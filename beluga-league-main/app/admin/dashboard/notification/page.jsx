'use client'

import { useEffect, useState } from 'react'

export default function NotificationPage() {
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

  if (!config) {
    return <div className="text-blue-200/60">Loading…</div>
  }

  const nb = config.notificationBar

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">
          Homepage
        </div>
        <h1 className="text-3xl font-black text-white mb-2">Notification Bar</h1>
        <p className="text-blue-100/60 text-sm">
          Edit the banner at the top of the homepage. Changes save to the admin data store.
        </p>
      </div>

      <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 space-y-5">
        {/* Enabled toggle */}
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <div className="text-sm font-bold text-white">Show banner</div>
            <div className="text-xs text-blue-100/50">Toggle the bar on/off for all visitors</div>
          </div>
          <button
            onClick={() =>
              setConfig({ ...config, notificationBar: { ...nb, enabled: !nb.enabled } })
            }
            className={`relative w-12 h-6 rounded-full transition-colors ${
              nb.enabled ? 'bg-blue-500' : 'bg-white/10'
            }`}
            aria-pressed={nb.enabled}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                nb.enabled ? 'translate-x-6' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>

        <div className="h-px bg-white/10" />

        {/* Message */}
        <div>
          <label className="block text-xs font-bold tracking-wider uppercase text-blue-300/70 mb-2">
            Message
          </label>
          <textarea
            value={nb.message}
            onChange={(e) =>
              setConfig({ ...config, notificationBar: { ...nb, message: e.target.value } })
            }
            rows={3}
            className="w-full px-4 py-3 bg-black/40 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-sm leading-relaxed focus:outline-none transition"
            placeholder="Enter notification message"
          />
          <div className="text-[10px] text-blue-300/50 mt-1.5">
            {nb.message?.length || 0} characters
          </div>
        </div>

        {/* Link */}
        <div>
          <label className="block text-xs font-bold tracking-wider uppercase text-blue-300/70 mb-2">
            Link destination
          </label>
          <input
            type="text"
            value={nb.href || ''}
            onChange={(e) =>
              setConfig({ ...config, notificationBar: { ...nb, href: e.target.value } })
            }
            className="w-full px-4 py-3 bg-black/40 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-sm focus:outline-none transition"
            placeholder="/players"
          />
          <div className="text-[10px] text-blue-300/50 mt-1.5">
            Where clicking the banner takes users (leave blank for no link)
          </div>
        </div>

        {/* Preview */}
        <div>
          <div className="text-xs font-bold tracking-wider uppercase text-blue-300/70 mb-2">
            Preview
          </div>
          <div className="relative rounded-lg overflow-hidden border border-blue-400/30">
            {nb.enabled ? (
              <div className="bg-gradient-to-r from-blue-950 via-blue-800 to-blue-950 px-4 py-3">
                <div className="flex items-center justify-center gap-3">
                  <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-blue-100 bg-blue-400/20 border border-blue-300/40 rounded-full px-2.5 py-1">
                    New
                  </span>
                  <div className="text-sm text-white/90 truncate">{nb.message}</div>
                </div>
              </div>
            ) : (
              <div className="bg-black/40 px-4 py-6 text-center text-xs text-white/40 italic">
                Banner hidden
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-3 bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/50 text-white font-bold rounded-lg shadow-[0_0_25px_rgba(59,130,246,0.4)] hover:shadow-[0_0_40px_rgba(59,130,246,0.7)] transition-all"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        {saved && (
          <span className="text-sm text-blue-300 flex items-center gap-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Saved
          </span>
        )}
      </div>
    </div>
  )
}
