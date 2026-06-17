import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { getSeasonConfig, upsertSeasonConfig } from '../../../../../../lib/franchiseStore'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  const config = await getSeasonConfig(seasonId)
  return NextResponse.json({ config })
}

async function patchHandler(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const config = await upsertSeasonConfig(seasonId, {
    teamsPerDivision: body.teamsPerDivision || {},
    weeks: body.weeks ?? null,
    // Only forwarded when present so other config saves don't wipe caps.
    onfieldCaps: body.onfieldCaps,
  })
  return NextResponse.json({ ok: true, config })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const PATCH = withAudit(patchHandler, { action: 'seasons.config.patch' })
