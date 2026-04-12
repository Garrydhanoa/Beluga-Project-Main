'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { getAllPlayers } from '../../lib/fakePlayers'

// ====================================================================
// Config
// ====================================================================

const DIVISIONS = [
  { key: 'aa', label: 'AA' },
  { key: 'aaa', label: 'AAA' },
  { key: 'major', label: 'Majors' },
]

const TEAMS = [
  '6 Speed', 'Archangels', 'Aviators', 'Clovis Esports', 'Griffins',
  'Immortals', 'InTraCate', 'Kingdom', 'Lotus', 'Malfeasance',
  'MNML', 'Panthers', 'Sublunary', 'Surge',
]

const MAJORS_TEAMS = [
  '6 Speed', 'Archangels', 'Aviators', 'Clovis Esports', 'InTraCate',
  'Lotus', 'Malfeasance', 'Panthers', 'Sublunary', 'Surge',
]

const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8]

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

function seededFloat(seed, min, max) {
  const x = Math.sin(seed) * 10000
  const r = x - Math.floor(x)
  return r * (max - min) + min
}

// ====================================================================
// Ranking generation
// ====================================================================

function computeTeamPoints(team, division, week) {
  const seed = hashString(`${team}|${division}|w${week}`)
  return parseFloat(seededFloat(seed, 55, 100).toFixed(1))
}

function generateTeamRankings(division, week) {
  const teams = division === 'major' ? MAJORS_TEAMS : TEAMS
  const current = teams
    .map((team) => ({ team, points: computeTeamPoints(team, division, week) }))
    .sort((a, b) => b.points - a.points)

  // Trend: compare current rank to previous week's rank
  let prevRank = null
  if (week > 1) {
    const prev = teams
      .map((team) => ({ team, points: computeTeamPoints(team, division, week - 1) }))
      .sort((a, b) => b.points - a.points)
    prevRank = {}
    prev.forEach((p, i) => { prevRank[p.team] = i })
  }

  return current.map((entry, i) => {
    let trendDelta = 0
    let trend = 'stable'
    if (prevRank !== null) {
      const prev = prevRank[entry.team]
      trendDelta = prev - i
      trend = trendDelta > 0 ? 'up' : trendDelta < 0 ? 'down' : 'stable'
    }
    return { ...entry, rank: i + 1, trend, trendDelta }
  })
}

function computePlayerScore(player, week) {
  const base = player.goals * 2 + player.assists * 1.5 + player.saves * 0.5 + player.mvps * 8
  const weekBonus = seededFloat(hashString(`${player.username}|w${week}`), -10, 10)
  return parseFloat((base + weekBonus).toFixed(1))
}

function generatePlayerRankings(division, week, allPlayers) {
  const divPlayers = allPlayers.filter((p) => p.division === division)
  const scored = divPlayers.map((p) => ({
    player: p,
    points: computePlayerScore(p, week),
  }))
  scored.sort((a, b) => b.points - a.points)

  // Compute previous week ranks for trend
  let prevRank = null
  if (week > 1) {
    const prev = divPlayers
      .map((p) => ({ player: p, points: computePlayerScore(p, week - 1) }))
      .sort((a, b) => b.points - a.points)
    prevRank = {}
    prev.forEach((entry, i) => { prevRank[entry.player.username] = i })
  }

  return scored.slice(0, 10).map((entry, i) => {
    let trendDelta = 0
    let trend = 'stable'
    if (prevRank !== null) {
      const prev = prevRank[entry.player.username]
      if (prev !== undefined) {
        trendDelta = prev - i
        trend = trendDelta > 0 ? 'up' : trendDelta < 0 ? 'down' : 'stable'
      }
    }
    return { ...entry, rank: i + 1, trend, trendDelta }
  })
}

// ====================================================================
// Shared helpers
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

function TrendIndicator({ trend, delta }) {
  if (trend === 'up') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '3px',
          color: '#4ade80',
          fontSize: '11px',
          fontWeight: 800,
        }}
        title={`Up ${delta} position${delta === 1 ? '' : 's'}`}
      >
        ▲ {delta}
      </span>
    )
  }
  if (trend === 'down') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '3px',
          color: '#f87171',
          fontSize: '11px',
          fontWeight: 800,
        }}
        title={`Down ${Math.abs(delta)} position${Math.abs(delta) === 1 ? '' : 's'}`}
      >
        ▼ {Math.abs(delta)}
      </span>
    )
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        color: 'rgba(255,255,255,0.35)',
        fontSize: '11px',
        fontWeight: 800,
      }}
      title="No change"
    >
      —
    </span>
  )
}

// ====================================================================
// Main page
// ====================================================================

export default function PowerRankingsPage() {
  const [division, setDivision] = useState('major')
  const [week, setWeek] = useState(1)

  const allPlayers = useMemo(() => getAllPlayers(), [])
  const teamRankings = useMemo(() => generateTeamRankings(division, week), [division, week])
  const playerRankings = useMemo(
    () => generatePlayerRankings(division, week, allPlayers),
    [division, week, allPlayers]
  )

  const divisionLabel = DIVISIONS.find((d) => d.key === division)?.label || division

  return (
    <div className="relative text-white overflow-hidden">
      {/* ============ HERO ============ */}
      <section className="container mx-auto px-4 pt-16 pb-10">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 backdrop-blur-sm mb-6">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-xs text-blue-200 font-medium tracking-[0.2em] uppercase">
                Season 9 · Week {week}
              </span>
            </div>
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight mb-4 leading-[0.95]">
              <span className="block text-white">Power</span>
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-200 via-blue-300 to-blue-500 drop-shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                Rankings
              </span>
            </h1>
            <p className="text-base md:text-lg text-blue-100/70 max-w-xl mx-auto">
              Weekly team and player rankings across all divisions. Updated every week of the season.
            </p>
          </div>
        </FadeIn>
      </section>

      {/* ============ CONTROLS ============ */}
      <section className="container mx-auto px-4 mb-10">
        <FadeIn delay={0.1}>
          <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-8">
            {/* Division tabs */}
            <div className="flex gap-2 flex-wrap justify-center">
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

            {/* Week selector */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-blue-300/70">
                Week
              </span>
              <div className="flex gap-1.5">
                {WEEKS.map((w) => {
                  const active = week === w
                  return (
                    <button
                      key={w}
                      onClick={() => setWeek(w)}
                      className={`w-9 h-9 rounded-lg font-bold text-sm transition-all ${
                        active
                          ? 'bg-blue-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.5)]'
                          : 'bg-white/5 hover:bg-white/10 border border-white/15 hover:border-blue-400/50 text-white/70 hover:text-blue-200'
                      }`}
                    >
                      {w}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ============ RANKINGS GRID ============ */}
      <section className="container mx-auto px-4 pb-24 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Teams */}
          <FadeIn delay={0.15}>
            <RankingCard
              title="Top Teams"
              subtitle={`${divisionLabel} · Week ${week}`}
              iconPath="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            >
              {teamRankings.map((entry) => (
                <TeamRow key={entry.team} entry={entry} />
              ))}
            </RankingCard>
          </FadeIn>

          {/* Top Players */}
          <FadeIn delay={0.2}>
            <RankingCard
              title="Top Players"
              subtitle={`${divisionLabel} · Week ${week}`}
              iconPath="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            >
              {playerRankings.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-white/40">
                  No player rankings available.
                </div>
              ) : (
                playerRankings.map((entry) => (
                  <PlayerRow key={entry.player.username} entry={entry} />
                ))
              )}
            </RankingCard>
          </FadeIn>
        </div>

        {/* Footer note */}
        <div className="mt-8 text-center text-[10px] text-white/30 tracking-wider">
          Rankings shown are placeholder data for design purposes.
        </div>
      </section>
    </div>
  )
}

// ====================================================================
// Sub-components
// ====================================================================

function RankingCard({ title, subtitle, iconPath, children }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 bg-black/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-400/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
            </svg>
          </div>
          <div>
            <div className="text-sm font-black text-white">{title}</div>
            <div className="text-[9px] font-bold tracking-[0.2em] uppercase text-blue-300/60">
              {subtitle}
            </div>
          </div>
        </div>
      </div>
      <div className="divide-y divide-white/5">{children}</div>
    </div>
  )
}

function TeamRow({ entry }) {
  const { team, points, rank, trend, trendDelta } = entry
  return (
    <div className="px-5 py-4 flex items-center gap-4 hover:bg-white/[0.03] transition">
      {/* Rank badge */}
      <div
        style={{
          ...rankBadgeStyle(rank),
          width: '42px',
          height: '42px',
          borderRadius: '9999px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 900,
          fontSize: '16px',
          flexShrink: 0,
        }}
      >
        {rank}
      </div>

      {/* Logo */}
      <div className="w-11 h-11 flex-shrink-0 flex items-center justify-center">
        <img
          src={`/logos/${team}.png`}
          alt={team}
          className="w-full h-full object-contain drop-shadow-[0_0_10px_rgba(59,130,246,0.2)]"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      </div>

      {/* Name + points */}
      <div className="flex-1 min-w-0">
        <Link
          href={`/teams/${encodeURIComponent(team)}`}
          className="block text-sm font-bold text-white hover:text-blue-200 transition-colors truncate"
        >
          {team}
        </Link>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs font-black text-blue-200">{points.toFixed(1)}</span>
          <span className="text-[9px] text-blue-300/50 tracking-wider uppercase">pts</span>
          <TrendIndicator trend={trend} delta={trendDelta} />
        </div>
      </div>
    </div>
  )
}

function PlayerRow({ entry }) {
  const { player, points, rank, trend, trendDelta } = entry
  return (
    <div className="px-5 py-4 flex items-center gap-4 hover:bg-white/[0.03] transition">
      {/* Rank badge */}
      <div
        style={{
          ...rankBadgeStyle(rank),
          width: '42px',
          height: '42px',
          borderRadius: '9999px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 900,
          fontSize: '16px',
          flexShrink: 0,
        }}
      >
        {rank}
      </div>

      {/* Team logo (if on a team) */}
      <div className="w-11 h-11 flex-shrink-0 flex items-center justify-center">
        {player.team ? (
          <img
            src={`/logos/${player.team}.png`}
            alt={player.team}
            className="w-full h-full object-contain opacity-70"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-400/30 flex items-center justify-center text-[10px] font-black text-blue-200">
            FA
          </div>
        )}
      </div>

      {/* Name + points */}
      <div className="flex-1 min-w-0">
        <Link
          href={`/players/${encodeURIComponent(player.username)}`}
          className="block text-sm font-bold text-white hover:text-blue-200 transition-colors truncate"
        >
          {player.displayName}
        </Link>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs font-black text-blue-200">{points.toFixed(1)}</span>
          <span className="text-[9px] text-blue-300/50 tracking-wider uppercase">pts</span>
          <TrendIndicator trend={trend} delta={trendDelta} />
        </div>
      </div>
    </div>
  )
}
