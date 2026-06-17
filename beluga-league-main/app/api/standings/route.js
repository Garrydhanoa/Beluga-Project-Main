import { NextResponse } from 'next/server';
import { getActiveSeason, getStandingsFromRecords } from '../../../lib/leagueStore';
import { getStatsStandings } from '../../../lib/belugaStats';

// Tell Next.js this is a dynamic route that shouldn't be prerendered
export const dynamic = 'force-dynamic';

export async function GET(request) {
  // Get the division parameter from the URL
  const url = new URL(request.url);
  const division = url.searchParams.get('division');
  
  if (!division || !['majors', 'aaa', 'aa'].includes(division)) {
    console.log(`Invalid division parameter: ${division}`);
    return NextResponse.json(
      { error: 'Invalid division parameter. Must be one of: majors, aaa, aa' },
      { status: 400 }
    );
  }
  
  try {
    const season = await getActiveSeason();
    if (!season) {
      return NextResponse.json({
        data: [],
        season: null,
        timestamp: new Date().toISOString()
      });
    }

    const divisionMap = {
      majors: 'Majors',
      aaa: 'AAA',
      aa: 'AA'
    };

    // New Ballchasing-based stats are authoritative (full tiebreaker chain:
    // W → L → H2H excl. forfeits → game diff → goal diff → rating). Falls back
    // to the legacy team_records standings if the new tables have no rows yet.
    const statsRows = await getStatsStandings(season.id, divisionMap[division]);
    const data = statsRows.length
      ? statsRows.map((r) => ({
          rank: r.rank,
          team: r.team,
          teamId: r.teamId,
          division: divisionMap[division],
          wins: r.wins,
          losses: r.losses,
          gameDiff: r.gameDiff,
          goalDiff: r.goalDiff,
          goalsFor: r.goalsFor,
          goalsAgainst: r.goalsAgainst,
          rating: r.rating,
        }))
      : await getStandingsFromRecords(season.id, divisionMap[division]);

    return NextResponse.json({
      data,
      season,
      source: statsRows.length ? 'stats' : 'records',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('API Error in standings endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return NextResponse.json(
      { 
        error: errorMessage,
        data: [],
        fromCache: false,
        cachedAt: null,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
