import { query, getPool } from './db'
import { ensureLeagueSchema } from './leagueSchema'

function mapFranchise(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    defaultDivision: row.default_division,
    isActive: row.is_active,
    hasLogo: Boolean(row.logo_mime && row.logo_data),
    logoMime: row.logo_mime || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeasonNumber: row.last_season_number ?? null,
    seasonCount: row.season_count != null ? Number(row.season_count) : null,
  }
}

export async function listFranchises({ activeOnly = false } = {}) {
  await ensureLeagueSchema()
  const where = activeOnly ? 'WHERE f.is_active = TRUE' : ''
  const result = await query(`
    SELECT
      f.*,
      COALESCE(MAX(s.season_number), NULL) AS last_season_number,
      COUNT(DISTINCT t.season_id) AS season_count
    FROM team_franchises f
    LEFT JOIN teams t ON t.franchise_id = f.id
    LEFT JOIN seasons s ON s.id = t.season_id
    ${where}
    GROUP BY f.id
    ORDER BY f.is_active DESC, f.name ASC
  `)
  return result.rows.map(mapFranchise)
}

export async function getFranchise(id) {
  await ensureLeagueSchema()
  const result = await query('SELECT * FROM team_franchises WHERE id = $1', [id])
  return result.rows.length ? mapFranchise(result.rows[0]) : null
}

export async function getFranchiseByName(name) {
  await ensureLeagueSchema()
  const result = await query('SELECT * FROM team_franchises WHERE name = $1', [name])
  return result.rows.length ? mapFranchise(result.rows[0]) : null
}

export async function createFranchise({ name, defaultDivision = null, logoMime = null, logoData = null }) {
  await ensureLeagueSchema()
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('Franchise name required')
  const result = await query(
    `INSERT INTO team_franchises (name, default_division, logo_mime, logo_data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [trimmed, defaultDivision, logoMime, logoData]
  )
  return mapFranchise(result.rows[0])
}

export async function updateFranchise(id, patch) {
  await ensureLeagueSchema()
  const fields = []
  const values = []
  let i = 1
  if (patch.name !== undefined) { fields.push(`name = $${i++}`); values.push(String(patch.name).trim()) }
  if (patch.defaultDivision !== undefined) { fields.push(`default_division = $${i++}`); values.push(patch.defaultDivision) }
  if (patch.isActive !== undefined) { fields.push(`is_active = $${i++}`); values.push(Boolean(patch.isActive)) }
  if (!fields.length) return getFranchise(id)
  values.push(id)
  const result = await query(
    `UPDATE team_franchises SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${i} RETURNING *`,
    values
  )
  return result.rows.length ? mapFranchise(result.rows[0]) : null
}

export async function setFranchiseLogo(id, { mime, data }) {
  await ensureLeagueSchema()
  const result = await query(
    `UPDATE team_franchises SET logo_mime = $1, logo_data = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 RETURNING *`,
    [mime, data, id]
  )
  return result.rows.length ? mapFranchise(result.rows[0]) : null
}

export async function getFranchiseLogo(id) {
  await ensureLeagueSchema()
  const result = await query(
    'SELECT logo_mime, logo_data FROM team_franchises WHERE id = $1',
    [id]
  )
  if (!result.rows.length) return null
  return { mime: result.rows[0].logo_mime, data: result.rows[0].logo_data }
}

export async function deleteFranchise(id) {
  await ensureLeagueSchema()
  await query('DELETE FROM team_franchises WHERE id = $1', [id])
}

export async function getSuggestionsForSeason(seasonId) {
  await ensureLeagueSchema()
  const result = await query(`
    SELECT f.*,
      COALESCE(MAX(s.season_number), NULL) AS last_season_number,
      COUNT(DISTINCT t.season_id) AS season_count
    FROM team_franchises f
    LEFT JOIN teams t ON t.franchise_id = f.id
    LEFT JOIN seasons s ON s.id = t.season_id
    WHERE f.is_active = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM teams cur
        WHERE cur.franchise_id = f.id AND cur.season_id = $1
      )
    GROUP BY f.id
    ORDER BY last_season_number DESC NULLS LAST, f.name ASC
  `, [seasonId])
  return result.rows.map(mapFranchise)
}

export async function getSeasonConfig(seasonId) {
  await ensureLeagueSchema()
  const result = await query('SELECT * FROM season_config WHERE season_id = $1', [seasonId])
  if (!result.rows.length) return null
  const row = result.rows[0]
  return {
    seasonId: row.season_id,
    teamsPerDivision: row.teams_per_division || {},
    weeks: row.weeks,
    onfieldCaps: row.onfield_caps || {},
    scheduleGeneratedAt: row.schedule_generated_at,
  }
}

export async function upsertSeasonConfig(seasonId, { teamsPerDivision, weeks, onfieldCaps }) {
  await ensureLeagueSchema()
  // Only overwrite onfield_caps when explicitly provided, so config saves that
  // don't include caps don't wipe them.
  const result = await query(`
    INSERT INTO season_config (season_id, teams_per_division, weeks, onfield_caps)
    VALUES ($1, $2::jsonb, $3, COALESCE($4::jsonb, '{}'::jsonb))
    ON CONFLICT (season_id) DO UPDATE
      SET teams_per_division = EXCLUDED.teams_per_division,
          weeks = EXCLUDED.weeks,
          onfield_caps = COALESCE($4::jsonb, season_config.onfield_caps),
          updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [
    seasonId,
    JSON.stringify(teamsPerDivision || {}),
    weeks ?? null,
    onfieldCaps !== undefined ? JSON.stringify(onfieldCaps || {}) : null,
  ])
  const row = result.rows[0]
  return {
    seasonId: row.season_id,
    teamsPerDivision: row.teams_per_division || {},
    weeks: row.weeks,
    onfieldCaps: row.onfield_caps || {},
    scheduleGeneratedAt: row.schedule_generated_at,
  }
}

export async function markScheduleGenerated(seasonId) {
  await ensureLeagueSchema()
  await query(
    `UPDATE season_config SET schedule_generated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE season_id = $1`,
    [seasonId]
  )
}

export async function addFranchiseToSeason({ franchiseId, seasonId, division, name, rosterLimit }) {
  await ensureLeagueSchema()
  const franchise = await getFranchise(franchiseId)
  if (!franchise) throw new Error('Franchise not found')
  const teamName = (name && String(name).trim()) || franchise.name
  const teamDivision = division || franchise.defaultDivision
  if (!teamDivision) throw new Error('Division required')

  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Scope existence by (season_id, franchise_id, division). A franchise can
    // legitimately field separate teams in different divisions in the same season.
    const existing = await client.query(
      `SELECT id FROM teams
       WHERE season_id = $1 AND franchise_id = $2 AND division = $3
       LIMIT 1`,
      [seasonId, franchiseId, teamDivision]
    )
    let teamId
    if (existing.rows.length) {
      teamId = existing.rows[0].id
      await client.query(
        `UPDATE teams SET is_active = TRUE, name = $1,
           roster_limit = COALESCE($2, roster_limit), updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [teamName, rosterLimit ?? null, teamId]
      )
    } else {
      const inserted = await client.query(
        `INSERT INTO teams (season_id, division, name, roster_limit, franchise_id, logo_mime, logo_data)
         VALUES ($1, $2, $3, COALESCE($4, 4), $5, $6, $7)
         ON CONFLICT (season_id, division, name) DO UPDATE
           SET franchise_id = EXCLUDED.franchise_id,
               is_active = TRUE,
               updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [seasonId, teamDivision, teamName, rosterLimit ?? null, franchiseId, franchise.logoMime || null, null]
      )
      teamId = inserted.rows[0].id
      if (franchise.hasLogo) {
        const logoRow = await client.query(
          'SELECT logo_data FROM team_franchises WHERE id = $1',
          [franchiseId]
        )
        if (logoRow.rows.length && logoRow.rows[0].logo_data) {
          await client.query(
            `UPDATE teams SET logo_mime = $1, logo_data = $2 WHERE id = $3`,
            [franchise.logoMime, logoRow.rows[0].logo_data, teamId]
          )
        }
      }
    }
    await client.query('COMMIT')
    return { teamId }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
