import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { query } from '../../../../../lib/db'
import { recomputeForSeries, recomputePlayer, logAudit } from '../../../../../lib/belugaStatsAdmin'

export const dynamic = 'force-dynamic'

async function loadSeries(id) {
  const r = await query(`SELECT * FROM stats_series WHERE id = $1`, [id])
  return r.rows[0] || null
}

// Full series detail: games + per-player lines + audit trail.
export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const { id } = await params
  const seriesId = Number(id)
  const series = await loadSeries(seriesId)
  if (!series) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [teams, games, players, audit] = await Promise.all([
    query(`SELECT id, name FROM teams WHERE id IN ($1, $2)`, [series.home_team_id, series.away_team_id]),
    query(`SELECT * FROM stats_games WHERE series_id = $1 ORDER BY game_number`, [seriesId]),
    query(
      `SELECT gp.*, t.name AS team_name FROM stats_game_players gp
       LEFT JOIN teams t ON t.id = gp.team_id
       WHERE gp.series_id = $1 ORDER BY gp.game_id, gp.team_id, gp.score DESC`,
      [seriesId]
    ),
    query(`SELECT * FROM stats_audit_log WHERE series_id = $1 ORDER BY created_at DESC LIMIT 50`, [seriesId]),
  ])
  const nameOf = new Map(teams.rows.map((t) => [t.id, t.name]))

  return NextResponse.json({
    series: {
      ...series,
      home_team_name: nameOf.get(series.home_team_id) || null,
      away_team_name: nameOf.get(series.away_team_id) || null,
    },
    games: games.rows,
    players: players.rows,
    audit: audit.rows,
  })
}

// Edit: series fields, per-game scores, per-player stat lines. Everything is
// recomputed from the per-game rows afterwards, so totals always stay honest.
async function patchHandler(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const { id } = await params
  const seriesId = Number(id)
  const series = await loadSeries(seriesId)
  if (!series) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  try {
  // 1) Series-level fields.
  const sets = []
  const vals = []
  let i = 1
  const setIf = (cond, col, val) => { if (cond) { sets.push(`${col} = $${i}`); vals.push(val); i += 1 } }
  setIf(body.homeScore !== undefined, 'home_score', Number(body.homeScore))
  setIf(body.awayScore !== undefined, 'away_score', Number(body.awayScore))
  setIf(body.isForfeit !== undefined, 'is_forfeit', Boolean(body.isForfeit))
  setIf(body.status !== undefined, 'status', String(body.status))
  setIf(body.week !== undefined, 'week', body.week === null ? null : Number(body.week))
  setIf(body.manualOverride !== undefined, 'manual_override', Boolean(body.manualOverride))
  // Matchup-level fields, so a series reported by hand can be corrected later.
  setIf(body.division !== undefined, 'division', String(body.division))
  setIf(body.isPlayoff !== undefined, 'is_playoff', Boolean(body.isPlayoff))
  setIf(body.format !== undefined, 'format', body.format === 'bo7' ? 'bo7' : 'bo5')
  setIf(body.homeTeamId !== undefined, 'home_team_id', Number(body.homeTeamId))
  setIf(body.awayTeamId !== undefined, 'away_team_id', Number(body.awayTeamId))
  setIf(body.ballchasingGroupUrl !== undefined, 'ballchasing_group_url', body.ballchasingGroupUrl || null)
  // forfeit_kind must follow is_forfeit: leaving a stale 'double' behind after the
  // forfeit flag is cleared would keep charging BOTH teams a loss in recomputeTeamSeason.
  if (body.forfeitKind !== undefined || body.isForfeit !== undefined) {
    const ff = body.isForfeit !== undefined ? Boolean(body.isForfeit) : series.is_forfeit
    const kind = body.forfeitKind !== undefined ? body.forfeitKind : series.forfeit_kind
    setIf(true, 'forfeit_kind', ff ? (kind === 'double' ? 'double' : 'full') : null)
  }
  if (sets.length) {
    // Keep winner consistent with any score change. A double forfeit is 0-0, so this
    // correctly leaves it with no winner.
    const hs = body.homeScore !== undefined ? Number(body.homeScore) : series.home_score
    const as = body.awayScore !== undefined ? Number(body.awayScore) : series.away_score
    const homeId = body.homeTeamId !== undefined ? Number(body.homeTeamId) : series.home_team_id
    const awayId = body.awayTeamId !== undefined ? Number(body.awayTeamId) : series.away_team_id
    sets.push(`winner_team_id = $${i}`)
    vals.push(hs > as ? homeId : as > hs ? awayId : null)
    i += 1
    sets.push(`updated_at = CURRENT_TIMESTAMP`)
    vals.push(seriesId)
    await query(`UPDATE stats_series SET ${sets.join(', ')} WHERE id = $${i}`, vals)
  }

  // 1b) Teams changed → move the existing game winners and player rows with them.
  // A single CASE evaluates against the pre-update row, so this is safe even when
  // the two teams are swapped and the ids would otherwise collide mid-update.
  const newHomeId = body.homeTeamId !== undefined ? Number(body.homeTeamId) : series.home_team_id
  const newAwayId = body.awayTeamId !== undefined ? Number(body.awayTeamId) : series.away_team_id
  if (newHomeId !== series.home_team_id || newAwayId !== series.away_team_id) {
    const remap = `CASE WHEN %C = $2 THEN $4::int WHEN %C = $3 THEN $5::int ELSE %C END`
    const args = [seriesId, series.home_team_id, series.away_team_id, newHomeId, newAwayId]
    await query(`UPDATE stats_games SET winner_team_id = ${remap.replaceAll('%C', 'winner_team_id')} WHERE series_id = $1`, args)
    await query(`UPDATE stats_game_players SET team_id = ${remap.replaceAll('%C', 'team_id')} WHERE series_id = $1`, args)
  }

  // 1c) Swap which SIDE the stats belong to. The importer guesses home/away from
  // account affinity; when it guesses wrong this flips the whole series in one go
  // rather than making staff re-report it.
  if (body.swapSides) {
    await query(
      `UPDATE stats_game_players SET team_id =
         CASE WHEN team_id = $2 THEN $3::int WHEN team_id = $3 THEN $2::int ELSE team_id END
       WHERE series_id = $1`,
      [seriesId, newHomeId, newAwayId]
    )
    await query(
      `UPDATE stats_games SET home_goals = away_goals, away_goals = home_goals,
         winner_team_id = CASE WHEN winner_team_id = $2 THEN $3::int WHEN winner_team_id = $3 THEN $2::int ELSE winner_team_id END
       WHERE series_id = $1`,
      [seriesId, newHomeId, newAwayId]
    )
    await query(
      `UPDATE stats_series SET home_score = away_score, away_score = home_score,
         winner_team_id = CASE WHEN winner_team_id = $2 THEN $3::int WHEN winner_team_id = $3 THEN $2::int ELSE winner_team_id END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [seriesId, newHomeId, newAwayId]
    )
  }

  // 2) Per-game edits: [{ id, homeGoals, awayGoals, replayUrl?, overtime? }]
  const gameEdits = Array.isArray(body.gameEdits) ? body.gameEdits : []
  for (const g of gameEdits) {
    const winner = Number(g.homeGoals) > Number(g.awayGoals) ? newHomeId
      : Number(g.awayGoals) > Number(g.homeGoals) ? newAwayId : null
    await query(
      `UPDATE stats_games SET home_goals = $1, away_goals = $2, winner_team_id = $3,
          ballchasing_replay_url = CASE WHEN $6::boolean THEN $7 ELSE ballchasing_replay_url END,
          overtime = CASE WHEN $8::boolean THEN $9::boolean ELSE overtime END
       WHERE id = $4 AND series_id = $5`,
      [Number(g.homeGoals) || 0, Number(g.awayGoals) || 0, winner, Number(g.id), seriesId,
       g.replayUrl !== undefined, g.replayUrl || null,
       g.overtime !== undefined, Boolean(g.overtime)]
    )
  }

  // 2b) Add games — a series reported with the wrong number of games, or one built
  // up game by game, has to be able to grow. [{ homeGoals, awayGoals, replayUrl? }]
  for (const g of Array.isArray(body.addGames) ? body.addGames : []) {
    const winner = Number(g.homeGoals) > Number(g.awayGoals) ? newHomeId
      : Number(g.awayGoals) > Number(g.homeGoals) ? newAwayId : null
    const nextNo = await query(`SELECT COALESCE(MAX(game_number), 0) + 1 AS n FROM stats_games WHERE series_id = $1`, [seriesId])
    await query(
      `INSERT INTO stats_games (series_id, game_number, home_goals, away_goals, winner_team_id, overtime, ballchasing_replay_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [seriesId, g.gameNumber ?? nextNo.rows[0].n, Number(g.homeGoals) || 0, Number(g.awayGoals) || 0,
       winner, Boolean(g.overtime), g.replayUrl || null]
    )
  }

  // 2c) Remove games (cascades to their player lines).
  const removeGames = (Array.isArray(body.removeGameIds) ? body.removeGameIds : []).map(Number).filter(Boolean)
  if (removeGames.length) {
    await query(`DELETE FROM stats_games WHERE series_id = $1 AND id = ANY($2::int[])`, [seriesId, removeGames])
  }

  // If the games changed and the admin didn't explicitly set the series score this
  // request, recompute the series tally (game-win counts) + winner from the games
  // (answer-key Q2.3). Forfeits keep their fixed score — never recompute those.
  const isFF = body.isForfeit ?? series.is_forfeit
  const gamesChanged = gameEdits.length || (body.addGames?.length) || removeGames.length || body.swapSides
  if (gamesChanged && !isFF && body.homeScore === undefined && body.awayScore === undefined) {
    const gw = await query(
      `SELECT COUNT(*) FILTER (WHERE winner_team_id = $2)::int AS home_wins,
              COUNT(*) FILTER (WHERE winner_team_id = $3)::int AS away_wins
       FROM stats_games WHERE series_id = $1`,
      [seriesId, newHomeId, newAwayId]
    )
    const hw = gw.rows[0]?.home_wins || 0
    const aw = gw.rows[0]?.away_wins || 0
    const seriesWinner = hw > aw ? newHomeId : aw > hw ? newAwayId : null
    await query(
      `UPDATE stats_series SET home_score = $1, away_score = $2, winner_team_id = $3,
         updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [hw, aw, seriesWinner, seriesId]
    )
  }

  // 3) Per-player stat-line edits: [{ id, score, goals, assists, saves, shots, demosInflicted, demosTaken, mvp }]
  for (const p of Array.isArray(body.playerEdits) ? body.playerEdits : []) {
    await query(
      `UPDATE stats_game_players SET
          score = COALESCE($1, score), goals = COALESCE($2, goals), assists = COALESCE($3, assists),
          saves = COALESCE($4, saves), shots = COALESCE($5, shots),
          demos_inflicted = COALESCE($6, demos_inflicted), demos_taken = COALESCE($7, demos_taken),
          mvp = COALESCE($8, mvp), manually_edited = TRUE
       WHERE id = $9 AND series_id = $10`,
      [p.score ?? null, p.goals ?? null, p.assists ?? null, p.saves ?? null, p.shots ?? null,
       p.demosInflicted ?? null, p.demosTaken ?? null, p.mvp ?? null, Number(p.id), seriesId]
    )
  }

  // 3b) Add a player stat line to a game — a series reported with scores only can
  // have its stats filled in by hand afterwards.
  // [{ gameId, teamId, discordId?, ingameName?, isSub?, score, goals, ... }]
  for (const p of Array.isArray(body.addPlayers) ? body.addPlayers : []) {
    const gid = Number(p.gameId)
    const owns = await query(`SELECT id FROM stats_games WHERE id = $1 AND series_id = $2`, [gid, seriesId])
    if (!owns.rows.length) continue // never let a stat line land on another series' game
    await query(
      `INSERT INTO stats_game_players (
          game_id, series_id, season_id, division, is_playoff, team_id,
          discord_id, ingame_name, is_sub,
          score, goals, assists, saves, shots, demos_inflicted, demos_taken, mvp, manually_edited
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,TRUE)`,
      [gid, seriesId, series.season_id, body.division ?? series.division,
       body.isPlayoff ?? series.is_playoff, Number(p.teamId) || null,
       p.discordId || null, p.ingameName || null, Boolean(p.isSub),
       Number(p.score) || 0, Number(p.goals) || 0, Number(p.assists) || 0, Number(p.saves) || 0,
       Number(p.shots) || 0, Number(p.demosInflicted) || 0, Number(p.demosTaken) || 0, Boolean(p.mvp)]
    )
  }

  // 3c) Remove player stat lines.
  const removePlayers = (Array.isArray(body.removePlayerIds) ? body.removePlayerIds : []).map(Number).filter(Boolean)
  if (removePlayers.length) {
    await query(`DELETE FROM stats_game_players WHERE series_id = $1 AND id = ANY($2::int[])`, [seriesId, removePlayers])
  }

  const updated = await loadSeries(seriesId)
  await recomputeForSeries(updated)
  // Moving a series between teams or divisions leaves the ones it LEFT holding
  // stale totals, so rebuild those too — recomputeForSeries only knows about where
  // the series is now.
  if (updated.home_team_id !== series.home_team_id || updated.away_team_id !== series.away_team_id
      || updated.division !== series.division || updated.is_playoff !== series.is_playoff) {
    await recomputeForSeries({ ...series, id: seriesId })
  }
  await logAudit({
    seriesId, action: 'series_edited',
    actor: { name: auth.session?.discordUsername || auth.session?.user?.name || 'admin' },
    detail: { fields: Object.keys(body) },
  })
  } catch (e) {
    console.error('stats-series PATCH failed:', e)
    return NextResponse.json({ error: e.message || 'Edit failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// Delete a series — stats vanish from all totals automatically (recompute).
async function deleteHandler(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const { id } = await params
  const seriesId = Number(id)
  const series = await loadSeries(seriesId)
  if (!series) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Collect the affected players BEFORE the cascade delete.
  const players = await query(
    `SELECT DISTINCT discord_id FROM stats_game_players WHERE series_id = $1 AND discord_id IS NOT NULL`,
    [seriesId]
  )

  await query(`DELETE FROM stats_series WHERE id = $1`, [seriesId])

  // Recompute the two teams + every player that was in the series.
  await recomputeForSeries({ ...series, id: -1 }) // id -1: no game rows left; recomputes the teams
  for (const row of players.rows) await recomputePlayer(row.discord_id)

  await logAudit({
    seriesId, action: 'series_deleted',
    actor: { name: auth.session?.discordUsername || auth.session?.user?.name || 'admin' },
    detail: { homeTeamId: series.home_team_id, awayTeamId: series.away_team_id, week: series.week },
  })

  return NextResponse.json({ ok: true })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const PATCH = withAudit(patchHandler, { action: 'stats-series.patch' })
export const DELETE = withAudit(deleteHandler, { action: 'stats-series.delete' })
