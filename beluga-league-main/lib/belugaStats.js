// Reader for the NEW Ballchasing-based stats system (stats_* tables, written by
// the bot). Mirrors the bot's standings logic exactly: Wins → Losses → H2H
// (forfeits excluded, mini-table for 3+ tied) → Game Diff → Goal Diff → Rating.
// All reads tolerate empty tables (pre-season) by returning empty results.

import { query } from './db'

// ---------- standings ----------

export async function getStatsStandings(seasonId, division) {
  const rowsRes = await query(
    `SELECT ts.team_id, t.name AS team_name,
        ts.series_wins AS wins, ts.series_losses AS losses,
        (ts.game_wins - ts.game_losses) AS game_diff,
        (ts.goals_for - ts.goals_against) AS goal_diff,
        ts.goals_for, ts.goals_against, ts.beluga_score AS rating
     FROM stats_team_season ts
     LEFT JOIN teams t ON t.id = ts.team_id
     WHERE ts.season_id = $1 AND ts.division = $2 AND ts.is_playoff = FALSE`,
    [seasonId, division]
  ).catch(() => ({ rows: [] }))

  const teams = rowsRes.rows.map((r) => ({
    teamId: r.team_id,
    team: r.team_name,
    wins: Number(r.wins || 0),
    losses: Number(r.losses || 0),
    gameDiff: Number(r.game_diff || 0),
    goalDiff: Number(r.goal_diff || 0),
    goalsFor: Number(r.goals_for || 0),
    goalsAgainst: Number(r.goals_against || 0),
    rating: Number(r.rating || 0),
  }))
  if (!teams.length) return []
  if (teams.length === 1) return teams.map((t, i) => ({ ...t, rank: i + 1 }))

  const seriesRes = await query(
    `SELECT home_team_id, away_team_id, winner_team_id, home_score, away_score
     FROM stats_series
     WHERE season_id = $1 AND division = $2 AND is_playoff = FALSE
       AND status = 'confirmed' AND is_forfeit = FALSE`,
    [seasonId, division]
  ).catch(() => ({ rows: [] }))
  const series = seriesRes.rows

  // Operator rule D4: tied teams rank by H2H record; if still tied, by game
  // differential WITHIN the H2H matchups (must stay in sync with the bot's
  // statsStore.getStandings).
  const h2hWithin = (teamId, group) => {
    const ids = new Set(group.map((t) => t.teamId))
    let wins = 0
    let losses = 0
    let gameDiff = 0
    for (const s of series) {
      const isHome = s.home_team_id === teamId && ids.has(s.away_team_id)
      const isAway = s.away_team_id === teamId && ids.has(s.home_team_id)
      if (!isHome && !isAway) continue
      if (s.winner_team_id === teamId) wins += 1
      else if (s.winner_team_id != null) losses += 1
      const own = Number(isHome ? s.home_score : s.away_score) || 0
      const opp = Number(isHome ? s.away_score : s.home_score) || 0
      gameDiff += own - opp
    }
    return { wins, losses, gameDiff }
  }

  const cmpBase = (a, b) => b.wins - a.wins || a.losses - b.losses
  const cmpFallback = (a, b) => b.gameDiff - a.gameDiff || b.goalDiff - a.goalDiff || b.rating - a.rating

  teams.sort((a, b) => cmpBase(a, b) || cmpFallback(a, b))
  const out = []
  let i = 0
  while (i < teams.length) {
    let j = i + 1
    while (j < teams.length && teams[j].wins === teams[i].wins && teams[j].losses === teams[i].losses) j += 1
    const cluster = teams.slice(i, j)
    if (cluster.length > 1) {
      const withH2H = cluster.map((t) => ({ ...t, _h2h: h2hWithin(t.teamId, cluster) }))
      withH2H.sort((a, b) =>
        (b._h2h.wins - b._h2h.losses) - (a._h2h.wins - a._h2h.losses)
        || b._h2h.gameDiff - a._h2h.gameDiff
        || cmpFallback(a, b))
      out.push(...withH2H.map(({ _h2h, ...t }) => t))
    } else {
      out.push(cluster[0])
    }
    i = j
  }
  return out.map((t, idx) => ({ ...t, rank: idx + 1 }))
}

// ---------- recent results (homepage) ----------

export async function getRecentResults(limit = 5) {
  const r = await query(
    `SELECT s.id, s.division, s.week, s.is_playoff, s.is_forfeit,
        s.home_score, s.away_score, s.ballchasing_group_url, s.confirmed_at,
        ht.name AS home_team, at.name AS away_team
     FROM stats_series s
     LEFT JOIN teams ht ON ht.id = s.home_team_id
     LEFT JOIN teams at ON at.id = s.away_team_id
     WHERE s.status = 'confirmed'
     ORDER BY s.confirmed_at DESC NULLS LAST, s.id DESC
     LIMIT $1`,
    [limit]
  ).catch(() => ({ rows: [] }))

  return r.rows.map((row) => {
    const homeWon = Number(row.home_score) >= Number(row.away_score)
    return {
      id: row.id,
      division: row.division,
      week: row.week,
      isPlayoff: row.is_playoff,
      isForfeit: row.is_forfeit,
      winner: homeWon ? row.home_team : row.away_team,
      loser: homeWon ? row.away_team : row.home_team,
      winnerScore: homeWon ? row.home_score : row.away_score,
      loserScore: homeWon ? row.away_score : row.home_score,
      replayGroupUrl: row.ballchasing_group_url,
      confirmedAt: row.confirmed_at,
    }
  })
}

// ---------- leaderboards ----------

const AVG_MIN_GAMES = 25
const STAT_KEYS = ['score', 'goals', 'assists', 'saves', 'shots', 'demos_inflicted', 'mvps']

async function resolveDisplayNames(discordIds) {
  if (!discordIds.length) return new Map()
  const r = await query(
    `SELECT discord_id, display_name, username FROM discord_members WHERE discord_id = ANY($1)`,
    [discordIds]
  ).catch(() => ({ rows: [] }))
  const map = new Map()
  for (const row of r.rows) map.set(String(row.discord_id), row.display_name || row.username)
  return map
}

/**
 * Player AVERAGE leaders (min 25 games), per stat.
 * scope: 'season' (active season, optional division) | 'alltime'
 */
export async function getAverageLeaders({ scope = 'season', seasonId = null, division = null, top = 5 }) {
  let rows
  if (scope === 'alltime') {
    const r = await query(
      `SELECT discord_id, games, score, goals, assists, saves, shots, demos_inflicted, mvps, beluga_score
       FROM stats_player_lifetime WHERE is_playoff = FALSE AND games >= $1`,
      [AVG_MIN_GAMES]
    ).catch(() => ({ rows: [] }))
    rows = r.rows
  } else {
    const params = [seasonId, AVG_MIN_GAMES]
    let where = `season_id = $1 AND is_playoff = FALSE AND games >= $2`
    if (division) {
      params.push(division)
      where += ` AND division = $${params.length}`
    }
    const r = await query(
      `SELECT discord_id, division, games, score, goals, assists, saves, shots, demos_inflicted, mvps, beluga_score
       FROM stats_player_season WHERE ${where}`,
      params
    ).catch(() => ({ rows: [] }))
    rows = r.rows
  }

  const names = await resolveDisplayNames(rows.map((r) => String(r.discord_id)))
  const players = rows.map((r) => ({
    discordId: String(r.discord_id),
    name: names.get(String(r.discord_id)) || `User ${String(r.discord_id).slice(-4)}`,
    division: r.division || null,
    games: Number(r.games || 0),
    belugaScore: Number(r.beluga_score || 0),
    averages: Object.fromEntries(
      STAT_KEYS.map((k) => [k, r.games ? Math.round((Number(r[k] || 0) / Number(r.games)) * 100) / 100 : 0])
    ),
  }))

  const boards = {}
  for (const key of STAT_KEYS) {
    boards[key] = [...players]
      .sort((a, b) => b.averages[key] - a.averages[key])
      .slice(0, top)
      .map((p, i) => ({ rank: i + 1, ...p, value: p.averages[key] }))
  }
  boards.beluga_score = [...players]
    .sort((a, b) => b.belugaScore - a.belugaScore)
    .slice(0, top)
    .map((p, i) => ({ rank: i + 1, ...p, value: p.belugaScore }))
  return { minGames: AVG_MIN_GAMES, boards }
}

/** Team stat totals for a division (current season or all-time). */
export async function getTeamTotals({ scope = 'season', seasonId = null, division }) {
  const params = []
  let where = `ts.is_playoff = FALSE`
  if (scope === 'season') {
    params.push(seasonId)
    where += ` AND ts.season_id = $${params.length}`
  }
  if (division) {
    params.push(division)
    where += ` AND ts.division = $${params.length}`
  }
  const r = await query(
    `SELECT t.name AS team, ts.division,
        SUM(ts.games_played)::int AS games_played,
        SUM(ts.score)::int AS score, SUM(ts.goals)::int AS goals, SUM(ts.assists)::int AS assists,
        SUM(ts.saves)::int AS saves, SUM(ts.shots)::int AS shots,
        SUM(ts.demos_inflicted)::int AS demos_inflicted,
        SUM(ts.series_wins)::int AS wins, SUM(ts.series_losses)::int AS losses
     FROM stats_team_season ts
     JOIN teams t ON t.id = ts.team_id
     WHERE ${where}
     GROUP BY t.name, ts.division
     ORDER BY SUM(ts.score) DESC`,
    params
  ).catch(() => ({ rows: [] }))
  return r.rows
}

/** Franchise records: combined W-L of a franchise's teams across all 3 divisions. */
export async function getFranchiseRecords({ scope = 'season', seasonId = null }) {
  const params = []
  let where = `ts.is_playoff = FALSE`
  if (scope === 'season') {
    params.push(seasonId)
    where += ` AND ts.season_id = $${params.length}`
  }
  const r = await query(
    `SELECT COALESCE(f.name, t.name) AS franchise,
        SUM(ts.series_wins)::int AS wins, SUM(ts.series_losses)::int AS losses
     FROM stats_team_season ts
     JOIN teams t ON t.id = ts.team_id
     LEFT JOIN team_franchises f ON f.id = t.franchise_id
     WHERE ${where}
     GROUP BY COALESCE(f.name, t.name)
     ORDER BY SUM(ts.series_wins) DESC, SUM(ts.series_losses) ASC`,
    params
  ).catch(() => ({ rows: [] }))
  return r.rows.map((row, i) => ({
    rank: i + 1,
    franchise: row.franchise,
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    record: `${row.wins}-${row.losses}`,
  }))
}

// ---------- player profile ----------

export async function getPlayerStatsBundle(discordId) {
  const id = String(discordId)
  const [seasonRows, lifetimeRows, history, accounts, recentGames] = await Promise.all([
    query(
      `SELECT ps.*, s.season_number, t.name AS team_name
       FROM stats_player_season ps
       LEFT JOIN seasons s ON s.id = ps.season_id
       LEFT JOIN teams t ON t.id = ps.team_id
       WHERE ps.discord_id = $1
       ORDER BY s.season_number DESC NULLS LAST, ps.division`,
      [id]
    ).catch(() => ({ rows: [] })),
    query(`SELECT * FROM stats_player_lifetime WHERE discord_id = $1`, [id]).catch(() => ({ rows: [] })),
    query(
      `SELECT name, platform, platform_id, observed_at FROM stats_name_history
       WHERE discord_id = $1 ORDER BY observed_at DESC LIMIT 25`,
      [id]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT platform, platform_id, current_name, last_seen FROM stats_player_accounts
       WHERE discord_id = $1 ORDER BY last_seen DESC`,
      [id]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT gp.score, gp.goals, gp.assists, gp.saves, gp.shots, gp.mvp,
          gp.demos_inflicted, gp.demos_taken,
          g.home_goals, g.away_goals, g.ballchasing_replay_url, g.played_at,
          s.division, s.week, s.is_playoff,
          ht.name AS home_team, at.name AS away_team, tm.name AS player_team
       FROM stats_game_players gp
       JOIN stats_games g ON g.id = gp.game_id
       JOIN stats_series s ON s.id = gp.series_id
       LEFT JOIN teams ht ON ht.id = s.home_team_id
       LEFT JOIN teams at ON at.id = s.away_team_id
       LEFT JOIN teams tm ON tm.id = gp.team_id
       WHERE gp.discord_id = $1 AND s.status = 'confirmed'
       ORDER BY g.played_at DESC NULLS LAST, gp.id DESC
       LIMIT 40`,
      [id]
    ).catch(() => ({ rows: [] })),
  ])

  const num = (v) => Number(v || 0)
  const avg = (total, n, dp = 2) => (n ? Math.round((total / n) * 10 ** dp) / 10 ** dp : 0)

  const mapTotals = (r) => ({
    games: num(r.games),
    score: num(r.score), goals: num(r.goals), assists: num(r.assists),
    saves: num(r.saves), shots: num(r.shots),
    demosInflicted: num(r.demos_inflicted), demosTaken: num(r.demos_taken),
    mvps: num(r.mvps), belugaScore: num(r.beluga_score),
  })
  const perGame = (t) => ({
    score: avg(t.score, t.games), goals: avg(t.goals, t.games), assists: avg(t.assists, t.games),
    saves: avg(t.saves, t.games), shots: avg(t.shots, t.games),
    demosInflicted: avg(t.demosInflicted, t.games), demosTaken: avg(t.demosTaken, t.games),
    mvps: avg(t.mvps, t.games),
  })

  const seasons = seasonRows.rows.map((r) => ({
    seasonId: r.season_id,
    seasonNumber: r.season_number,
    division: r.division,
    isPlayoff: r.is_playoff,
    teamName: r.team_name,
    totals: mapTotals(r),
    perGame: perGame(mapTotals(r)),
  }))

  const lifetime = {}
  for (const r of lifetimeRows.rows) {
    const t = mapTotals(r)
    const seasonsPlayed = num(r.seasons_played)
    lifetime[r.is_playoff ? 'playoffs' : 'regular'] = {
      totals: t,
      seasonsPlayed,
      perGame: perGame(t),
      perSeason: {
        score: avg(t.score, seasonsPlayed), goals: avg(t.goals, seasonsPlayed),
        assists: avg(t.assists, seasonsPlayed), saves: avg(t.saves, seasonsPlayed),
        shots: avg(t.shots, seasonsPlayed), mvps: avg(t.mvps, seasonsPlayed),
      },
    }
  }

  return {
    seasons,
    lifetime,
    nameHistory: history.rows,
    accounts: accounts.rows,
    recentGames: recentGames.rows.map((r) => ({
      division: r.division, week: r.week, isPlayoff: r.is_playoff,
      home: r.home_team, away: r.away_team, playerTeam: r.player_team,
      homeGoals: r.home_goals, awayGoals: r.away_goals,
      score: num(r.score), goals: num(r.goals), assists: num(r.assists),
      saves: num(r.saves), shots: num(r.shots), mvp: Boolean(r.mvp),
      demosInflicted: num(r.demos_inflicted), demosTaken: num(r.demos_taken),
      replayUrl: r.ballchasing_replay_url, playedAt: r.played_at,
    })),
  }
}

// ---------- team page ----------

export async function getTeamStatsBundle(seasonId, teamId) {
  const [seasonRow, playerRows, seriesRows] = await Promise.all([
    query(
      `SELECT * FROM stats_team_season WHERE season_id = $1 AND team_id = $2 AND is_playoff = FALSE`,
      [seasonId, teamId]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT ps.*
       FROM stats_player_season ps
       WHERE ps.season_id = $1 AND ps.team_id = $2 AND ps.is_playoff = FALSE
       ORDER BY ps.score DESC`,
      [seasonId, teamId]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT s.id, s.week, s.is_playoff, s.is_forfeit, s.home_score, s.away_score,
          s.ballchasing_group_url, s.confirmed_at, s.home_team_id, s.away_team_id,
          ht.name AS home_team, at.name AS away_team
       FROM stats_series s
       LEFT JOIN teams ht ON ht.id = s.home_team_id
       LEFT JOIN teams at ON at.id = s.away_team_id
       WHERE s.season_id = $1 AND s.status = 'confirmed'
         AND (s.home_team_id = $2 OR s.away_team_id = $2)
       ORDER BY s.week ASC NULLS LAST, s.id ASC`,
      [seasonId, teamId]
    ).catch(() => ({ rows: [] })),
  ])

  const rec = seasonRow.rows[0] || null
  const names = await resolveDisplayNames(playerRows.rows.map((r) => String(r.discord_id)))

  return {
    record: rec
      ? {
          wins: Number(rec.series_wins || 0),
          losses: Number(rec.series_losses || 0),
          gameWins: Number(rec.game_wins || 0),
          gameLosses: Number(rec.game_losses || 0),
          goalsFor: Number(rec.goals_for || 0),
          goalsAgainst: Number(rec.goals_against || 0),
          gamesPlayed: Number(rec.games_played || 0),
          belugaScore: Number(rec.beluga_score || 0),
        }
      : null,
    playerStats: playerRows.rows.map((r) => ({
      discordId: String(r.discord_id),
      playerName: names.get(String(r.discord_id)) || `User ${String(r.discord_id).slice(-4)}`,
      gamesPlayed: Number(r.games || 0),
      score: Number(r.score || 0), goals: Number(r.goals || 0), assists: Number(r.assists || 0),
      saves: Number(r.saves || 0), shots: Number(r.shots || 0),
      demosInflicted: Number(r.demos_inflicted || 0), demosTaken: Number(r.demos_taken || 0),
      mvps: Number(r.mvps || 0), belugaScore: Number(r.beluga_score || 0),
    })),
    series: seriesRows.rows.map((r) => {
      const isHome = r.home_team_id === teamId
      const ourScore = isHome ? r.home_score : r.away_score
      const theirScore = isHome ? r.away_score : r.home_score
      return {
        id: r.id,
        week: r.week,
        isPlayoff: r.is_playoff,
        isForfeit: r.is_forfeit,
        opponent: isHome ? r.away_team : r.home_team,
        ourScore: Number(ourScore),
        theirScore: Number(theirScore),
        won: Number(ourScore) > Number(theirScore),
        replayGroupUrl: r.ballchasing_group_url,
        confirmedAt: r.confirmed_at,
      }
    }),
  }
}

export { AVG_MIN_GAMES }
