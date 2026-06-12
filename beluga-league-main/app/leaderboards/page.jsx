'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const DIVISIONS = ['all', 'Majors', 'AAA', 'AA']
const STAT_LABELS = {
  beluga_score: 'Beluga Score',
  score: 'Avg Score',
  goals: 'Avg Goals',
  assists: 'Avg Assists',
  saves: 'Avg Saves',
  shots: 'Avg Shots',
  demos_inflicted: 'Avg Demos',
  mvps: 'Avg MVPs',
}

export default function LeaderboardsPage() {
  const [scope, setScope] = useState('season')
  const [division, setDivision] = useState('all')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ scope })
    if (division !== 'all') params.set('division', division)
    fetch(`/api/public/stats/leaderboards?${params}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(e.message || 'Failed to load') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [scope, division])

  const leaders = data?.leaders
  const boards = leaders?.boards || {}

  return (
    <main className="min-h-screen px-4 py-10 max-w-6xl mx-auto">
      <div className="mb-8">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">Beluga League</div>
        <h1 className="text-4xl font-black text-white mb-2">Leaderboards</h1>
        <p className="text-blue-100/60 text-sm">
          Average leaders (min. {leaders?.minGames ?? 25} games), team totals, and franchise records.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {['season', 'alltime'].map((s) => (
            <button key={s} onClick={() => setScope(s)}
              className={`px-4 py-2 text-sm font-bold ${scope === s ? 'bg-blue-500 text-white' : 'bg-black/40 text-white/60 hover:text-white'}`}>
              {s === 'season' ? 'This Season' : 'All-Time'}
            </button>
          ))}
        </div>
        <select value={division} onChange={(e) => setDivision(e.target.value)}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          {DIVISIONS.map((d) => <option key={d} value={d}>{d === 'all' ? 'All divisions' : d}</option>)}
        </select>
      </div>

      {error && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}
      {loading ? (
        <div className="text-blue-200/60">Loading…</div>
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="text-xl font-black text-white mb-4">Average Leaders</h2>
            {Object.values(boards).every((b) => !b?.length) ? (
              <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">
                No players have reached {leaders?.minGames ?? 25} games yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(STAT_LABELS).map(([key, label]) => (
                  <div key={key} className="rounded-2xl bg-white/[0.02] border border-white/10 p-4">
                    <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-2">{label}</div>
                    {(boards[key] || []).length === 0 ? (
                      <div className="text-xs text-white/40 italic">—</div>
                    ) : (
                      <ol className="space-y-1">
                        {boards[key].map((p) => (
                          <li key={p.discordId} className="flex items-center gap-2 text-sm">
                            <span className="text-white/40 w-4">{p.rank}</span>
                            <Link href={`/players/${encodeURIComponent(p.discordId)}`} className="text-blue-200 hover:text-white truncate flex-1">
                              {p.name}
                            </Link>
                            <span className="font-mono font-bold text-white">{p.value}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xl font-black text-white mb-4">Team Totals</h2>
            {(data?.teamTotals || []).length === 0 ? (
              <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">No team stats yet.</div>
            ) : (
              <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-black/30">
                    <tr className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
                      <th className="px-3 py-2 text-left">Team</th>
                      <th className="px-3 py-2 text-left">Div</th>
                      <th className="px-3 py-2 text-right">GP</th>
                      <th className="px-3 py-2 text-right">Score</th>
                      <th className="px-3 py-2 text-right">Goals</th>
                      <th className="px-3 py-2 text-right">Assists</th>
                      <th className="px-3 py-2 text-right">Saves</th>
                      <th className="px-3 py-2 text-right">Shots</th>
                      <th className="px-3 py-2 text-right">Demos</th>
                      <th className="px-3 py-2 text-right">W-L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teamTotals.map((t) => (
                      <tr key={`${t.team}-${t.division}`} className="border-t border-white/5 hover:bg-white/[0.04]">
                        <td className="px-3 py-2">
                          <Link href={`/teams/${encodeURIComponent(t.team)}`} className="text-white font-medium hover:text-blue-200">{t.team}</Link>
                        </td>
                        <td className="px-3 py-2 text-blue-200/80">{t.division}</td>
                        <td className="px-3 py-2 text-right text-white/70">{t.games_played}</td>
                        <td className="px-3 py-2 text-right text-white/70">{t.score}</td>
                        <td className="px-3 py-2 text-right text-white/70">{t.goals}</td>
                        <td className="px-3 py-2 text-right text-white/70">{t.assists}</td>
                        <td className="px-3 py-2 text-right text-white/70">{t.saves}</td>
                        <td className="px-3 py-2 text-right text-white/70">{t.shots}</td>
                        <td className="px-3 py-2 text-right text-white/70">{t.demos_inflicted}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-white">{t.wins}-{t.losses}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xl font-black text-white mb-4">Franchise Records</h2>
            {(data?.franchises || []).length === 0 ? (
              <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">No franchise records yet.</div>
            ) : (
              <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden max-w-xl">
                <table className="w-full text-sm">
                  <thead className="bg-black/30">
                    <tr className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Franchise</th>
                      <th className="px-3 py-2 text-right">Combined Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.franchises.map((f) => (
                      <tr key={f.franchise} className="border-t border-white/5 hover:bg-white/[0.04]">
                        <td className="px-3 py-2 text-white/40">{f.rank}</td>
                        <td className="px-3 py-2 text-white font-medium">{f.franchise}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-white">{f.record}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
