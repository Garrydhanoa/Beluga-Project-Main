/**
 * Starting and lifting suspensions (rulebook 6.1.3).
 *
 * The moderation table is the source of truth: it gives the Suspended role and writes
 * SalSheet column L, and roleSync checks here before ever removing that role.
 *
 * Series suspensions count down in suspensionTicker.js. Someone unsigned, including a
 * dropped player, simply has no team series to count, so their count sits still until
 * they sign and sit the rest. That is 6.1.3 working as written, not a special case.
 *
 * Only one suspension runs at a time. Another one queues and starts when the current
 * one ends, and the role stays on throughout.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { pool, TransactionDB } = require('../utils/database');
const Logger = require('../utils/logger');
const { ROLES } = require('../constants/roles');
const { setCells } = require('../utils/salSheetWriter');
const store = require('./modStore');
const posting = require('./modPosting');
const { resolveTeam } = require('./release');

/** How long a time-based suspension runs from `from`. Null for the other units. */
function endsAtFrom(unit, total, from = new Date()) {
    if (unit === 'days') return new Date(from.getTime() + total * 86400 * 1000);
    if (unit === 'weeks') return new Date(from.getTime() + total * 7 * 86400 * 1000);
    return null;
}

// Rule 5.1.1: a player keeps their team unless a 4+ game suspension is given. Weeks
// and seasons are compared in series, at two series a week.
function offersRelease({ unit, total }) {
    if (unit === 'indefinite' || unit === 'seasons') return true;
    if (unit === 'series') return (total || 0) >= 4;
    if (unit === 'weeks') return (total || 0) >= 2;
    return false;
}

function releaseRow(suspensionId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`md:release:${suspensionId}`).setLabel('Release from team').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`md:keep:${suspensionId}`).setLabel('Keep on team').setStyle(ButtonStyle.Secondary),
    );
}

function suspensionDm(ctx, length) {
    const text = posting.suspensionLengthText(length.unit, length.total);
    const rule = ctx.rule ? `\nRule: ${ctx.rule.label}` : '';
    const how = length.unit === 'series'
        ? 'You cannot play until your team has completed that many series without you. If you are not on a team, it starts once you sign.'
        : 'You cannot play until it ends.';
    return `You have been suspended from Beluga League: ${text}.\n\nReason: ${ctx.reason}${rule}\n\n${how}`;
}

async function applyRole(guild, discordId, reason) {
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return null;
    if (member.roles.cache.has(ROLES.SUSPENDED)) return null;
    try {
        await member.roles.add(ROLES.SUSPENDED, reason);
        return null;
    } catch (err) {
        return `The Suspended role was not added: ${err.message}`;
    }
}

async function removeRole(guild, discordId, reason) {
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member?.roles.cache.has(ROLES.SUSPENDED)) return null;
    try {
        await member.roles.remove(ROLES.SUSPENDED, reason);
        return null;
    } catch (err) {
        return `The Suspended role was not removed: ${err.message}`;
    }
}

/** Column L follows "does this person have a running or queued suspension?". */
async function syncSheet(discordId) {
    const { rows } = await pool.query(
        `SELECT 1 FROM mod_suspensions WHERE discord_id = $1 AND status IN ('active','queued') LIMIT 1`,
        [String(discordId)],
    );
    const res = await setCells(discordId, { L: rows.length ? 'YES' : '' });
    await pool.query('UPDATE mod_suspensions SET sheet_synced = $2 WHERE discord_id = $1', [String(discordId), !!res.ok]);
    return res;
}

async function logTransaction(ctx, team, type, details) {
    try {
        await TransactionDB.log({
            discordId: ctx.target.id,
            discordUsername: ctx.target.name,
            teamId: team?.teamId || null,
            teamNameSnapshot: team?.teamName || null,
            type,
            details,
            performedByDiscordId: ctx.actor?.id || null,
            performedByUsername: ctx.actor?.name || null,
            source: 'bot:moderation',
        });
    } catch (err) {
        Logger.warning(`moderation: transaction log failed: ${err.message}`);
    }
}

async function startSuspension(ctx, c, length, problems) {
    const { once } = require('./actions');
    const team = await resolveTeam(ctx.target.id).catch(() => null);
    const row = await once(c, 'suspension', problems, async () => {
        const running = await pool.query(
            `SELECT 1 FROM mod_suspensions WHERE discord_id = $1 AND status = 'active' LIMIT 1`,
            [ctx.target.id],
        );
        const status = running.rows.length ? 'queued' : 'active';
        const season = await pool.query(`SELECT id, season_number FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
        const now = new Date();
        const inserted = await pool.query(
            `INSERT INTO mod_suspensions
                (case_id, discord_id, unit, total, status, starts_at, ends_at, team_id, team_name, division,
                 season_id, target_season_number, release_state)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
            [
                c.id, ctx.target.id, length.unit, length.total, status,
                status === 'active' ? now : null,
                status === 'active' ? endsAtFrom(length.unit, length.total, now) : null,
                team?.teamId || null, team?.teamName || null, team?.division || null,
                season.rows[0]?.id || null,
                length.unit === 'seasons' ? (season.rows[0]?.season_number || 0) + length.total : null,
                team && offersRelease(length) ? 'offered' : null,
            ],
        );
        return { value: inserted.rows[0].id };
    });
    if (!row) return null;

    await once(c, 'suspended_role', problems, async () => {
        const problem = await applyRole(ctx.guild, ctx.target.id, `Case ${c.id}: ${ctx.reason}`.slice(0, 512));
        return problem ? { problem } : { value: true };
    });
    await once(c, 'sheet', problems, async () => {
        const res = await syncSheet(ctx.target.id);
        return res.ok ? { value: res.rows } : { problem: `SalSheet column L was not updated: ${res.error}. It will retry.` };
    });
    const { rows } = await pool.query('SELECT * FROM mod_suspensions WHERE id = $1', [row]);
    await once(c, 'suspension_post', problems, async () => {
        const msg = await posting.postSuspension(ctx.client, c, rows[0]);
        if (msg) await store.setMessageId(c.id, 'suspensions', msg.id);
        return msg ? { value: msg.id } : { problem: 'The suspension was not posted in #player-suspensions.' };
    });
    await once(c, 'transaction', problems, async () => {
        await logTransaction(ctx, team, 'suspend', {
            length: posting.suspensionLengthText(length.unit, length.total), reason: ctx.reason, caseId: c.id,
        });
        return { value: true };
    });
    if (rows[0]?.release_state === 'offered') {
        ctx.components = [...(ctx.components || []), releaseRow(row)];
    }
    return rows[0];
}

/**
 * End one suspension. `quiet` skips the #general ping, for staff lifting it early or
 * voiding it, where "has been served" would be false.
 */
async function lift(client, guild, suspension, { reason, actor = null, status = 'lifted', quiet = false, problems = [] }) {
    const claimed = await pool.query(
        `UPDATE mod_suspensions SET status = $2, lifted_at = NOW(), lifted_by_id = $3, lifted_by_name = $4, lift_reason = $5
          WHERE id = $1 AND status IN ('active','queued') RETURNING *`,
        [suspension.id, status, actor?.id || null, actor?.name || null, String(reason || '').slice(0, 500)],
    );
    if (!claimed.rows.length) return false;
    const id = suspension.discord_id;
    const left = await pool.query(
        `SELECT 1 FROM mod_suspensions WHERE discord_id = $1 AND status IN ('active','queued') LIMIT 1`,
        [id],
    );
    if (!left.rows.length) {
        const problem = await removeRole(guild, id, `Suspension ended: ${reason}`.slice(0, 512));
        if (problem) problems.push(problem);
        if (!quiet) await posting.postSuspensionLifted(client, id);
    }
    const sheet = await syncSheet(id);
    if (!sheet.ok) problems.push(`SalSheet column L was not updated: ${sheet.error}. It will retry.`);
    await store.logEvent({
        discordId: id, caseId: suspension.case_id, kind: 'suspension_end',
        summary: `Suspension on case ${suspension.case_id} ended: ${reason}`,
        actorId: actor?.id, actorName: actor?.name,
    });
    await logTransaction(
        { target: { id, name: null }, actor },
        suspension.team_id ? { teamId: suspension.team_id, teamName: suspension.team_name } : null,
        'reinstate',
        { reason, caseId: suspension.case_id },
    );
    if (!left.rows.length) {
        const { noteLifted } = require('./threadNotices');
        await noteLifted(client, suspension).catch((err) => Logger.warning(`moderation thread lift note failed: ${err.message}`));
    }
    return true;
}

async function liftAllFor(ctx, rows, { reason, problems = [], quiet = true }) {
    for (const row of rows) {
        await lift(ctx.client, ctx.guild, row, { reason, actor: ctx.actor, status: 'lifted', quiet, problems });
    }
}

/** Everyone who should hold the role right now. roleSync reads this. */
async function activeSuspendedIds() {
    const { rows } = await pool.query(`SELECT DISTINCT discord_id FROM mod_suspensions WHERE status IN ('active','queued')`);
    return new Set(rows.map((r) => r.discord_id));
}

/** Adds a warning to a sign request. Must never stop a transaction, so it can't throw. */
async function addSuspensionWarning(embed, discordId) {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM mod_suspensions WHERE discord_id = $1 AND status IN ('active','queued') ORDER BY id`,
            [String(discordId)],
        );
        if (!rows.length) return;
        const { suspensionLine } = require('./modViews');
        embed.addFields({
            name: 'Suspended',
            value: posting.clip(`This player is suspended: ${rows.map(suspensionLine).join('; ')}. They cannot play until it is served.`),
        });
    } catch (err) {
        Logger.warning(`Could not check for a suspension on a sign request: ${err.message}`);
    }
}

/** Leaving and rejoining must not shake off a suspension. */
async function reapplyOnJoin(member) {
    const { rows } = await pool.query(
        `SELECT 1 FROM mod_suspensions WHERE discord_id = $1 AND status IN ('active','queued') LIMIT 1`,
        [member.id],
    );
    if (rows.length) await member.roles.add(ROLES.SUSPENDED, 'Active suspension re-applied on rejoin');
}

async function activate(row) {
    const now = new Date();
    await pool.query(
        `UPDATE mod_suspensions SET status = 'active', starts_at = $2, ends_at = $3 WHERE id = $1 AND status = 'queued'`,
        [row.id, now, endsAtFrom(row.unit, row.total, now)],
    );
}

module.exports = {
    endsAtFrom, offersRelease, releaseRow, suspensionDm, syncSheet, startSuspension,
    lift, liftAllFor, activeSuspendedIds, addSuspensionWarning, reapplyOnJoin, activate,
};
