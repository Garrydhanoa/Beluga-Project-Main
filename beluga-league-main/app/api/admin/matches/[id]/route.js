import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { query } from '../../../../../lib/db'

export const dynamic = 'force-dynamic'

function badRequest(msg, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seriesId = Number(id)
  if (!Number.isInteger(seriesId)) return badRequest('Invalid id')

  await ensureLeagueSchema()

  const seriesRes = await query(`
    SELECT ms.*, ht.name AS home_name, at.name AS away_name
    FROM match_series ms
    LEFT JOIN teams ht ON ht.id = ms.home_team_id
    LEFT JOIN teams at ON at.id = ms.away_team_id
    WHERE ms.id = $1 LIMIT 1
  `, [seriesId])
  if (!seriesRes.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ms = seriesRes.rows[0]

  const [replaysRes, approvalsRes] = await Promise.all([
    query(`
      SELECT mr.id, mr.ballchasing_id, mr.ballchasing_url, mr.status,
        mr.home_team_id, mr.away_team_id, mr.home_goals, mr.away_goals,
        mr.created_at
      FROM match_replays mr
      WHERE mr.series_id = $1
      ORDER BY mr.id
    `, [seriesId]),
    query(`
      SELECT msa.id, msa.team_id, msa.approver_discord_id, msa.approver_username,
        msa.approver_role, msa.decision, msa.created_at,
        t.name AS team_name
      FROM match_series_approvals msa
      LEFT JOIN teams t ON t.id = msa.team_id
      WHERE msa.series_id = $1
      ORDER BY msa.created_at
    `, [seriesId]),
  ])

  // Fetch player stats per replay
  const replayIds = replaysRes.rows.map((r) => r.id)
  let replayPlayers = []
  if (replayIds.length) {
    const r = await query(`
      SELECT mrp.*, t.name AS team_name_resolved
      FROM match_replay_players mrp
      LEFT JOIN teams t ON t.id = mrp.team_id
      WHERE mrp.replay_id = ANY($1::int[])
      ORDER BY mrp.replay_id,
        COALESCE(NULLIF(mrp.stats->'core'->>'score', '')::int, 0) DESC
    `, [replayIds])
    replayPlayers = r.rows
  }

  return NextResponse.json({
    series: {
      id: ms.id,
      seasonId: ms.season_id,
      division: ms.division,
      week: ms.week,
      isPlayoff: ms.is_playoff,
      homeTeamId: ms.home_team_id,
      awayTeamId: ms.away_team_id,
      homeTeam: ms.home_name,
      awayTeam: ms.away_name,
      homeScore: ms.home_score,
      awayScore: ms.away_score,
      isForfeit: ms.is_forfeit,
      status: ms.status,
      reportType: ms.report_type,
      reportSource: ms.report_source,
      statsApplied: ms.stats_applied,
      threadId: ms.thread_id,
      reportedByDiscordId: ms.reported_by_discord_id,
      reportedByUsername: ms.reported_by_username,
      createdAt: ms.created_at,
      updatedAt: ms.updated_at,
    },
    replays: replaysRes.rows.map((r) => ({
      id: r.id,
      ballchasingId: r.ballchasing_id,
      ballchasingUrl: r.ballchasing_url,
      status: r.status,
      homeTeamId: r.home_team_id,
      awayTeamId: r.away_team_id,
      homeGoals: r.home_goals,
      awayGoals: r.away_goals,
      createdAt: r.created_at,
      players: replayPlayers
        .filter((p) => p.replay_id === r.id)
        .map((p) => ({
          id: p.id,
          teamId: p.team_id,
          teamName: p.team_name_resolved || p.team_name,
          playerName: p.player_name,
          platform: p.platform,
          platformId: p.platform_id,
          teamColor: p.team_color,
          stats: p.stats,
        })),
    })),
    approvals: approvalsRes.rows.map((a) => ({
      id: a.id,
      teamId: a.team_id,
      teamName: a.team_name,
      approverDiscordId: a.approver_discord_id,
      approverUsername: a.approver_username,
      approverRole: a.approver_role,
      decision: a.decision,
      createdAt: a.created_at,
    })),
  })
}

export async function PATCH(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seriesId = Number(id)
  if (!Number.isInteger(seriesId)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  await ensureLeagueSchema()

  const fields = []
  const values = []
  let i = 1
  if (body.homeScore !== undefined) {
    const v = Number(body.homeScore)
    if (!Number.isInteger(v) || v < 0) return badRequest('Invalid homeScore')
    fields.push(`home_score = $${i++}`); values.push(v)
  }
  if (body.awayScore !== undefined) {
    const v = Number(body.awayScore)
    if (!Number.isInteger(v) || v < 0) return badRequest('Invalid awayScore')
    fields.push(`away_score = $${i++}`); values.push(v)
  }
  if (body.isForfeit !== undefined) { fields.push(`is_forfeit = $${i++}`); values.push(Boolean(body.isForfeit)) }
  if (body.status !== undefined) { fields.push(`status = $${i++}`); values.push(String(body.status)) }
  if (body.week !== undefined) {
    const v = body.week === null ? null : Number(body.week)
    if (v !== null && (!Number.isInteger(v) || v < 1)) return badRequest('Invalid week')
    fields.push(`week = $${i++}`); values.push(v)
  }
  if (body.division !== undefined) { fields.push(`division = $${i++}`); values.push(String(body.division)) }
  if (body.isPlayoff !== undefined) { fields.push(`is_playoff = $${i++}`); values.push(Boolean(body.isPlayoff)) }
  if (body.statsApplied !== undefined) { fields.push(`stats_applied = $${i++}`); values.push(Boolean(body.statsApplied)) }

  if (!fields.length) return badRequest('No fields to update')

  values.push(seriesId)
  await query(
    `UPDATE match_series SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${i}`,
    values
  )

  return NextResponse.json({ ok: true })
}

export async function DELETE(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seriesId = Number(id)
  if (!Number.isInteger(seriesId)) return badRequest('Invalid id')

  await ensureLeagueSchema()
  await query('DELETE FROM match_series WHERE id = $1', [seriesId])
  return NextResponse.json({ ok: true })
}
