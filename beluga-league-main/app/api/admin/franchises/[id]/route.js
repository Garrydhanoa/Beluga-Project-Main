import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
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

async function patchHandler(request, { params }) {
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
  if (body.gmRoleId !== undefined) patch.gmRoleId = body.gmRoleId ? String(body.gmRoleId).trim() : null
  if (body.npRoleId !== undefined) patch.npRoleId = body.npRoleId ? String(body.npRoleId).trim() : null
  if (body.discordInviteUrl !== undefined) patch.discordInviteUrl = body.discordInviteUrl ? String(body.discordInviteUrl).trim() : null
  if (body.color !== undefined) patch.color = body.color ? String(body.color).trim() : null

  const franchise = await updateFranchise(fid, patch)
  return NextResponse.json({ ok: true, franchise })
}

async function deleteHandler(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const fid = Number(id)
  if (!Number.isInteger(fid)) return badRequest('Invalid id')

  await deleteFranchise(fid)
  return NextResponse.json({ ok: true })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const PATCH = withAudit(patchHandler, { action: 'franchises.patch' })
export const DELETE = withAudit(deleteHandler, { action: 'franchises.delete' })
