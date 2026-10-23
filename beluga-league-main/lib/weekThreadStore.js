import { query, getPool } from './db'
import { ensureLeagueSchema } from './leagueSchema'

/** The league runs on US Eastern; the week turns over at 9am Monday. */
export const LEAGUE_TZ = 'America/New_York'
export const WEEK_OPEN_HOUR = 9

/** Wall-clock parts of `date` as seen in `timeZone`. */
function zonedParts(date, timeZone = LEAGUE_TZ) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const out = {}
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  // Some ICU builds report midnight as hour 24 under hour12:false.
  out.hour %= 24
  return out
}

/**
 * Given a season start date (ISO yyyy-mm-dd, must be a Monday) and a reference date,
 * compute the week number (1-based). Returns null if startDate is missing or
 * the reference is before the season opens.
 *
 * The week rolls over at 9:00 AM MONDAY US EASTERN, DST included. This was plain
 * UTC date math, which on a UTC host advanced the week at 00:00 UTC Monday —
 * 8:00 PM SUNDAY Eastern in summer, so the admin panel (and the bot's
 * thread auto-open) jumped a week a day early.
 *
 * The 9-hour shift is the trick: take the Eastern wall clock, subtract the
 * opening hour, and the calendar date of the result names the league week.
 *   Mon 08:59 ET - 9h -> Sun 23:59 -> previous week
 *   Mon 09:00 ET - 9h -> Mon 00:00 -> new week
 *
 * KEEP IN LOCK-STEP with Beluga Bot/src/utils/leagueWeek.js (currentLeagueWeek).
 */
export function computeWeekNumber(startDateIso, referenceDate = new Date()) {
  if (!startDateIso) return null
  const iso = startDateIso instanceof Date
    ? startDateIso.toISOString().slice(0, 10)
    : String(startDateIso).slice(0, 10)
  const start = new Date(iso + 'T00:00:00Z')
  if (isNaN(start.getTime())) return null

  const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate)
  if (isNaN(ref.getTime())) return null

  const p = zonedParts(ref)
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  const shifted = new Date(wall - WEEK_OPEN_HOUR * 60 * 60 * 1000)
  const shiftedDayUTC = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())

  const diffMs = shiftedDayUTC - start.getTime()
  if (diffMs < 0) return null
  const week = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1
  return week >= 1 ? week : null
}

/**
 * Get the Monday of the week the given date falls in (UTC).
 */
export function mondayOfWeek(date) {
  const d = new Date(date)
  const day = d.getUTCDay() // 0 = Sunday, 1 = Monday
  const diff = (day === 0 ? -6 : 1 - day)
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff))
  return monday
}

/**
 * Returns the Monday date for a given week number, given the season start date.
 */
export function mondayForWeek(startDateIso, weekNumber) {
  const start = new Date(startDateIso + 'T00:00:00Z')
  const ms = start.getTime() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000
  return new Date(ms)
}

/**
 * List week_threads rows. Three modes:
 *   - { seasonId: N } → all rows for that season (open + closed)
 *   - { scope: 'open_all' } → every OPEN row across every season (cross-season view)
 *   - { scope: 'all' } → everything ever (open + closed, every season)
 */
export async function listWeekThreads(seasonIdOrOpts = null, opts = null) {
  await ensureLeagueSchema()

  // Backwards-compat: if called with just a seasonId number, behave as before.
  let seasonId = null
  let scope = 'season'
  if (typeof seasonIdOrOpts === 'object' && seasonIdOrOpts !== null) {
    seasonId = seasonIdOrOpts.seasonId ?? null
    scope = seasonIdOrOpts.scope || (seasonId ? 'season' : 'open_all')
  } else {
    seasonId = seasonIdOrOpts
    scope = 'season'
  }

  let where = ''
  let params = []
  if (scope === 'season') {
    where = `WHERE wt.season_id = $1 OR ($1 IS NULL AND wt.season_id IS NULL)`
    params = [seasonId]
  } else if (scope === 'open_all') {
    where = `WHERE wt.is_closed = FALSE`
  } else if (scope === 'all') {
    where = ''
  }

  const result = await query(`
    SELECT wt.*, s.season_number
    FROM week_threads wt
    LEFT JOIN seasons s ON s.id = wt.season_id
    ${where}
    ORDER BY wt.is_closed ASC, COALESCE(s.season_number, 0) DESC, wt.week_number DESC, wt.division, wt.match_number, wt.id
  `, params)
  return result.rows.map((r) => ({
    id: r.id,
    seasonId: r.season_id,
    seasonNumber: r.season_number,
    weekNumber: r.week_number,
    division: r.division,
    team1: r.team1,
    team2: r.team2,
    threadId: r.thread_id,
    matchNumber: r.match_number,
    isClosed: !!r.is_closed,
    closedAt: r.closed_at,
    createdAt: r.created_at,
  }))
}

/**
 * Materialize week_threads rows from schedule_matches for a given week.
 * If `replace=true`, deletes any existing rows for that (season, week) first.
 * Returns number of rows inserted.
 */
export async function materializeWeekFromSchedule({ seasonId, weekNumber, replace = false }) {
  await ensureLeagueSchema()
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (replace) {
      await client.query(
        `DELETE FROM week_threads WHERE season_id = $1 AND week_number = $2`,
        [seasonId, weekNumber]
      )
    }

    const matches = await client.query(`
      SELECT sm.division, ht.name AS home, at.name AS away, sm.match_order
      FROM schedule_matches sm
      LEFT JOIN teams ht ON ht.id = sm.home_team_id
      LEFT JOIN teams at ON at.id = sm.away_team_id
      WHERE sm.season_id = $1 AND sm.week = $2 AND sm.is_published = TRUE
      ORDER BY sm.division, sm.match_order, sm.id
    `, [seasonId, weekNumber])

    let inserted = 0
    let perDivCounter = {}
    for (const m of matches.rows) {
      if (!m.home || !m.away) continue
      perDivCounter[m.division] = (perDivCounter[m.division] || 0) + 1
      // Skip if already exists for the same (season, week, division, team pair).
      const dup = await client.query(`
        SELECT 1 FROM week_threads
        WHERE season_id = $1 AND week_number = $2 AND division = $3
          AND ((team1 = $4 AND team2 = $5) OR (team1 = $5 AND team2 = $4))
        LIMIT 1
      `, [seasonId, weekNumber, m.division, m.home, m.away])
      if (dup.rows.length) continue

      await client.query(`
        INSERT INTO week_threads (week_number, division, team1, team2, season_id, match_number)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [weekNumber, m.division, m.home, m.away, seasonId, perDivCounter[m.division]])
      inserted += 1
    }

    await client.query('COMMIT')
    return inserted
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function createManualWeekThread({ seasonId, weekNumber, division, team1, team2 }) {
  await ensureLeagueSchema()
  const result = await query(`
    INSERT INTO week_threads (week_number, division, team1, team2, season_id, match_number)
    VALUES ($1, $2, $3, $4, $5,
      COALESCE((SELECT MAX(match_number) FROM week_threads WHERE season_id = $5 AND week_number = $1 AND division = $2), 0) + 1
    )
    RETURNING id
  `, [weekNumber, division, team1, team2, seasonId])
  return result.rows[0].id
}

export async function closeWeekThread(id, closed = true) {
  await ensureLeagueSchema()
  // close_synced = FALSE flags the bot to archive/unarchive the Discord thread
  // to match this new is_closed state on its next reconciliation pass.
  await query(
    `UPDATE week_threads
     SET is_closed = $1,
         closed_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
         close_synced = FALSE
     WHERE id = $2`,
    [closed, id]
  )
}

export async function deleteWeekThread(id) {
  await ensureLeagueSchema()
  await query(`DELETE FROM week_threads WHERE id = $1`, [id])
}

/**
 * Week threads for `weekNumber` with NO confirmed series — i.e. matches that
 * would lose their only reporting surface if the week were deleted.
 *
 * Mirrors `Beluga Bot/src/stats/weekReportCheck.js` exactly; the bot re-runs the
 * same check before it actually deletes, so this is a preview for the warning
 * dialog and never the sole gate.
 *
 * `is_playoff` is matched to the WEEK, not hardcoded to FALSE. This used to read
 * `AND s.is_playoff = FALSE`, which meant a playoff report (always is_playoff =
 * TRUE, because week >= 90) could never satisfy the sub-select: every playoff
 * thread read as unreported forever and the week could only be force-deleted.
 * A regular-season week still only counts regular-season series, so nothing about
 * weeks 1-30 changes.
 */
export async function getUnreportedForWeek(seasonId, weekNumber) {
  await ensureLeagueSchema()
  const r = await query(
    `SELECT wt.id, wt.division, wt.team1, wt.team2, wt.match_number, wt.thread_id
       FROM week_threads wt
      WHERE wt.week_number = $2
        AND ($1::int IS NULL OR wt.season_id = $1 OR wt.season_id IS NULL)
        AND NOT EXISTS (
          SELECT 1
            FROM stats_series s
            JOIN teams ht ON ht.id = s.home_team_id
            JOIN teams at ON at.id = s.away_team_id
           WHERE s.status = 'confirmed'
             AND s.is_playoff = (wt.week_number >= 90)
             AND s.week = wt.week_number
             AND (wt.season_id IS NULL OR s.season_id = wt.season_id)
             AND LOWER(s.division) = LOWER(wt.division)
             AND (
                  (LOWER(ht.name) = LOWER(wt.team1) AND LOWER(at.name) = LOWER(wt.team2))
               OR (LOWER(ht.name) = LOWER(wt.team2) AND LOWER(at.name) = LOWER(wt.team1))
             )
        )
      ORDER BY CASE LOWER(wt.division)
                 WHEN 'majors' THEN 0 WHEN 'aaa' THEN 1 ELSE 2 END,
               wt.match_number NULLS LAST, wt.team1`,
    [seasonId == null ? null : Number(seasonId), Number(weekNumber)]
  )

  const total = await query(
    `SELECT COUNT(*)::int AS n FROM week_threads
      WHERE week_number = $2 AND ($1::int IS NULL OR season_id = $1 OR season_id IS NULL)`,
    [seasonId == null ? null : Number(seasonId), Number(weekNumber)]
  )

  return {
    unreported: r.rows.map((x) => ({
      id: x.id,
      division: x.division,
      team1: x.team1,
      team2: x.team2,
      matchNumber: x.match_number,
      hasThread: Boolean(x.thread_id),
    })),
    total: total.rows[0]?.n || 0,
  }
}

export async function deleteAllForWeek(seasonId, weekNumber) {
  await ensureLeagueSchema()
  const r = await query(
    `DELETE FROM week_threads WHERE season_id = $1 AND week_number = $2 RETURNING id`,
    [seasonId, weekNumber]
  )
  return r.rowCount
}
