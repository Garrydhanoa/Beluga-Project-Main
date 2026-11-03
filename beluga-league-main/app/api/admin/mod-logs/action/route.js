import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { getAction } from '../../../../../lib/modStore'

export const dynamic = 'force-dynamic'

// The page polls this while the bot carries out a queued action. It's in READ_NOISE:
// the action itself is already audited, and the polls would only bury it.
async function getHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const id = new URL(request.url).searchParams.get('id')
  return NextResponse.json({ action: await getAction(id) })
}

export const GET = withAudit(getHandler, { action: 'mod-logs.action-status' })
