import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

/**
 * The hidden audit log feed (/admin/dashboard/higgenlogs).
 *
 * `higgen_logs` holds everything from both apps:
 *   source ∈ bot | website        → the two top-level tabs
 *   stream ∈ interaction | error  → the two sub-tabs
 *
 * Restricted to requireSuperAdmin — the ADMIN_DISCORD_IDS allowlist, NOT "any
 * director". A log that the people it might incriminate can read and prune is
 * not evidence.
 */

const SORTS = {
  newest: 'occurred_at DESC, id DESC',
  oldest: 'occurred_at ASC, id ASC',
  actor: 'actor_name ASC NULLS LAST, occurred_at DESC',
  action: 'action ASC NULLS LAST, occurred_at DESC',
  slowest: 'duration_ms DESC NULLS LAST, occurred_at DESC',
}

const PAGE_SIZES = [50, 100, 250]
const RETENTION_DAYS = 30

// The bot sweeps retention every 24h; this is a belt-and-braces pass that runs at
// most hourly when someone opens the page, in case the bot is down.
let lastPruneAt = 0
async function opportunisticPrune() {
  if (Date.now() - lastPruneAt < 60 * 60 * 1000) return
  lastPruneAt = Date.now()
  await query(`DELETE FROM higgen_logs WHERE occurred_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`)
    .catch(() => {})
}

/** Build the shared WHERE clause from the query string. */
function buildFilters(url) {
  const p = url.searchParams
  const params = []
  const where = []
  // Push one value and substitute EVERY `$?` in the clause with its placeholder,
  // so a clause may reference the same value more than once.
  const add = (sql, value) => {
    params.push(value)
    where.push(sql.split('$?').join(`$${params.length}`))
  }

  const source = p.get('source')
  if (source && source !== 'all') add('source = $?', source)

  const stream = p.get('stream')
  if (stream && stream !== 'all') add('stream = $?', stream)

  const eventType = p.get('event_type')
  if (eventType && eventType !== 'all') add('event_type = $?', eventType)

  const outcome = p.get('outcome')
  if (outcome && outcome !== 'all') add('outcome = $?', outcome)

  // Accepts either the display name (from the dropdown) or a raw Discord ID.
  const actor = p.get('actor')
  if (actor && actor !== 'all') add('(actor_name = $? OR actor_id = $?)', actor)

  const action = p.get('action')
  if (action && action !== 'all') add('action = $?', action)

  const division = p.get('division')
  if (division && division !== 'all') add('division ILIKE $?', division)

  // Date range. `since` accepts an ISO date or a shorthand window.
  const WINDOWS = { hour: '1 hour', day: '24 hours', week: '7 days', month: '30 days' }
  const since = p.get('since')
  if (since && since !== 'all') {
    if (WINDOWS[since]) where.push(`occurred_at >= NOW() - INTERVAL '${WINDOWS[since]}'`)
    else add('occurred_at >= $?', since)
  }
  const until = p.get('until')
  if (until) add('occurred_at <= $?', until)

  // Free text across everything a person might remember about an entry.
  const q = p.get('q')
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`)
    const i = params.length
    where.push(`(summary ILIKE $${i} OR details::text ILIKE $${i} OR actor_name ILIKE $${i}
                 OR action ILIKE $${i} OR target ILIKE $${i} OR location ILIKE $${i}
                 OR error_message ILIKE $${i})`)
  }

  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
}

const SELECT_COLS = `id, occurred_at, source, stream, event_type, actor_name, actor_tag,
  actor_id, action, target, location, outcome, duration_ms, division, summary, details,
  error_message, error_stack, ip, user_agent`

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  await opportunisticPrune()

  const url = new URL(request.url)
  const { where, params } = buildFilters(url)

  // Facet mode: the distinct actors / actions / event types that populate the
  // filter dropdowns, scoped to the current tab so the lists stay short.
  if (url.searchParams.get('facets') === '1') {
    const scopeParams = []
    const scope = []
    const source = url.searchParams.get('source')
    if (source && source !== 'all') { scopeParams.push(source); scope.push(`source = $${scopeParams.length}`) }
    const stream = url.searchParams.get('stream')
    if (stream && stream !== 'all') { scopeParams.push(stream); scope.push(`stream = $${scopeParams.length}`) }
    const scopeSql = scope.length ? `WHERE ${scope.join(' AND ')}` : ''

    const [actors, actions, types, outcomes] = await Promise.all([
      query(`SELECT actor_name AS v, COUNT(*)::int AS n FROM higgen_logs ${scopeSql}
             GROUP BY actor_name HAVING actor_name IS NOT NULL ORDER BY n DESC LIMIT 100`, scopeParams).catch(() => ({ rows: [] })),
      query(`SELECT action AS v, COUNT(*)::int AS n FROM higgen_logs ${scopeSql}
             GROUP BY action HAVING action IS NOT NULL ORDER BY n DESC LIMIT 200`, scopeParams).catch(() => ({ rows: [] })),
      query(`SELECT event_type AS v, COUNT(*)::int AS n FROM higgen_logs ${scopeSql}
             GROUP BY event_type HAVING event_type IS NOT NULL ORDER BY n DESC LIMIT 50`, scopeParams).catch(() => ({ rows: [] })),
      query(`SELECT outcome AS v, COUNT(*)::int AS n FROM higgen_logs ${scopeSql}
             GROUP BY outcome HAVING outcome IS NOT NULL ORDER BY n DESC LIMIT 20`, scopeParams).catch(() => ({ rows: [] })),
    ])
    // Keys listed explicitly, never spread — a spread whose object shares a key
    // with an array silently replaced the array with a count once before.
    return NextResponse.json({
      actors: actors.rows,
      actions: actions.rows,
      eventTypes: types.rows,
      outcomes: outcomes.rows,
    })
  }

  // CSV export of the current filtered view — evidence you can hand to someone.
  if (url.searchParams.get('format') === 'csv') {
    const rows = await query(
      `SELECT ${SELECT_COLS} FROM higgen_logs ${where}
       ORDER BY ${SORTS[url.searchParams.get('sort')] || SORTS.newest} LIMIT 20000`,
      params
    ).catch(() => ({ rows: [] }))

    const headers = ['When', 'Source', 'Stream', 'Type', 'Who', 'Discord ID', 'Action',
      'Outcome', 'Where', 'What happened', 'Details', 'Error', 'IP']
    const lines = [headers.join(',')]
    for (const r of rows.rows) {
      lines.push([
        new Date(r.occurred_at).toISOString(), r.source, r.stream, r.event_type,
        r.actor_name, r.actor_id, r.action, r.outcome, r.location, r.summary,
        (r.details || []).map(([k, v]) => `${k}: ${v}`).join(' | '),
        r.error_message, r.ip,
      ].map(csvEscape).join(','))
    }
    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="beluga-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  const sort = SORTS[url.searchParams.get('sort')] || SORTS.newest
  const requested = parseInt(url.searchParams.get('limit') || '50', 10)
  const limit = PAGE_SIZES.includes(requested) ? requested : 50
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const offset = (page - 1) * limit

  const [rows, totalRes, tabCounts] = await Promise.all([
    query(
      `SELECT ${SELECT_COLS} FROM higgen_logs ${where} ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset}`,
      params
    ).catch(() => ({ rows: [] })),
    query(`SELECT COUNT(*)::int AS n FROM higgen_logs ${where}`, params).catch(() => ({ rows: [{ n: 0 }] })),
    // Unfiltered per-tab totals so the four tab badges always show real numbers.
    query(`SELECT source, stream, COUNT(*)::int AS n FROM higgen_logs GROUP BY source, stream`)
      .catch(() => ({ rows: [] })),
  ])

  const counts = {}
  for (const r of tabCounts.rows) counts[`${r.source}:${r.stream}`] = r.n

  const total = totalRes.rows[0]?.n ?? 0
  return NextResponse.json({
    logs: rows.rows,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    counts,
    retentionDays: RETENTION_DAYS,
  })
}

/**
 * DELETE — prune entries OLDER than 30 days only. This is the ONLY delete path:
 * recent entries are intentionally non-deletable, because an audit log someone can
 * clear on demand proves nothing. No single-row delete, no "delete everything";
 * the 30-day floor is enforced here, server-side.
 */
export async function DELETE() {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response
  const r = await query(
    `DELETE FROM higgen_logs WHERE occurred_at < NOW() - INTERVAL '${RETENTION_DAYS} days' RETURNING id`
  ).catch(() => ({ rows: [] }))
  return NextResponse.json({ ok: true, deleted: r.rows.length })
}
