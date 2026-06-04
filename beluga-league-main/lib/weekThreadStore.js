import { query, getPool } from './db'
import { ensureLeagueSchema } from './leagueSchema'

/**
 * Given a season start date (ISO yyyy-mm-dd, must be a Monday) and a reference date,
 * compute the week number (1-based). Returns null if startDate is missing or
 * the reference is before startDate.
 */
export function computeWeekNumber(startDateIso, referenceDate = new Date()) {
  if (!startDateIso) return null
  const start = new Date(startDateIso + 'T00:00:00Z')
  if (isNaN(start.getTime())) return null
  const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate)
  const refUTC = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate())
  const diffMs = refUTC - start.getTime()
  if (diffMs < 0) return null
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1
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

export async function deleteAllForWeek(seasonId, weekNumber) {
  await ensureLeagueSchema()
  const r = await query(
    `DELETE FROM week_threads WHERE season_id = $1 AND week_number = $2 RETURNING id`,
    [seasonId, weekNumber]
  )
  return r.rowCount
}
