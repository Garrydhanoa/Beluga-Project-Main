import { NextResponse } from 'next/server'
import {
  getActiveSeason,
  getScheduleMatches,
  getPlayoffMatchups,
} from '../../../lib/leagueStore'

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

function groupedPlayoffs(brackets) {
  const out = {
    aa: [],
    aaa: [],
    majors: [],
  }

  for (const bracket of brackets) {
    const divisionKey = String(bracket.division || '').toLowerCase() === 'majors'
      ? 'majors'
      : String(bracket.division || '').toLowerCase()

    if (!out[divisionKey]) continue

    out[divisionKey].push({
      id: bracket.id,
      name: bracket.name,
      rounds: (bracket.rounds || []).map((round) => ({
        id: round.id,
        name: round.name,
        roundNumber: round.roundNumber,
        matchups: (round.matchups || []).map((m) => [m.homeTeam, m.awayTeam]),
      })),
    })
  }

  return out
}

export async function GET() {
  const season = await getActiveSeason()
  if (!season) {
    return NextResponse.json({ season: null, regular: { aa: {}, aaa: {}, majors: {} }, playoffs: { aa: [], aaa: [], majors: [] } })
  }

  const regular = await getScheduleMatches(season.id, { publishedOnly: true })
  const playoffs = await getPlayoffMatchups(season.id)

  return NextResponse.json({
    season,
    regular: groupedRegular(regular),
    playoffs: groupedPlayoffs(playoffs),
  })
}
