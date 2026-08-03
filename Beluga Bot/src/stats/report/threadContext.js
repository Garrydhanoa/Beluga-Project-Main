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
 * Every active team id belonging to the same FRANCHISE as `teamId` (any division,
 * same season). A franchise fields one team per division, so this is how a member
 * who plays in one division is linked to their franchise's team in another.
 * Returns [] when the team has no franchise (behaviour then matches the old rules).
 */
async function getFranchiseSiblingTeamIds(seasonId, teamId) {
    if (!db() || !teamId) return [];
    try {
        const r = await pool.query(
            `SELECT sib.id
             FROM teams t
             JOIN teams sib ON sib.franchise_id = t.franchise_id
             WHERE t.id = $1 AND t.franchise_id IS NOT NULL
               AND sib.season_id = $2 AND sib.is_active = TRUE`,
            [teamId, seasonId]
        );
        return r.rows.map((row) => row.id);
    } catch (err) {
        Logger.error('getFranchiseSiblingTeamIds failed', err);
        return [];
    }
}

/**
 * Which of the two teams (if any) the user is an authorized captain/GM for.
 * Recognised via ANY of:
 *   - the team's GM Discord role (franchise-wide, so GMs already cross divisions),
 *   - the division captain Discord role + being on that team (role or roster),
 *   - the DB roster role being 'captain'/'gm' for that team,
 *   - the division captain Discord role + the franchise's NP (non-playing) role.
 *     An NP is franchise staff and carries no team or division role, so an NP
 *     captain used to fail every other check — this is what stopped e.g. a AAA
 *     captain wearing only their franchise's NP role from reporting AAA series.
 *   - the division captain Discord role + belonging to that team's FRANCHISE in
 *     ANY division (a AAA player holding the AA captain role can report their
 *     franchise's AA series even though they have no AA team role).
 * @param {import('discord.js').GuildMember} member
 * @param {{id:number,name:string}} homeTeam
 * @param {{id:number,name:string}} awayTeam
 * @returns {Promise<'home'|'away'|null>}
 */
async function getUserAuthorizedTeam(member, seasonId, homeTeam, awayTeam, division) {
    const discordId = member?.id || member?.user?.id;
    if (!discordId) return null;

    // Franchise siblings of the two matchup teams (one team per division each).
    const [homeSiblings, awaySiblings] = await Promise.all([
        getFranchiseSiblingTeamIds(seasonId, homeTeam.id),
        getFranchiseSiblingTeamIds(seasonId, awayTeam.id),
    ]);

    // DB roster rows for this user on either of the two teams OR anywhere in
    // their franchises. Keyed by team id; the per-team checks below still only
    // look up the two matchup teams, so the original rules are unchanged.
    const rosterByTeam = new Map();
    if (db()) {
        const teamIds = Array.from(new Set([homeTeam.id, awayTeam.id, ...homeSiblings, ...awaySiblings]));
        try {
            const r = await pool.query(
                `SELECT team_id, role FROM team_roster_members
                 WHERE season_id = $1 AND discord_id = $2 AND is_active = TRUE
                   AND team_id = ANY($3::int[])`,
                [seasonId, String(discordId), teamIds]
            );
            for (const row of r.rows) rosterByTeam.set(row.team_id, row.role);
        } catch (err) {
            Logger.error('getUserAuthorizedTeam roster lookup failed', err);
        }
    }

    const { getTeamDiscordRoles, getCaptainRoleId } = require('../../utils/teamRoles');
    const captainRoleId = getCaptainRoleId(division);
    const hasRole = (id) => Boolean(id && member?.roles?.cache?.has(id));

    // Franchise link: a roster row on, or the Discord team/NP role of, ANY of
    // the franchise's teams. Only consulted for the captain branch below.
    // The NP role is franchise-wide (one per franchise, shared by all three of
    // its teams), so it links a non-playing captain to the franchise in every
    // division without them holding any team role at all.
    const isInFranchise = async (siblingIds) => {
        for (const id of siblingIds) {
            if (rosterByTeam.has(id)) return true;
        }
        for (const id of siblingIds) {
            // eslint-disable-next-line no-await-in-loop
            const sibRoles = await getTeamDiscordRoles(id);
            if (hasRole(sibRoles.teamRoleId) || hasRole(sibRoles.npRoleId)) return true;
        }
        return false;
    };

    // DB-first role resolution (teams.discord_role_id + franchise GM role),
    // with the legacy constants as a built-in fallback inside teamRoles.
    const isAuthorizedFor = async (team, siblingIds) => {
        const roles = await getTeamDiscordRoles(team.id);
        if (hasRole(roles.gmRoleId)) return true;                                  // franchise/team GM role
        if (hasRole(captainRoleId) && hasRole(roles.teamRoleId)) return true;      // division captain + on the team
        if (hasRole(captainRoleId) && hasRole(roles.npRoleId)) return true;        // division captain + franchise NP role
        const dbRole = rosterByTeam.get(team.id);
        if (dbRole === 'captain' || dbRole === 'gm') return true;                  // roster role (DB)
        if (hasRole(captainRoleId) && rosterByTeam.has(team.id)) return true;      // division captain + on this roster (DB)
        // Cross-division captain: holds THIS division's captain role and belongs
        // to this team's franchise in some other division.
        if (hasRole(captainRoleId) && await isInFranchise(siblingIds)) return true;
        return false;
    };

    if (await isAuthorizedFor(homeTeam, homeSiblings)) return 'home';
    if (await isAuthorizedFor(awayTeam, awaySiblings)) return 'away';
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
    getFranchiseSiblingTeamIds,
    getOnfieldCaps,
};
