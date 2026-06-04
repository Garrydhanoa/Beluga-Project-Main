import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { updateFranchise, deleteFranchise, getFranchise } from '../../../../../lib/franchiseStore'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const fid = Number(id)
  if (!Number.isInteger(fid)) return badRequest('Invalid id')

  const franchise = await getFranchise(fid)
  if (!franchise) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ franchise })
}

export async function PATCH(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const fid = Number(id)
  if (!Number.isInteger(fid)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const patch = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.defaultDivision !== undefined) patch.defaultDivision = body.defaultDivision
  if (body.isActive !== undefined) patch.isActive = body.isActive

  const franchise = await updateFranchise(fid, patch)
  return NextResponse.json({ ok: true, franchise })
}

export async function DELETE(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const fid = Number(id)
  if (!Number.isInteger(fid)) return badRequest('Invalid id')

  await deleteFranchise(fid)
  return NextResponse.json({ ok: true })
}
