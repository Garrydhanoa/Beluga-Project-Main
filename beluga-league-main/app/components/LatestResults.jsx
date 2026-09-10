'use client'

// Homepage "Latest Results" strip: the 5 most recent confirmed series across all
// divisions (winner shown first), each linking to its Ballchasing replay group.
// Renders nothing until at least one series has been reported.

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function LatestResults() {
  const [results, setResults] = useState([])

  useEffect(() => {
    fetch('/api/public/stats/recent', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setResults(Array.isArray(d.results) ? d.results : []))
      .catch(() => {})
  }, [])

  if (!results.length) return null

  return (
    <section className="container mx-auto px-4 py-16">
      <div className="text-center mb-8">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">Fresh off the field</div>
        <h2 className="text-3xl md:text-4xl font-black text-white">Latest Results</h2>
      </div>
      <div className="max-w-3xl mx-auto space-y-2">
        {results.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 hover:border-blue-400/30 transition">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300/70 w-14">{r.division}</span>
            <span className="text-white/40 text-xs w-10">{r.isPlayoff ? 'PO' : `W${r.week ?? '—'}`}</span>
            <span className="flex-1 text-sm truncate">
              <Link href={`/teams/${encodeURIComponent(r.winner || '')}`} className={r.isDoubleForfeit ? 'text-white/70 hover:text-blue-200' : 'font-bold text-white hover:text-blue-200'}>{r.winner}</Link>
              <span className="font-mono font-bold text-blue-300 mx-2">{r.winnerScore}–{r.loserScore}</span>
              <Link href={`/teams/${encodeURIComponent(r.loser || '')}`} className="text-white/70 hover:text-blue-200">{r.loser}</Link>
              {r.isForfeit && (
                <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-orange-500/15 text-orange-300 border border-orange-400/30">
                  {r.isDoubleForfeit ? 'Double FF' : 'FF'}
                </span>
              )}
            </span>
            {r.replayGroupUrl && (
              <a href={r.replayGroupUrl} target="_blank" rel="noreferrer"
                className="text-[10px] uppercase font-bold text-blue-200 hover:text-white px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 rounded">
                Replays
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
