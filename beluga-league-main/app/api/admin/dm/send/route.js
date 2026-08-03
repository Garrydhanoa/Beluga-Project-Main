import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { getSiteConfig } from '../../../../../lib/siteConfigStore'
import {
  resolveRecipients,
  normalizeTargets,
  hasAnyTarget,
  createJob,
  DM_DEFAULT_KEY,
  DM_DEFAULT_FALLBACK,
  DM_MAX_LEN,
} from '../../../../../lib/dmStore'

export const dynamic = 'force-dynamic'

/** Above this many recipients the client must echo the exact count back. */
const CONFIRM_THRESHOLD = 100

async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const session = auth.session

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const text = String(body.body || '')
  const includeDefault = body.includeDefault !== false
  const testOnly = Boolean(body.testOnly)

  if (!text.trim()) {
    return NextResponse.json({ error: 'Message body is empty.' }, { status: 400 })
  }

  const cfg = await getSiteConfig(DM_DEFAULT_KEY)
  const defaultText = typeof cfg?.text === 'string' ? cfg.text : DM_DEFAULT_FALLBACK

  // A test send always goes to the signed-in director and nobody else.
  if (testOnly) {
    const me = session.discordUserId
    if (!me) {
      return NextResponse.json({ error: 'Could not resolve your Discord ID for a test send.' }, { status: 400 })
    }
    const job = await createJob({
      createdBy: me,
      createdByName: session.discordUsername,
      targets: { users: [me], testOnly: true },
      includeDefault,
      defaultText,
      body: text,
      recipients: [{ discordId: String(me), displayName: session.discordUsername || 'You' }],
      testOnly: true,
    })
    return NextResponse.json({ ok: true, jobId: job.id, count: 1, testOnly: true })
  }

  const targets = normalizeTargets(body.targets)
  if (!hasAnyTarget(targets)) {
    return NextResponse.json({ error: 'No recipients selected.' }, { status: 400 })
  }

  const { recipients } = await resolveRecipients(targets)
  const deliverable = recipients.filter((r) => r.inGuild)
  if (!deliverable.length) {
    return NextResponse.json({ error: 'That selection resolved to nobody in the server.' }, { status: 400 })
  }

  // Large blasts require the client to echo back the exact resolved count, so a
  // stale preview can never silently turn a 12-person send into a 1,200-person one.
  if (deliverable.length > CONFIRM_THRESHOLD && Number(body.confirmCount) !== deliverable.length) {
    return NextResponse.json(
      {
        error: 'Confirmation required',
        needsConfirmation: true,
        count: deliverable.length,
        message: `This will DM ${deliverable.length} people. Re-confirm to proceed.`,
      },
      { status: 409 }
    )
  }

  const job = await createJob({
    createdBy: session.discordUserId,
    createdByName: session.discordUsername,
    targets,
    includeDefault,
    defaultText,
    body: text,
    recipients: deliverable,
  })

  return NextResponse.json({ ok: true, jobId: job.id, count: deliverable.length, maxLen: DM_MAX_LEN })
}

export const POST = withAudit(postHandler, { action: 'dm.send' })
