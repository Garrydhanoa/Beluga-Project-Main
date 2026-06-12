'use client'

// Admin — Logs: every bot edge case + error (stats rejects, cap blocks, GotW
// failures, application post failures…) in one searchable place. Mirrors what
// lands in the Discord log channel.

import { useEffect, useState, useCallback } from 'react'

export default function LogsPage() {
  const [logs, setLogs] = useState([])
  const [q, setQ] = useState('')
  const [level, setLevel] = useState('all')
  const [open, setOpen] = useState(null)

  const reload = useCallback(async () => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (level !== 'all') params.set('level', level)
    const r = await fetch(`/api/admin/logs?${params}`, { cache: 'no-store' })
    const d = await r.json()
    setLogs(d.logs || [])
  }, [q, level])
  useEffect(() => { reload() }, [reload])

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
        <h1 className="text-3xl font-black text-white mb-1">Logs</h1>
        <p className="text-blue-100/60 text-sm">Everything the bot reports (errors, rejected replays, cap blocks, failed posts…). Click a row for the copy-pasteable detail.</p>
      </div>

      <div className="mb-4 flex gap-2 items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reload()}
          placeholder="Search summaries + details…" className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm" />
        <select value={level} onChange={(e) => setLevel(e.target.value)} className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          <option value="all">All levels</option><option value="error">Errors</option><option value="warn">Warnings</option>
        </select>
        <button onClick={reload} className="px-4 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 rounded">Search</button>
        <button onClick={async () => { if (confirm('Delete logs older than 30 days?')) { await fetch('/api/admin/logs', { method: 'DELETE' }); reload() } }}
          className="px-3 py-2 text-xs font-bold text-white/50 hover:text-red-300 bg-white/5 rounded">Prune 30d+</button>
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-16 text-white/40 text-sm rounded-2xl bg-white/[0.02] border border-dashed border-white/10">No log entries.</div>
      ) : (
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden divide-y divide-white/5">
          {logs.map((l) => (
            <div key={l.id}>
              <button onClick={() => setOpen(open === l.id ? null : l.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03]">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${l.level === 'error' ? 'bg-red-500/15 text-red-300 border-red-400/30' : 'bg-yellow-500/15 text-yellow-200 border-yellow-400/30'}`}>{l.level}</span>
                {l.division && <span className="text-blue-200/70 text-xs font-bold">{l.division}</span>}
                <span className="text-white text-sm flex-1 truncate">{l.summary}</span>
                <span className="text-white/30 text-[10px] whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</span>
              </button>
              {open === l.id && l.detail && (
                <pre className="px-5 pb-4 text-[11px] text-white/60 whitespace-pre-wrap break-all bg-black/20">{l.detail}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
