import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { closeWeekThread, deleteWeekThread } from '../../../../../lib/weekThreadStore'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

async function patchHandler(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const tid = Number(id)
  if (!Number.isInteger(tid)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  await ensureLeagueSchema()
  if (body.isClosed !== undefined) {
    await closeWeekThread(tid, Boolean(body.isClosed))
  }
  return NextResponse.json({ ok: true })
}

async function deleteHandler(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const tid = Number(id)
  if (!Number.isInteger(tid)) return badRequest('Invalid id')

  await ensureLeagueSchema()
  await deleteWeekThread(tid)
  return NextResponse.json({ ok: true })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const PATCH = withAudit(patchHandler, { action: 'week-threads.patch' })
export const DELETE = withAudit(deleteHandler, { action: 'week-threads.delete' })
