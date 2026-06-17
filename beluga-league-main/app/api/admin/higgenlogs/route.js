import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

/**
 * Hidden audit log feed for /admin/dashboard/higgenlogs.
 *
 * site_logs holds everything: website admin activity + errors (source='website')
 * and bot activity + errors (source='bot'), tagged by `kind` (activity|error|login).
 *
 * Filters: source (website|bot), kind, level, q (text). Returns newest first.
 */
export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const url = new URL(request.url)
  const source = url.searchParams.get('source')   // website | bot
  const kind = url.searchParams.get('kind')       // activity | error | login
  const level = url.searchParams.get('level')     // info | warn | error
  const q = url.searchParams.get('q')

  const params = []
  const where = []
  if (source && source !== 'all') { params.push(source); where.push(`source = $${params.length}`) }
  if (kind && kind !== 'all') { params.push(kind); where.push(`kind = $${params.length}`) }
  if (level && level !== 'all') { params.push(level); where.push(`level = $${params.length}`) }
  if (q) {
    params.push(`%${q}%`)
    where.push(`(summary ILIKE $${params.length} OR detail ILIKE $${params.length} OR actor_name ILIKE $${params.length} OR action ILIKE $${params.length})`)
  }

  const rows = await query(
    `SELECT id, source, level, kind, summary, detail, division, actor_name, actor_discord_id, action, target, created_at
     FROM site_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY id DESC LIMIT 500`,
    params
  ).catch(() => ({ rows: [] }))

  // Per-source counts for the tab badges (unfiltered by source so both show).
  const counts = await query(
    `SELECT source, COUNT(*)::int AS n FROM site_logs GROUP BY source`
  ).catch(() => ({ rows: [] }))
  const bySource = {}
  for (const r of counts.rows) bySource[r.source] = r.n

  return NextResponse.json({ logs: rows.rows, counts: bySource })
}

/**
 * DELETE — prune logs OLDER than 30 days only. This is the ONLY delete path:
 * recent logs are intentionally non-deletable (audit integrity). No single-row
 * delete and no "delete everything" — the 30-day floor is enforced server-side.
 */
export async function DELETE() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const r = await query(
    `DELETE FROM site_logs WHERE created_at < NOW() - INTERVAL '30 days' RETURNING id`
  ).catch(() => ({ rows: [] }))
  return NextResponse.json({ ok: true, deleted: r.rows.length })
}
