import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import {
  getSeasonSummaries,
  getActiveSeason,
  createSeason,
  updateSeason,
  startSeason,
} from '../../../../lib/leagueStore'
import { upsertSeasonConfig } from '../../../../lib/franchiseStore'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const seasons = await getSeasonSummaries()
  const active = await getActiveSeason()
  return NextResponse.json({ seasons, activeSeasonId: active?.id || null })
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const seasonNumber = Number(body.seasonNumber)
  if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) return badRequest('Invalid seasonNumber')

  // Archive-gate: a new season can't be started while one is still active. The
  // current season must be archived first (its data is preserved as a past
  // season via season_id scoping). Bypass only with explicit force=true.
  const active = await getActiveSeason()
  if (active && active.status === 'active' && active.seasonNumber !== seasonNumber && !body.force) {
    return NextResponse.json({
      error: `Season ${active.seasonNumber} is still active. Archive it first — its teams, schedule, standings, stats, and champions stay saved as a past season — before starting a new one.`,
      code: 'active_season_exists',
      activeSeasonId: active.id,
      activeSeasonNumber: active.seasonNumber,
    }, { status: 409 })
  }

  const created = await createSeason(seasonNumber, body.name || null)

  const patch = {}
  if (body.year !== undefined) patch.year = body.year
  if (body.statusLabel !== undefined) patch.statusLabel = body.statusLabel
  if (body.description !== undefined) patch.description = body.description
  if (body.recruitingOpen !== undefined) patch.recruitingOpen = body.recruitingOpen
  if (body.startDate !== undefined) patch.startDate = body.startDate
  let season = created
  if (Object.keys(patch).length) {
    season = await updateSeason(created.id, patch)
  }

  if (body.teamsPerDivision || body.weeks !== undefined) {
    await upsertSeasonConfig(season.id, {
      teamsPerDivision: body.teamsPerDivision || {},
      weeks: body.weeks ?? null,
    })
  }

  if (body.activate) {
    season = await startSeason(season.id)
  }

  return NextResponse.json({ ok: true, season })
}
