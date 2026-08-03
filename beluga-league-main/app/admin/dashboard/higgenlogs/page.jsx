'use client'

/**
 * HIDDEN audit page. No nav link — reach it only by typing the URL — and gated on
 * the ADMIN_DISCORD_IDS allowlist (operator + owner), NOT on "is a director". A log
 * that the people it might incriminate can read and prune is not evidence.
 *
 * Four views over `higgen_logs`:
 *   Bot     ▸ Interactions — every command, button, dropdown, form and ✅ approval
 *   Bot     ▸ Fails        — every bot error, with the message and stack
 *   Website ▸ Interactions — every admin click, page view and API call
 *   Website ▸ Errors       — every server and browser error
 *
 * The readability rule: rows show a finished English sentence, and expanding one
 * shows a labelled table. No JSON, no customIds-as-identity, no raw stack unless
 * the entry IS an error. Entries are non-deletable except the 30-day prune, which
 * the bot also runs automatically every day.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

const SOURCES = [
  { value: 'bot', label: 'Bot' },
  { value: 'website', label: 'Website' },
]

const STREAM_LABELS = {
  bot: [{ value: 'interaction', label: 'Interactions' }, { value: 'error', label: 'Fails' }],
  website: [{ value: 'interaction', label: 'Interactions' }, { value: 'error', label: 'Errors' }],
}

const WINDOWS = [
  { value: 'all', label: 'All time' },
  { value: 'hour', label: 'Last hour' },
  { value: 'day', label: 'Last 24 hours' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
]

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'actor', label: 'By person (A–Z)' },
  { value: 'action', label: 'By action (A–Z)' },
  { value: 'slowest', label: 'Slowest first' },
]

// Plain-English names for the machine-ish event_type values.
const TYPE_WORDS = {
  slash_command: 'Command',
  button: 'Button',
  select_menu: 'Dropdown',
  modal: 'Form',
  context_menu: 'Menu',
  reaction: 'Reaction',
  interaction: 'Interaction',
  interaction_error: 'Failed',
  stats_edge_case: 'Edge case',
  crash: 'Crash',
  click: 'Click',
  change: 'Changed a field',
  submit: 'Form submit',
  page_view: 'Page view',
  api_write: 'Saved a change',
  api_read: 'Viewed data',
  route_error: 'Route error',
  server_error: 'Server error',
  client_error: 'Browser error',
}

const OUTCOME_STYLES = {
  success: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30',
  failed: 'bg-red-500/15 text-red-300 border-red-400/30',
  expired: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
  unhandled: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
  denied: 'bg-orange-500/15 text-orange-200 border-orange-400/30',
}

function fullDate(value) {
  try {
    return new Date(value).toLocaleString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit',
    })
  } catch { return String(value) }
}

function relative(value) {
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.round((Date.now() - then) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`
  return `${Math.floor(secs / 86400)} d ago`
}

function Row({ label, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4 py-1">
      <div className="w-28 shrink-0 text-[10px] font-bold uppercase tracking-wider text-blue-300/50 pt-0.5">{label}</div>
      <div className="text-[12px] text-white/85 break-words min-w-0">{children}</div>
    </div>
  )
}

function Entry({ log, expanded, onToggle }) {
  const details = Array.isArray(log.details) ? log.details : []
  const typeWord = TYPE_WORDS[log.event_type] || log.event_type || log.stream
  const outcomeStyle = OUTCOME_STYLES[log.outcome] || 'bg-white/10 text-white/70 border-white/20'

  return (
    <div className={expanded ? 'bg-white/[0.03]' : ''}>
      {/* Badge stacks ABOVE the sentence on narrow screens — side by side it eats
          most of a phone's width and squeezes the summary into a column. */}
      <button
        onClick={onToggle}
        className="w-full flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 px-4 py-2.5 text-left hover:bg-white/[0.04] transition"
      >
        <span className={`self-start sm:mt-0.5 shrink-0 whitespace-nowrap px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${outcomeStyle}`}>
          {typeWord}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] text-white leading-snug">{log.summary}</span>
          <span className="block text-[10px] text-white/35 mt-0.5">
            {log.actor_name || 'unknown'} · {fullDate(log.occurred_at)} · {relative(log.occurred_at)}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="px-4 sm:px-5 pb-4 pt-1 border-t border-white/5">
          <Row label="When">{fullDate(log.occurred_at)} <span className="text-white/40">({relative(log.occurred_at)})</span></Row>
          <Row label="Who">
            {log.actor_name || 'Unknown'}
            {log.actor_tag && log.actor_tag !== log.actor_name ? ` (${log.actor_tag})` : ''}
            {log.actor_id ? <span className="text-white/40"> · Discord ID {log.actor_id}</span> : null}
          </Row>
          {/* The sentence itself is already on the row above — don't repeat it.
              Show the action key instead: it's what you filter and search by. */}
          {log.action && <Row label="Action">{log.action}</Row>}
          {log.location && <Row label="Where">{log.location}</Row>}
          <Row label="Result">
            {log.outcome === 'success' ? 'Succeeded' : log.outcome === 'failed' ? 'Failed' : (log.outcome || 'unknown')}
            {log.duration_ms != null ? ` — took ${(log.duration_ms / 1000).toFixed(2)} seconds` : ''}
          </Row>
          {log.division && <Row label="Division">{log.division}</Row>}
          {log.ip && <Row label="From IP">{log.ip}</Row>}

          {details.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5">
              {details.map(([label, value], i) => (
                <Row key={`${label}-${i}`} label={label}>{String(value)}</Row>
              ))}
            </div>
          )}

          {log.error_message && (
            <div className="mt-3 pt-3 border-t border-red-400/20">
              <div className="text-[10px] font-bold uppercase tracking-wider text-red-300/70 mb-1">Error message</div>
              <div className="text-[12px] text-red-200 mb-2 break-words">{log.error_message}</div>
              {log.error_stack && (
                <details data-log-ignore>
                  <summary className="text-[10px] text-white/40 cursor-pointer hover:text-white/70">
                    Show the technical stack trace
                  </summary>
                  <pre className="mt-2 text-[10px] text-white/50 whitespace-pre-wrap break-all max-h-64 overflow-auto">
                    {log.error_stack}
                  </pre>
                </details>
              )}
            </div>
          )}

          {log.user_agent && <div className="mt-3 text-[10px] text-white/25 break-all">Browser: {log.user_agent}</div>}
        </div>
      )}
    </div>
  )
}

export default function HiggenLogsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [source, setSource] = useState('bot')
  const [stream, setStream] = useState('interaction')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [actor, setActor] = useState('all')
  const [action, setAction] = useState('all')
  const [eventType, setEventType] = useState('all')
  const [outcome, setOutcome] = useState('all')
  const [since, setSince] = useState('all')
  const [sort, setSort] = useState('newest')
  const [limit, setLimit] = useState(50)
  const [page, setPage] = useState(1)

  const [data, setData] = useState({ logs: [], total: 0, pages: 1, counts: {} })
  const [facets, setFacets] = useState({ actors: [], actions: [], eventTypes: [], outcomes: [] })
  const [open, setOpen] = useState(null)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [notice, setNotice] = useState('')
  const firstLoad = useRef(true)

  // Only the operator/owner may see this page. Directors get bounced like anyone
  // else — matching the API, which 404s rather than admitting the page exists.
  useEffect(() => {
    if (status === 'authenticated' && !session?.isSuperAdmin) router.replace('/admin/denied')
  }, [status, session, router])

  const params = useCallback(() => {
    const p = new URLSearchParams()
    p.set('source', source)
    p.set('stream', stream)
    if (search) p.set('q', search)
    if (actor !== 'all') p.set('actor', actor)
    if (action !== 'all') p.set('action', action)
    if (eventType !== 'all') p.set('event_type', eventType)
    if (outcome !== 'all') p.set('outcome', outcome)
    if (since !== 'all') p.set('since', since)
    p.set('sort', sort)
    p.set('limit', String(limit))
    p.set('page', String(page))
    return p
  }, [source, stream, search, actor, action, eventType, outcome, since, sort, limit, page])

  const reload = useCallback(async () => {
    if (firstLoad.current) setLoading(true)
    try {
      const r = await fetch(`/api/admin/higgenlogs?${params()}`, { cache: 'no-store' })
      if (!r.ok) throw new Error('request failed')
      const d = await r.json()
      setData({
        logs: Array.isArray(d.logs) ? d.logs : [],
        total: d.total ?? 0,
        pages: d.pages ?? 1,
        counts: d.counts && typeof d.counts === 'object' ? d.counts : {},
      })
    } catch {
      setData({ logs: [], total: 0, pages: 1, counts: {} })
    }
    setLoading(false)
    firstLoad.current = false
  }, [params])

  useEffect(() => { reload() }, [reload])

  // Refresh the dropdown options whenever the tab changes.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/higgenlogs?facets=1&source=${source}&stream=${stream}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        setFacets({
          actors: Array.isArray(d.actors) ? d.actors : [],
          actions: Array.isArray(d.actions) ? d.actions : [],
          eventTypes: Array.isArray(d.eventTypes) ? d.eventTypes : [],
          outcomes: Array.isArray(d.outcomes) ? d.outcomes : [],
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [source, stream])

  useEffect(() => {
    if (!autoRefresh) return undefined
    const id = setInterval(reload, 10000)
    return () => clearInterval(id)
  }, [autoRefresh, reload])

  // Any filter change starts from page 1 — otherwise you land on an empty page 7.
  useEffect(() => { setPage(1); setOpen(null) }, [source, stream, search, actor, action, eventType, outcome, since, sort, limit])

  function switchSource(next) {
    setSource(next)
    setActor('all'); setAction('all'); setEventType('all'); setOutcome('all')
  }

  async function prune() {
    if (!confirm('Delete every entry older than 30 days?\n\nRecent entries cannot be deleted — that is the point of the log. The bot already does this automatically every day.')) return
    setNotice('Pruning…')
    try {
      const r = await fetch('/api/admin/higgenlogs', { method: 'DELETE' })
      const d = await r.json()
      setNotice(r.ok ? `Removed ${d.deleted} entr${d.deleted === 1 ? 'y' : 'ies'} older than 30 days.` : 'Prune failed.')
      reload()
    } catch { setNotice('Prune failed.') }
    setTimeout(() => setNotice(''), 5000)
  }

  function exportCsv() {
    const p = params()
    p.set('format', 'csv')
    window.location.href = `/api/admin/higgenlogs?${p}`
  }

  const streams = STREAM_LABELS[source]
  const selectCls = 'px-2.5 py-1.5 bg-black/40 border border-white/10 rounded-lg text-white text-xs min-w-0'

  if (status === 'loading' || (status === 'authenticated' && !session?.isSuperAdmin)) {
    return <div className="py-20 text-center text-white/40 text-sm">Loading…</div>
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">Restricted</div>
        <h1 className="text-3xl font-black text-white mb-1">Audit Log</h1>
        <p className="text-blue-100/60 text-sm">
          Everything that happens on the bot and in this admin panel — who did it, when, where, and
          exactly what they did. Entries cannot be edited or deleted; they age out automatically
          after 30 days.
        </p>
      </div>

      {/* Source tabs */}
      <div className="flex gap-2 mb-3" data-log-section="Audit log tabs">
        {SOURCES.map((t) => (
          <button
            key={t.value}
            onClick={() => switchSource(t.value)}
            className={`px-4 py-2 rounded-lg text-sm font-bold border transition ${
              source === t.value
                ? 'bg-blue-500/20 text-blue-100 border-blue-400/50'
                : 'bg-white/[0.03] text-white/60 border-white/10 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Stream sub-tabs */}
      <div className="flex gap-2 mb-4" data-log-section="Audit log tabs">
        {streams.map((s) => (
          <button
            key={s.value}
            onClick={() => setStream(s.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
              stream === s.value
                ? (s.value === 'error'
                  ? 'bg-red-500/15 text-red-200 border-red-400/40'
                  : 'bg-white/10 text-white border-white/25')
                : 'bg-transparent text-white/45 border-white/10 hover:text-white/80'
            }`}
          >
            {s.label}
            <span className="ml-2 text-[10px] text-white/35">{data.counts[`${source}:${s.value}`] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-2" data-log-section="Audit log filters">
        <div className="flex gap-2 flex-wrap">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setSearch(q) }}
            placeholder="Search anything — a name, a command, a team, an error…"
            className="flex-1 min-w-[220px] px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm"
          />
          <button onClick={() => setSearch(q)} className="px-4 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 rounded-lg">
            Search
          </button>
          {(search || actor !== 'all' || action !== 'all' || eventType !== 'all' || outcome !== 'all' || since !== 'all') && (
            <button
              onClick={() => { setQ(''); setSearch(''); setActor('all'); setAction('all'); setEventType('all'); setOutcome('all'); setSince('all') }}
              className="px-3 py-2 text-xs font-bold text-white/50 hover:text-white bg-white/5 rounded-lg"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <select value={actor} onChange={(e) => setActor(e.target.value)} className={selectCls} aria-label="Filter by person">
            <option value="all">Anyone</option>
            {facets.actors.map((a) => <option key={a.v} value={a.v}>{a.v} ({a.n})</option>)}
          </select>

          <select value={action} onChange={(e) => setAction(e.target.value)} className={selectCls} aria-label="Filter by action">
            <option value="all">Any action</option>
            {facets.actions.map((a) => <option key={a.v} value={a.v}>{a.v} ({a.n})</option>)}
          </select>

          <select value={eventType} onChange={(e) => setEventType(e.target.value)} className={selectCls} aria-label="Filter by type">
            <option value="all">Any type</option>
            {facets.eventTypes.map((t) => <option key={t.v} value={t.v}>{TYPE_WORDS[t.v] || t.v} ({t.n})</option>)}
          </select>

          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={selectCls} aria-label="Filter by outcome">
            <option value="all">Any outcome</option>
            {facets.outcomes.map((o) => <option key={o.v} value={o.v}>{o.v} ({o.n})</option>)}
          </select>

          <select value={since} onChange={(e) => setSince(e.target.value)} className={selectCls} aria-label="Filter by time">
            {WINDOWS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>

          <select value={sort} onChange={(e) => setSort(e.target.value)} className={selectCls} aria-label="Sort order">
            {SORT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={selectCls} aria-label="Entries per page">
            {[50, 100, 250].map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex items-center gap-3 flex-wrap text-xs">
        <span className="text-white/45">
          {loading ? 'Loading…' : `${data.total.toLocaleString()} entr${data.total === 1 ? 'y' : 'ies'}`}
          {data.pages > 1 && !loading ? ` · page ${page} of ${data.pages}` : ''}
        </span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-white/45 cursor-pointer">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-blue-500" />
          Auto-refresh
        </label>
        <button onClick={reload} className="px-3 py-1.5 font-bold text-white/70 hover:text-white bg-white/5 rounded-lg">Refresh</button>
        <button onClick={exportCsv} className="px-3 py-1.5 font-bold text-white/70 hover:text-white bg-white/5 rounded-lg">Export CSV</button>
        <button onClick={prune} className="px-3 py-1.5 font-bold text-white/40 hover:text-red-300 bg-white/5 rounded-lg">Prune 30d+</button>
      </div>
      {notice && <div className="mb-3 text-xs text-blue-200">{notice}</div>}

      {/* Entries */}
      {loading ? (
        <div className="text-center py-16 text-white/40 text-sm">Loading…</div>
      ) : data.logs.length === 0 ? (
        <div className="text-center py-16 text-white/40 text-sm rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
          Nothing matches those filters.
        </div>
      ) : (
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden divide-y divide-white/5">
          {data.logs.map((log) => (
            <Entry
              key={log.id}
              log={log}
              expanded={open === log.id}
              onToggle={() => setOpen(open === log.id ? null : log.id)}
            />
          ))}
        </div>
      )}

      {/* Paging */}
      {data.pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-xs">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 font-bold text-white/70 bg-white/5 rounded-lg disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-white/40 px-2">Page {page} of {data.pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page >= data.pages}
            className="px-3 py-1.5 font-bold text-white/70 bg-white/5 rounded-lg disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
