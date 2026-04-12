'use client'

import { useEffect, useState } from 'react'

export default function ChampionsPage() {
  const [champions, setChampions] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/admin/data?type=champions')
      .then((r) => r.json())
      .then((res) => setChampions(res.data || []))
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'champions', data: champions }),
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
    setChampions(champions.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function addChampion() {
    const nextSeason = Math.max(0, ...champions.map((c) => c.season)) + 1
    setChampions([
      ...champions,
      {
        id: Date.now(),
        season: nextSeason,
        team: '',
        gm: '',
        year: new Date().getFullYear(),
      },
    ])
  }

  function remove(id) {
    setChampions(champions.filter((c) => c.id !== id))
  }

  if (!champions) return <div className="text-blue-200/60">Loading…</div>

  return (
    <div className="max-w-5xl">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">
            Hall of Fame
          </div>
          <h1 className="text-3xl font-black text-white mb-2">Champions</h1>
          <p className="text-blue-100/60 text-sm">
            Past season winners displayed on the homepage Legacy Rail.
          </p>
        </div>
        <button
          onClick={addChampion}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-bold rounded-lg shadow-[0_0_20px_rgba(59,130,246,0.3)] transition"
        >
          + Add Season
        </button>
      </div>

      <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
        <div className="grid grid-cols-[80px_1fr_1fr_100px_60px] gap-4 px-5 py-3 border-b border-white/10 text-[10px] font-bold tracking-wider uppercase text-blue-300/60 bg-black/30">
          <div>Season</div>
          <div>Team</div>
          <div>GM</div>
          <div>Year</div>
          <div></div>
        </div>
        {champions
          .slice()
          .sort((a, b) => a.season - b.season)
          .map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-[80px_1fr_1fr_100px_60px] gap-4 px-5 py-3 border-b border-white/5 items-center hover:bg-white/[0.02]"
            >
              <input
                type="number"
                value={c.season}
                onChange={(e) => update(c.id, { season: parseInt(e.target.value, 10) || 0 })}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white font-black text-lg focus:outline-none focus:border-blue-400/60"
              />
              <input
                type="text"
                value={c.team || ''}
                onChange={(e) => update(c.id, { team: e.target.value })}
                placeholder="Team name"
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-400/60"
              />
              <input
                type="text"
                value={c.gm || ''}
                onChange={(e) => update(c.id, { gm: e.target.value })}
                placeholder="General Manager"
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-400/60"
              />
              <input
                type="number"
                value={c.year || ''}
                onChange={(e) => update(c.id, { year: parseInt(e.target.value, 10) || 0 })}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-400/60"
              />
              <button
                onClick={() => remove(c.id)}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg p-2 transition"
                aria-label="Delete"
              >
                ✕
              </button>
            </div>
          ))}
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
