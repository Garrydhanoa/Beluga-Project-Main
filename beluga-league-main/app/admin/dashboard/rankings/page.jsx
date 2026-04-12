'use client'

import { useEffect, useState } from 'react'

const DIVISIONS = ['Majors', 'AAA', 'AA']

export default function RankingsPage() {
  const [rankings, setRankings] = useState(null)
  const [division, setDivision] = useState('Majors')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/admin/data?type=rankings')
      .then((r) => r.json())
      .then((res) => setRankings(res.data || {}))
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'rankings', data: rankings }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!rankings) return <div className="text-blue-200/60">Loading…</div>

  const list = rankings[division] || []

  function move(index, direction) {
    const newList = [...list]
    const target = index + direction
    if (target < 0 || target >= newList.length) return
    ;[newList[index], newList[target]] = [newList[target], newList[index]]
    newList.forEach((item, i) => {
      item.rank = i + 1
    })
    setRankings({ ...rankings, [division]: newList })
  }

  function updateItem(index, patch) {
    const newList = list.map((item, i) => (i === index ? { ...item, ...patch } : item))
    setRankings({ ...rankings, [division]: newList })
  }

  function addRow() {
    const newList = [...list, { rank: list.length + 1, team: '', delta: 0, note: '' }]
    setRankings({ ...rankings, [division]: newList })
  }

  function removeRow(index) {
    const newList = list.filter((_, i) => i !== index)
    newList.forEach((item, i) => {
      item.rank = i + 1
    })
    setRankings({ ...rankings, [division]: newList })
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">
          Weekly Update
        </div>
        <h1 className="text-3xl font-black text-white mb-2">Power Rankings</h1>
        <p className="text-blue-100/60 text-sm">
          Reorder teams and add analyst notes. Placeholder data for now.
        </p>
      </div>

      {/* Division tabs */}
      <div className="flex gap-2 mb-6">
        {DIVISIONS.map((d) => (
          <button
            key={d}
            onClick={() => setDivision(d)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
              division === d
                ? 'bg-blue-500/20 text-blue-200 border border-blue-400/40'
                : 'text-white/60 hover:text-blue-200 border border-transparent hover:bg-white/5'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="space-y-2 mb-4">
        {list.map((item, i) => (
          <div
            key={i}
            className="p-4 rounded-xl bg-white/[0.03] border border-white/10 hover:border-blue-400/30 transition"
          >
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-10 text-center">
                <div className="text-3xl font-black text-white">{item.rank}</div>
              </div>
              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  value={item.team}
                  onChange={(e) => updateItem(i, { team: e.target.value })}
                  placeholder="Team name"
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm font-bold focus:outline-none focus:border-blue-400/60"
                />
                <input
                  type="text"
                  value={item.note || ''}
                  onChange={(e) => updateItem(i, { note: e.target.value })}
                  placeholder="Analyst note"
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-blue-400/60"
                />
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                <div className="flex flex-col items-center">
                  <div className="text-[9px] text-blue-300/60 uppercase tracking-wider">Δ</div>
                  <input
                    type="number"
                    value={item.delta || 0}
                    onChange={(e) => updateItem(i, { delta: parseInt(e.target.value, 10) || 0 })}
                    className="w-14 px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-center text-sm focus:outline-none focus:border-blue-400/60"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="px-2 py-0.5 text-xs text-white/60 hover:text-blue-200 hover:bg-white/5 disabled:opacity-30 rounded"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === list.length - 1}
                    className="px-2 py-0.5 text-xs text-white/60 hover:text-blue-200 hover:bg-white/5 disabled:opacity-30 rounded"
                  >
                    ▼
                  </button>
                </div>
                <button
                  onClick={() => removeRow(i)}
                  className="text-red-400 hover:text-red-300 p-2 rounded transition"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addRow}
        className="w-full py-3 border-2 border-dashed border-white/10 hover:border-blue-400/40 text-white/50 hover:text-blue-200 rounded-xl text-sm font-semibold transition"
      >
        + Add Team
      </button>

      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-3 bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/50 text-white font-bold rounded-lg shadow-[0_0_25px_rgba(59,130,246,0.4)] hover:shadow-[0_0_40px_rgba(59,130,246,0.7)] transition-all"
        >
          {saving ? 'Saving…' : 'Publish Rankings'}
        </button>
        {saved && <span className="text-sm text-blue-300">✓ Published</span>}
      </div>
    </div>
  )
}
