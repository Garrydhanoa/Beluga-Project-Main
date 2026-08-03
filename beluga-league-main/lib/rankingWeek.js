import { query } from './db'
import { computeWeekNumber } from './weekThreadStore'

/**
 * Which WEEK a power-rankings run is for.
 *
 * A power-rankings row is a snapshot of one week: recalculating week 3 leaves
 * weeks 2 and 4 untouched, and trend arrows compare week N against week N-1.
 *
 * The default is the latest week that ACTUALLY HAS RESULTS, taken league-wide
 * (max across all three divisions) so a recalc produces one consistent week for
 * every division. Falling back to the calendar week would, on a Monday, target a
 * week with zero games and store a duplicate of the previous week.
 *
 * KEEP IN LOCK-STEP with the bot copy at Beluga Bot/src/stats/rankingWeek.js.
 */

/** Playoff week numbers (90 + bracket round) must never be the default. */
export const PLAYOFF_WEEK_FLOOR = 90

function toWeek(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
}

/** Season start_date comes back as a Date from pg; computeWeekNumber wants yyyy-mm-dd. */
function startDateIso(season) {
  const raw = season && (season.start_date ?? season.startDate)
  if (!raw) return null
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10)
  return String(raw).slice(0, 10)
}

/** The highest week with a confirmed regular-season series, across every division. */
export async function latestPlayedWeek(seasonId) {
  if (!seasonId) return null
  try {
    const res = await query(
      `SELECT MAX(week) AS week FROM stats_series
        WHERE season_id=$1 AND is_playoff=FALSE AND status='confirmed'
          AND week IS NOT NULL AND week < $2`,
      [seasonId, PLAYOFF_WEEK_FLOOR]
    )
    return toWeek(res.rows[0] && res.rows[0].week)
  } catch {
    return null
  }
}

/**
 * Resolve the week to rank.
 *   explicit request  ->  that week (recalculates only it)
 *   otherwise         ->  latest week with results, else the calendar week, else 1
 */
export async function resolveRankingWeek(seasonId, requestedWeek = null, season = null) {
  const explicit = toWeek(requestedWeek)
  if (explicit != null) return explicit
  const played = await latestPlayedWeek(seasonId)
  if (played != null) return played
  return toWeek(computeWeekNumber(startDateIso(season))) ?? 1
}

/** Weeks that have at least one confirmed regular-season series, ascending. */
export async function listPlayedWeeks(seasonId) {
  if (!seasonId) return []
  try {
    const res = await query(
      `SELECT DISTINCT week FROM stats_series
        WHERE season_id=$1 AND is_playoff=FALSE AND status='confirmed'
          AND week IS NOT NULL AND week < $2
        ORDER BY week ASC`,
      [seasonId, PLAYOFF_WEEK_FLOOR]
    )
    return res.rows.map((r) => toWeek(r.week)).filter((w) => w != null)
  } catch {
    return []
  }
}

/** Weeks that already have a stored ranking, ascending. Drives the week pickers. */
export async function listRankedWeeks(seasonId) {
  if (!seasonId) return []
  try {
    const res = await query(
      `SELECT DISTINCT week FROM power_rankings
        WHERE season_id=$1 AND week IS NOT NULL ORDER BY week ASC`,
      [seasonId]
    )
    return res.rows.map((r) => toWeek(r.week)).filter((w) => w != null)
  } catch {
    return []
  }
}

/**
 * How many confirmed series have NO week set (staff reports may omit it). Those
 * count toward EVERY week's window, so we surface the number rather than letting
 * it skew an early week silently.
 */
export async function countUnweekedSeries(seasonId) {
  if (!seasonId) return 0
  try {
    const res = await query(
      `SELECT COUNT(*)::int AS n FROM stats_series
        WHERE season_id=$1 AND is_playoff=FALSE AND status='confirmed' AND week IS NULL`,
      [seasonId]
    )
    return Number((res.rows[0] && res.rows[0].n) || 0)
  } catch {
    return 0
  }
}
