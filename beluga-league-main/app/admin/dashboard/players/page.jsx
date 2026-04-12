'use client'

import { useEffect, useState } from 'react'

const DIVISIONS = ['Majors', 'AAA', 'AA']

export default function PlayersPage() {
  const [players, setPlayers] = useState(null)
  const [query, setQuery] = useState('')
  const [divFilter, setDivFilter] = useState('all')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/admin/data?type=players')
      .then((r) => r.json())
      .then((res) => setPlayers(res.data || []))
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'players', data: players }),
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
    setPlayers(players.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  function add() {
    setPlayers([
      ...players,
      {
        id: Date.now(),
        username: '',
        team: null,
        division: 'Majors',
        rank: 'GC',
        freeAgent: true,
        salary: 0,
      },
    ])
  }

  function remove(id) {
    setPlayers(players.filter((p) => p.id !== id))
  }

  if (!players) return <div className="text-blue-200/60">Loading…</div>

  const filtered = players.filter((p) => {
    if (divFilter !== 'all' && p.division !== divFilter) return false
    if (query && !p.username.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })

  return (
    <div className="max-w-6xl">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">
            Directory
          </div>
          <h1 className="text-3xl font-black text-white mb-2">Players</h1>
          <p className="text-blue-100/60 text-sm">Manage the player directory. Placeholder data.</p>
        </div>
        <button
          onClick={add}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-bold rounded-lg shadow-[0_0_20px_rgba(59,130,246,0.3)] transition"
        >
          + New Player
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by username..."
          className="flex-1 px-4 py-2.5 bg-black/40 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-sm focus:outline-none transition"
        />
        <select
          value={divFilter}
          onChange={(e) => setDivFilter(e.target.value)}
          className="px-4 py-2.5 bg-black/40 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-sm focus:outline-none"
        >
          <option value="all">All Divisions</option>
          {DIVISIONS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
        <div className="grid grid-cols-[1fr_1fr_100px_80px_80px_90px_60px] gap-3 px-4 py-3 border-b border-white/10 text-[10px] font-bold tracking-wider uppercase text-blue-300/60 bg-black/30">
          <div>Username</div>
          <div>Team</div>
          <div>Division</div>
          <div>Rank</div>
          <div>FA</div>
          <div>Salary</div>
          <div></div>
        </div>
        {filtered.map((p) => (
          <div
            key={p.id}
            className="grid grid-cols-[1fr_1fr_100px_80px_80px_90px_60px] gap-3 px-4 py-3 border-b border-white/5 items-center hover:bg-white/[0.02]"
          >
            <input
              type="text"
              value={p.username}
              onChange={(e) => update(p.id, { username: e.target.value })}
              className="px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs font-semibold focus:outline-none focus:border-blue-400/60"
            />
            <input
              type="text"
              value={p.team || ''}
              onChange={(e) => update(p.id, { team: e.target.value || null })}
              placeholder="—"
              className="px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-blue-400/60"
            />
            <select
              value={p.division}
              onChange={(e) => update(p.id, { division: e.target.value })}
              className="px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-blue-400/60"
            >
              {DIVISIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <input
              type="text"
              value={p.rank || ''}
              onChange={(e) => update(p.id, { rank: e.target.value })}
              className="px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs text-center focus:outline-none focus:border-blue-400/60"
            />
            <button
              onClick={() => update(p.id, { freeAgent: !p.freeAgent })}
              className={`px-2 py-1.5 rounded text-xs font-bold transition ${
                p.freeAgent
                  ? 'bg-blue-500/20 border border-blue-400/40 text-blue-200'
                  : 'bg-white/5 border border-white/10 text-white/40'
              }`}
            >
              {p.freeAgent ? 'FA' : '—'}
            </button>
            <input
              type="number"
              value={p.salary || 0}
              onChange={(e) => update(p.id, { salary: parseInt(e.target.value, 10) || 0 })}
              className="px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs text-right focus:outline-none focus:border-blue-400/60"
            />
            <button
              onClick={() => remove(p.id)}
              className="text-red-400 hover:text-red-300 p-2 rounded transition"
            >
              ✕
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-white/40">No players match.</div>
        )}
      </div>

      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-3 bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/50 text-white font-bold rounded-lg shadow-[0_0_25px_rgba(59,130,246,0.4)] hover:shadow-[0_0_40px_rgba(59,130,246,0.7)] transition-all"
        >
          {saving ? 'Saving…' : 'Save Players'}
        </button>
        {saved && <span className="text-sm text-blue-300">✓ Saved</span>}
      </div>
    </div>
  )
}
