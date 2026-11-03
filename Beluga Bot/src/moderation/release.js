/**
 * Team lookup and releasing a player from their team without an interaction.
 *
 * /drop's completion step is private and edits the reaction message it came from,
 * so this reproduces its effects for moderation: team, NP and captain roles off, Free
 * Agent role on, sheet I=YES M=YES K=NO W=blank, a post in transactions, a
 * transaction row and a roster refresh.
 *
 * A GM's roster row comes from their franchise role, so a release would simply be
 * rebuilt. GMs and AGMs are never released here; staff get a prompt instead.
 */

const { EmbedBuilder } = require('discord.js');
const { pool, TransactionDB } = require('../utils/database');
const Logger = require('../utils/logger');
const { ROLES, TEAM_ROLES, NP_ROLES, CHANNELS } = require('../constants/roles');
const { pickPrimaryRoster } = require('../utils/primaryDivision');
const { getSheetLeague } = require('../utils/salSheetLookup');
const { divisionLabel } = require('../utils/divisionLabels');
const { setCells } = require('../utils/salSheetWriter');

function divisionKey(division) {
    const d = String(division || '').toUpperCase();
    return d.startsWith('MAJOR') ? 'MAJORS' : d;
}

/**
 * The player's team this season, or null when they're unsigned. A GM sits on all
 * three franchise teams, so pickPrimaryRoster chooses the one that counts.
 */
async function resolveTeam(discordId, seasonId = null) {
    const id = String(discordId);
    const { rows } = await pool.query(
        `SELECT m.team_id, m.role, t.name AS team_name, t.division, t.season_id
           FROM team_roster_members m
           JOIN teams t ON t.id = m.team_id
           JOIN seasons s ON s.id = m.season_id
          WHERE m.discord_id = $1 AND m.is_active = TRUE AND t.is_active = TRUE
            AND ($2::int IS NULL AND s.status = 'active' OR m.season_id = $2)`,
        [id, seasonId],
    );
    if (!rows.length) return null;
    const [sheetLeague, stats] = await Promise.all([
        getSheetLeague(id).catch(() => null),
        pool.query(
            `SELECT division FROM stats_player_season
              WHERE discord_id = $1 AND season_id = $2 AND is_playoff = FALSE
              ORDER BY games DESC LIMIT 1`,
            [id, rows[0].season_id],
        ).catch(() => ({ rows: [] })),
    ]);
    const picked = pickPrimaryRoster(rows, { sheetLeague, statsDivision: stats.rows[0]?.division || null });
    if (!picked) return null;
    return {
        teamId: picked.team_id, teamName: picked.team_name, division: picked.division, role: picked.role,
        seasonId: picked.season_id, isManager: rows.some((r) => ['gm', 'agm'].includes(String(r.role).toLowerCase())),
    };
}

async function removeRoles(member, team) {
    const key = divisionKey(team.division);
    const toRemove = [TEAM_ROLES[key]?.[team.teamName], NP_ROLES[team.teamName], ...Object.values(ROLES.CAPTAINS)].filter(Boolean);
    for (const roleId of toRemove) {
        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Released by the moderation system');
    }
    const freeAgent = ROLES.FREE_AGENTS[key];
    if (freeAgent) await member.roles.add(freeAgent, 'Released by the moderation system');
}

/**
 * @param {object} opts
 * @param {object} [opts.team] a snapshot from resolveTeam, taken before a ban removes them
 * @returns {Promise<{ok:boolean, skipped?:string, team?:object, problems:string[]}>}
 */
async function releasePlayer({ client, guild, discordId, playerName = null, actor, reason, team = null }) {
    const problems = [];
    const current = team || await resolveTeam(discordId);
    if (!current) return { ok: false, skipped: 'They are not on a team.', problems };
    if (current.isManager) return { ok: false, skipped: 'They are a GM or AGM, so staff must handle their franchise role.', team: current, problems };

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (member) {
        try {
            await removeRoles(member, current);
        } catch (err) {
            problems.push(`Team roles were not changed: ${err.message}`);
        }
    }

    const sheet = await setCells(discordId, { I: 'YES', M: 'YES', K: 'NO', W: '' });
    if (!sheet.ok) problems.push(`The SalSheet was not updated: ${sheet.error}`);

    try {
        const channel = await client.channels.fetch(CHANNELS.TRANSACTION_CONFIRMATION);
        await channel.send({
            content: `<@${discordId}>`,
            embeds: [new EmbedBuilder()
                .setTitle(`${current.teamName} released ${playerName || 'a player'}`.slice(0, 256))
                .setDescription(`<@${discordId}> has been released from ${divisionLabel(current.division)} by league staff.`)
                .setColor(0xFF6B6B)
                .setTimestamp()],
            allowedMentions: { parse: [] },
        });
    } catch (err) {
        problems.push(`The transaction post failed: ${err.message}`);
    }

    try {
        await TransactionDB.log({
            discordId,
            discordUsername: playerName,
            teamId: current.teamId,
            teamNameSnapshot: current.teamName,
            type: 'drop',
            details: { division: current.division, moderation: true, reason },
            performedByDiscordId: actor?.id || null,
            performedByUsername: actor?.name || null,
            source: 'bot:moderation',
        });
    } catch (err) {
        problems.push(`The transaction record failed: ${err.message}`);
    }

    try {
        const { updateDivisionRoster } = require('../utils/rosterManager');
        await updateDivisionRoster(client, divisionKey(current.division));
    } catch (err) {
        Logger.error('moderation release: roster refresh failed', err);
        problems.push(`The roster refresh failed: ${err.message}`);
    }
    return { ok: true, team: current, problems };
}

module.exports = { resolveTeam, releasePlayer, divisionKey };
