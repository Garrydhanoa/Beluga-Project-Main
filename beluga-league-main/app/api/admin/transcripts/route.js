import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

/**
 * Transcript management (operator R5):
 *   DELETE ?ticket=<channelId>           → delete ONE ticket's transcript/messages
 *   DELETE ?weekThreads=<weekNumber>&seasonId=<id?> → bulk-delete that week's
 *           thread transcripts (live messages + archived snapshots)
 */
async function deleteHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const url = new URL(request.url)
  const ticket = url.searchParams.get('ticket')
  const weekThreads = url.searchParams.get('weekThreads')
  const seasonId = url.searchParams.get('seasonId')

  if (ticket) {
    const a = await query(`DELETE FROM thread_messages WHERE thread_id = $1 RETURNING id`, [String(ticket)]).catch(() => ({ rows: [] }))
    const b = await query(`DELETE FROM thread_archives WHERE thread_id = $1 RETURNING id`, [String(ticket)]).catch(() => ({ rows: [] }))
    return NextResponse.json({ ok: true, deletedMessages: a.rows.length, deletedArchives: b.rows.length })
  }

  if (weekThreads) {
    const params = [Number(weekThreads)]
    let where = `week_number = $1`
    if (seasonId) { params.push(Number(seasonId)); where += ` AND season_id = $2` }
    const threads = await query(`SELECT thread_id FROM week_threads WHERE ${where} AND thread_id IS NOT NULL`, params)
    const ids = threads.rows.map((r) => String(r.thread_id))
    if (!ids.length) return NextResponse.json({ ok: true, deletedMessages: 0, deletedArchives: 0, threads: 0 })
    const a = await query(`DELETE FROM thread_messages WHERE thread_id = ANY($1) RETURNING id`, [ids]).catch(() => ({ rows: [] }))
    const b = await query(`DELETE FROM thread_archives WHERE thread_id = ANY($1) RETURNING id`, [ids]).catch(() => ({ rows: [] }))
    return NextResponse.json({ ok: true, deletedMessages: a.rows.length, deletedArchives: b.rows.length, threads: ids.length })
  }

  return NextResponse.json({ error: 'ticket or weekThreads parameter required' }, { status: 400 })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const DELETE = withAudit(deleteHandler, { action: 'transcripts.delete' })
