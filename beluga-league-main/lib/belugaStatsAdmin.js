// Admin-side write/recompute for the new stats system — a faithful ESM port of
// the bot's statsStore recompute (same Beluga weights, same derivation rules:
// aggregates are rebuilt from stats_game_players; manual_override rows are
// preserved). Used by the admin API for edits, deletes, identity fixes, recalc.

import { query } from './db'

export const BELUGA_WEIGHTS = { score: 25, goals: 30, assists: 15, saves: 20, shots: 5, demos: 5 }
const W_TOTAL = Object.values(BELUGA_WEIGHTS).reduce((a, b) => a + b, 0)

export function belugaFromTotals(totals, games) {
  if (!games) return 0
  const w = BELUGA_WEIGHTS
  const raw =
    (Number(totals.score || 0) / games) * w.score +
    (Number(totals.goals || 0) / games) * w.goals +
    (Number(totals.assists || 0) / games) * w.assists +
    (Number(totals.saves || 0) / games) * w.saves +
    (Number(totals.shots || 0) / games) * w.shots +
    (Number(totals.demos_inflicted || 0) / games) * w.demos
  return Math.round((raw / W_TOTAL) * 100) / 100
}

export async function recomputePlayer(discordId) {
  if (!discordId) return
  const agg = await query(
    `SELECT season_id, division, is_playoff,
        (ARRAY_AGG(team_id ORDER BY id DESC))[1] AS team_id,
        COUNT(*)::int AS games,
        COALESCE(SUM(score),0)::int AS score, COALESCE(SUM(goals),0)::int AS goals,
        COALESCE(SUM(assists),0)::int AS assists, COALESCE(SUM(saves),0)::int AS saves,
        COALESCE(SUM(shots),0)::int AS shots,
        COALESCE(SUM(demos_inflicted),0)::int AS demos_inflicted,
        COALESCE(SUM(demos_taken),0)::int AS demos_taken,
        COALESCE(SUM(CASE WHEN mvp THEN 1 ELSE 0 END),0)::int AS mvps
     FROM stats_game_players WHERE discord_id = $1
     GROUP BY season_id, division, is_playoff`,
    [String(discordId)]
  )
  await query(`DELETE FROM stats_player_season WHERE discord_id = $1 AND manual_override = FALSE`, [String(discordId)])
  for (const r of agg.rows) {
    await query(
      `INSERT INTO stats_player_season (
          discord_id, season_id, division, is_playoff, team_id, games,
          score, goals, assists, saves, shots, demos_inflicted, demos_taken, mvps, beluga_score, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CURRENT_TIMESTAMP)
       ON CONFLICT (discord_id, season_id, division, is_playoff) DO NOTHING`,
      [String(discordId), r.season_id, r.division, r.is_playoff, r.team_id, r.games,
       r.score, r.goals, r.assists, r.saves, r.shots, r.demos_inflicted, r.demos_taken, r.mvps,
       belugaFromTotals(r, r.games)]
    )
  }
  const life = await query(
    `SELECT is_playoff, COUNT(*)::int AS games, COUNT(DISTINCT season_id)::int AS seasons_played,
        COALESCE(SUM(score),0)::int AS score, COALESCE(SUM(goals),0)::int AS goals,
        COALESCE(SUM(assists),0)::int AS assists, COALESCE(SUM(saves),0)::int AS saves,
        COALESCE(SUM(shots),0)::int AS shots,
        COALESCE(SUM(demos_inflicted),0)::int AS demos_inflicted,
        COALESCE(SUM(demos_taken),0)::int AS demos_taken,
        COALESCE(SUM(CASE WHEN mvp THEN 1 ELSE 0 END),0)::int AS mvps
     FROM stats_game_players WHERE discord_id = $1 GROUP BY is_playoff`,
    [String(discordId)]
  )
  await query(`DELETE FROM stats_player_lifetime WHERE discord_id = $1`, [String(discordId)])
  for (const r of life.rows) {
    await query(
      `INSERT INTO stats_player_lifetime (
          discord_id, is_playoff, games, seasons_played, score, goals, assists, saves, shots,
          demos_inflicted, demos_taken, mvps, beluga_score, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP)`,
      [String(discordId), r.is_playoff, r.games, r.seasons_played, r.score, r.goals, r.assists, r.saves,
       r.shots, r.demos_inflicted, r.demos_taken, r.mvps, belugaFromTotals(r, r.games)]
    )
  }
}

export async function recomputeTeamSeason(seasonId, division, teamId, isPlayoff) {
  if (!teamId) return
  const ov = await query(
    `SELECT manual_override FROM stats_team_season WHERE season_id=$1 AND division=$2 AND team_id=$3 AND is_playoff=$4`,
    [seasonId, division, teamId, isPlayoff]
  )
  if (ov.rows[0]?.manual_override) return

  const totals = (await query(
    `SELECT COUNT(DISTINCT game_id)::int AS games_played,
        COALESCE(SUM(score),0)::int AS score, COALESCE(SUM(goals),0)::int AS goals,
        COALESCE(SUM(assists),0)::int AS assists, COALESCE(SUM(saves),0)::int AS saves,
        COALESCE(SUM(shots),0)::int AS shots,
        COALESCE(SUM(demos_inflicted),0)::int AS demos_inflicted,
        COALESCE(SUM(demos_taken),0)::int AS demos_taken
     FROM stats_game_players
     WHERE team_id=$1 AND season_id=$2 AND division=$3 AND is_playoff=$4`,
    [teamId, seasonId, division, isPlayoff]
  )).rows[0]

  const sres = await query(
    `SELECT id, home_team_id, away_team_id, winner_team_id, is_forfeit
     FROM stats_series
     WHERE season_id=$1 AND division=$2 AND is_playoff=$3 AND status='confirmed'
       AND (home_team_id=$4 OR away_team_id=$4)`,
    [seasonId, division, isPlayoff, teamId]
  )
  let seriesWins = 0; let seriesLosses = 0
  let gameWins = 0; let gameLosses = 0; let goalsFor = 0; let goalsAgainst = 0
  for (const s of sres.rows) {
    if (s.winner_team_id === teamId) seriesWins += 1
    else if (s.winner_team_id != null) seriesLosses += 1
    const gms = await query(`SELECT home_goals, away_goals, winner_team_id FROM stats_games WHERE series_id=$1`, [s.id])
    const isHome = s.home_team_id === teamId
    for (const g of gms.rows) {
      goalsFor += Number(isHome ? g.home_goals : g.away_goals) || 0
      goalsAgainst += Number(isHome ? g.away_goals : g.home_goals) || 0
      if (g.winner_team_id === teamId) gameWins += 1
      else if (g.winner_team_id != null) gameLosses += 1
    }
  }

  await query(
    `INSERT INTO stats_team_season (
        season_id, division, team_id, is_playoff,
        series_wins, series_losses, game_wins, game_losses, goals_for, goals_against, games_played,
        score, goals, assists, saves, shots, demos_inflicted, demos_taken, beluga_score, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,CURRENT_TIMESTAMP)
     ON CONFLICT (season_id, division, team_id, is_playoff) DO UPDATE SET
        series_wins=EXCLUDED.series_wins, series_losses=EXCLUDED.series_losses,
        game_wins=EXCLUDED.game_wins, game_losses=EXCLUDED.game_losses,
        goals_for=EXCLUDED.goals_for, goals_against=EXCLUDED.goals_against, games_played=EXCLUDED.games_played,
        score=EXCLUDED.score, goals=EXCLUDED.goals, assists=EXCLUDED.assists, saves=EXCLUDED.saves,
        shots=EXCLUDED.shots, demos_inflicted=EXCLUDED.demos_inflicted, demos_taken=EXCLUDED.demos_taken,
        beluga_score=EXCLUDED.beluga_score, updated_at=CURRENT_TIMESTAMP`,
    [seasonId, division, teamId, isPlayoff,
     seriesWins, seriesLosses, gameWins, gameLosses, goalsFor, goalsAgainst, totals.games_played,
     totals.score, totals.goals, totals.assists, totals.saves, totals.shots,
     totals.demos_inflicted, totals.demos_taken, belugaFromTotals(totals, totals.games_played)]
  )
}

/** Recompute everything a series touches (both teams + all its players). */
export async function recomputeForSeries(seriesLike) {
  const s = seriesLike
  const players = await query(
    `SELECT DISTINCT discord_id FROM stats_game_players WHERE series_id = $1 AND discord_id IS NOT NULL`,
    [s.id]
  )
  await recomputeTeamSeason(s.season_id, s.division, s.home_team_id, s.is_playoff)
  await recomputeTeamSeason(s.season_id, s.division, s.away_team_id, s.is_playoff)
  for (const row of players.rows) await recomputePlayer(row.discord_id)
}

/** Full rebuild for a season (the staff "Recalculate" button). */
export async function recomputeAllForSeason(seasonId) {
  const teams = await query(
    `SELECT DISTINCT season_id, division, team_id, is_playoff FROM stats_game_players
     WHERE season_id=$1 AND team_id IS NOT NULL`, [seasonId]
  )
  for (const r of teams.rows) await recomputeTeamSeason(r.season_id, r.division, r.team_id, r.is_playoff)
  const players = await query(
    `SELECT DISTINCT discord_id FROM stats_game_players WHERE season_id=$1 AND discord_id IS NOT NULL`, [seasonId]
  )
  for (const r of players.rows) await recomputePlayer(r.discord_id)
}

export async function logAudit({ seriesId = null, action, actor = null, detail = null }) {
  await query(
    `INSERT INTO stats_audit_log (series_id, action, actor_discord_id, actor_name, actor_source, detail)
     VALUES ($1,$2,$3,$4,'website',$5::jsonb)`,
    [seriesId, action, actor?.discordId || null, actor?.name || null, detail ? JSON.stringify(detail) : null]
  ).catch(() => {})
}
