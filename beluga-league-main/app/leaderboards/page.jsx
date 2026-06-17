'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import TeamLogo from '../components/TeamLogo'

const DIVISIONS = ['all', 'Majors', 'AAA', 'AA']
const DIVISION_LABEL = { all: 'All Divisions', Majors: 'Majors', AAA: 'AAA', AA: 'AA' }

// The board the operator cares about most leads; the rest follow.
const STAT_ORDER = [
  ['beluga_score', 'Beluga Score', '🐳'],
  ['score', 'Avg Score', '⚡'],
  ['goals', 'Avg Goals', '🥅'],
  ['assists', 'Avg Assists', '🅰️'],
  ['saves', 'Avg Saves', '🧤'],
  ['shots', 'Avg Shots', '🎯'],
  ['demos_inflicted', 'Avg Demos', '💥'],
  ['mvps', 'Avg MVPs', '⭐'],
]

const MEDAL = ['🥇', '🥈', '🥉']
const rankColor = (i) =>
  i === 0 ? 'text-yellow-300' : i === 1 ? 'text-slate-200' : i === 2 ? 'text-amber-500' : 'text-white/40'

function StatBoard({ icon, label, rows, highlight }) {
  return (
    <div className={`relative rounded-2xl border p-4 overflow-hidden ${highlight
      ? 'bg-gradient-to-br from-cyan-500/[0.12] to-blue-600/[0.06] border-cyan-400/30'
      : 'bg-white/[0.02] border-white/10'}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{icon}</span>
        <span className={`text-[11px] uppercase tracking-wider font-bold ${highlight ? 'text-cyan-200' : 'text-blue-300/70'}`}>{label}</span>
      </div>
      {(!rows || rows.length === 0) ? (
        <div className="text-xs text-white/40 italic py-2">No qualifiers yet</div>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((p, i) => (
            <li key={p.discordId} className="flex items-center gap-2 text-sm">
              <span className={`w-5 text-center font-bold ${rankColor(i)}`}>{i < 3 ? MEDAL[i] : p.rank}</span>
              <Link href={`/players/${encodeURIComponent(p.discordId)}`} className="text-blue-100/90 hover:text-white truncate flex-1">
                {p.name}
              </Link>
              <span className={`font-mono font-bold ${highlight ? 'text-cyan-200' : 'text-white'}`}>{p.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
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
  const teamTotals = data?.teamTotals || []
  const franchises = data?.franchises || []
  const maxFranchiseGames = Math.max(1, ...franchises.map((f) => (f.wins || 0) + (f.losses || 0)))

  return (
    <main className="relative min-h-screen px-4 py-10 sm:py-12 max-w-6xl mx-auto">
      {/* Hero */}
      <div className="mb-8 text-center sm:text-left">
        <div className="text-[11px] font-bold tracking-[0.3em] uppercase text-cyan-300/70 mb-2">Beluga League</div>
        <h1 className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-300 mb-2">
          Leaderboards
        </h1>
        <p className="text-blue-100/60 text-sm max-w-2xl mx-auto sm:mx-0">
          The league&apos;s top performers — average leaders (min. {leaders?.minGames ?? 25} games),
          team totals, and franchise records, by division.
        </p>
      </div>

      {/* Controls: scope toggle + prominent division tabs */}
      <div className="mb-8 space-y-3">
        <div className="flex justify-center sm:justify-start">
          <div className="inline-flex rounded-xl overflow-hidden border border-white/10 bg-black/30">
            {['season', 'alltime'].map((s) => (
              <button key={s} onClick={() => setScope(s)}
                className={`px-5 py-2 text-sm font-bold transition ${scope === s ? 'bg-blue-500 text-white' : 'text-white/60 hover:text-white'}`}>
                {s === 'season' ? 'This Season' : 'All-Time'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap justify-center sm:justify-start gap-2">
          {DIVISIONS.map((d) => (
            <button key={d} onClick={() => setDivision(d)}
              className={`px-4 py-2 rounded-lg text-sm font-bold border transition ${division === d
                ? 'bg-cyan-500/20 text-cyan-100 border-cyan-400/50 shadow-[0_0_20px_rgba(34,211,238,0.2)]'
                : 'bg-white/[0.03] text-white/60 border-white/10 hover:text-white hover:border-white/25'}`}>
              {DIVISION_LABEL[d]}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}

      {loading ? (
        <div className="text-center py-20 text-blue-200/60">Loading leaderboards…</div>
      ) : (
        <div className="space-y-12">
          {/* Average leaders */}
          <section>
            <h2 className="text-lg font-black text-white mb-4 flex items-center gap-2">
              <span className="w-1.5 h-5 rounded-full bg-cyan-400" /> Average Leaders
            </h2>
            {Object.values(boards).every((b) => !b?.length) ? (
              <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">
                No players have reached {leaders?.minGames ?? 25} games {division === 'all' ? '' : `in ${division} `}yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {STAT_ORDER.map(([key, label, icon]) => (
                  <StatBoard key={key} icon={icon} label={label} rows={boards[key]} highlight={key === 'beluga_score'} />
                ))}
              </div>
            )}
          </section>

          {/* Franchise records — richer panel with logos + win% bars + medals */}
          <section>
            <h2 className="text-lg font-black text-white mb-4 flex items-center gap-2">
              <span className="w-1.5 h-5 rounded-full bg-yellow-400" /> Franchise Records
            </h2>
            {franchises.length === 0 ? (
              <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">No franchise records yet.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {franchises.map((f, i) => {
                  const games = (f.wins || 0) + (f.losses || 0)
                  const pct = games ? Math.round((f.wins / games) * 100) : 0
                  return (
                    <div key={f.franchise} className="flex items-center gap-3 rounded-2xl bg-white/[0.02] border border-white/10 p-3 hover:border-cyan-400/30 transition">
                      <span className={`w-7 text-center text-lg font-black ${rankColor(i)}`}>{i < 3 ? MEDAL[i] : f.rank}</span>
                      <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center">
                        <TeamLogo name={f.franchise} className="w-full h-full" imgClassName="w-full h-full object-contain drop-shadow" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-bold truncate">{f.franchise}</div>
                        <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-black text-white text-lg">{f.record}</div>
                        <div className="text-[10px] text-white/40">{pct}% · {games} GP</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Team totals — with logos */}
          <section>
            <h2 className="text-lg font-black text-white mb-4 flex items-center gap-2">
              <span className="w-1.5 h-5 rounded-full bg-blue-400" /> Team Totals
            </h2>
            {teamTotals.length === 0 ? (
              <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">No team stats yet.</div>
            ) : (
              <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-black/30">
                    <tr className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
                      <th className="px-3 py-2.5 text-left">Team</th>
                      <th className="px-3 py-2.5 text-left">Div</th>
                      <th className="px-3 py-2.5 text-right">GP</th>
                      <th className="px-3 py-2.5 text-right">Goals</th>
                      <th className="px-3 py-2.5 text-right">Assists</th>
                      <th className="px-3 py-2.5 text-right">Saves</th>
                      <th className="px-3 py-2.5 text-right">Shots</th>
                      <th className="px-3 py-2.5 text-right">Demos</th>
                      <th className="px-3 py-2.5 text-right">W-L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamTotals.map((t) => (
                      <tr key={`${t.team}-${t.division}`} className="border-t border-white/5 hover:bg-white/[0.04]">
                        <td className="px-3 py-2">
                          <Link href={`/teams/${encodeURIComponent(t.team)}`} className="flex items-center gap-2 text-white font-medium hover:text-cyan-200">
                            <span className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
                              <TeamLogo name={t.team} className="w-full h-full" imgClassName="w-full h-full object-contain" />
                            </span>
                            <span className="truncate">{t.team}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-blue-200/80">{t.division}</td>
                        <td className="px-3 py-2 text-right text-white/70">{t.games_played}</td>
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
        </div>
      )}
    </main>
  )
}
