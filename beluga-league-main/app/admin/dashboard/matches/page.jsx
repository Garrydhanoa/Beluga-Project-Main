'use client'

import { useEffect, useState } from 'react'

export default function MatchesPage() {
  const [matches, setMatches] = useState(null)
  const [filter, setFilter] = useState('all')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/admin/data?type=matches')
      .then((r) => r.json())
      .then((res) => setMatches(res.data || []))
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'matches', data: matches }),
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
    setMatches(matches.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  function complete(id) {
    update(id, { status: 'completed' })
  }

  if (!matches) return <div className="text-blue-200/60">Loading…</div>

  const filtered =
    filter === 'all' ? matches : matches.filter((m) => m.status === filter)

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">
          League Operations
        </div>
        <h1 className="text-3xl font-black text-white mb-2">Match Results</h1>
        <p className="text-blue-100/60 text-sm">
          Enter scores after each match night. Placeholder data — not yet wired to production standings.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { key: 'all', label: 'All' },
          { key: 'scheduled', label: 'Scheduled' },
          { key: 'completed', label: 'Completed' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
              filter === f.key
                ? 'bg-blue-500/20 text-blue-200 border border-blue-400/40'
                : 'text-white/60 hover:text-blue-200 border border-transparent hover:bg-white/5'
            }`}
          >
            {f.label} ({matches.filter((m) => f.key === 'all' || m.status === f.key).length})
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((m) => (
          <div
            key={m.id}
            className="p-4 rounded-xl bg-white/[0.03] border border-white/10 hover:border-blue-400/30 transition"
          >
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 text-center min-w-[80px]">
                <div className="text-[9px] font-bold tracking-wider uppercase text-blue-300/60">
                  {m.division}
                </div>
                <div className="text-xs text-white/70 mt-0.5">Week {m.week}</div>
                <div className="text-[10px] text-blue-300/50 mt-0.5">{m.date}</div>
              </div>

              <div className="flex-1 flex items-center gap-3">
                <div className="flex-1 text-right text-sm font-bold text-white">{m.homeTeam}</div>
                <input
                  type="number"
                  value={m.homeScore ?? ''}
                  onChange={(e) =>
                    update(m.id, {
                      homeScore: e.target.value === '' ? null : parseInt(e.target.value, 10),
                    })
                  }
                  className="w-14 px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-center font-black focus:outline-none focus:border-blue-400/60"
                  placeholder="—"
                />
                <span className="text-xs text-blue-300/50">vs</span>
                <input
                  type="number"
                  value={m.awayScore ?? ''}
                  onChange={(e) =>
                    update(m.id, {
                      awayScore: e.target.value === '' ? null : parseInt(e.target.value, 10),
                    })
                  }
                  className="w-14 px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-center font-black focus:outline-none focus:border-blue-400/60"
                  placeholder="—"
                />
                <div className="flex-1 text-left text-sm font-bold text-white">{m.awayTeam}</div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`text-[9px] px-2 py-0.5 rounded-full border font-bold tracking-wider uppercase ${
                    m.status === 'completed'
                      ? 'bg-blue-500/20 border-blue-400/40 text-blue-200'
                      : 'bg-white/5 border-white/20 text-white/60'
                  }`}
                >
                  {m.status}
                </span>
                {m.status === 'scheduled' && m.homeScore !== null && m.awayScore !== null && (
                  <button
                    onClick={() => complete(m.id)}
                    className="text-xs px-3 py-1 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/40 text-blue-200 rounded font-semibold transition"
                  >
                    Mark Completed
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-white/40">No matches in this filter.</div>
        )}
      </div>

      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-3 bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/50 text-white font-bold rounded-lg shadow-[0_0_25px_rgba(59,130,246,0.4)] hover:shadow-[0_0_40px_rgba(59,130,246,0.7)] transition-all"
        >
          {saving ? 'Saving…' : 'Save All'}
        </button>
        {saved && <span className="text-sm text-blue-300">✓ Saved</span>}
      </div>
    </div>
  )
}
