import { query } from './db'
import { ensureLeagueSchema } from './leagueSchema'

function map(row) {
  if (!row) return null
  return {
    id: row.id,
    seasonId: row.season_id,
    division: row.division,
    teamId: row.team_id,
    franchiseId: row.franchise_id,
    teamName: row.team_name ?? null,
    franchiseName: row.franchise_name ?? null,
    gmDiscordId: row.gm_discord_id,
    gmDisplayName: row.gm_display_name,
    notes: row.notes,
    setAt: row.set_at,
    seasonNumber: row.season_number ?? null,
    seasonYear: row.year ?? null,
  }
}

export async function listChampions({ seasonId = null, includeFuture = false } = {}) {
  await ensureLeagueSchema()
  const params = []
  let where = '1=1'
  if (seasonId) {
    params.push(seasonId)
    where = `c.season_id = $${params.length}`
  }
  if (!includeFuture) {
    where += ` AND s.status <> 'draft'`
  }
  const result = await query(`
    SELECT c.*, t.name AS team_name, f.name AS franchise_name,
      s.season_number, s.year
    FROM season_champions c
    LEFT JOIN seasons s ON s.id = c.season_id
    LEFT JOIN teams t ON t.id = c.team_id
    LEFT JOIN team_franchises f ON f.id = c.franchise_id
    WHERE ${where}
    ORDER BY s.season_number DESC NULLS LAST, c.division
  `, params)
  return result.rows.map(map)
}

export async function getChampion(seasonId, division) {
  await ensureLeagueSchema()
  const result = await query(`
    SELECT c.*, t.name AS team_name, f.name AS franchise_name,
      s.season_number, s.year
    FROM season_champions c
    LEFT JOIN seasons s ON s.id = c.season_id
    LEFT JOIN teams t ON t.id = c.team_id
    LEFT JOIN team_franchises f ON f.id = c.franchise_id
    WHERE c.season_id = $1 AND c.division = $2
    LIMIT 1
  `, [seasonId, division])
  return result.rows.length ? map(result.rows[0]) : null
}

export async function setChampion({ seasonId, division, teamId = null, franchiseId = null, gmDiscordId = null, gmDisplayName = null, notes = null }) {
  await ensureLeagueSchema()
  let resolvedFranchiseId = franchiseId
  if (teamId && !resolvedFranchiseId) {
    const r = await query('SELECT franchise_id FROM teams WHERE id = $1', [teamId])
    if (r.rows.length) resolvedFranchiseId = r.rows[0].franchise_id
  }
  const result = await query(`
    INSERT INTO season_champions (season_id, division, team_id, franchise_id, gm_discord_id, gm_display_name, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (season_id, division) DO UPDATE SET
      team_id = EXCLUDED.team_id,
      franchise_id = EXCLUDED.franchise_id,
      gm_discord_id = EXCLUDED.gm_discord_id,
      gm_display_name = EXCLUDED.gm_display_name,
      notes = EXCLUDED.notes,
      set_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [seasonId, division, teamId, resolvedFranchiseId, gmDiscordId, gmDisplayName, notes])
  return map(result.rows[0])
}

export async function clearChampion(seasonId, division) {
  await ensureLeagueSchema()
  await query('DELETE FROM season_champions WHERE season_id = $1 AND division = $2', [seasonId, division])
}
