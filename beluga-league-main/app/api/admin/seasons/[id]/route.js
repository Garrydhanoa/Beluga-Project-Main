import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import {
  getSeasonById,
  updateSeason,
  startSeason,
  archiveSeason,
  deleteSeason,
} from '../../../../../lib/leagueStore'

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

  const season = await getSeasonById(seasonId)
  if (!season) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ season })
}

export async function PATCH(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  if (body.action === 'activate') {
    const season = await startSeason(seasonId)
    return NextResponse.json({ ok: true, season })
  }
  if (body.action === 'archive') {
    const season = await archiveSeason(seasonId)
    return NextResponse.json({ ok: true, season })
  }

  const patch = {}
  if (body.seasonNumber !== undefined) patch.seasonNumber = body.seasonNumber
  if (body.name !== undefined) patch.name = body.name
  if (body.year !== undefined) patch.year = body.year
  if (body.statusLabel !== undefined) patch.statusLabel = body.statusLabel
  if (body.description !== undefined) patch.description = body.description
  if (body.recruitingOpen !== undefined) patch.recruitingOpen = body.recruitingOpen
  if (body.startDate !== undefined) patch.startDate = body.startDate || null

  const season = await updateSeason(seasonId, patch)
  return NextResponse.json({ ok: true, season })
}

export async function DELETE(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  await deleteSeason(seasonId)
  return NextResponse.json({ ok: true })
}
