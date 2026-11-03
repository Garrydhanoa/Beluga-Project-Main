/**
 * Website → bot queue for the Mod Logs tab (`mod_actions`). The website only reads and
 * records; anything that touches Discord or the sheet comes through here, so the admin
 * panel runs the same engine as the slash commands.
 *
 * NOTIFY gives near-instant pickup, the poll is the fallback, and `FOR UPDATE SKIP
 * LOCKED` means two bot instances can't both take a row. A row left `running` by a
 * crash goes back to pending; retrying is safe because each action finds its case by
 * `action_id` and skips the steps already recorded on it.
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { db, ensureModSchema } = require('./modSchema');
const { ruleByCode, clearSettingsCache } = require('./modConfig');
const { getGuild } = require('./modGuild');
const actions = require('./actions');

const POLL_MS = 10 * 1000;
const STUCK_MINUTES = 5;
const MAX_ATTEMPTS = 3;

let running = false;
let listenClient = null;

function contextFor(client, row) {
    const p = row.payload || {};
    return {
        client,
        guild: getGuild(client),
        target: { id: String(p.targetId || ''), name: p.targetName || null },
        actor: { id: row.requested_by_discord_id, name: row.requested_by_username, source: 'website' },
        rule: p.ruleCode ? ruleByCode(p.ruleCode) : null,
        reason: p.reason,
        silent: !!p.silent,
        actionId: row.id,
    };
}

async function perform(client, row) {
    const p = row.payload || {};
    const ctx = contextFor(client, row);
    switch (row.action) {
        case 'note': return actions.note(ctx);
        case 'warn': return actions.warn(ctx);
        case 'timeout': return actions.timeout(ctx, { seconds: p.seconds });
        case 'untimeout': return actions.untimeout(ctx);
        case 'kick': return actions.kick(ctx);
        case 'strike': return actions.strike(ctx, p.pkg);
        case 'unstrike': return actions.unstrike(ctx);
        case 'set_strikes': return actions.setStrikes(ctx, p.count);
        case 'suspend': return actions.suspend(ctx, p.length);
        case 'unsuspend': return actions.unsuspend(ctx);
        case 'ban': return actions.ban(ctx, p.ban);
        case 'unban': return actions.unban(ctx);
        case 'void': return actions.voidCase(ctx, p.caseId);
        case 'reason': return actions.changeReason(ctx, p.caseId, p.reason);
        case 'release': {
            const { releasePlayer } = require('./release');
            const res = await releasePlayer({
                client, guild: ctx.guild, discordId: ctx.target.id, playerName: ctx.target.name,
                actor: ctx.actor, reason: p.reason,
            });
            if (p.suspensionId) await pool.query('UPDATE mod_suspensions SET release_state = $2 WHERE id = $1', [p.suspensionId, res.ok ? 'released' : 'offered']);
            return { summary: res.ok ? `Released from ${res.team.teamName}.` : `Not released: ${res.skipped}`, problems: res.problems };
        }
        case 'lift_freeze':
            return require('./rogueBrake').unfreeze(p.staffId, ctx.actor);
        case 'appeal_decide':
            return require('./appeals').decide(client, p.appealId, { verdict: p.verdict, note: p.note, actor: ctx.actor });
        case 'appeal_post':
            return require('./appeals').postPending(client);
        case 'history_import':
            return require('./historyImport').importHistory(client, { actor: ctx.actor });
        case 'filter_reload':
            clearSettingsCache();
            await require('./filter/matcher').reload();
            return { summary: 'Reloaded the chat filter settings and word lists.', problems: [] };
        case 'filter_test':
            return { summary: await require('./filter').testMessage(p.text), problems: [] };
        default:
            throw new Error(`Unknown moderation action "${row.action}"`);
    }
}

function resultText(res) {
    const problems = res?.problems?.length ? ` Not completed: ${res.problems.join(' ')}` : '';
    return `${res?.summary || 'Done.'}${problems}`.slice(0, 1000);
}

async function recover() {
    await pool.query(
        `UPDATE mod_actions SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END,
                result = CASE WHEN attempts >= $2 THEN 'Gave up after repeated restarts while running.' ELSE result END
          WHERE status = 'running' AND started_at < NOW() - make_interval(mins => $1)`,
        [STUCK_MINUTES, MAX_ATTEMPTS],
    );
}

async function drain(client) {
    if (running || !db()) return;
    running = true;
    try {
        if (!(await ensureModSchema())) return;
        await recover();
        for (;;) {
            const claimed = await pool.query(`
                UPDATE mod_actions SET status = 'running', started_at = NOW(), attempts = attempts + 1
                 WHERE id = (SELECT id FROM mod_actions WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
                 RETURNING *`);
            const row = claimed.rows[0];
            if (!row) break;
            try {
                const res = await perform(client, row);
                const text = resultText(res);
                await pool.query(`UPDATE mod_actions SET status = 'done', result = $2, fulfilled_at = NOW() WHERE id = $1`, [row.id, text]);
                actions.logJob(`moderation.${row.action}`, `carried out "${row.action}" from the admin panel: ${text}`, {
                    actor: { name: row.requested_by_username || 'Admin panel', id: row.requested_by_discord_id },
                    target: row.payload?.targetId || null,
                    details: [['Result', text]],
                });
            } catch (err) {
                const message = String(err.message || err).slice(0, 500);
                await pool.query(`UPDATE mod_actions SET status = 'failed', result = $2, fulfilled_at = NOW() WHERE id = $1`, [row.id, message]).catch(() => {});
                if (!(err instanceof actions.ModError)) {
                    Logger.error(`Moderation action ${row.id} (${row.action}) failed`, err);
                    higgenLog.logFailure({ summary: `A moderation action from the website ("${row.action}") failed: ${err.message}`, error: err, action: `moderation.${row.action}`, where: 'Moderation queue' });
                }
            }
        }
    } catch (err) {
        Logger.error('Moderation queue drain failed', err);
    } finally {
        running = false;
    }
}

async function startListener(client) {
    try {
        listenClient = await pool.connect();
        listenClient.on('notification', () => { drain(client); });
        listenClient.on('error', (err) => {
            Logger.warning(`Moderation listener dropped (${err.message}); polling continues.`);
            try { listenClient.release(err); } catch { /* already gone */ }
            listenClient = null;
            setTimeout(() => startListener(client), 10 * 1000);
        });
        await listenClient.query('LISTEN mod_actions');
    } catch (err) {
        Logger.warning(`Moderation listener could not start (${err.message}); polling only.`);
        listenClient = null;
    }
}

function startModActions(client) {
    startListener(client);
    setInterval(() => drain(client), POLL_MS);
    setTimeout(() => drain(client), POLL_MS);
}

module.exports = { startModActions, drain };
