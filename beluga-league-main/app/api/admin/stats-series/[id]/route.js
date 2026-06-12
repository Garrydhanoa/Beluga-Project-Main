import { NextResponse } from 'next/server'
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
export async function PATCH(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const { id } = await params
  const seriesId = Number(id)
  const series = await loadSeries(seriesId)
  if (!series) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

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
  if (sets.length) {
    // Keep winner consistent with any score change.
    const hs = body.homeScore !== undefined ? Number(body.homeScore) : series.home_score
    const as = body.awayScore !== undefined ? Number(body.awayScore) : series.away_score
    sets.push(`winner_team_id = $${i}`)
    vals.push(hs > as ? series.home_team_id : as > hs ? series.away_team_id : null)
    i += 1
    sets.push(`updated_at = CURRENT_TIMESTAMP`)
    vals.push(seriesId)
    await query(`UPDATE stats_series SET ${sets.join(', ')} WHERE id = $${i}`, vals)
  }

  // 2) Per-game score edits: [{ id, homeGoals, awayGoals }]
  for (const g of Array.isArray(body.gameEdits) ? body.gameEdits : []) {
    const winner = Number(g.homeGoals) > Number(g.awayGoals) ? series.home_team_id
      : Number(g.awayGoals) > Number(g.homeGoals) ? series.away_team_id : null
    await query(
      `UPDATE stats_games SET home_goals = $1, away_goals = $2, winner_team_id = $3 WHERE id = $4 AND series_id = $5`,
      [Number(g.homeGoals) || 0, Number(g.awayGoals) || 0, winner, Number(g.id), seriesId]
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

  const updated = await loadSeries(seriesId)
  await recomputeForSeries(updated)
  await logAudit({
    seriesId, action: 'series_edited',
    actor: { name: auth.session?.discordUsername || auth.session?.user?.name || 'admin' },
    detail: { fields: Object.keys(body) },
  })

  return NextResponse.json({ ok: true })
}

// Delete a series — stats vanish from all totals automatically (recompute).
export async function DELETE(_request, { params }) {
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
