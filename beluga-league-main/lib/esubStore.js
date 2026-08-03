import { query } from './db'
import { ensureLeagueSchema } from './leagueSchema'

/**
 * E-sub (one-day sub) usage — the admin-panel half of the DB-backed counter the
 * bot writes from /esub and /adminesub.
 *
 * Counts live in `team_esubs`, keyed by (season_id, team_id). A team row is per
 * (season, division, name), so the count is inherently per-division and resets
 * itself when a new season starts: new season → new team ids → no rows → 0 used.
 *
 * The allowance lives on `season_config.esub_limit` (default 3) and is shared by
 * every team in the season.
 */

export const DEFAULT_ESUB_LIMIT = 3

const DIVISION_ORDER = `CASE t.division WHEN 'Majors' THEN 0 WHEN 'AAA' THEN 1 ELSE 2 END`

/** Active season id, or null. */
export async function getActiveSeasonId() {
  await ensureLeagueSchema()
  const r = await query(`SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1`)
  return r.rows[0]?.id ?? null
}

/** Per-season e-sub allowance. */
export async function getEsubLimit(seasonId) {
  if (!seasonId) return DEFAULT_ESUB_LIMIT
  await ensureLeagueSchema()
  const r = await query(`SELECT esub_limit FROM season_config WHERE season_id = $1`, [seasonId])
  const n = Number(r.rows[0]?.esub_limit)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_ESUB_LIMIT
}

/** Set the per-season allowance (creates the season_config row if needed). */
export async function setEsubLimit(seasonId, limit) {
  await ensureLeagueSchema()
  const value = Math.max(0, Math.trunc(Number(limit) || 0))
  await query(
    `INSERT INTO season_config (season_id, esub_limit) VALUES ($1, $2)
     ON CONFLICT (season_id) DO UPDATE SET esub_limit = EXCLUDED.esub_limit, updated_at = now()`,
    [seasonId, value]
  )
  return value
}

/**
 * Every active team in a season with its e-sub usage (0 when it has no row).
 * @returns {Promise<Array<{teamId, name, division, used, updatedAt, updatedBy}>>}
 */
export async function listEsubUsage(seasonId) {
  if (!seasonId) return []
  await ensureLeagueSchema()
  const r = await query(
    `SELECT t.id, t.name, t.division, COALESCE(e.used, 0) AS used, e.updated_at, e.updated_by
       FROM teams t
       LEFT JOIN team_esubs e ON e.team_id = t.id AND e.season_id = t.season_id
      WHERE t.season_id = $1 AND t.is_active = TRUE
      ORDER BY ${DIVISION_ORDER}, t.name`,
    [seasonId]
  )
  return r.rows.map((row) => ({
    teamId: row.id,
    name: row.name,
    division: row.division,
    used: Number(row.used) || 0,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
  }))
}

/** Set one team's exact count. Clamped to >= 0. */
export async function setEsubUsed(seasonId, teamId, used, actor = null) {
  await ensureLeagueSchema()
  const value = Math.max(0, Math.trunc(Number(used) || 0))
  // Guard against a team id from another season being written into this one.
  const t = await query(`SELECT id FROM teams WHERE id = $1 AND season_id = $2`, [teamId, seasonId])
  if (!t.rowCount) throw new Error('team does not belong to that season')
  const r = await query(
    `INSERT INTO team_esubs (season_id, team_id, used, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (season_id, team_id) DO UPDATE
        SET used = EXCLUDED.used, updated_at = now(), updated_by = $4
     RETURNING used`,
    [seasonId, teamId, value, actor]
  )
  return Number(r.rows[0]?.used) || 0
}

/** Zero every team's usage for a season (manual mid-season reset). */
export async function resetSeasonEsubs(seasonId, actor = null) {
  await ensureLeagueSchema()
  const r = await query(
    `UPDATE team_esubs SET used = 0, updated_at = now(), updated_by = $2 WHERE season_id = $1`,
    [seasonId, actor]
  )
  return r.rowCount
}
