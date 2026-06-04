import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { getActiveSeason, getRosterEntries } from '../../../../lib/leagueStore'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const season = await getActiveSeason()
  if (!season) {
    return NextResponse.json({ season: null, rosters: [] })
  }

  const entries = await getRosterEntries(season.id)

  return NextResponse.json({ season, rosters: entries })
}
