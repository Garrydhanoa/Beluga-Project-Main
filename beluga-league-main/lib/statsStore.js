import { query } from './db'
import { ensureLeagueSchema } from './leagueSchema'

function mapTeamRecord(row) {
  return {
    id: row.id,
    seasonId: row.season_id,
    division: row.division,
    teamId: row.team_id,
    teamName: row.team_name ?? null,
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    gameWins: Number(row.game_wins || 0),
    gameLosses: Number(row.game_losses || 0),
    goalsFor: Number(row.goals_for || 0),
    goalsAgainst: Number(row.goals_against || 0),
    manualOverride: !!row.manual_override,
    updatedAt: row.updated_at,
  }
}

function mapPlayerRecord(row) {
  return {
    id: row.id,
    seasonId: row.season_id,
    division: row.division,
    teamId: row.team_id,
    teamName: row.team_name ?? null,
    playerName: row.player_name,
    platform: row.platform,
    platformId: row.platform_id,
    gamesPlayed: Number(row.games_played || 0),
    goals: Number(row.goals || 0),
    assists: Number(row.assists || 0),
    saves: Number(row.saves || 0),
    shots: Number(row.shots || 0),
    score: Number(row.score || 0),
    manualOverride: !!row.manual_override,
    updatedAt: row.updated_at,
  }
}

export async function getTeamRecords(seasonId, { division = null } = {}) {
  await ensureLeagueSchema()
  const params = [seasonId]
  let where = 'tr.season_id = $1'
  if (division) {
    params.push(division)
    where += ` AND tr.division = $${params.length}`
  }
  const result = await query(`
    SELECT tr.*, t.name AS team_name
    FROM team_records tr
    LEFT JOIN teams t ON t.id = tr.team_id
    WHERE ${where}
    ORDER BY tr.wins DESC, (tr.goals_for - tr.goals_against) DESC, tr.goals_for DESC, t.name
  `, params)
  return result.rows.map(mapTeamRecord)
}

export async function upsertTeamRecord({ seasonId, division, teamId, wins = 0, losses = 0, gameWins = 0, gameLosses = 0, goalsFor = 0, goalsAgainst = 0, manualOverride = false }) {
  await ensureLeagueSchema()
  const result = await query(`
    INSERT INTO team_records (season_id, division, team_id, wins, losses, game_wins, game_losses, goals_for, goals_against, manual_override)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (season_id, division, team_id) DO UPDATE SET
      wins = EXCLUDED.wins,
      losses = EXCLUDED.losses,
      game_wins = EXCLUDED.game_wins,
      game_losses = EXCLUDED.game_losses,
      goals_for = EXCLUDED.goals_for,
      goals_against = EXCLUDED.goals_against,
      manual_override = EXCLUDED.manual_override,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [seasonId, division, teamId, wins, losses, gameWins, gameLosses, goalsFor, goalsAgainst, manualOverride])
  return mapTeamRecord(result.rows[0])
}

export async function deleteTeamRecord(seasonId, division, teamId) {
  await ensureLeagueSchema()
  await query('DELETE FROM team_records WHERE season_id = $1 AND division = $2 AND team_id = $3', [seasonId, division, teamId])
}

export async function getPlayerRecords(seasonId, { division = null, teamId = null, platformId = null } = {}) {
  await ensureLeagueSchema()
  const params = [seasonId]
  let where = 'pr.season_id = $1'
  if (division) {
    params.push(division)
    where += ` AND pr.division = $${params.length}`
  }
  if (teamId) {
    params.push(teamId)
    where += ` AND pr.team_id = $${params.length}`
  }
  if (platformId) {
    params.push(String(platformId))
    where += ` AND pr.platform_id = $${params.length}`
  }
  const result = await query(`
    SELECT pr.*, t.name AS team_name
    FROM player_records pr
    LEFT JOIN teams t ON t.id = pr.team_id
    WHERE ${where}
    ORDER BY pr.score DESC, pr.goals DESC, pr.player_name
  `, params)
  return result.rows.map(mapPlayerRecord)
}

export async function upsertPlayerRecord({ seasonId, division, teamId, playerName, platform = null, platformId = null, gamesPlayed = 0, goals = 0, assists = 0, saves = 0, shots = 0, score = 0, manualOverride = false }) {
  await ensureLeagueSchema()
  const result = await query(`
    INSERT INTO player_records (season_id, division, team_id, player_name, platform, platform_id, games_played, goals, assists, saves, shots, score, manual_override)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (season_id, division, team_id, player_name, platform, platform_id) DO UPDATE SET
      games_played = EXCLUDED.games_played,
      goals = EXCLUDED.goals,
      assists = EXCLUDED.assists,
      saves = EXCLUDED.saves,
      shots = EXCLUDED.shots,
      score = EXCLUDED.score,
      manual_override = EXCLUDED.manual_override,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [seasonId, division, teamId, playerName, platform, platformId, gamesPlayed, goals, assists, saves, shots, score, manualOverride])
  return mapPlayerRecord(result.rows[0])
}

export async function deletePlayerRecord(id) {
  await ensureLeagueSchema()
  await query('DELETE FROM player_records WHERE id = $1', [id])
}

/**
 * Bot-side helper: only upsert if the row is NOT manually overridden.
 * Returns { applied: boolean, reason?: string }.
 */
export async function botUpsertTeamRecord(args) {
  await ensureLeagueSchema()
  const existing = await query(
    `SELECT manual_override FROM team_records WHERE season_id = $1 AND division = $2 AND team_id = $3`,
    [args.seasonId, args.division, args.teamId]
  )
  if (existing.rows.length && existing.rows[0].manual_override) {
    return { applied: false, reason: 'manual_override' }
  }
  await upsertTeamRecord({ ...args, manualOverride: false })
  return { applied: true }
}

export async function botUpsertPlayerRecord(args) {
  await ensureLeagueSchema()
  const existing = await query(
    `SELECT manual_override FROM player_records
     WHERE season_id = $1 AND division = $2 AND team_id = $3
       AND player_name = $4 AND platform = $5 AND platform_id = $6`,
    [args.seasonId, args.division, args.teamId, args.playerName, args.platform, args.platformId]
  )
  if (existing.rows.length && existing.rows[0].manual_override) {
    return { applied: false, reason: 'manual_override' }
  }
  await upsertPlayerRecord({ ...args, manualOverride: false })
  return { applied: true }
}
