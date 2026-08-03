import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { getConversation, queueReply, markRead } from '../../../../../../lib/dmInboxStore'

export const dynamic = 'force-dynamic'

/**
 * GET  — one conversation. `?after=<id>` returns only newer messages (the poll).
 *        `?read=1` also clears the unread counter.
 * POST — queue a staff reply; the bot delivers it within ~2s.
 */
export async function GET(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  // Next 16: params is a Promise.
  const { discordId } = await params
  const { searchParams } = new URL(request.url)
  const after = searchParams.get('after')

  const result = await getConversation(discordId, { afterId: after ? Number(after) : null })
  if (!result) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  if (searchParams.get('read') === '1') await markRead(discordId)

  return NextResponse.json(result)
}

async function postHandler(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const session = auth.session

  const { discordId } = await params

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const result = await queueReply({
    discordId,
    content: body.content,
    authorName: session.discordUsername,
    authorDiscordId: session.discordUserId,
  })
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 })

  await markRead(discordId)
  return NextResponse.json({ ok: true, message: result.message })
}

export const POST = withAudit(postHandler, { action: 'dm.reply' })
