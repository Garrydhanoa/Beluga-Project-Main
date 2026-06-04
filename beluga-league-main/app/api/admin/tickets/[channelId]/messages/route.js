import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../../lib/leagueSchema'
import { query } from '../../../../../../lib/db'
import { getMentionResolver } from '../../../../../../lib/discordMembers'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { channelId } = await params
  const id = String(channelId || '').trim()
  if (!id) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

  await ensureLeagueSchema()

  const { searchParams } = new URL(request.url)
  const sinceId = searchParams.get('sinceId') // for incremental polling

  let rows
  if (sinceId) {
    const r = await query(`
      SELECT * FROM ticket_messages
      WHERE channel_id = $1 AND id > $2
      ORDER BY message_created_at ASC, id ASC
    `, [id, Number(sinceId)])
    rows = r.rows
  } else {
    const r = await query(`
      SELECT * FROM ticket_messages
      WHERE channel_id = $1
      ORDER BY message_created_at ASC, id ASC
      LIMIT 1000
    `, [id])
    rows = r.rows
  }

  // Is the ticket still open? (still present in the bot-owned tickets table)
  const openRes = await query(`SELECT channel_id, channel_name FROM tickets WHERE channel_id = $1`, [id])
    .catch(() => ({ rows: [] }))
  const isOpen = openRes.rows.length > 0

  // Resolve <@id>/<@&id> mentions to readable names for the transcript.
  const resolve = await getMentionResolver().catch(() => (c) => c)
  const resolveEmbeds = (embeds) => (embeds || []).map((e) => ({ ...e, title: resolve(e.title), description: resolve(e.description) }))

  // CLOSED ticket: the live ticket_messages rows are deleted on close, so fall
  // back to the consolidated snapshot stored in ticket_archives.transcript.
  if (!isOpen && rows.length === 0 && !sinceId) {
    const arc = await query(`SELECT channel_name, transcript FROM ticket_archives WHERE channel_id = $1`, [id])
      .catch(() => ({ rows: [] }))
    const snap = arc.rows[0]?.transcript
    if (Array.isArray(snap) && snap.length) {
      return NextResponse.json({
        open: false,
        channelName: arc.rows[0]?.channel_name || null,
        messages: snap.map((m, i) => ({
          id: i + 1,
          messageId: m.messageId,
          authorId: m.authorId,
          authorUsername: m.authorUsername,
          authorDisplay: m.authorDisplay || m.authorUsername,
          authorAvatar: m.authorAvatar,
          authorColor: m.authorColor,
          isBot: m.isBot,
          content: resolve(m.content),
          attachments: m.attachments || [],
          embeds: resolveEmbeds(m.embeds),
          createdAt: m.createdAt,
        })),
      })
    }
  }

  return NextResponse.json({
    open: isOpen,
    channelName: openRes.rows[0]?.channel_name || null,
    messages: rows.map((m) => ({
      id: m.id,
      messageId: m.message_id,
      authorId: m.author_id,
      authorUsername: m.author_username,
      authorDisplay: m.author_display || m.author_username,
      authorAvatar: m.author_avatar,
      authorColor: m.author_color,
      isBot: m.is_bot,
      content: resolve(m.content),
      attachments: m.attachments || [],
      embeds: resolveEmbeds(m.embeds),
      createdAt: m.message_created_at,
    })),
  })
}
