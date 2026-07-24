import { NextResponse } from 'next/server'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { resolveSeason } from '../../../../../lib/leagueStore'
import { getAverageLeaders, getTeamTotals, getFranchiseRecords } from '../../../../../lib/belugaStats'

export const dynamic = 'force-dynamic'

// Leaderboards (per operator spec): player AVERAGE leaders (min-games gated),
// team stat totals per division, and franchise records — each toggleable
// between the current season and all-time.
// Query: ?scope=season|alltime&division=Majors|AAA|AA&season=<number> (division optional;
// season only applies when scope=season, absent → active season)
export async function GET(request) {
  await ensureLeagueSchema()
  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') === 'alltime' ? 'alltime' : 'season'
  const division = url.searchParams.get('division') || null
  const seasonParam = url.searchParams.get('season')

  const season = await resolveSeason(seasonParam)
  if (scope === 'season' && !season) {
    return NextResponse.json({ season: null, scope, leaders: null, teamTotals: [], franchises: [] })
  }
  const seasonId = season ? season.id : null

  const [leaders, teamTotals, franchises] = await Promise.all([
    getAverageLeaders({ scope, seasonId, division, top: 5 }),
    getTeamTotals({ scope, seasonId, division }),
    getFranchiseRecords({ scope, seasonId }),
  ])

  return NextResponse.json({ season, scope, division, leaders, teamTotals, franchises })
}
