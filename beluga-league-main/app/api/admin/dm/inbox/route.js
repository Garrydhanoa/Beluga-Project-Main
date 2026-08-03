import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { listConversations, getUnreadTotal } from '../../../../../lib/dmInboxStore'

export const dynamic = 'force-dynamic'

/** Conversation list + total unread. Polled every ~2s by the inbox. */
export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const [conversations, totals] = await Promise.all([
    listConversations({ search: searchParams.get('q') || '' }),
    getUnreadTotal(),
  ])

  // Listed explicitly on purpose — spreading `totals` here once overwrote the
  // `conversations` ARRAY with a same-named count and crashed the client.
  return NextResponse.json({
    conversations,
    unread: totals.unread,
    unreadConversations: totals.unreadConversations,
  })
}
