// Admin-side write/recompute for the new stats system — a faithful ESM port of
// the bot's statsStore recompute (same Beluga weights, same derivation rules:
// aggregates are rebuilt from stats_game_players; manual_override rows are
// preserved). Used by the admin API for edits, deletes, identity fixes, recalc.

import { query, getPool } from './db'

export const BELUGA_WEIGHTS = { score: 25, goals: 30, assists: 15, saves: 20, shots: 5, demos: 5 }
const W_TOTAL = Object.values(BELUGA_WEIGHTS).reduce((a, b) => a + b, 0)

// stats_series.forfeit_kind values. Mirrors Beluga Bot/src/stats/statsStore.js —
// keep in sync.
//   'full'   — one team forfeited: a 1-0 series win, carried by one synthetic game row.
//   'double' — BOTH teams forfeited: no winner, no game rows, and each team is charged
//              the same 0-1 loss the loser of a full FF takes (see recomputeTeamSeason).
export const FULL_FORFEIT = 'full'
export const DOUBLE_FORFEIT = 'double'

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
    `SELECT id, home_team_id, away_team_id, winner_team_id, is_forfeit, forfeit_kind
     FROM stats_series
     WHERE season_id=$1 AND division=$2 AND is_playoff=$3 AND status='confirmed'
       AND (home_team_id=$4 OR away_team_id=$4)`,
    [seasonId, division, isPlayoff, teamId]
  )
  let seriesWins = 0; let seriesLosses = 0
  let gameWins = 0; let gameLosses = 0; let goalsFor = 0; let goalsAgainst = 0
  for (const s of sres.rows) {
    // Double forfeit: nobody won, so BOTH teams are charged the same 0-1 loss a
    // normal FF's loser takes. It has no game rows, so the +1 game loss and the
    // +1 goal against are applied here — a NULL winner would otherwise fall
    // through both branches below and count as nothing at all.
    if (s.is_forfeit && s.forfeit_kind === DOUBLE_FORFEIT) {
      seriesLosses += 1; gameLosses += 1; goalsAgainst += 1
      continue
    }
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
  // Discover teams from BOTH the per-player rows AND the series themselves, so a team
  // whose only series has no player rows (all-skipped, or FF-only — /report-ff makes a
  // synthetic game with no player rows) still gets its standings rebuilt. Discovering
  // only via stats_game_players silently skips such teams. recomputeForSeries already
  // derives teams from the series row; this keeps "Recalculate all" consistent with it.
  const teams = await query(
    `SELECT DISTINCT season_id, division, team_id, is_playoff FROM (
        SELECT season_id, division, team_id, is_playoff
          FROM stats_game_players WHERE season_id=$1 AND team_id IS NOT NULL
        UNION
        SELECT season_id, division, home_team_id AS team_id, is_playoff
          FROM stats_series WHERE season_id=$1 AND status='confirmed' AND home_team_id IS NOT NULL
        UNION
        SELECT season_id, division, away_team_id AS team_id, is_playoff
          FROM stats_series WHERE season_id=$1 AND status='confirmed' AND away_team_id IS NOT NULL
     ) u`, [seasonId]
  )
  for (const r of teams.rows) await recomputeTeamSeason(r.season_id, r.division, r.team_id, r.is_playoff)
  const players = await query(
    `SELECT DISTINCT discord_id FROM stats_game_players WHERE season_id=$1 AND discord_id IS NOT NULL`, [seasonId]
  )
  for (const r of players.rows) await recomputePlayer(r.discord_id)
}

/**
 * Is this matchup already on the books? Mirrors findExistingSeries() in the bot's
 * report flow: season + division + week + the two teams in EITHER order, because
 * schedule_match_id alone misses staff and forfeit entries.
 */
export async function findExistingSeries({ seasonId, division, week, homeTeamId, awayTeamId }) {
  const r = await query(
    `SELECT s.id, s.home_score, s.away_score, s.is_forfeit, s.forfeit_kind,
        ht.name AS home_team, at.name AS away_team
       FROM stats_series s
       LEFT JOIN teams ht ON ht.id = s.home_team_id
       LEFT JOIN teams at ON at.id = s.away_team_id
      WHERE s.season_id = $1 AND s.division = $2 AND s.status = 'confirmed'
        AND s.week IS NOT DISTINCT FROM $3
        AND ((s.home_team_id = $4 AND s.away_team_id = $5) OR (s.home_team_id = $5 AND s.away_team_id = $4))
      LIMIT 1`,
    [seasonId, division, week ?? null, homeTeamId, awayTeamId]
  )
  return r.rows[0] || null
}

/**
 * Create a series by hand (admin "Report a series"). The bot's commitSeries()
 * equivalent for the website — same tables, same shapes, same recompute contract,
 * but the Ballchasing group and every game are OPTIONAL: staff may be recording a
 * series that never had a replay group at all.
 *
 * Player stat lines are optional too. They can be typed here, added later in the
 * edit modal, or pulled in from Ballchasing by the bot's importer.
 *
 * @throws {Error} with .code 'DUPLICATE' | 'GROUP_TAKEN' | 'SCHEDULE_TAKEN' so the
 *         route can turn each into a sentence rather than a Postgres constraint name.
 */
export async function createSeries({
  seasonId, division, week = null, isPlayoff = false, format = 'bo5',
  homeTeamId, awayTeamId, homeScore = null, awayScore = null,
  isForfeit = false, forfeitKind = null, scheduleMatchId = null,
  groupUrl = null, groupId = null, groupName = null,
  games = [], reportedBy = null, allowDuplicate = false,
}) {
  if (!seasonId) throw new Error('A season is required.')
  if (!division) throw new Error('A division is required.')
  if (!homeTeamId || !awayTeamId) throw new Error('Both teams are required.')
  if (Number(homeTeamId) === Number(awayTeamId)) throw new Error('The two teams must be different.')

  if (!allowDuplicate) {
    const existing = await findExistingSeries({ seasonId, division, week, homeTeamId, awayTeamId })
    if (existing) {
      const err = new Error(
        `${existing.home_team || 'Home'} vs ${existing.away_team || 'Away'} is already reported for this week ` +
        `(series #${existing.id}: ${existing.home_score}-${existing.away_score}${existing.is_forfeit ? ' FF' : ''}).`
      )
      err.code = 'DUPLICATE'
      err.seriesId = existing.id
      throw err
    }
  }

  // Series score: an explicit value wins (forfeits set their own), otherwise count
  // game wins — the same derivation the bot uses.
  let hs = homeScore
  let as = awayScore
  if (hs == null || as == null) {
    hs = games.filter((g) => Number(g.homeGoals) > Number(g.awayGoals)).length
    as = games.filter((g) => Number(g.awayGoals) > Number(g.homeGoals)).length
  }
  hs = Number(hs) || 0
  as = Number(as) || 0
  const winnerTeamId = hs > as ? homeTeamId : as > hs ? awayTeamId : null

  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    const sres = await client.query(
      `INSERT INTO stats_series (
          season_id, division, week, is_playoff, schedule_match_id,
          home_team_id, away_team_id, home_score, away_score, winner_team_id,
          format, is_forfeit, forfeit_kind,
          ballchasing_group_id, ballchasing_group_url, ballchasing_group_name,
          status, reported_by_discord_id, reported_via, confirmed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'confirmed',$17,'website',CURRENT_TIMESTAMP)
       RETURNING id`,
      [
        seasonId, division, week ?? null, Boolean(isPlayoff), scheduleMatchId ?? null,
        homeTeamId, awayTeamId, hs, as, winnerTeamId,
        format, Boolean(isForfeit), forfeitKind ?? null,
        groupId ?? null, groupUrl ?? null, groupName ?? null,
        reportedBy?.discordId ?? null,
      ]
    )
    const seriesId = sres.rows[0].id

    for (let gi = 0; gi < games.length; gi += 1) {
      const g = games[gi]
      const hg = Number(g.homeGoals) || 0
      const ag = Number(g.awayGoals) || 0
      const gWinner = hg > ag ? homeTeamId : ag > hg ? awayTeamId : null
      const ins = await client.query(
        `INSERT INTO stats_games (
            series_id, game_number, ballchasing_replay_id, ballchasing_replay_url,
            overtime, home_goals, away_goals, winner_team_id, is_forfeit
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [seriesId, g.gameNumber ?? gi + 1, g.replayId ?? null, g.replayUrl ?? null,
         Boolean(g.overtime), hg, ag, gWinner, Boolean(g.isForfeit)]
      )
      const gameId = ins.rows[0].id

      for (const p of (g.players || [])) {
        await client.query(
          `INSERT INTO stats_game_players (
              game_id, series_id, season_id, division, is_playoff, team_id,
              discord_id, ingame_name, is_sub,
              score, goals, assists, saves, shots, demos_inflicted, demos_taken, mvp, manually_edited
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,TRUE)`,
          [gameId, seriesId, seasonId, division, Boolean(isPlayoff), p.teamId ?? null,
           p.discordId ?? null, p.ingameName ?? null, Boolean(p.isSub),
           Number(p.score) || 0, Number(p.goals) || 0, Number(p.assists) || 0, Number(p.saves) || 0,
           Number(p.shots) || 0, Number(p.demosInflicted) || 0, Number(p.demosTaken) || 0, Boolean(p.mvp)]
        )
      }
    }

    await client.query('COMMIT')

    // Recompute outside the txn — same contract as the bot: the series is saved, so
    // a recompute hiccup must not fail the report.
    try {
      await recomputeForSeries({ id: seriesId, season_id: seasonId, division, is_playoff: Boolean(isPlayoff), home_team_id: homeTeamId, away_team_id: awayTeamId })
    } catch { /* aggregates can always be rebuilt with "Recalculate all totals" */ }

    return { seriesId, homeScore: hs, awayScore: as, winnerTeamId }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    // Turn the two partial unique indexes into something a human can act on.
    if (err.code === '23505') {
      if (String(err.constraint || '').includes('group')) {
        const e = new Error('That Ballchasing group has already been reported on another series. Every group can only be used once.')
        e.code = 'GROUP_TAKEN'
        throw e
      }
      if (String(err.constraint || '').includes('schedule')) {
        const e = new Error('That scheduled match already has a reported series attached to it.')
        e.code = 'SCHEDULE_TAKEN'
        throw e
      }
    }
    throw err
  } finally {
    client.release()
  }
}

/** Queue the bot to pull real stats in from Ballchasing for a series. */
export async function queueImport(seriesId, { discordId = null, username = null } = {}) {
  const r = await query(
    `INSERT INTO stats_import_jobs (series_id, requested_by_discord_id, requested_by_username)
     VALUES ($1,$2,$3) RETURNING id`,
    [seriesId, discordId, username]
  )
  return r.rows[0].id
}

export async function logAudit({ seriesId = null, action, actor = null, detail = null }) {
  await query(
    `INSERT INTO stats_audit_log (series_id, action, actor_discord_id, actor_name, actor_source, detail)
     VALUES ($1,$2,$3,$4,'website',$5::jsonb)`,
    [seriesId, action, actor?.discordId || null, actor?.name || null, detail ? JSON.stringify(detail) : null]
  ).catch(() => {})
}
