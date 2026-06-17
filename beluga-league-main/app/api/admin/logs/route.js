import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

// Unified log (site_logs — every bot edge case/error, searchable).
export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  const url = new URL(request.url)
  const q = url.searchParams.get('q')
  const level = url.searchParams.get('level')

  const params = []
  const where = []
  if (q) { params.push(`%${q}%`); where.push(`(summary ILIKE $${params.length} OR detail ILIKE $${params.length})`) }
  if (level && level !== 'all') { params.push(level); where.push(`level = $${params.length}`) }

  const r = await query(
    `SELECT * FROM site_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 200`,
    params
  ).catch(() => ({ rows: [] }))
  return NextResponse.json({ logs: r.rows })
}

async function deleteHandler() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await query(`DELETE FROM site_logs WHERE created_at < NOW() - INTERVAL '30 days'`).catch(() => {})
  return NextResponse.json({ ok: true })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const DELETE = withAudit(deleteHandler, { action: 'logs.delete' })
