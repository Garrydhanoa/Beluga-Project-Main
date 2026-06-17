import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { withAudit } from '../../../../../lib/activityLog'
import {
  updateTeam,
  setTeamActive,
  hardDeleteTeam,
} from '../../../../../lib/leagueStore'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

async function patchHandler(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const teamId = Number(id)
  if (!Number.isInteger(teamId)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  if (typeof body.isActive === 'boolean' && Object.keys(body).length === 1) {
    const team = await setTeamActive(teamId, body.isActive)
    return NextResponse.json({ ok: true, team })
  }

  const patch = {}
  if (body.name !== undefined) patch.name = String(body.name).trim()
  if (body.division !== undefined) patch.division = String(body.division).trim()
  if (body.rosterLimit !== undefined) patch.rosterLimit = Number(body.rosterLimit)
  if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive)
  if (body.discordRoleId !== undefined) patch.discordRoleId = body.discordRoleId ? String(body.discordRoleId).trim() : null
  if (body.discordGmRoleId !== undefined) patch.discordGmRoleId = body.discordGmRoleId ? String(body.discordGmRoleId).trim() : null
  if (body.discordCaptainRoleId !== undefined) patch.discordCaptainRoleId = body.discordCaptainRoleId ? String(body.discordCaptainRoleId).trim() : null
  if (body.discordNpRoleId !== undefined) patch.discordNpRoleId = body.discordNpRoleId ? String(body.discordNpRoleId).trim() : null
  if (body.slogan !== undefined) patch.slogan = body.slogan ? String(body.slogan).trim() : null

  const team = await updateTeam(teamId, patch)
  return NextResponse.json({ ok: true, team })
}

async function deleteHandler(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const teamId = Number(id)
  if (!Number.isInteger(teamId)) return badRequest('Invalid id')

  await hardDeleteTeam(teamId)
  return NextResponse.json({ ok: true })
}

// Audit every write (actor + body + status → /higgenlogs).
export const PATCH = withAudit(patchHandler, { action: 'team.update' })
export const DELETE = withAudit(deleteHandler, { action: 'team.delete' })
