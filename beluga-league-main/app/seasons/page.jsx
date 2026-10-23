'use client'

// Public "Seasons" archive / Hall of Fame. Lists every season (newest first) with
// its champion per division, and links to browse that season's standings, teams and
// leaderboards through the site-wide ?season= viewer. Past seasons live forever here.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import TeamLogo from '../components/TeamLogo'
import { useSeason } from '../components/SeasonContext'

const DIV_LABEL = { Majors: 'Majors', AAA: 'AAA', AA: 'AA' }
const DIV_ACCENT = {
  Majors: 'from-yellow-400/20 to-amber-600/5 border-yellow-400/30 text-yellow-200',
  AAA: 'from-cyan-400/20 to-blue-600/5 border-cyan-400/30 text-cyan-200',
  AA: 'from-purple-400/20 to-fuchsia-600/5 border-purple-400/30 text-purple-200',
}

export default function SeasonsPage() {
  const { setSeason } = useSeason()
  const [seasons, setSeasons] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/public/champions', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setSeasons(Array.isArray(d.seasons) ? d.seasons : []))
      .catch(() => setSeasons([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="relative text-white overflow-hidden">
      <section className="container mx-auto px-4 pt-16 pb-10">
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 backdrop-blur-sm mb-6">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-xs text-blue-200 font-medium tracking-[0.2em] uppercase">Beluga League · Archive</span>
          </div>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight mb-4 leading-[0.95]">
            <span className="block text-white">Seasons</span>
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-amber-300 to-yellow-500 drop-shadow-[0_0_30px_rgba(250,204,21,0.25)]">
              Hall of Fame
            </span>
          </h1>
          <p className="text-base md:text-lg text-blue-100/70 max-w-xl mx-auto">
            Every season, preserved forever — champions by division, with a link to browse each season&apos;s standings, teams and leaders.
          </p>
        </div>
      </section>

      <section className="container mx-auto px-4 pb-24 max-w-4xl">
        {loading ? (
          <div className="py-20 text-center text-sm text-blue-200/60">Loading seasons…</div>
        ) : seasons.length === 0 ? (
          <div className="py-16 text-center text-sm text-white/40">No seasons recorded yet.</div>
        ) : (
          <div className="space-y-6">
            {seasons.map((s) => (
              <div key={s.seasonId} className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/10 bg-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-black text-white">Season {s.seasonNumber}</span>
                    {s.isActive && (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-green-500/15 text-green-300 border border-green-400/30">Current</span>
                    )}
                    {s.name && <span className="text-sm text-blue-100/50">{s.name}</span>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SeasonLink label="Standings" href="/standings" seasonNumber={s.seasonNumber} isActive={s.isActive} setSeason={setSeason} />
                    <SeasonLink label="Leaderboards" href="/leaderboards" seasonNumber={s.seasonNumber} isActive={s.isActive} setSeason={setSeason} />
                    <SeasonLink label="Power Rankings" href="/power-rankings" seasonNumber={s.seasonNumber} isActive={s.isActive} setSeason={setSeason} />
                    {/* A past season's bracket stays readable whether or not the
                        live Playoffs tab is switched on — it is league history. */}
                    <SeasonLink label="Bracket" href="/playoffs" seasonNumber={s.seasonNumber} isActive={s.isActive} setSeason={setSeason} />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-5">
                  {s.champions.map((c) => (
                    <div key={c.division} className={`rounded-xl bg-gradient-to-br border p-4 ${DIV_ACCENT[c.division] || 'from-white/5 to-transparent border-white/10'}`}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-sm">🏆</span>
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-90">{DIV_LABEL[c.division] || c.division}</span>
                      </div>
                      {c.teamName ? (
                        <Link href={`/teams/${encodeURIComponent(c.teamName)}`} className="flex items-center gap-2 group">
                          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center">
                            <TeamLogo name={c.teamName} teamId={c.teamId} className="w-full h-full" imgClassName="w-full h-full object-contain" />
                          </div>
                          <span className="text-sm font-bold text-white group-hover:text-blue-200 truncate">{c.teamName}</span>
                        </Link>
                      ) : (
                        <div className="text-sm text-white/30 italic">Not decided</div>
                      )}
                      {c.gmDisplayName && <div className="mt-1 text-[11px] text-white/40">GM: {c.gmDisplayName}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// A pill that sets the site-wide season selection, then navigates to the target page
// (which reads the selection from context). For the active season it clears the param.
function SeasonLink({ label, href, seasonNumber, isActive, setSeason }) {
  const target = isActive ? href : `${href}?season=${seasonNumber}`
  return (
    <Link
      href={target}
      onClick={() => setSeason(isActive ? '' : String(seasonNumber))}
      className="px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-white/5 hover:bg-blue-500/20 border border-white/15 hover:border-blue-400/50 text-white/70 hover:text-blue-100 transition"
    >
      {label} →
    </Link>
  )
}
