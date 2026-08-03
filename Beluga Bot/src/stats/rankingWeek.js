/**
 * Which WEEK a power-rankings run is for.
 *
 * A power-rankings row is a snapshot of one week: recalculating week 3 leaves
 * weeks 2 and 4 untouched, and trend arrows compare week N against week N-1.
 * This module answers "which week?" consistently for the slash command, the
 * week-close hook and the admin panel.
 *
 * The default is the latest week that ACTUALLY HAS RESULTS, taken league-wide
 * (max across all three divisions) so all three cards posted in one run carry
 * the same week number. Falling back to the calendar week would, on a Monday,
 * target a week with zero games and store a duplicate of the previous week.
 *
 * KEEP IN LOCK-STEP with the website copy at beluga-league-main/lib/rankingWeek.js.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const { computeCurrentWeek } = require('../utils/weekNumber');

/** Playoff week numbers (90 + bracket round) must never be the default. */
const PLAYOFF_WEEK_FLOOR = 90;

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

const toWeek = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
};

/**
 * The highest week with a confirmed regular-season series, across every division.
 * @returns {Promise<number|null>}
 */
async function latestPlayedWeek(seasonId) {
    if (!db() || !seasonId) return null;
    const res = await pool.query(
        `SELECT MAX(week) AS week FROM stats_series
          WHERE season_id=$1 AND is_playoff=FALSE AND status='confirmed'
            AND week IS NOT NULL AND week < $2`,
        [seasonId, PLAYOFF_WEEK_FLOOR]
    ).catch(() => ({ rows: [] }));
    return toWeek(res.rows[0] && res.rows[0].week);
}

/**
 * Resolve the week to rank.
 *   explicit request  ->  that week (recalculates only it)
 *   otherwise         ->  latest week with results, else the calendar week, else 1
 *
 * @param {number} seasonId
 * @param {number|null} requestedWeek
 * @param {object|null} season the season row, for the start_date fallback
 */
async function resolveRankingWeek(seasonId, requestedWeek = null, season = null) {
    const explicit = toWeek(requestedWeek);
    if (explicit != null) return explicit;
    const played = await latestPlayedWeek(seasonId);
    if (played != null) return played;
    return toWeek(computeCurrentWeek(season)) ?? 1;
}

/** Weeks that have at least one confirmed regular-season series, ascending. */
async function listPlayedWeeks(seasonId) {
    if (!db() || !seasonId) return [];
    const res = await pool.query(
        `SELECT DISTINCT week FROM stats_series
          WHERE season_id=$1 AND is_playoff=FALSE AND status='confirmed'
            AND week IS NOT NULL AND week < $2
          ORDER BY week ASC`,
        [seasonId, PLAYOFF_WEEK_FLOOR]
    ).catch(() => ({ rows: [] }));
    return res.rows.map((r) => toWeek(r.week)).filter((w) => w != null);
}

/** Weeks that already have a stored ranking, ascending. */
async function listRankedWeeks(seasonId) {
    if (!db() || !seasonId) return [];
    const res = await pool.query(
        `SELECT DISTINCT week FROM power_rankings
          WHERE season_id=$1 AND week IS NOT NULL ORDER BY week ASC`,
        [seasonId]
    ).catch(() => ({ rows: [] }));
    return res.rows.map((r) => toWeek(r.week)).filter((w) => w != null);
}

/**
 * How many confirmed series have NO week set (staff reports may omit it).
 * Those count toward EVERY week's window, so the command surfaces the number
 * rather than letting it skew an early week silently.
 */
async function countUnweekedSeries(seasonId) {
    if (!db() || !seasonId) return 0;
    const res = await pool.query(
        `SELECT COUNT(*)::int AS n FROM stats_series
          WHERE season_id=$1 AND is_playoff=FALSE AND status='confirmed' AND week IS NULL`,
        [seasonId]
    ).catch(() => ({ rows: [] }));
    return Number((res.rows[0] && res.rows[0].n) || 0);
}

module.exports = {
    PLAYOFF_WEEK_FLOOR,
    resolveRankingWeek,
    latestPlayedWeek,
    listPlayedWeeks,
    listRankedWeeks,
    countUnweekedSeries,
};
