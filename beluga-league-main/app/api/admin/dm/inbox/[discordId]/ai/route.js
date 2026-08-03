import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../../../lib/adminAuth'
import { DM_AI_MODES, setAiEnabled } from '../../../../../../../lib/dmInboxStore'

export const dynamic = 'force-dynamic'

/**
 * Toggle the AI auto-responder for ONE conversation, and pick which persona
 * answers. Off by default everywhere — with it off the bot never replies on its
 * own, only what staff type is sent.
 *
 * `enabled` and `mode` are independent: omit either to leave it as it was.
 */
async function postHandler(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { discordId } = await params

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.mode != null && !DM_AI_MODES.includes(String(body.mode))) {
    return NextResponse.json({ error: 'Unknown AI mode' }, { status: 400 })
  }

  const state = await setAiEnabled(
    discordId,
    body.enabled == null ? null : Boolean(body.enabled),
    body.mode == null ? null : String(body.mode),
    { discordUserId: auth.session?.discordUserId, discordUsername: auth.session?.discordUsername }
  )
  return NextResponse.json({ ok: true, ...state })
}

export const POST = withAudit(postHandler, { action: 'dm.ai-toggle' })
