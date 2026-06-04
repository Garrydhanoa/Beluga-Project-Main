import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../../lib/leagueSchema'
import { query } from '../../../../../../lib/db'

export const dynamic = 'force-dynamic'

/**
 * Queue a close request. The bot consumes ticket_close_requests, runs the same
 * close flow as the /close command (transcript saved + channel deleted + tickets
 * row removed), then marks the request fulfilled. The website never mutates the
 * off-limits `tickets` table directly.
 */
export async function POST(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { channelId } = await params
  const id = String(channelId || '').trim()
  if (!id) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

  await ensureLeagueSchema()

  // Avoid duplicate pending requests for the same channel.
  const existing = await query(
    `SELECT id FROM ticket_close_requests WHERE channel_id = $1 AND status = 'pending' LIMIT 1`,
    [id]
  )
  if (existing.rows.length) {
    return NextResponse.json({ ok: true, alreadyQueued: true })
  }

  await query(
    `INSERT INTO ticket_close_requests (channel_id, requested_by_discord_id, requested_by_username)
     VALUES ($1, $2, $3)`,
    [id, auth.session?.discordUserId || null, auth.session?.discordUsername || null]
  )
  return NextResponse.json({ ok: true, queued: true })
}
