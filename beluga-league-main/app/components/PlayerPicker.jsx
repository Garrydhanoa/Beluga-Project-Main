'use client'

import { useEffect, useRef, useState } from 'react'
import Avatar from './Avatar'

// Reusable name+avatar player search across the FULL directory (~1200, not just
// discord_members) — backed by /api/admin/players which unions roster +
// transactions + manual_salaries + the salary sheet. Returns the picked player
// object { discordId, displayName, avatarUrl, current? } to onPick.
export default function PlayerPicker({ onPick, exclude = [], placeholder = 'Search player by name…' }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const timer = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => {
    function onDocClick(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!q.trim()) { setResults([]); return }
    timer.current = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await fetch(`/api/admin/players?search=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })
        const d = await r.json()
        const ex = new Set(exclude.map(String))
        setResults((d.players || []).filter((p) => !ex.has(String(p.discordId))).slice(0, 12))
        setOpen(true)
      } catch { setResults([]) } finally { setBusy(false) }
    }, 250)
    return () => timer.current && clearTimeout(timer.current)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative" ref={boxRef}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:border-blue-400/60 focus:outline-none"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg bg-[#0b1220] border border-white/15 shadow-2xl">
          {busy && <div className="px-3 py-2 text-[11px] text-white/40">Searching…</div>}
          {!busy && results.length === 0 && <div className="px-3 py-2 text-[11px] text-white/40">No matches.</div>}
          {results.map((p) => (
            <button
              key={p.discordId}
              onMouseDown={(e) => { e.preventDefault(); onPick(p); setOpen(false); setQ('') }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/[0.06]"
            >
              <Avatar src={p.avatarUrl} name={p.displayName} size={26} ring={false} className="flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-xs text-white truncate">{p.displayName}</div>
                <div className="text-[9px] font-mono text-white/35 truncate">{p.discordId}{p.current?.teamName ? ` · ${p.current.teamName}` : ''}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
