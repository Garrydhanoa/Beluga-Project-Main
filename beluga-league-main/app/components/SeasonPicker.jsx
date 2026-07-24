'use client'

// Dropdown that drives the site-wide season selection (archive viewer). Fetches the
// public season list once; selecting a past season re-renders every page bound to
// useSeason(). Hidden until there is more than one season (nothing to pick).

import { useEffect, useState } from 'react'
import { useSeason } from './SeasonContext'

export default function SeasonPicker({ className = '' }) {
  const { season, setSeason } = useSeason()
  const [seasons, setSeasons] = useState([])
  const [activeNum, setActiveNum] = useState(null)

  useEffect(() => {
    let alive = true
    fetch('/api/seasons', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setSeasons(Array.isArray(d.seasons) ? d.seasons : [])
        setActiveNum(d.activeSeasonNumber ?? null)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (seasons.length <= 1) return null

  // '' (active) shows the active season's number as selected.
  const value = season || (activeNum != null ? String(activeNum) : '')

  return (
    <div className={`relative ${className}`}>
      <label className="sr-only" htmlFor="season-picker">Season</label>
      <select
        id="season-picker"
        value={value}
        onChange={(e) => {
          const v = e.target.value
          // Selecting the active season clears the param for a clean URL.
          setSeason(activeNum != null && v === String(activeNum) ? '' : v)
        }}
        className="appearance-none pl-4 pr-9 py-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 hover:border-blue-400/50 text-sm font-bold text-blue-100 focus:outline-none focus:border-blue-400/70 transition cursor-pointer"
      >
        {seasons.map((s) => (
          <option key={s.id} value={String(s.seasonNumber)} className="bg-slate-900 text-white">
            Season {s.seasonNumber}{s.isActive ? ' · Current' : ''}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-300/70"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  )
}
