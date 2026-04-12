'use client'

import { useEffect, useState } from 'react'

const TEAMS = [
  '6 Speed', 'Archangels', 'Aviators', 'Clovis Esports', 'Griffins',
  'Immortals', 'InTraCate', 'Kingdom', 'Lotus', 'Malfeasance',
  'MNML', 'Panthers', 'Sublunary', 'Surge',
]

const ROLES = ['Captain', 'Player', 'Sub', 'Coach']
const RANKS = ['Bronze', 'Silver', 'Gold', 'Plat', 'Diamond', 'Champ', 'GC', 'GC2', 'GC3', 'SSL']

export default function RostersPage() {
  const [rosters, setRosters] = useState(null)
  const [selectedTeam, setSelectedTeam] = useState('Aviators')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/admin/data?type=rosters')
      .then((r) => r.json())
      .then((res) => setRosters(res.data || {}))
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'rosters', data: rosters }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!rosters) return <div className="text-blue-200/60">Loading…</div>

  const roster = rosters[selectedTeam] || []

  function updatePlayer(index, patch) {
    const newRoster = roster.map((p, i) => (i === index ? { ...p, ...patch } : p))
    setRosters({ ...rosters, [selectedTeam]: newRoster })
  }

  function addPlayer() {
    setRosters({
      ...rosters,
      [selectedTeam]: [...roster, { username: '', role: 'Player', rank: 'GC' }],
    })
  }

  function removePlayer(index) {
    setRosters({ ...rosters, [selectedTeam]: roster.filter((_, i) => i !== index) })
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">
          Team Management
        </div>
        <h1 className="text-3xl font-black text-white mb-2">Rosters</h1>
        <p className="text-blue-100/60 text-sm">Manage team lineups, captains, and roles.</p>
      </div>

      <div className="grid grid-cols-[240px_1fr] gap-6">
        {/* Team list */}
        <div className="space-y-1">
          <div className="text-[10px] font-bold tracking-wider uppercase text-blue-300/60 px-3 mb-2">
            Teams
          </div>
          {TEAMS.map((t) => {
            const count = (rosters[t] || []).length
            return (
              <button
                key={t}
                onClick={() => setSelectedTeam(t)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold transition ${
                  selectedTeam === t
                    ? 'bg-blue-500/15 text-blue-200 border border-blue-400/40'
                    : 'text-white/70 hover:bg-white/5 hover:text-blue-200 border border-transparent'
                }`}
              >
                <span>{t}</span>
                <span className="text-[10px] text-white/40">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Roster editor */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-black text-white">{selectedTeam}</h2>
            <button
              onClick={addPlayer}
              className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white text-xs font-bold rounded transition"
            >
              + Add Player
            </button>
          </div>

          <div className="space-y-2">
            {roster.length === 0 && (
              <div className="text-center py-12 text-sm text-white/40 border border-dashed border-white/10 rounded-xl">
                No players on this roster yet.
              </div>
            )}
            {roster.map((p, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_140px_140px_40px] gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/10 hover:border-blue-400/30 transition items-center"
              >
                <input
                  type="text"
                  value={p.username}
                  onChange={(e) => updatePlayer(i, { username: e.target.value })}
                  placeholder="Username"
                  className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm font-semibold focus:outline-none focus:border-blue-400/60"
                />
                <select
                  value={p.role}
                  onChange={(e) => updatePlayer(i, { role: e.target.value })}
                  className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-400/60"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <select
                  value={p.rank}
                  onChange={(e) => updatePlayer(i, { rank: e.target.value })}
                  className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-400/60"
                >
                  {RANKS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <button
                  onClick={() => removePlayer(i)}
                  className="text-red-400 hover:text-red-300 p-2 rounded transition"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-3 bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/50 text-white font-bold rounded-lg shadow-[0_0_25px_rgba(59,130,246,0.4)] hover:shadow-[0_0_40px_rgba(59,130,246,0.7)] transition-all"
        >
          {saving ? 'Saving…' : 'Save Rosters'}
        </button>
        {saved && <span className="text-sm text-blue-300">✓ Saved</span>}
      </div>
    </div>
  )
}
