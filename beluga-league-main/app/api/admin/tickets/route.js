import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

/**
 * Returns all currently-open tickets (from the bot-owned `tickets` table) and
 * all pending ticket requests (from the website-owned `ticket_requests` table).
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  await ensureLeagueSchema()

  let openTickets = []
  let pendingRequests = []

  try {
    const r = await query(`
      SELECT channel_id, channel_name, reason, created_by, created_by_username,
        user_ids, created_at
      FROM tickets
      ORDER BY created_at DESC
    `)
    openTickets = r.rows.map((row) => ({
      channelId: row.channel_id,
      channelName: row.channel_name,
      reason: row.reason,
      createdBy: row.created_by,
      createdByUsername: row.created_by_username,
      userIds: Array.isArray(row.user_ids) ? row.user_ids : [],
      createdAt: row.created_at,
    }))
  } catch (err) {
    // If the bot hasn't initialized the tickets table yet, treat as empty.
    if (!String(err.message || '').includes('does not exist')) throw err
  }

  try {
    const r = await query(`
      SELECT * FROM ticket_requests
      WHERE status = 'pending'
      ORDER BY requested_at DESC
    `)
    pendingRequests = r.rows.map((row) => ({
      id: row.id,
      targetKind: row.target_kind,
      targetId: row.target_id,
      reason: row.reason,
      requestedByDiscordId: row.requested_by_discord_id,
      requestedByUsername: row.requested_by_username,
      status: row.status,
      ticketChannelId: row.ticket_channel_id,
      requestedAt: row.requested_at,
      fulfilledAt: row.fulfilled_at,
    }))
  } catch { /* table may not exist yet */ }

  let closedTickets = []
  try {
    const r = await query(`
      SELECT channel_id, channel_name, reason, opened_by_username, opened_at,
        closed_by_username, closed_at, message_count
      FROM ticket_archives
      ORDER BY closed_at DESC
      LIMIT 200
    `)
    closedTickets = r.rows.map((row) => ({
      channelId: row.channel_id,
      channelName: row.channel_name,
      reason: row.reason,
      openedByUsername: row.opened_by_username,
      openedAt: row.opened_at,
      closedByUsername: row.closed_by_username,
      closedAt: row.closed_at,
      messageCount: row.message_count,
    }))
  } catch { /* table may not exist yet */ }

  return NextResponse.json({ openTickets, pendingRequests, closedTickets })
}

/**
 * Create a ticket REQUEST — a row the bot polls and reconciles into an actual
 * Discord ticket channel + tickets row.
 */
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const targetKind = (body.targetKind || '').trim()
  const targetId = (body.targetId || '').trim()
  const reason = (body.reason || '').trim() || null
  if (!targetKind || !['user', 'role'].includes(targetKind)) return badRequest("targetKind must be 'user' or 'role'")
  if (!targetId) return badRequest('targetId required')

  await ensureLeagueSchema()

  const r = await query(
    `INSERT INTO ticket_requests (target_kind, target_id, reason, requested_by_discord_id, requested_by_username)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      targetKind,
      targetId,
      reason,
      auth.session?.discordUserId || null,
      auth.session?.discordUsername || null,
    ]
  )
  return NextResponse.json({ ok: true, request: r.rows[0] })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'tickets.post' })
