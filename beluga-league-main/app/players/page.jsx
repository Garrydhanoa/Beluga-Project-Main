"use client"

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import Avatar from '../components/Avatar'
// Team list and division labels are derived from API data at runtime.

const DIVISION_OPTIONS = [
  { key: 'all', label: 'All Divisions' },
  { key: 'major', label: 'Majors' },
  { key: 'aaa', label: 'AAA' },
  { key: 'aa', label: 'AA' },
]

const SORT_OPTIONS = [
  { key: 'salary', label: 'Salary' },
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'saves', label: 'Saves' },
  { key: 'mvps', label: 'MVPs' },
  { key: 'displayName', label: 'Name' },
]

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

function adaptApiPlayer(p) {
  const divKey = (() => {
    const d = String(p.currentDivision || p.division || '').toLowerCase()
    if (d.includes('major')) return 'major'
    if (d.includes('aaa')) return 'aaa'
    if (d.includes('aa')) return 'aa'
    return 'aa'
  })()
  const displayName = p.displayName || (p.discordId ? `User ${String(p.discordId).slice(-4)}` : 'Unknown')
  return {
    // username is ONLY the real Discord username — never the raw ID. Used for the
    // "@handle" line, which is hidden entirely when there's no real username.
    username: p.discordUsername || null,
    displayName,
    discordId: p.discordId,
    avatarUrl: p.avatarUrl || null,
    team: p.currentTeam || 'Free Agent',
    division: divKey,
    divisionLabel: divKey === 'major' ? 'Majors' : divKey.toUpperCase(),
    isCaptain: p.role === 'captain',
    isFreeAgent: !!p.isFreeAgent,
    role: p.role || null,
    rank: 0,
    goals: 0, assists: 0, saves: 0, mvps: 0,
    salary: Number(p.salary) || 0,
    eligible: p.eligible,
    achievements: [],
  }
}

export default function PlayersDirectoryPage() {
  const [apiPlayers, setApiPlayers] = useState(null)
  const [season, setSeason] = useState(null)
  useEffect(() => {
    fetch('/api/players', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.season) setSeason(d.season)
        if (Array.isArray(d.players)) setApiPlayers(d.players.map(adaptApiPlayer))
        else setApiPlayers([])
      })
      .catch(() => setApiPlayers([]))
  }, [])
  const allPlayers = apiPlayers || []
  const TEAMS = useMemo(() => {
    const set = new Set()
    for (const p of allPlayers) if (p.team && p.team !== 'Free Agent') set.add(p.team)
    return Array.from(set).sort()
  }, [allPlayers])

  const [query, setQuery] = useState('')
  const [division, setDivision] = useState('all')
  const [team, setTeam] = useState('all')
  const [freeAgentsOnly, setFreeAgentsOnly] = useState(false)
  const [sortBy, setSortBy] = useState('salary')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)
  const pageSize = 24

  const filtered = useMemo(() => {
    let list = allPlayers
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(
        (p) =>
          (p.displayName || '').toLowerCase().includes(q) ||
          (p.username || '').toLowerCase().includes(q) ||
          (p.team || '').toLowerCase().includes(q)
      )
    }
    if (division !== 'all') list = list.filter((p) => p.division === division)
    if (team !== 'all') list = list.filter((p) => p.team === team)
    if (freeAgentsOnly) list = list.filter((p) => p.isFreeAgent)

    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'displayName') cmp = a.displayName.localeCompare(b.displayName)
      else cmp = (a[sortBy] || 0) - (b[sortBy] || 0)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [allPlayers, query, division, team, freeAgentsOnly, sortBy, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pageItems = filtered.slice(pageStart, pageStart + pageSize)

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1)
  }, [query, division, team, freeAgentsOnly, sortBy, sortDir])

  return (
    <div className="relative text-white overflow-hidden">
      {/* ============ HERO ============ */}
      <section className="container mx-auto px-4 pt-16 pb-10">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 backdrop-blur-sm mb-6">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-xs text-blue-200 font-medium tracking-[0.2em] uppercase">
                {season?.season_number ? `Season ${season.season_number} · ` : ''}Directory
              </span>
            </div>
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight mb-4 leading-[0.95]">
              <span className="block text-white">Player</span>
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-200 via-blue-300 to-blue-500 drop-shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                Directory
              </span>
            </h1>
            <p className="text-base md:text-lg text-blue-100/70 max-w-xl mx-auto">
              {allPlayers.length} players{TEAMS.length ? ` across ${TEAMS.length} teams` : ''} and 3 divisions. Click any player to see their profile.
            </p>
          </div>
        </FadeIn>
      </section>

      {/* ============ FILTERS ============ */}
      <section className="container mx-auto px-4 mb-8">
        <FadeIn delay={0.1}>
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
            {/* Search */}
            <div className="relative mb-4">
              <svg
                className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-300/60"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by player or team..."
                className="w-full pl-11 pr-4 py-3 bg-black/40 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-sm focus:outline-none transition"
              />
            </div>

            {/* Selects */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] font-bold tracking-wider uppercase text-blue-300/70 mb-1.5">
                  Division
                </label>
                <select
                  value={division}
                  onChange={(e) => setDivision(e.target.value)}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-400/60"
                >
                  {DIVISION_OPTIONS.map((d) => (
                    <option key={d.key} value={d.key}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold tracking-wider uppercase text-blue-300/70 mb-1.5">
                  Team
                </label>
                <select
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-400/60"
                >
                  <option value="all">All Teams</option>
                  {TEAMS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold tracking-wider uppercase text-blue-300/70 mb-1.5">
                  Sort By
                </label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-400/60"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold tracking-wider uppercase text-blue-300/70 mb-1.5">
                  Order
                </label>
                <select
                  value={sortDir}
                  onChange={(e) => setSortDir(e.target.value)}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-400/60"
                >
                  <option value="desc">Highest First</option>
                  <option value="asc">Lowest First</option>
                </select>
              </div>
            </div>

            {/* Toggle */}
            <div className="mt-4 flex items-center justify-between">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={freeAgentsOnly}
                  onChange={(e) => setFreeAgentsOnly(e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-500"
                />
                <span className="text-sm text-blue-200/80">Free agents only</span>
              </label>
              <div className="text-sm text-blue-200/60">
                <span className="font-bold text-blue-200">{filtered.length}</span> {filtered.length === 1 ? 'player' : 'players'}
              </div>
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ============ PLAYERS GRID ============ */}
      <section className="container mx-auto px-4 pb-16">
        {pageItems.length === 0 ? (
          <div className="text-center py-20 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
            No players match the current filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {pageItems.map((player, i) => (
              <FadeIn key={player.discordId || player.username} delay={(i % 8) * 0.03}>
                <PlayerCard player={player} />
              </FadeIn>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-10 flex items-center justify-center gap-2 flex-wrap">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 hover:border-blue-400/50 text-white/80 text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              ← Prev
            </button>
            <div className="flex gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(
                  (p) =>
                    p === 1 ||
                    p === totalPages ||
                    Math.abs(p - currentPage) <= 1
                )
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && arr[idx - 1] < p - 1) acc.push('...')
                  acc.push(p)
                  return acc
                }, [])
                .map((p, i) =>
                  p === '...' ? (
                    <span key={`ellipsis-${i}`} className="px-2 py-2 text-white/40">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-10 h-10 rounded-lg text-sm font-bold transition ${
                        currentPage === p
                          ? 'bg-blue-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.5)]'
                          : 'bg-white/5 hover:bg-white/10 border border-white/15 text-white/70'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
            </div>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 hover:border-blue-400/50 text-white/80 text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              Next →
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

// ====================================================================
// Player card
// ====================================================================

function PlayerCard({ player }) {
  const hasTeam = !!player.team
  return (
    <Link
      href={`/players/${encodeURIComponent(player.discordId || player.username)}`}
      className="group relative block h-full p-5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-blue-400/50 hover:bg-blue-500/5 hover:-translate-y-1 hover:shadow-[0_10px_30px_rgba(59,130,246,0.2)] transition-all overflow-hidden"
    >
      {/* Ghost team logo in background */}
      {hasTeam && (
        <div
          className="absolute -top-8 -right-8 w-32 h-32 opacity-[0.06] group-hover:opacity-[0.15] transition-opacity pointer-events-none"
          aria-hidden="true"
        >
          <img
            src={`/logos/${player.team}.png`}
            alt=""
            className="w-full h-full object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        </div>
      )}

      {/* Top: role + rank */}
      <div className="relative flex items-center justify-between mb-4">
        {player.role ? (
          <span
            className={`text-[9px] font-bold tracking-[0.2em] uppercase px-2.5 py-1 rounded-full border ${
              player.isCaptain
                ? 'bg-blue-500/20 border-blue-400/50 text-blue-100'
                : player.isFreeAgent
                  ? 'bg-white/5 border-white/20 text-white/60'
                  : player.role === 'Sub'
                    ? 'bg-white/5 border-white/20 text-white/60'
                    : 'bg-blue-500/10 border-blue-400/30 text-blue-200'
            }`}
          >
            {player.role}
          </span>
        ) : (
          <span className="text-[9px] font-bold tracking-[0.2em] uppercase px-2.5 py-1 rounded-full border bg-white/5 border-white/20 text-white/50">
            {player.isFreeAgent ? 'Free Agent' : 'Player'}
          </span>
        )}
      </div>

      {/* Avatar + Name */}
      <div className="relative flex items-center gap-3">
        <Avatar src={player.avatarUrl} name={player.displayName} size={44} />
        <div className="min-w-0">
          <div className="text-lg font-black text-white group-hover:text-blue-200 transition-colors truncate">
            {player.displayName}
          </div>
          {player.username && (
            <div className="text-[10px] text-blue-300/50 truncate">@{player.username}</div>
          )}
        </div>
      </div>
      <div className="mb-3" />

      {/* Team row */}
      <div className="relative flex items-center gap-2 mb-4 pb-3 border-b border-white/5">
        {hasTeam ? (
          <>
            <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
              <img
                src={`/logos/${player.team}.png`}
                alt=""
                className="w-full h-full object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
            </div>
            <div className="text-xs font-semibold text-white/80 truncate">{player.team}</div>
          </>
        ) : (
          <div className="text-xs font-semibold text-blue-300/60 italic">Free Agent</div>
        )}
        <div className="ml-auto text-[9px] font-bold tracking-wider uppercase text-blue-300/60">
          {player.divisionLabel}
        </div>
      </div>

      {/* Stats row */}
      <div className="relative grid grid-cols-3 gap-2">
        <Stat label="G" value={player.goals} />
        <Stat label="A" value={player.assists} />
        <Stat label="S" value={player.saves} />
      </div>

      {/* Salary bar */}
      <div className="relative mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs">
        <span className="text-blue-300/60 tracking-wider uppercase text-[9px] font-bold">Salary</span>
        <span className="font-mono font-bold text-blue-200">{player.salary.toFixed(2)}</span>
      </div>
    </Link>
  )
}

function Stat({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-base font-black text-white">{value}</div>
      <div className="text-[9px] text-blue-300/50 tracking-wider uppercase">{label}</div>
    </div>
  )
}
