'use client'

// Site-wide "which season am I viewing" state for the archive viewer. Lives in the
// public LayoutShell so standings / schedule / teams / leaderboards / power-rankings
// all read the same selection. Default '' = the active season. The choice is mirrored
// into the URL (?season=<number>) via history.replaceState so links are shareable,
// without a full navigation.

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

const SeasonContext = createContext({ season: '', setSeason: () => {} })

export function SeasonProvider({ children }) {
  // Start '' on both server and first client render (avoids hydration mismatch);
  // a mount effect then reads any ?season= already in the URL for deep links.
  const [season, setSeasonState] = useState('')

  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('season')
      if (fromUrl) setSeasonState(fromUrl)
    } catch { /* no window */ }
  }, [])

  const setSeason = useCallback((val) => {
    const next = val ? String(val) : ''
    setSeasonState(next)
    try {
      const params = new URLSearchParams(window.location.search)
      if (next) params.set('season', next)
      else params.delete('season')
      const qs = params.toString()
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
      window.history.replaceState(window.history.state, '', url)
    } catch { /* no window */ }
  }, [])

  return (
    <SeasonContext.Provider value={{ season, setSeason }}>
      {children}
    </SeasonContext.Provider>
  )
}

export function useSeason() {
  return useContext(SeasonContext)
}

// Convenience: the `&season=N` suffix (or '') to append to an API fetch URL.
export function seasonQuerySuffix(season) {
  return season ? `&season=${encodeURIComponent(season)}` : ''
}
