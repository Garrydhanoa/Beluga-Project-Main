import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'
import { getActiveSeason } from '../../../../lib/leagueStore'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  await ensureLeagueSchema()

  const { searchParams } = new URL(request.url)
  let seasonId = searchParams.get('seasonId')
  if (!seasonId || seasonId === 'active') {
    const active = await getActiveSeason()
    seasonId = active?.id || null
  } else {
    seasonId = Number(seasonId)
    if (!Number.isInteger(seasonId)) seasonId = null
  }
  const division = searchParams.get('division')
  const week = searchParams.get('week')
  const status = searchParams.get('status')

  const params = []
  const conds = []
  if (seasonId) { params.push(seasonId); conds.push(`ms.season_id = $${params.length}`) }
  if (division && division !== 'all') { params.push(division); conds.push(`ms.division = $${params.length}`) }
  if (week) { params.push(Number(week)); conds.push(`ms.week = $${params.length}`) }
  if (status && status !== 'all') { params.push(status); conds.push(`ms.status = $${params.length}`) }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const result = await query(`
    SELECT ms.id, ms.season_id, ms.division, ms.week, ms.is_playoff,
      ms.home_team_id, ms.away_team_id,
      ms.home_score, ms.away_score, ms.is_forfeit, ms.status,
      ms.report_type, ms.report_source, ms.stats_applied,
      ms.thread_id, ms.reported_by_username, ms.created_at, ms.updated_at,
      ht.name AS home_name, at.name AS away_name,
      (SELECT COUNT(*)::int FROM match_replays mr WHERE mr.series_id = ms.id) AS replay_count,
      (SELECT COUNT(*)::int FROM match_series_approvals msa WHERE msa.series_id = ms.id) AS approval_count
    FROM match_series ms
    LEFT JOIN teams ht ON ht.id = ms.home_team_id
    LEFT JOIN teams at ON at.id = ms.away_team_id
    ${where}
    ORDER BY ms.created_at DESC, ms.id DESC
    LIMIT 500
  `, params)

  return NextResponse.json({
    seasonId,
    matches: result.rows.map((r) => ({
      id: r.id,
      seasonId: r.season_id,
      division: r.division,
      week: r.week,
      isPlayoff: r.is_playoff,
      homeTeamId: r.home_team_id,
      awayTeamId: r.away_team_id,
      homeTeam: r.home_name,
      awayTeam: r.away_name,
      homeScore: r.home_score,
      awayScore: r.away_score,
      isForfeit: r.is_forfeit,
      status: r.status,
      reportType: r.report_type,
      reportSource: r.report_source,
      statsApplied: r.stats_applied,
      threadId: r.thread_id,
      reportedByUsername: r.reported_by_username,
      replayCount: r.replay_count,
      approvalCount: r.approval_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  })
}
