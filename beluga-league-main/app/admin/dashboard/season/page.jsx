'use client'

import { useEffect, useState } from 'react'

export default function SeasonPage() {
  const [config, setConfig] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/admin/data?type=config')
      .then((r) => r.json())
      .then((res) => setConfig(res.data))
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'config', data: config }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!config) return <div className="text-blue-200/60">Loading…</div>

  const s = config.season
  const update = (patch) => setConfig({ ...config, season: { ...s, ...patch } })

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">
          Homepage
        </div>
        <h1 className="text-3xl font-black text-white mb-2">Season Config</h1>
        <p className="text-blue-100/60 text-sm">
          Controls the season number, status label, and recruiting state shown on the homepage.
        </p>
      </div>

      <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold tracking-wider uppercase text-blue-300/70 mb-2">
              Season Number
            </label>
            <input
              type="number"
              value={s.number}
              onChange={(e) => update({ number: parseInt(e.target.value, 10) || 0 })}
              className="w-full px-4 py-3 bg-black/40 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-2xl font-black focus:outline-none transition"
              min={1}
            />
          </div>
          <div>
            <label className="block text-xs font-bold tracking-wider uppercase text-blue-300/70 mb-2">
              Year
            </label>
            <input
              type="number"
              value={s.year}
              onChange={(e) => update({ year: parseInt(e.target.value, 10) || 0 })}
              className="w-full px-4 py-3 bg-black/40 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-2xl font-black focus:outline-none transition"
              min={2020}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold tracking-wider uppercase text-blue-300/70 mb-2">
            Status Label
          </label>
          <input
            type="text"
            value={s.statusLabel}
            onChange={(e) => update({ statusLabel: e.target.value })}
            className="w-full px-4 py-3 bg-black/40 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-sm focus:outline-none transition"
            placeholder="e.g. SEASON 9 · NOW LIVE"
          />
          <div className="text-[10px] text-blue-300/50 mt-1.5">
            Shown in the hero pill on the homepage
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold tracking-wider uppercase text-blue-300/70 mb-2">
            Description
          </label>
          <input
            type="text"
            value={s.description || ''}
            onChange={(e) => update({ description: e.target.value })}
            className="w-full px-4 py-3 bg-black/40 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-sm focus:outline-none transition"
            placeholder="e.g. Season in progress"
          />
        </div>

        <label className="flex items-center justify-between cursor-pointer pt-2">
          <div>
            <div className="text-sm font-bold text-white">Recruiting Open</div>
            <div className="text-xs text-blue-100/50">Show "Recruiting Now" messaging across the site</div>
          </div>
          <button
            onClick={() => update({ recruitingOpen: !s.recruitingOpen })}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              s.recruitingOpen ? 'bg-blue-500' : 'bg-white/10'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                s.recruitingOpen ? 'translate-x-6' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>

        {/* Preview */}
        <div className="pt-4">
          <div className="text-xs font-bold tracking-wider uppercase text-blue-300/70 mb-2">
            Hero Pill Preview
          </div>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-xs sm:text-sm text-blue-200 font-medium tracking-[0.2em]">
              {s.statusLabel}
            </span>
          </div>
        </div>
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
