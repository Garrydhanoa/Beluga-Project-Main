import { NextResponse } from 'next/server'
import { ensureLeagueSchema } from '../../../lib/leagueSchema'
import { getSeasonById, resolveSeason } from '../../../lib/leagueStore'
import { getRankingsForSeason } from '../../../lib/powerRankingsStore'

export const dynamic = 'force-dynamic'

/**
 * Public power rankings — DB-backed and season-scoped. Returns admin-curated
 * team + player rankings per division. No fake/seeded data: empty until an admin
 * publishes rankings.
 *
 * Season selection: ?season=<number> (site-wide archive picker) is preferred;
 * legacy ?seasonId=<id> is still honored. Absent/'active' → the active season.
 */
export async function GET(request) {
  await ensureLeagueSchema()

  const { searchParams } = new URL(request.url)
  const seasonParam = searchParams.get('season')
  const legacyId = searchParams.get('seasonId')
  let season = null
  if (legacyId && legacyId !== 'active' && !seasonParam) {
    season = await getSeasonById(Number(legacyId)).catch(() => null)
  } else {
    season = await resolveSeason(seasonParam)
  }
  const seasonId = season?.id || null

  const rankings = seasonId ? await getRankingsForSeason(seasonId) : { team: { Majors: [], AAA: [], AA: [] }, player: { Majors: [], AAA: [], AA: [] } }

  return NextResponse.json({
    season,
    seasonId,
    rankings, // { team: {Majors:[],AAA:[],AA:[]}, player: {...} }
  })
}
