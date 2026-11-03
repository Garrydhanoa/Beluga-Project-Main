/**
 * Week-thread notices for suspended players: one reminder per suspension per thread
 * telling the team's GM, AGM and captain the player can't play, and a follow-up in any
 * thread still open when the suspension lifts.
 *
 * This only sends into existing threads. The week-thread creation path is untouched.
 * Reminders use Discord user ids rather than role pings because a GM role covers all
 * three franchise teams and a captain role covers a whole division.
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const { ROLES } = require('../constants/roles');
const { sameDivision } = require('../utils/primaryDivision');
const { getTeamDiscordRoles } = require('../utils/teamRoles');
const { divisionKey } = require('./release');
const { suspensionLengthText } = require('./modPosting');
const { getGuild } = require('./modGuild');

async function openThreads(seasonId, teamName, division) {
    const { rows } = await pool.query(
        `SELECT id, thread_id, week_number, division, team1, team2 FROM week_threads
          WHERE season_id = $1 AND is_closed = FALSE AND thread_id IS NOT NULL
            AND (LOWER(team1) = LOWER($2) OR LOWER(team2) = LOWER($2))`,
        [seasonId, teamName],
    );
    return rows.filter((r) => sameDivision(r.division, division));
}

/** The team's GM, AGM and captain as user ids. Roles must be cached to read members. */
async function teamLeaders(guild, team) {
    const wiring = await getTeamDiscordRoles(team.teamId);
    const ids = new Set();
    const gmRoleId = wiring?.gmRoleId || null;
    const agmRoleId = wiring?.agmRoleId || null;
    for (const roleId of [gmRoleId, agmRoleId].filter(Boolean)) {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        for (const id of role?.members?.keys?.() || []) ids.add(id);
    }

    const captainRoleId = ROLES.CAPTAINS[divisionKey(team.division)];
    const captainRole = captainRoleId ? await guild.roles.fetch(captainRoleId).catch(() => null) : null;
    if (captainRole) {
        const { rows } = await pool.query(
            `SELECT discord_role_id FROM teams WHERE is_active = TRUE AND discord_role_id IS NOT NULL AND LOWER(name) = LOWER($1)`,
            [team.teamName],
        );
        const teamRoleIds = new Set(rows.map((r) => r.discord_role_id));
        if (wiring?.npRoleId) teamRoleIds.add(wiring.npRoleId);
        for (const [id, member] of captainRole.members) {
            if ([...teamRoleIds].some((roleId) => member.roles.cache.has(roleId))) ids.add(id);
        }
    }
    return [...ids];
}

async function sendInThread(client, threadId, payload) {
    const thread = await client.channels.fetch(threadId);
    // An archived thread swallows the send silently.
    if (thread.archived) await thread.setArchived(false).catch(() => {});
    return thread.send(payload);
}

async function claim(suspensionId, threadId, kind) {
    const { rowCount } = await pool.query(
        `INSERT INTO mod_thread_notices (suspension_id, thread_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [suspensionId, threadId, kind],
    );
    return rowCount > 0;
}

async function remindOpenThreads(client, suspension, team) {
    if (!team?.teamName) return;
    const guild = getGuild(client);
    if (!guild) return;
    const threads = await openThreads(team.seasonId, team.teamName, team.division);
    if (!threads.length) return;

    const left = suspension.unit === 'series' ? Math.max((suspension.total || 0) - (suspension.served || 0), 0) : null;
    const lengthText = left !== null
        ? `${left} series left`
        : suspensionLengthText(suspension.unit, suspension.total);

    for (const thread of threads) {
        if (!(await claim(suspension.id, thread.thread_id, 'reminder'))) continue;
        try {
            const leaders = await teamLeaders(guild, team);
            await sendInThread(client, thread.thread_id, {
                content: `${leaders.map((id) => `<@${id}>`).join(' ')}\nReminder: <@${suspension.discord_id}> is suspended and cannot play this series (${lengthText}).`.trim(),
                allowedMentions: { parse: [], users: leaders },
            });
        } catch (err) {
            await pool.query(
                `DELETE FROM mod_thread_notices WHERE suspension_id = $1 AND thread_id = $2 AND kind = 'reminder'`,
                [suspension.id, thread.thread_id],
            ).catch(() => {});
            Logger.warning(`moderation: reminder for suspension ${suspension.id} failed in ${thread.thread_id}: ${err.message}`);
        }
    }
}

/** Threads that already carry a reminder and are still open get an all-clear. */
async function noteLifted(client, suspension) {
    const { rows } = await pool.query(
        `SELECT n.thread_id FROM mod_thread_notices n
           JOIN week_threads w ON w.thread_id = n.thread_id
          WHERE n.suspension_id = $1 AND n.kind = 'reminder' AND w.is_closed = FALSE`,
        [suspension.id],
    );
    for (const row of rows) {
        if (!(await claim(suspension.id, row.thread_id, 'lifted'))) continue;
        await sendInThread(client, row.thread_id, {
            content: `<@${suspension.discord_id}>'s suspension has ended and they are eligible for this series.`,
            allowedMentions: { parse: [] },
        }).catch((err) => Logger.warning(`moderation: lift note failed in ${row.thread_id}: ${err.message}`));
    }
}

module.exports = { remindOpenThreads, noteLifted, teamLeaders };
