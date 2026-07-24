import { NextResponse } from 'next/server'
import { getSeasons, getActiveSeason } from '../../../lib/leagueStore'

// Public list of seasons for the site-wide season picker (archive viewer). Returns
// every season newest-first plus which one is active, so pages can default to the
// active season and let visitors browse past ones via ?season=<number>.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [seasons, active] = await Promise.all([getSeasons(), getActiveSeason()])
    return NextResponse.json({
      seasons: seasons.map((s) => ({
        id: s.id,
        seasonNumber: s.seasonNumber,
        name: s.name,
        status: s.status,
        isActive: active ? s.id === active.id : false,
      })),
      activeSeasonNumber: active ? active.seasonNumber : null,
    })
  } catch (error) {
    console.error('API Error in /api/seasons:', error)
    return NextResponse.json({ seasons: [], activeSeasonNumber: null }, { status: 500 })
  }
}
