import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../../../lib/adminAuth'
import { retryFailed } from '../../../../../../../lib/dmStore'

export const dynamic = 'force-dynamic'

/** Re-queue only the failures of a finished job, reusing its exact text. */
async function postHandler(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const session = auth.session

  const { id } = await params
  const result = await retryFailed(id, {
    createdBy: session.discordUserId,
    createdByName: session.discordUsername,
  })
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, jobId: result.job.id, count: result.count })
}

export const POST = withAudit(postHandler, { action: 'dm.retry' })
