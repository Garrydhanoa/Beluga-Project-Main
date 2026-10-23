import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'
import { TRANSCRIPT_LOCK_DAYS } from '../../../../lib/transcriptExport'

export const dynamic = 'force-dynamic'

/**
 * Transcript management (operator R5):
 *   DELETE ?ticket=<channelId>           → delete ONE ticket/thread transcript
 *   DELETE ?weekThreads=<weekNumber>&seasonId=<id?> → bulk-delete that week's
 *           thread transcripts (live messages + archived snapshots)
 *
 * RETENTION LOCK (operator, Oct 2026): transcripts are kept forever and can't be
 * deleted until 30 days after the ticket/thread CLOSED. A transcript that is still
 * open (live rows, no archive) can't be deleted at all. Locked ones are skipped
 * and reported; the request never partially deletes a locked transcript.
 */
async function lockStatus(ids) {
  if (!ids.length) return { deletable: [], locked: [] }
  const r = await query(`
    SELECT x.id,
           COALESCE(ta.closed_at, tk.closed_at) AS closed_at,
           EXISTS (SELECT 1 FROM thread_messages tm WHERE tm.thread_id = x.id) AS has_live_thread,
           EXISTS (SELECT 1 FROM ticket_messages km WHERE km.channel_id = x.id) AS has_live_ticket,
           EXISTS (SELECT 1 FROM week_threads w WHERE w.thread_id = x.id) AS still_tracked,
           EXISTS (SELECT 1 FROM tickets t WHERE t.channel_id = x.id) AS ticket_open
      FROM unnest($1::text[]) AS x(id)
      LEFT JOIN thread_archives ta ON ta.thread_id = x.id
      LEFT JOIN ticket_archives tk ON tk.channel_id = x.id
  `, [ids])
  const cutoff = Date.now() - TRANSCRIPT_LOCK_DAYS * 24 * 60 * 60 * 1000
  const deletable = []
  const locked = []
  for (const row of r.rows) {
    const closed = row.closed_at ? new Date(row.closed_at).getTime() : null
    const open = row.still_tracked || row.ticket_open || (!closed && (row.has_live_thread || row.has_live_ticket))
    if (open) locked.push({ id: row.id, why: 'still open' })
    else if (closed && closed > cutoff) locked.push({ id: row.id, why: 'closed less than 30 days ago', unlocksAt: new Date(closed + TRANSCRIPT_LOCK_DAYS * 86400000).toISOString() })
    else deletable.push(row.id)
  }
  return { deletable, locked }
}

async function deleteIds(ids) {
  if (!ids.length) return { a: 0, b: 0 }
  const a = await query(`DELETE FROM thread_messages WHERE thread_id = ANY($1) RETURNING id`, [ids]).catch(() => ({ rows: [] }))
  const b = await query(`DELETE FROM thread_archives WHERE thread_id = ANY($1) RETURNING thread_id`, [ids]).catch(() => ({ rows: [] }))
  const c = await query(`DELETE FROM ticket_messages WHERE channel_id = ANY($1) RETURNING id`, [ids]).catch(() => ({ rows: [] }))
  const d = await query(`DELETE FROM ticket_archives WHERE channel_id = ANY($1) RETURNING channel_id`, [ids]).catch(() => ({ rows: [] }))
  await query(`DELETE FROM transcript_files WHERE parent_id = ANY($1)`, [ids]).catch(() => {})
  return { a: a.rows.length + c.rows.length, b: b.rows.length + d.rows.length }
}

function lockedMessage(locked) {
  if (!locked.length) return null
  const first = locked[0]
  const when = first.unlocksAt ? ` (unlocks ${new Date(first.unlocksAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})` : ''
  return `${locked.length} transcript${locked.length === 1 ? ' is' : 's are'} locked — transcripts can only be deleted 30 days after they close${when}.`
}

async function deleteHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const url = new URL(request.url)
  const ticket = url.searchParams.get('ticket')
  const weekThreads = url.searchParams.get('weekThreads')
  const seasonId = url.searchParams.get('seasonId')

  let ids = []
  if (ticket) {
    ids = [String(ticket)]
  } else if (weekThreads) {
    const params = [Number(weekThreads)]
    let where = `week_number = $1`
    if (seasonId) { params.push(Number(seasonId)); where += ` AND season_id = $2` }
    const threads = await query(`SELECT thread_id FROM week_threads WHERE ${where} AND thread_id IS NOT NULL`, params)
    ids = threads.rows.map((r) => String(r.thread_id))
    if (!ids.length) return NextResponse.json({ ok: true, deletedMessages: 0, deletedArchives: 0, threads: 0 })
  } else {
    return NextResponse.json({ error: 'ticket or weekThreads parameter required' }, { status: 400 })
  }

  const { deletable, locked } = await lockStatus(ids)
  if (!deletable.length) {
    return NextResponse.json({ error: lockedMessage(locked), locked }, { status: 423 })
  }
  const { a, b } = await deleteIds(deletable)
  return NextResponse.json({
    ok: true, deletedMessages: a, deletedArchives: b, threads: deletable.length,
    locked, note: lockedMessage(locked),
  })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const DELETE = withAudit(deleteHandler, { action: 'transcripts.delete' })
