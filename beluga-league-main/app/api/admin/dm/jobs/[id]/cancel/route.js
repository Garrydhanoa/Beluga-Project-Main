import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../../../lib/adminAuth'
import { cancelJob } from '../../../../../../../lib/dmStore'

export const dynamic = 'force-dynamic'

/** Ask the bot to stop between sends. Already-delivered DMs cannot be recalled. */
async function postHandler(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const job = await cancelJob(id)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  return NextResponse.json({ ok: true, job })
}

export const POST = withAudit(postHandler, { action: 'dm.cancel' })
