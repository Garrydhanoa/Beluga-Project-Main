import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { getSeasonActionRequest } from '../../../../../../lib/seasonActionsStore'

// Poll endpoint for the admin panel to watch a pending season action move through
// awaiting_approval → executed | declined | expired.
export const dynamic = 'force-dynamic'

const APPROVALS_REQUIRED = 3

export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const req = await getSeasonActionRequest(Number(id))
  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    request: {
      id: req.id,
      action: req.action,
      status: req.status,
      approvals: (req.approverIds || []).length,
      required: APPROVALS_REQUIRED,
      declinedBy: req.declinedBy,
      expiresAt: req.expiresAt,
      result: req.result,
    },
  })
}
