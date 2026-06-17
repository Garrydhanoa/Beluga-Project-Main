'use client'

// HIDDEN audit page (no nav link; reach it only by typing /admin/dashboard/higgenlogs).
// Still fully admin-gated by the dashboard layout + the API's requireAdmin.
//
// Two tabs (Website / Bot) over the shared site_logs table:
//   - WEBSITE: every admin write action (who/what/status) + any website error
//   - BOT: bot activity + every bot error (mirrored from Logger.error / logEdge)
// Logs are non-deletable except the "prune 30 days+" button (enforced server-side).

import { useEffect, useState, useCallback } from 'react'

const KINDS = [
  { value: 'all', label: 'All' },
  { value: 'activity', label: 'Activity' },
  { value: 'error', label: 'Errors' },
  { value: 'login', label: 'Logins' },
]

function KindBadge({ kind, level }) {
  const map = {
    activity: 'bg-blue-500/15 text-blue-200 border-blue-400/30',
    login: 'bg-green-500/15 text-green-200 border-green-400/30',
    error: 'bg-red-500/15 text-red-300 border-red-400/30',
  }
  const cls = level === 'error' ? map.error : (map[kind] || 'bg-white/10 text-white/70 border-white/20')
  return <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${cls}`}>{kind || level}</span>
}

export default function HiggenLogsPage() {
  const [source, setSource] = useState('website')
  const [kind, setKind] = useState('all')
  const [q, setQ] = useState('')
  const [logs, setLogs] = useState([])
  const [counts, setCounts] = useState({})
  const [open, setOpen] = useState(null)
  const [loading, setLoading] = useState(false)
  const [pruneMsg, setPruneMsg] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('source', source)
    if (kind !== 'all') params.set('kind', kind)
    if (q) params.set('q', q)
    try {
      const r = await fetch(`/api/admin/higgenlogs?${params}`, { cache: 'no-store' })
      const d = await r.json()
      setLogs(d.logs || [])
      setCounts(d.counts || {})
    } catch { setLogs([]) }
    setLoading(false)
  }, [source, kind, q])
  useEffect(() => { reload() }, [reload])

  async function prune() {
    if (!confirm('Delete ALL logs older than 30 days? (Recent logs cannot be deleted — audit integrity.)')) return
    setPruneMsg('Pruning…')
    try {
      const r = await fetch('/api/admin/higgenlogs', { method: 'DELETE' })
      const d = await r.json()
      setPruneMsg(r.ok ? `✓ Pruned ${d.deleted} old log${d.deleted === 1 ? '' : 's'}` : '❌ failed')
      reload()
    } catch { setPruneMsg('❌ failed') }
    setTimeout(() => setPruneMsg(''), 4000)
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">Audit</div>
        <h1 className="text-3xl font-black text-white mb-1">Activity &amp; Error Logs</h1>
        <p className="text-blue-100/60 text-sm">
          Every admin action (who did what) and every website/bot error, in one place. Logs are kept
          for audit — only entries older than 30 days can be pruned.
        </p>
      </div>

      {/* Source tabs */}
      <div className="flex gap-2 mb-4">
        {[
          { value: 'website', label: 'Website' },
          { value: 'bot', label: 'Bot' },
        ].map((t) => (
          <button
            key={t.value}
            onClick={() => { setSource(t.value); setOpen(null) }}
            className={`px-4 py-2 rounded-lg text-sm font-bold border transition ${
              source === t.value
                ? 'bg-blue-500/20 text-blue-100 border-blue-400/50'
                : 'bg-white/[0.03] text-white/60 border-white/10 hover:text-white'
            }`}
          >
            {t.label}
            <span className="ml-2 text-[10px] text-white/40">{counts[t.value] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-2 items-center flex-wrap p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && reload()}
          placeholder="Search actor, action, summary, detail…"
          className="flex-1 min-w-[200px] px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm"
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <button onClick={reload} className="px-4 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 rounded">Search</button>
        <button onClick={prune} className="px-3 py-2 text-xs font-bold text-white/50 hover:text-red-300 bg-white/5 rounded">Prune 30d+</button>
      </div>
      {pruneMsg && <div className="mb-3 text-xs text-blue-200">{pruneMsg}</div>}

      {loading ? (
        <div className="text-center py-16 text-white/40 text-sm">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-white/40 text-sm rounded-2xl bg-white/[0.02] border border-dashed border-white/10">No log entries.</div>
      ) : (
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden divide-y divide-white/5">
          {logs.map((l) => (
            <div key={l.id}>
              <button onClick={() => setOpen(open === l.id ? null : l.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03]">
                <KindBadge kind={l.kind} level={l.level} />
                {l.actor_name && <span className="text-blue-200/80 text-xs font-bold whitespace-nowrap max-w-[160px] truncate">{l.actor_name}</span>}
                <span className="text-white text-sm flex-1 truncate">{l.summary}</span>
                <span className="text-white/30 text-[10px] whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</span>
              </button>
              {open === l.id && (
                <div className="px-5 pb-4 bg-black/20 text-[11px] text-white/60 space-y-1">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 pt-2 text-white/50">
                    {l.action && <span>action: <span className="text-white/80 font-mono">{l.action}</span></span>}
                    {l.target && <span>target: <span className="text-white/80 font-mono break-all">{l.target}</span></span>}
                    {l.actor_discord_id && <span>actor id: <span className="text-white/80 font-mono">{l.actor_discord_id}</span></span>}
                    {l.division && <span>division: <span className="text-white/80">{l.division}</span></span>}
                  </div>
                  {l.detail && <pre className="whitespace-pre-wrap break-all mt-1">{l.detail}</pre>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
