"use client"

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'

// ====================================================================
// Config
// ====================================================================

const DIVISIONS = [
  { key: 'aa', label: 'AA' },
  { key: 'aaa', label: 'AAA' },
  { key: 'major', label: 'Majors' },
]

const ALL_TEAMS = [
  '6 Speed', 'Archangels', 'Aviators', 'Clovis Esports', 'Griffins',
  'Immortals', 'InTraCate', 'Kingdom', 'Lotus', 'Malfeasance',
  'MNML', 'Panthers', 'Sublunary', 'Surge',
]

const MAJORS_TEAMS = [
  '6 Speed', 'Archangels', 'Aviators', 'Clovis Esports', 'InTraCate',
  'Lotus', 'Malfeasance', 'Panthers', 'Sublunary', 'Surge',
]

const PLAYOFF_CUTOFF = 8
const TOTAL_GAMES = 16 // 8 weeks × 2 matches per week

// ====================================================================
// Deterministic helpers
// ====================================================================

function hashString(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function seededRand(seed, min, max) {
  const x = Math.sin(seed) * 10000
  const r = x - Math.floor(x)
  return Math.floor(r * (max - min + 1)) + min
}

// ====================================================================
// Fake standings generation
// ====================================================================

function generateStandings(division) {
  const teams = division === 'major' ? MAJORS_TEAMS : ALL_TEAMS
  const results = teams.map((team) => {
    const seed = hashString(`${team}|${division}|s9`)
    const wins = seededRand(seed, 2, TOTAL_GAMES - 1)
    const losses = TOTAL_GAMES - wins
    const goalsFor = seededRand(seed + 1, 35, 90)
    const goalsAgainst = seededRand(seed + 2, 25, 80)
    const gameDiff = wins - losses
    const goalDiff = goalsFor - goalsAgainst
    const winPct = ((wins / TOTAL_GAMES) * 100).toFixed(1)

    return {
      team,
      wins,
      losses,
      winPct: parseFloat(winPct),
      goalsFor,
      goalsAgainst,
      gameDiff,
      goalDiff,
    }
  })

  // Sort: wins → goalDiff → goalsFor
  results.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff
    return b.goalsFor - a.goalsFor
  })

  results.forEach((t, i) => {
    t.position = i + 1
  })
  return results
}

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
    return {
      background: 'linear-gradient(135deg, #fde047, #ca8a04)',
      color: '#422006',
      boxShadow: '0 0 20px rgba(250, 204, 21, 0.4)',
      border: '1px solid rgba(250, 204, 21, 0.7)',
    }
  }
  if (rank === 2) {
    return {
      background: 'linear-gradient(135deg, #e2e8f0, #94a3b8)',
      color: '#1e293b',
      boxShadow: '0 0 15px rgba(148, 163, 184, 0.3)',
      border: '1px solid rgba(226, 232, 240, 0.6)',
    }
  }
  if (rank === 3) {
    return {
      background: 'linear-gradient(135deg, #fb923c, #9a3412)',
      color: '#431407',
      boxShadow: '0 0 15px rgba(251, 146, 60, 0.3)',
      border: '1px solid rgba(251, 146, 60, 0.6)',
    }
  }
  return {
    background: 'rgba(59, 130, 246, 0.15)',
    color: '#93c5fd',
    border: '1px solid rgba(96, 165, 250, 0.3)',
  }
}

// ====================================================================
// Main page
// ====================================================================

export default function StandingsPage() {
  const [division, setDivision] = useState('major')
  const [query, setQuery] = useState('')
  const [sortField, setSortField] = useState('position')
  const [sortDir, setSortDir] = useState('asc')
  const [apiData, setApiData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const divKey = division === 'major' ? 'majors' : division
    setLoading(true)
    fetch(`/api/standings?division=${divKey}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setApiData(d))
      .catch(() => setApiData({ data: [] }))
      .finally(() => setLoading(false))
  }, [division])

  const rawStandings = useMemo(() => {
    if (!apiData || !Array.isArray(apiData.data)) return []
    return apiData.data.map((row, i) => {
      const wins = Number(row.wins || 0)
      const losses = Number(row.losses || 0)
      const goalsFor = Number(row.goalsFor || row.goals_for || 0)
      const goalsAgainst = Number(row.goalsAgainst || row.goals_against || 0)
      const totalGames = wins + losses || 1
      return {
        team: row.team,
        wins,
        losses,
        winPct: parseFloat(((wins / totalGames) * 100).toFixed(1)),
        goalsFor,
        goalsAgainst,
        gameDiff: wins - losses,
        goalDiff: goalsFor - goalsAgainst,
        position: row.rank || i + 1,
      }
    })
  }, [apiData])

  const sortedStandings = useMemo(() => {
    let list = rawStandings
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter((t) => t.team.toLowerCase().includes(q))
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'position':
          cmp = a.position - b.position
          break
        case 'team':
          cmp = a.team.localeCompare(b.team)
          break
        case 'wins':
          cmp = a.wins - b.wins
          break
        case 'losses':
          cmp = a.losses - b.losses
          break
        case 'winPct':
          cmp = a.winPct - b.winPct
          break
        case 'gameDiff':
          cmp = a.gameDiff - b.gameDiff
          break
        case 'goalDiff':
          cmp = a.goalDiff - b.goalDiff
          break
        default:
          cmp = a.position - b.position
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [rawStandings, query, sortField, sortDir])

  function toggleSort(field) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      // "position" and "losses" sort ascending first, others descending
      setSortDir(field === 'position' || field === 'losses' ? 'asc' : 'desc')
    }
  }

  const divisionLabel = DIVISIONS.find((d) => d.key === division)?.label || division
  const totalTeams = division === 'major' ? MAJORS_TEAMS.length : ALL_TEAMS.length

  return (
    <div className="relative text-white overflow-hidden">
      {/* ============ HERO ============ */}
      <section className="container mx-auto px-4 pt-16 pb-10">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 backdrop-blur-sm mb-6">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-xs text-blue-200 font-medium tracking-[0.2em] uppercase">
                Season 9 · Standings
              </span>
            </div>
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight mb-4 leading-[0.95]">
              <span className="block text-white">League</span>
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-200 via-blue-300 to-blue-500 drop-shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                Standings
              </span>
            </h1>
            <p className="text-base md:text-lg text-blue-100/70 max-w-xl mx-auto">
              Live team standings across all three divisions. Top {PLAYOFF_CUTOFF} teams qualify for playoffs.
            </p>
          </div>
        </FadeIn>
      </section>

      {/* ============ CONTROLS ============ */}
      <section className="container mx-auto px-4 mb-8 max-w-5xl">
        <FadeIn delay={0.1}>
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Division tabs */}
            <div className="flex gap-2 flex-wrap">
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

            {/* Search */}
            <div className="relative w-full md:w-64">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-300/60"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
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

      {/* ============ STANDINGS TABLE ============ */}
      <section className="container mx-auto px-4 pb-24 max-w-5xl">
        <FadeIn delay={0.15}>
          {/* Division summary header */}
          <div className="mb-4 flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">
              {divisionLabel} Division
            </span>
            <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
            <span className="text-[10px] font-bold text-blue-300/60">
              {sortedStandings.length} / {totalTeams} {totalTeams === 1 ? 'team' : 'teams'}
            </span>
          </div>

          {/* Table */}
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
            {/* Column headers */}
            <div className="hidden md:grid grid-cols-[60px_1fr_80px_70px_70px_90px_100px_100px] gap-3 px-5 py-3 border-b border-white/10 bg-black/30 text-[10px] font-bold tracking-wider uppercase text-blue-300/60">
              <ColumnHeader label="Pos" field="position" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
              <ColumnHeader label="Team" field="team" sortField={sortField} sortDir={sortDir} onClick={toggleSort} alignLeft />
              <ColumnHeader label="W" field="wins" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
              <ColumnHeader label="L" field="losses" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
              <ColumnHeader label="PCT" field="winPct" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
              <ColumnHeader label="Game Diff" field="gameDiff" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
              <ColumnHeader label="Goal Diff" field="goalDiff" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
              <div className="text-right">Goals F/A</div>
            </div>

            {sortedStandings.length === 0 ? (
              <div className="py-16 text-center text-sm text-white/40">No teams match your search.</div>
            ) : (
              sortedStandings.map((team, idx) => {
                // Show the playoff cutoff divider after the last playoff team
                const showPlayoffCutoff =
                  sortField === 'position' &&
                  sortDir === 'asc' &&
                  team.position === PLAYOFF_CUTOFF &&
                  idx < sortedStandings.length - 1
                return (
                  <div key={team.team}>
                    <StandingRow team={team} />
                    {showPlayoffCutoff && (
                      <div className="relative flex items-center gap-3 px-5 py-2 bg-blue-500/[0.04] border-y border-blue-400/20">
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
            <div className="flex items-center gap-2">
              <div style={{ ...rankBadgeStyle(1), width: 16, height: 16, borderRadius: 9999 }} />
              <span>1st Place</span>
            </div>
            <div className="flex items-center gap-2">
              <div style={{ ...rankBadgeStyle(2), width: 16, height: 16, borderRadius: 9999 }} />
              <span>2nd</span>
            </div>
            <div className="flex items-center gap-2">
              <div style={{ ...rankBadgeStyle(3), width: 16, height: 16, borderRadius: 9999 }} />
              <span>3rd</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-blue-500/15 border border-blue-400/30" />
              <span>Playoff Contender</span>
            </div>
          </div>

          <div className="mt-6 text-center text-[10px] text-white/30 tracking-wider">
            Standings shown are placeholder data for design purposes.
          </div>
        </FadeIn>
      </section>
    </div>
  )
}

// ====================================================================
// Sub-components
// ====================================================================

function ColumnHeader({ label, field, sortField, sortDir, onClick, alignLeft = false }) {
  const active = sortField === field
  return (
    <button
      onClick={() => onClick(field)}
      className={`flex items-center gap-1 ${alignLeft ? 'justify-start' : 'justify-end text-right'} cursor-pointer transition-colors hover:text-blue-200 ${
        active ? 'text-blue-200' : ''
      }`}
    >
      <span>{label}</span>
      {active && (
        <span className="text-[8px] leading-none">
          {sortDir === 'asc' ? '▲' : '▼'}
        </span>
      )}
    </button>
  )
}

function StandingRow({ team }) {
  const isPlayoff = team.position <= PLAYOFF_CUTOFF
  return (
    <div
      className={`grid grid-cols-[48px_1fr_40px_40px_54px_70px] md:grid-cols-[60px_1fr_80px_70px_70px_90px_100px_100px] gap-3 px-5 py-4 items-center border-b border-white/5 last:border-b-0 transition-colors ${
        isPlayoff ? 'hover:bg-blue-500/[0.05]' : 'hover:bg-white/[0.02] opacity-70'
      }`}
    >
      {/* Position badge */}
      <div
        style={{
          ...rankBadgeStyle(team.position),
          width: '38px',
          height: '38px',
          borderRadius: '9999px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 900,
          fontSize: '14px',
          flexShrink: 0,
        }}
      >
        {team.position}
      </div>

      {/* Team name + logo */}
      <Link
        href={`/teams/${encodeURIComponent(team.team)}`}
        className="group flex items-center gap-3 min-w-0"
      >
        <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center">
          <img
            src={`/logos/${team.team}.png`}
            alt={team.team}
            className="w-full h-full object-contain drop-shadow-[0_0_10px_rgba(59,130,246,0.2)]"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        </div>
        <span className="text-sm font-bold text-white group-hover:text-blue-200 transition-colors truncate">
          {team.team}
        </span>
      </Link>

      {/* Wins */}
      <div className="text-right text-sm font-black text-white tabular-nums">{team.wins}</div>

      {/* Losses */}
      <div className="text-right text-sm font-black text-white/60 tabular-nums">{team.losses}</div>

      {/* Win % */}
      <div className="text-right text-sm font-bold text-blue-200 tabular-nums">
        {team.winPct.toFixed(1)}%
      </div>

      {/* Game differential (hidden on mobile) */}
      <div className="hidden md:block text-right text-sm font-bold tabular-nums">
        <span className={team.gameDiff >= 0 ? 'text-blue-300' : 'text-white/50'}>
          {team.gameDiff >= 0 ? `+${team.gameDiff}` : team.gameDiff}
        </span>
      </div>

      {/* Goal differential */}
      <div className="text-right text-sm font-bold tabular-nums">
        <span className={team.goalDiff >= 0 ? 'text-blue-300' : 'text-white/50'}>
          {team.goalDiff >= 0 ? `+${team.goalDiff}` : team.goalDiff}
        </span>
      </div>

      {/* Goals F/A (hidden on mobile) */}
      <div className="hidden md:block text-right text-xs text-white/50 tabular-nums">
        {team.goalsFor} / {team.goalsAgainst}
      </div>
    </div>
  )
}
