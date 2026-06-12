import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'
import { getActiveSeason } from '../../../../lib/leagueStore'

export const dynamic = 'force-dynamic'

// List reported series (new stats system) with filters.
export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const url = new URL(request.url)
  let seasonId = url.searchParams.get('seasonId')
  if (!seasonId) {
    const season = await getActiveSeason()
    seasonId = season?.id || null
  }
  const division = url.searchParams.get('division')
  const week = url.searchParams.get('week')
  const status = url.searchParams.get('status')

  const params = []
  const where = []
  if (seasonId) { params.push(seasonId); where.push(`s.season_id = $${params.length}`) }
  if (division) { params.push(division); where.push(`s.division = $${params.length}`) }
  if (week) { params.push(Number(week)); where.push(`s.week = $${params.length}`) }
  if (status) { params.push(status); where.push(`s.status = $${params.length}`) }

  const r = await query(
    `SELECT s.id, s.division, s.week, s.is_playoff, s.is_forfeit, s.home_score, s.away_score,
        s.status, s.format, s.reported_via, s.reported_by_discord_id, s.manual_override,
        s.ballchasing_group_url, s.confirmed_at, s.created_at,
        ht.name AS home_team, at.name AS away_team,
        (SELECT COUNT(*)::int FROM stats_games g WHERE g.series_id = s.id) AS game_count
     FROM stats_series s
     LEFT JOIN teams ht ON ht.id = s.home_team_id
     LEFT JOIN teams at ON at.id = s.away_team_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT 300`,
    params
  )

  return NextResponse.json({
    seasonId,
    series: r.rows.map((row) => ({
      id: row.id,
      division: row.division,
      week: row.week,
      isPlayoff: row.is_playoff,
      isForfeit: row.is_forfeit,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      homeScore: row.home_score,
      awayScore: row.away_score,
      status: row.status,
      format: row.format,
      reportedVia: row.reported_via,
      reportedBy: row.reported_by_discord_id,
      manualOverride: row.manual_override,
      replayGroupUrl: row.ballchasing_group_url,
      gameCount: row.game_count,
      confirmedAt: row.confirmed_at,
      createdAt: row.created_at,
    })),
  })
}
