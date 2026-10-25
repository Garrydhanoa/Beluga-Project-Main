/**
 * Website → bot queue for the invite campaign (`invite_actions`).
 *
 * Staff decisions are written to the DB by the website directly; anything that
 * has to SAY something in Discord is queued here. NOTIFY gives near-instant
 * pickup, the poll is the fallback, and `FOR UPDATE SKIP LOCKED` means two bot
 * instances can never double-send.
 *
 *   notify_registered { inviteeId }                  "your invitee registered" (+ DM)
 *   claim_rejected    { claimerId, inviteeId, reason }
 *   campaign_ended    { campaignId }                 final top 3 post
 *   refresh_board     {}                             redraw the live board now
 *   refresh_codes     {}                             re-pull the invite list
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { db, ensureInviteSchema } = require('./inviteSchema');
const notify = require('./inviteNotify');

let running = false;
let listenClient = null;

async function perform(client, row) {
    const p = row.payload || {};
    switch (row.action) {
        case 'notify_registered':
            return (await notify.sendRegistered(client, p.inviteeId)) ? 'Posted.' : 'Nothing to post (already announced or no longer counted).';
        case 'claim_rejected':
            await notify.sendClaimRejected(client, p.claimerId, p.inviteeId, p.reason || null);
            return 'Posted.';
        case 'campaign_ended': {
            const { rows } = await pool.query('SELECT * FROM invite_campaigns WHERE id = $1', [p.campaignId]);
            if (rows[0]) await notify.sendCampaignFinal(client, rows[0]);
            require('./liveBoard').refreshBoard(client, { force: true }).catch(() => {});
            return 'Posted.';
        }
        case 'refresh_board':
            await require('./liveBoard').refreshBoard(client, { force: true });
            return 'Refreshed.';
        case 'refresh_codes': {
            const guild = notify.getGuild(client);
            const n = guild ? await require('./inviteCache').refresh(guild) : 0;
            return `Synced ${n} invite(s).`;
        }
        default:
            throw new Error(`Unknown invite action "${row.action}"`);
    }
}

async function drain(client) {
    if (running || !db()) return;
    running = true;
    try {
        if (!(await ensureInviteSchema())) return;
        for (;;) {
            const claimed = await pool.query(`
                UPDATE invite_actions SET status = 'running'
                 WHERE id = (SELECT id FROM invite_actions WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
                 RETURNING *`);
            const row = claimed.rows[0];
            if (!row) break;
            try {
                const result = await perform(client, row);
                await pool.query(`UPDATE invite_actions SET status = 'done', result = $2, fulfilled_at = NOW() WHERE id = $1`, [row.id, result]);
            } catch (err) {
                await pool.query(`UPDATE invite_actions SET status = 'failed', result = $2, fulfilled_at = NOW() WHERE id = $1`, [row.id, String(err.message || err).slice(0, 500)]).catch(() => {});
                Logger.error(`Invite action ${row.id} (${row.action}) failed`, err);
                higgenLog.logFailure({ summary: `A queued invite action from the website ("${row.action}") failed: ${err.message}`, error: err, action: `invites.${row.action}`, where: 'Invite action queue' });
            }
        }
    } catch (err) {
        Logger.error('Invite action queue drain failed', err);
    } finally {
        running = false;
    }
}

async function startListener(client) {
    try {
        listenClient = await pool.connect();
        listenClient.on('notification', () => { drain(client); });
        listenClient.on('error', (err) => {
            Logger.warning(`Invite action listener dropped (${err.message}); polling continues.`);
            try { listenClient.release(err); } catch { /* already gone */ }
            listenClient = null;
            setTimeout(() => startListener(client), 10 * 1000);
        });
        await listenClient.query('LISTEN invite_actions');
    } catch (err) {
        Logger.warning(`Invite action listener could not start (${err.message}); polling only.`);
        listenClient = null;
    }
}

function startInviteActions(client) {
    startListener(client);
    setInterval(() => drain(client), 10 * 1000);
    setTimeout(() => drain(client), 10 * 1000);
}

module.exports = { startInviteActions, drain };
