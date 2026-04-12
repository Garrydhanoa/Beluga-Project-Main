'use client'

import { useEffect, useState } from 'react'

const STATUSES = ['open', 'investigating', 'resolved', 'dismissed']
const PRIORITIES = ['low', 'medium', 'high']

export default function ReportsPage() {
  const [reports, setReports] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/admin/data?type=reports')
      .then((r) => r.json())
      .then((res) => setReports(res.data || []))
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'reports', data: reports }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } finally {
      setSaving(false)
    }
  }

  function update(id, patch) {
    setReports(reports.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  if (!reports) return <div className="text-blue-200/60">Loading…</div>

  const filtered = statusFilter === 'all' ? reports : reports.filter((r) => r.status === statusFilter)

  const priorityColor = (p) =>
    p === 'high' ? 'bg-blue-500/25 border-blue-300/60 text-blue-100' :
    p === 'medium' ? 'bg-blue-500/15 border-blue-400/40 text-blue-200' :
    'bg-white/5 border-white/10 text-white/60'

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">
          Moderation
        </div>
        <h1 className="text-3xl font-black text-white mb-2">Reports</h1>
        <p className="text-blue-100/60 text-sm">Player reports and moderation queue. Placeholder data.</p>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {['all', ...STATUSES].map((s) => {
          const count = s === 'all' ? reports.length : reports.filter((r) => r.status === s).length
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                statusFilter === s
                  ? 'bg-blue-500/20 text-blue-200 border border-blue-400/40'
                  : 'text-white/60 hover:text-blue-200 border border-transparent hover:bg-white/5'
              }`}
            >
              {s} ({count})
            </button>
          )
        })}
      </div>

      <div className="space-y-3">
        {filtered.map((r) => (
          <div
            key={r.id}
            className="p-5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-blue-400/30 transition"
          >
            <div className="flex items-start gap-4 mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full border ${priorityColor(r.priority)}`}
                  >
                    {r.priority}
                  </span>
                  <span className="text-[10px] text-blue-300/50 tracking-wider uppercase">
                    {r.date}
                  </span>
                </div>
                <div className="text-sm text-white">
                  <span className="text-blue-300 font-bold">{r.reporter}</span>
                  <span className="text-white/50"> reported </span>
                  <span className="text-white font-bold">{r.reported}</span>
                </div>
                <div className="text-xs text-blue-100/70 mt-1.5 italic">"{r.reason}"</div>
              </div>
              <select
                value={r.status}
                onChange={(e) => update(r.id, { status: e.target.value })}
                className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-xs font-semibold focus:outline-none focus:border-blue-400/60"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 pt-3 border-t border-white/5">
              <select
                value={r.priority}
                onChange={(e) => update(r.id, { priority: e.target.value })}
                className="px-3 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-blue-400/60"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p} priority</option>
                ))}
              </select>
              {r.status === 'open' && (
                <button
                  onClick={() => update(r.id, { status: 'investigating' })}
                  className="px-3 py-1.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/40 text-blue-200 text-xs font-semibold rounded transition"
                >
                  Take Case
                </button>
              )}
              {r.status === 'investigating' && (
                <>
                  <button
                    onClick={() => update(r.id, { status: 'resolved' })}
                    className="px-3 py-1.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/40 text-blue-200 text-xs font-semibold rounded transition"
                  >
                    Resolve
                  </button>
                  <button
                    onClick={() => update(r.id, { status: 'dismissed' })}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/20 text-white/70 text-xs font-semibold rounded transition"
                  >
                    Dismiss
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-sm text-white/40 border border-dashed border-white/10 rounded-xl">
            No reports with this status.
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-3 bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/50 text-white font-bold rounded-lg shadow-[0_0_25px_rgba(59,130,246,0.4)] hover:shadow-[0_0_40px_rgba(59,130,246,0.7)] transition-all"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        {saved && <span className="text-sm text-blue-300">✓ Saved</span>}
      </div>
    </div>
  )
}
