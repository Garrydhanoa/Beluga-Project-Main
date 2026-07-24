import { NextResponse } from 'next/server'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { getSeasons } from '../../../../lib/leagueStore'
import { listChampions } from '../../../../lib/championStore'

// Per-season champions for the public "Seasons" archive page. Each season lists its
// champion per division (Majors / AAA / AA) so past seasons live forever, with a
// link out to browse that season's standings/teams/leaders via the ?season= viewer.
export const dynamic = 'force-dynamic'

const DIVISIONS = ['Majors', 'AAA', 'AA']

export async function GET() {
  try {
    await ensureLeagueSchema()
    const [seasons, champions] = await Promise.all([getSeasons(), listChampions()])

    const bySeason = new Map()
    for (const c of champions) {
      if (!bySeason.has(c.seasonId)) bySeason.set(c.seasonId, {})
      bySeason.get(c.seasonId)[c.division] = {
        teamId: c.teamId,
        teamName: c.teamName || c.franchiseName || null,
        franchiseName: c.franchiseName || null,
        gmDisplayName: c.gmDisplayName || null,
        notes: c.notes || null,
      }
    }

    const out = seasons
      // Hide unstarted drafts; show active + archived.
      .filter((s) => s.status !== 'draft')
      .map((s) => {
        const champs = bySeason.get(s.id) || {}
        return {
          seasonId: s.id,
          seasonNumber: s.seasonNumber,
          name: s.name || null,
          status: s.status,
          isActive: s.status === 'active',
          champions: DIVISIONS.map((d) => ({ division: d, ...(champs[d] || { teamName: null }) })),
        }
      })

    return NextResponse.json({ seasons: out })
  } catch (error) {
    console.error('API Error in /api/public/champions:', error)
    return NextResponse.json({ seasons: [] }, { status: 500 })
  }
}
