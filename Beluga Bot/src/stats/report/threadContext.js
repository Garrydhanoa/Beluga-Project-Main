/**
 * Thread → matchup resolution + rosters + permissions for the report flow.
 *
 * A week thread (week_threads, keyed by thread_id) tells us season/division/week
 * and the two team NAMES. We resolve those to team ids, find the canonical
 * home/away + schedule_match_id from schedule_matches, and load each team's
 * active roster (team_roster_members) for matching + permission checks.
 */

const { pool, isDatabaseAvailable } = require('../../utils/database');
const { ROLES, TEAM_ROLES } = require('../../constants/roles');
const Logger = require('../../utils/logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

/**
 * Resolve a week thread to a full matchup context.
 * @returns {Promise<null | {
 *   seasonId, division, week, isPlayoff, format,
 *   homeTeam: {id, name}, awayTeam: {id, name},
 *   scheduleMatchId: number|null, isClosed: boolean
 * }>}
 */
async function resolveThreadContext(threadId) {
    if (!db() || !threadId) return null;
    try {
        const wt = await pool.query(
            `SELECT season_id, division, week_number, team1, team2, is_closed
             FROM week_threads WHERE thread_id = $1 LIMIT 1`,
            [String(threadId)]
        );
        if (!wt.rows.length) return null;
        const row = wt.rows[0];
        const seasonId = row.season_id;
        const division = row.division;
        const week = row.week_number;

        // Resolve the two team names to active team rows in this season+division.
        const teamsRes = await pool.query(
            `SELECT id, name FROM teams
             WHERE season_id = $1 AND division = $2 AND is_active = TRUE
               AND LOWER(name) IN (LOWER($3), LOWER($4))`,
            [seasonId, division, row.team1, row.team2]
        );
        const byName = new Map(teamsRes.rows.map((t) => [t.name.toLowerCase(), t]));
        const t1 = byName.get(String(row.team1).toLowerCase());
        const t2 = byName.get(String(row.team2).toLowerCase());
        if (!t1 || !t2) {
            Logger.warning(`resolveThreadContext: could not resolve both teams (${row.team1} / ${row.team2}) in S${seasonId} ${division}`);
            return null;
        }

        // Canonical home/away + schedule_match_id (either name order).
        let scheduleMatchId = null;
        let homeTeam = t1;
        let awayTeam = t2;
        const sm = await pool.query(
            `SELECT id, home_team_id, away_team_id FROM schedule_matches
             WHERE season_id = $1 AND division = $2 AND week = $3
               AND ((home_team_id = $4 AND away_team_id = $5) OR (home_team_id = $5 AND away_team_id = $4))
             ORDER BY is_published DESC
             LIMIT 1`,
            [seasonId, division, week, t1.id, t2.id]
        );
        if (sm.rows.length) {
            scheduleMatchId = sm.rows[0].id;
            const homeId = sm.rows[0].home_team_id;
            homeTeam = homeId === t1.id ? t1 : t2;
            awayTeam = homeId === t1.id ? t2 : t1;
        }

        // Playoff threads use week_number >= 90 by convention (regular weeks are
        // small). Playoff series can also always be reported via /staff-report.
        const isPlayoff = week != null && Number(week) >= 90;
        return {
            seasonId,
            division,
            week,
            isPlayoff,
            format: isPlayoff ? 'bo7' : 'bo5',
            homeTeam: { id: homeTeam.id, name: homeTeam.name },
            awayTeam: { id: awayTeam.id, name: awayTeam.name },
            scheduleMatchId,
            isClosed: Boolean(row.is_closed),
        };
    } catch (err) {
        Logger.error('resolveThreadContext failed', err);
        return null;
    }
}

/** Active roster members for a team (for matching + permissions). */
async function getTeamRoster(seasonId, teamId) {
    if (!db() || !teamId) return [];
    try {
        const r = await pool.query(
            `SELECT discord_id, discord_username, display_name, role
             FROM team_roster_members
             WHERE season_id = $1 AND team_id = $2 AND is_active = TRUE
             ORDER BY (role = 'gm') DESC, (role = 'captain') DESC, display_name`,
            [seasonId, teamId]
        );
        return r.rows.map((m) => ({
            discordId: m.discord_id,
            username: m.discord_username,
            displayName: m.display_name || m.discord_username || `User ${String(m.discord_id).slice(-4)}`,
            role: m.role,
        }));
    } catch (err) {
        Logger.error('getTeamRoster failed', err);
        return [];
    }
}

function isSalaryCrew(member) {
    return Boolean(member?.roles?.cache?.has(ROLES.SALARY_CREW));
}

/**
 * Which of the two teams (if any) the user is an authorized captain/GM for.
 * Recognised via ANY of:
 *   - the team's GM Discord role (ROLES.GM_ROLES[name]),
 *   - the division captain Discord role + being on that team's roster,
 *   - the DB roster role being 'captain'/'gm' for that team.
 * (The Discord-role checks will move to DB-sourced roles in the B4 migration.)
 * @param {import('discord.js').GuildMember} member
 * @param {{id:number,name:string}} homeTeam
 * @param {{id:number,name:string}} awayTeam
 * @returns {Promise<'home'|'away'|null>}
 */
async function getUserAuthorizedTeam(member, seasonId, homeTeam, awayTeam, division) {
    const discordId = member?.id || member?.user?.id;
    if (!discordId) return null;

    // DB roster rows for this user on either of the two teams.
    const rosterByTeam = new Map();
    if (db()) {
        try {
            const r = await pool.query(
                `SELECT team_id, role FROM team_roster_members
                 WHERE season_id = $1 AND discord_id = $2 AND is_active = TRUE AND team_id IN ($3, $4)`,
                [seasonId, String(discordId), homeTeam.id, awayTeam.id]
            );
            for (const row of r.rows) rosterByTeam.set(row.team_id, row.role);
        } catch (err) {
            Logger.error('getUserAuthorizedTeam roster lookup failed', err);
        }
    }

    const { getTeamDiscordRoles, getCaptainRoleId } = require('../../utils/teamRoles');
    const captainRoleId = getCaptainRoleId(division);
    const hasRole = (id) => Boolean(id && member?.roles?.cache?.has(id));

    // DB-first role resolution (teams.discord_role_id + franchise GM role),
    // with the legacy constants as a built-in fallback inside teamRoles.
    const isAuthorizedFor = async (team) => {
        const roles = await getTeamDiscordRoles(team.id);
        if (hasRole(roles.gmRoleId)) return true;                                  // franchise/team GM role
        if (hasRole(captainRoleId) && hasRole(roles.teamRoleId)) return true;      // division captain + on the team
        const dbRole = rosterByTeam.get(team.id);
        if (dbRole === 'captain' || dbRole === 'gm') return true;                  // roster role (DB)
        if (hasRole(captainRoleId) && rosterByTeam.has(team.id)) return true;      // division captain + on this roster (DB)
        return false;
    };

    if (await isAuthorizedFor(homeTeam)) return 'home';
    if (await isAuthorizedFor(awayTeam)) return 'away';
    return null;
}

/** Read on-field salary caps for a season (per division). */
async function getOnfieldCaps(seasonId) {
    if (!db()) return {};
    try {
        const r = await pool.query(`SELECT onfield_caps FROM season_config WHERE season_id = $1`, [seasonId]);
        return r.rows[0]?.onfield_caps || {};
    } catch {
        return {};
    }
}

module.exports = {
    resolveThreadContext,
    getTeamRoster,
    isSalaryCrew,
    getUserAuthorizedTeam,
    getOnfieldCaps,
};
