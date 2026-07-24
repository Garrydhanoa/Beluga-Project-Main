"use client"

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import TeamLogo from '../components/TeamLogo'
import SeasonPicker from '../components/SeasonPicker'
import { useSeason, seasonQuerySuffix } from '../components/SeasonContext'

// ====================================================================
// Config — divisions only. ALL standings data is live from /api/standings
// (the Ballchasing-based stats system). No placeholder data.
// ====================================================================

const DIVISIONS = [
  { key: 'majors', label: 'Majors' },
  { key: 'aaa', label: 'AAA' },
  { key: 'aa', label: 'AA' },
]

const PLAYOFF_CUTOFF = 8 // top N qualify for playoffs

// ====================================================================
// Shared
// ====================================================================

function FadeIn({ children, delay = 0, y = 20, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

function rankBadgeStyle(rank) {
  if (rank === 1) {
    return { background: 'linear-gradient(135deg, #fde047, #ca8a04)', color: '#422006', boxShadow: '0 0 20px rgba(250, 204, 21, 0.45)', border: '1px solid rgba(250, 204, 21, 0.7)' }
  }
  if (rank === 2) {
    return { background: 'linear-gradient(135deg, #e2e8f0, #94a3b8)', color: '#1e293b', boxShadow: '0 0 15px rgba(148, 163, 184, 0.35)', border: '1px solid rgba(226, 232, 240, 0.6)' }
  }
  if (rank === 3) {
    return { background: 'linear-gradient(135deg, #fb923c, #9a3412)', color: '#431407', boxShadow: '0 0 15px rgba(251, 146, 60, 0.35)', border: '1px solid rgba(251, 146, 60, 0.6)' }
  }
  return { background: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd', border: '1px solid rgba(96, 165, 250, 0.3)' }
}

function TrendChip({ trend }) {
  if (trend === 'up') return <span className="text-[11px] font-extrabold text-green-400" title="Up vs last power ranking">▲</span>
  if (trend === 'down') return <span className="text-[11px] font-extrabold text-red-400" title="Down vs last power ranking">▼</span>
  if (trend === 'new') return <span className="text-[10px] font-extrabold text-yellow-300" title="New">★</span>
  return null
}

// ====================================================================
// Main page
// ====================================================================

export default function StandingsPage() {
  const { season } = useSeason()
  const [division, setDivision] = useState('majors')
  const [query, setQuery] = useState('')
  const [apiData, setApiData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [trendByTeam, setTrendByTeam] = useState({})
  const [expanded, setExpanded] = useState(null)

  // Standings (live) — follows the site-wide season selection (archive viewer).
  useEffect(() => {
    setLoading(true)
    setExpanded(null)
    fetch(`/api/standings?division=${division}${seasonQuerySuffix(season)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setApiData(d))
      .catch(() => setApiData({ data: [] }))
      .finally(() => setLoading(false))
  }, [division, season])

  // Power-rankings trend (▲▼ movement) — best-effort; standings still render without it.
  useEffect(() => {
    const divKey = division === 'majors' ? 'Majors' : division === 'aaa' ? 'AAA' : 'AA'
    fetch(`/api/power-rankings?${season ? `season=${encodeURIComponent(season)}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const teams = d?.rankings?.team?.[divKey] || []
        const map = {}
        for (const t of teams) if (t?.name) map[t.name] = t.trend
        setTrendByTeam(map)
      })
      .catch(() => setTrendByTeam({}))
  }, [division, season])

  const standings = useMemo(() => {
    if (!apiData || !Array.isArray(apiData.data)) return []
    return apiData.data.map((row, i) => {
      const wins = Number(row.wins || 0)
      const losses = Number(row.losses || 0)
      const goalsFor = Number(row.goalsFor ?? row.goals_for ?? 0)
      const goalsAgainst = Number(row.goalsAgainst ?? row.goals_against ?? 0)
      const totalGames = wins + losses || 1
      return {
        team: row.team,
        teamId: row.teamId ?? null,
        wins,
        losses,
        winPct: Math.round((wins / totalGames) * 1000) / 10,
        goalsFor,
        goalsAgainst,
        gameDiff: Number(row.gameDiff ?? (wins - losses)),
        goalDiff: Number(row.goalDiff ?? (goalsFor - goalsAgainst)),
        rating: Number(row.rating || 0),
        position: row.rank || i + 1,
      }
    })
  }, [apiData])

  const visible = useMemo(() => {
    if (!query.trim()) return standings
    const q = query.toLowerCase()
    return standings.filter((t) => (t.team || '').toLowerCase().includes(q))
  }, [standings, query])

  const divisionLabel = DIVISIONS.find((d) => d.key === division)?.label || division
  const isStatsBacked = apiData?.source === 'stats'

  return (
    <div className="relative text-white overflow-hidden">
      {/* ============ HERO ============ */}
      <section className="container mx-auto px-4 pt-16 pb-10">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 backdrop-blur-sm mb-6">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-xs text-blue-200 font-medium tracking-[0.2em] uppercase">
                {apiData?.season?.season_number ? `Season ${apiData.season.season_number} · Standings` : 'Standings'}
              </span>
            </div>
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight mb-4 leading-[0.95]">
              <span className="block text-white">League</span>
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-200 via-blue-300 to-blue-500 drop-shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                Standings
              </span>
            </h1>
            <p className="text-base md:text-lg text-blue-100/70 max-w-xl mx-auto">
              Live team standings across all three divisions. Top {PLAYOFF_CUTOFF} teams qualify for playoffs — tap a team to expand its tiebreakers.
            </p>
          </div>
        </FadeIn>
      </section>

      {/* ============ CONTROLS ============ */}
      <section className="container mx-auto px-4 mb-8 max-w-5xl">
        <FadeIn delay={0.1}>
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex gap-2 flex-wrap items-center">
              <SeasonPicker />
              {DIVISIONS.map((d) => {
                const active = division === d.key
                return (
                  <button
                    key={d.key}
                    onClick={() => setDivision(d.key)}
                    className={`px-6 py-2.5 rounded-full font-bold text-sm transition-all ${
                      active
                        ? 'bg-blue-500 text-white shadow-[0_0_30px_rgba(59,130,246,0.5)] scale-105'
                        : 'bg-white/5 hover:bg-white/10 border border-white/15 hover:border-blue-400/50 text-white/70 hover:text-blue-200'
                    }`}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>

            <div className="relative w-full md:w-64">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-300/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search team..."
                className="w-full pl-10 pr-4 py-2.5 bg-black/40 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-sm focus:outline-none transition"
              />
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ============ STANDINGS ============ */}
      <section className="container mx-auto px-4 pb-24 max-w-5xl">
        <FadeIn delay={0.15}>
          <div className="mb-4 flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">
              {divisionLabel} Division
            </span>
            <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
            <span className="text-[10px] font-bold text-blue-300/60">
              {visible.length} {visible.length === 1 ? 'team' : 'teams'}
            </span>
          </div>

          {/* Header strip (desktop) */}
          <div className="hidden md:grid grid-cols-[64px_1fr_64px_120px_70px] gap-3 px-5 pb-2 text-[10px] font-bold tracking-wider uppercase text-blue-300/50">
            <div>Rank</div>
            <div>Team</div>
            <div className="text-center">Record</div>
            <div className="text-center">Win %</div>
            <div className="text-right">More</div>
          </div>

          <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
            {loading ? (
              <div className="py-20 text-center text-sm text-blue-200/60">Loading standings…</div>
            ) : visible.length === 0 ? (
              <div className="py-16 text-center text-sm text-white/40">
                {query.trim() ? 'No teams match your search.' : `No results recorded yet for ${divisionLabel} — standings appear after the first reported series.`}
              </div>
            ) : (
              visible.map((team, idx) => {
                const showPlayoffCutoff =
                  !query.trim() &&
                  team.position === PLAYOFF_CUTOFF &&
                  idx < visible.length - 1
                return (
                  <div key={team.team}>
                    <StandingRow
                      team={team}
                      trend={trendByTeam[team.team]}
                      open={expanded === team.team}
                      onToggle={() => setExpanded(expanded === team.team ? null : team.team)}
                    />
                    {showPlayoffCutoff && (
                      <div className="relative flex items-center gap-3 px-5 py-2 bg-blue-500/[0.05] border-y border-blue-400/20">
                        <div className="flex-1 h-px bg-gradient-to-r from-blue-400/40 to-transparent" />
                        <span className="text-[9px] font-black tracking-[0.3em] uppercase text-blue-300/70">
                          Playoff Cutoff
                        </span>
                        <div className="flex-1 h-px bg-gradient-to-l from-blue-400/40 to-transparent" />
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Legend */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[10px] text-white/50 tracking-wider">
            <div className="flex items-center gap-2"><div style={{ ...rankBadgeStyle(1), width: 16, height: 16, borderRadius: 9999 }} /><span>1st</span></div>
            <div className="flex items-center gap-2"><div style={{ ...rankBadgeStyle(2), width: 16, height: 16, borderRadius: 9999 }} /><span>2nd</span></div>
            <div className="flex items-center gap-2"><div style={{ ...rankBadgeStyle(3), width: 16, height: 16, borderRadius: 9999 }} /><span>3rd</span></div>
            <div className="flex items-center gap-2"><span className="text-green-400 font-extrabold">▲</span><span className="text-red-400 font-extrabold">▼</span><span>Power-ranking trend</span></div>
          </div>

          <div className="mt-4 text-center text-[10px] text-white/30 tracking-wider">
            Tiebreakers: Wins → Losses → Head-to-Head → Game Diff → Goal Diff → Rating
            {isStatsBacked ? '' : ' · legacy data'}
          </div>
        </FadeIn>
      </section>
    </div>
  )
}

// ====================================================================
// Sub-components
// ====================================================================

function StandingRow({ team, trend, open, onToggle }) {
  const isPlayoff = team.position <= PLAYOFF_CUTOFF
  const diffColor = (n) => (n > 0 ? 'text-green-300' : n < 0 ? 'text-red-300' : 'text-white/60')
  const fmt = (n) => (n > 0 ? `+${n}` : `${n}`)

  return (
    <div className={`border-b border-white/5 last:border-b-0 transition-colors ${isPlayoff ? '' : 'opacity-70'}`}>
      <button
        onClick={onToggle}
        className={`w-full grid grid-cols-[48px_1fr_auto_28px] md:grid-cols-[64px_1fr_64px_120px_70px] gap-3 px-5 py-4 items-center text-left ${
          isPlayoff ? 'hover:bg-blue-500/[0.06]' : 'hover:bg-white/[0.03]'
        }`}
      >
        {/* Rank badge */}
        <div
          style={{ ...rankBadgeStyle(team.position), width: 38, height: 38, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14, flexShrink: 0 }}
        >
          {team.position}
        </div>

        {/* Team name + logo + trend */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center">
            <TeamLogo
              name={team.team}
              teamId={team.teamId}
              className="w-full h-full"
              imgClassName="w-full h-full object-contain drop-shadow-[0_0_10px_rgba(59,130,246,0.2)]"
            />
          </div>
          <span className="text-sm font-bold text-white truncate">{team.team}</span>
          <TrendChip trend={trend} />
        </div>

        {/* Record (W-L) */}
        <div className="text-center md:text-center tabular-nums">
          <span className="text-sm font-black text-white">{team.wins}</span>
          <span className="text-white/30 mx-0.5">-</span>
          <span className="text-sm font-black text-white/60">{team.losses}</span>
        </div>

        {/* Win % (desktop) */}
        <div className="hidden md:block text-center text-sm font-bold text-blue-200 tabular-nums">
          {team.winPct.toFixed(1)}%
        </div>

        {/* Expand chevron */}
        <div className="text-right text-blue-300/60">
          <svg className={`w-4 h-4 inline transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-1">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Stat label="Win %" value={`${team.winPct.toFixed(1)}%`} accent="text-blue-200" />
                <Stat label="Game Diff" value={fmt(team.gameDiff)} accent={diffColor(team.gameDiff)} />
                <Stat label="Goal Diff" value={fmt(team.goalDiff)} accent={diffColor(team.goalDiff)} />
                <Stat label="Goals F / A" value={`${team.goalsFor} / ${team.goalsAgainst}`} accent="text-white/80" />
                <Stat label="Team Rating" value={team.rating ? team.rating.toFixed(1) : '—'} accent="text-purple-200" />
              </div>
              <div className="mt-3 text-right">
                <Link href={`/teams/${encodeURIComponent(team.team)}`} className="text-[11px] font-bold uppercase tracking-wider text-blue-300 hover:text-white transition">
                  View team page →
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div className="rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-center">
      <div className="text-[9px] font-bold tracking-wider uppercase text-white/40 mb-0.5">{label}</div>
      <div className={`text-sm font-black tabular-nums ${accent}`}>{value}</div>
    </div>
  )
}
