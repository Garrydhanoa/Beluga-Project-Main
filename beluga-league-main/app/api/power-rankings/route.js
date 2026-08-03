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
 *
 * Week selection: ?week=<number>. Rankings are per-week snapshots; omitting the
 * param returns the most recent stored week. `weeks` lists what else exists so
 * the page can offer the history.
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

  const weekParam = searchParams.get('week')
  const weekNum = Number(weekParam)
  const week = Number.isInteger(weekNum) && weekNum >= 1 ? weekNum : null

  const rankings = seasonId
    ? await getRankingsForSeason(seasonId, week)
    : { team: { Majors: [], AAA: [], AA: [] }, player: { Majors: [], AAA: [], AA: [] }, week: null, weeks: [] }

  return NextResponse.json({
    season,
    seasonId,
    week: rankings.week,   // the week actually served
    weeks: rankings.weeks, // every stored week, newest first
    rankings,              // { team: {Majors:[],AAA:[],AA:[]}, player: {...} }
  })
}
