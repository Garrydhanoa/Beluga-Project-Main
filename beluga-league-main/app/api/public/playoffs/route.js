import { NextResponse } from 'next/server'
import { resolveSeason, getActiveSeason } from '../../../../lib/leagueStore'
import { getAllBrackets, refreshAllBrackets } from '../../../../lib/playoffStore'
import { getSiteConfig } from '../../../../lib/siteConfigStore'

export const dynamic = 'force-dynamic'

const EMPTY = { season: null, brackets: [], enabled: false, isArchive: false }

/**
 * Public playoff brackets.
 *
 * The visibility toggle governs the CURRENT season only. An archived season's
 * bracket stays readable forever, because /seasons links to it as part of the
 * league's history — hiding last year's final because this year's playoffs
 * haven't started would be wrong.
 *
 * Replaces the bracket block that used to live on /schedules, which shipped
 * every bracket the moment it existed: `is_published` was selected and then
 * thrown away, so there was no publish gate at all.
 */
export async function GET(request) {
  try {
    const seasonParam = new URL(request.url).searchParams.get('season')
    const active = await getActiveSeason()
    const season = seasonParam ? await resolveSeason(seasonParam) : active
    if (!season) return NextResponse.json(EMPTY)

    const isArchive = !active || season.id !== active.id
    const settings = await getSiteConfig('playoffs')

    // Current season is gated by the toggle; archives are always visible.
    if (!isArchive && !settings.enabled) {
      return NextResponse.json({ ...EMPTY, season, enabled: false })
    }

    // Self-heal: wire legacy brackets and pull in results reported since the last
    // request. Idempotent, and a failure here must not blank the page.
    await refreshAllBrackets(season.id).catch(() => {})

    const brackets = await getAllBrackets(season.id, { publishedOnly: true })

    return NextResponse.json({
      season: {
        id: season.id,
        seasonNumber: season.seasonNumber,
        name: season.name,
        status: season.status,
      },
      brackets,
      enabled: true,
      isArchive,
    })
  } catch {
    // Public pages never crash on a DB blip — they render the empty state.
    return NextResponse.json(EMPTY)
  }
}
