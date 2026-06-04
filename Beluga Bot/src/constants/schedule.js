/**
 * League Schedule (DB-backed).
 *
 * The match schedule is the single source of truth in Postgres (`schedule_matches`,
 * read via LeagueDB.getScheduleMatches for the active season). The old hardcoded
 * MAJORS_SCHEDULE / AAA_AA_SCHEDULE arrays were removed — every schedule lookup now
 * reads from the DB. If the DB has no published schedule for a week, the lookup
 * returns empty (no hardcoded fallback). The constants kept below are just
 * team-name groupings used for slash-command choices, not schedule data.
 */

// Lazy import to avoid circular deps.
let _LeagueDB = null;
function getLeagueDB() {
    if (_LeagueDB) return _LeagueDB;
    try {
        const mod = require('../utils/database');
        _LeagueDB = mod.LeagueDB || null;
        return _LeagueDB;
    } catch {
        return null;
    }
}

/**
 * Get schedule for a specific team and division — DB only (active season).
 * @param {string} teamName
 * @param {string} division - MAJORS | AAA | AA
 * @returns {Promise<Object>} { "Week N": [{ opponent, isHome, matchup }] }
 */
async function getTeamSchedule(teamName, division) {
    const db = getLeagueDB();
    if (!db) return {};
    try {
        const rows = await db.getScheduleMatches({ division });
        if (!rows || !rows.length) return {};
        const teamSchedule = {};
        for (const r of rows) {
            const home = r.home_team;
            const away = r.away_team;
            if (home !== teamName && away !== teamName) continue;
            const weekKey = `Week ${r.week}`;
            if (!teamSchedule[weekKey]) teamSchedule[weekKey] = [];
            teamSchedule[weekKey].push({
                opponent: home === teamName ? away : home,
                isHome: home === teamName,
                matchup: `${home} vs ${away}`,
            });
        }
        return teamSchedule;
    } catch {
        return {};
    }
}

/**
 * Get all matches for a specific week and division — DB only (active season).
 * @param {number} weekNumber
 * @param {string} division - MAJORS | AAA | AA
 * @returns {Promise<Array>} Array of [Team1, Team2] pairs
 */
async function getWeekMatches(weekNumber, division) {
    const db = getLeagueDB();
    if (!db) return [];
    try {
        const rows = await db.getScheduleMatches({ division, week: weekNumber });
        if (!rows || !rows.length) return [];
        return rows.map((r) => [r.home_team, r.away_team]);
    } catch {
        return [];
    }
}

/**
 * All matches for a week across MAJORS + AAA (AA shares AAA's schedule).
 */
async function getAllWeekMatches(weekNumber) {
    const [majors, aaa] = await Promise.all([
        getWeekMatches(weekNumber, 'MAJORS'),
        getWeekMatches(weekNumber, 'AAA'),
    ]);
    return { MAJORS: majors, AAA_AA: aaa };
}

// Team-name groupings (config, not schedule) — used for slash-command choices.
const AAA_AA_ONLY_TEAMS = ['Kingdom', 'Griffins', 'Immortals', 'MNML'];
const ALL_DIVISION_TEAMS = [
    'Sublunary', 'Malfeasance', 'InTraCate', 'Archangels', 'Lotus',
    'Surge', 'Aviators', 'Panthers', 'Clovis Esports', '6 Speed'
];

module.exports = {
    getTeamSchedule,
    getWeekMatches,
    getAllWeekMatches,
    AAA_AA_ONLY_TEAMS,
    ALL_DIVISION_TEAMS,
};
