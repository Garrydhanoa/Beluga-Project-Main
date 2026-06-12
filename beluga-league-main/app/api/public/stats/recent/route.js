import { NextResponse } from 'next/server'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { getRecentResults } from '../../../../../lib/belugaStats'

export const dynamic = 'force-dynamic'

// Homepage "Latest Results": the 5 most recent confirmed series across all divisions.
export async function GET() {
  await ensureLeagueSchema()
  const results = await getRecentResults(5)
  return NextResponse.json({ results })
}
