import { NextResponse } from 'next/server'
import {
  resolveSeason,
  getScheduleMatches,
} from '../../../lib/leagueStore'

// Playoffs used to be bolted onto this route and rendered as a bare list at the
// bottom of /schedules — with no publish gate (is_published was fetched and then
// discarded) and with team IDs thrown away, so its logos fell back to ambiguous
// name lookups. The dedicated /playoffs page and /api/public/playoffs replace it.

export const dynamic = 'force-dynamic'

function groupedRegular(matches) {
  const out = {
    aa: {},
    aaa: {},
    majors: {},
  }

  for (const match of matches) {
    const divisionKey = String(match.division || '').toLowerCase() === 'majors'
      ? 'majors'
      : String(match.division || '').toLowerCase()

    if (!out[divisionKey]) continue

    const weekLabel = `Week ${match.week}`
    if (!out[divisionKey][weekLabel]) {
      out[divisionKey][weekLabel] = []
    }

    // [homeName, awayName, homeTeamId, awayTeamId] — ids let the UI request the
    // exact DB logo (name-only lookups can miss when franchises share a name).
    out[divisionKey][weekLabel].push([match.homeTeam, match.awayTeam, match.homeTeamId, match.awayTeamId])
  }

  return out
}

export async function GET(request) {
  const seasonParam = new URL(request.url).searchParams.get('season')
  const season = await resolveSeason(seasonParam)
  if (!season) {
    return NextResponse.json({ season: null, regular: { aa: {}, aaa: {}, majors: {} } })
  }

  const regular = await getScheduleMatches(season.id, { publishedOnly: true })

  return NextResponse.json({
    season,
    regular: groupedRegular(regular),
  })
}
