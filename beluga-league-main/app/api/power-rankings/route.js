import { NextResponse } from 'next/server'
import { ensureLeagueSchema } from '../../../lib/leagueSchema'
import { getActiveSeason, getSeasonById } from '../../../lib/leagueStore'
import { getRankingsForSeason } from '../../../lib/powerRankingsStore'

export const dynamic = 'force-dynamic'

/**
 * Public power rankings — DB-backed and season-scoped. Returns admin-curated
 * team + player rankings per division. No fake/seeded data: empty until an admin
 * publishes rankings.
 */
export async function GET(request) {
  await ensureLeagueSchema()

  const { searchParams } = new URL(request.url)
  let seasonId = searchParams.get('seasonId')
  let season = null
  if (!seasonId || seasonId === 'active') {
    season = await getActiveSeason()
  } else {
    season = await getSeasonById(Number(seasonId)).catch(() => null)
  }
  seasonId = season?.id || null

  const rankings = seasonId ? await getRankingsForSeason(seasonId) : { team: { Majors: [], AAA: [], AA: [] }, player: { Majors: [], AAA: [], AA: [] } }

  return NextResponse.json({
    season,
    seasonId,
    rankings, // { team: {Majors:[],AAA:[],AA:[]}, player: {...} }
  })
}
