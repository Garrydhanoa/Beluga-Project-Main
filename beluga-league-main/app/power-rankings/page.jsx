'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import Avatar from '../components/Avatar'
import TeamLogo from '../components/TeamLogo'
import SeasonPicker from '../components/SeasonPicker'
import { useSeason, seasonQuerySuffix } from '../components/SeasonContext'

const DIVISIONS = [
  { key: 'Majors', label: 'Majors' },
  { key: 'AAA', label: 'AAA' },
  { key: 'AA', label: 'AA' },
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

function rankBadgeStyle(rank) {
  if (rank === 1) return { background: 'linear-gradient(135deg, #fde047, #ca8a04)', color: '#422006', boxShadow: '0 0 20px rgba(250, 204, 21, 0.45)', border: '1px solid rgba(250, 204, 21, 0.7)' }
  if (rank === 2) return { background: 'linear-gradient(135deg, #e2e8f0, #94a3b8)', color: '#1e293b', boxShadow: '0 0 15px rgba(148, 163, 184, 0.35)', border: '1px solid rgba(226, 232, 240, 0.6)' }
  if (rank === 3) return { background: 'linear-gradient(135deg, #fb923c, #9a3412)', color: '#431407', boxShadow: '0 0 15px rgba(251, 146, 60, 0.35)', border: '1px solid rgba(251, 146, 60, 0.6)' }
  return { background: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd', border: '1px solid rgba(96, 165, 250, 0.3)' }
}

function TrendChip({ trend }) {
  if (trend === 'up') return <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-green-400" title="Up vs last ranking">▲</span>
  if (trend === 'down') return <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-red-400" title="Down vs last ranking">▼</span>
  if (trend === 'new') return <span className="text-[10px] font-extrabold text-yellow-300" title="New entry">★ NEW</span>
  if (trend === 'same') return <span className="text-[10px] font-bold text-white/30" title="No change">—</span>
  return null
}

export default function PowerRankingsPage() {
  const { season } = useSeason()
  const [division, setDivision] = useState('Majors')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/power-rankings?${seasonQuerySuffix(season).replace(/^&/, '')}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [season])

  const seasonNum = data?.season?.season_number
  const teams = useMemo(() => data?.rankings?.team?.[division] || [], [data, division])
  const players = useMemo(() => data?.rankings?.player?.[division] || [], [data, division])
  const divisionLabel = DIVISIONS.find((d) => d.key === division)?.label || division
  const hasAny = teams.length > 0 || players.length > 0
  const podium = teams.slice(0, 3)

  return (
    <div className="relative text-white overflow-hidden">
      {/* HERO */}
      <section className="container mx-auto px-4 pt-16 pb-10">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 backdrop-blur-sm mb-6">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-xs text-blue-200 font-medium tracking-[0.2em] uppercase">
                {seasonNum ? `Season ${seasonNum} · Power Rankings` : 'Power Rankings'}
              </span>
            </div>
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight mb-4 leading-[0.95]">
              <span className="block text-white">Power</span>
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-200 via-blue-300 to-blue-500 drop-shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                Rankings
              </span>
            </h1>
            <p className="text-base md:text-lg text-blue-100/70 max-w-xl mx-auto">
              Form-based team & player rankings — recent series and per-game performance, with movement vs the last ranking.
            </p>
          </div>
        </FadeIn>
      </section>

      {/* DIVISION TABS */}
      <section className="container mx-auto px-4 mb-10">
        <FadeIn delay={0.1}>
          <div className="flex gap-2 flex-wrap justify-center items-center">
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
        </FadeIn>
      </section>

      <section className="container mx-auto px-4 pb-24 max-w-6xl">
        {loading ? (
          <div className="text-center py-20 text-blue-200/60">Loading…</div>
        ) : !data?.seasonId ? (
          <Empty>No active season.</Empty>
        ) : !hasAny ? (
          <Empty>No rankings published for {divisionLabel} yet.</Empty>
        ) : (
          <>
            {/* PODIUM (top-3 teams) */}
            {podium.length >= 3 && (
              <FadeIn delay={0.12}>
                <div className="grid grid-cols-3 gap-3 sm:gap-5 mb-8 items-end max-w-3xl mx-auto">
                  <PodiumCard entry={podium[1]} place={2} height="h-36" />
                  <PodiumCard entry={podium[0]} place={1} height="h-44" />
                  <PodiumCard entry={podium[2]} place={3} height="h-32" />
                </div>
              </FadeIn>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <FadeIn delay={0.15}>
                <RankingCard
                  title="Top Teams"
                  subtitle={divisionLabel}
                  iconPath="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                >
                  {teams.length === 0 ? (
                    <div className="px-5 py-12 text-center text-sm text-white/40">No team rankings.</div>
                  ) : (
                    teams.map((entry) => <TeamRow key={entry.id} entry={entry} />)
                  )}
                </RankingCard>
              </FadeIn>

              <FadeIn delay={0.2}>
                <RankingCard
                  title="Top Players"
                  subtitle={divisionLabel}
                  iconPath="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                >
                  {players.length === 0 ? (
                    <div className="px-5 py-12 text-center text-sm text-white/40">No player rankings.</div>
                  ) : (
                    players.map((entry) => <PlayerRow key={entry.id} entry={entry} />)
                  )}
                </RankingCard>
              </FadeIn>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function Empty({ children }) {
  return (
    <div className="text-center py-20 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
      {children}
    </div>
  )
}

function PodiumCard({ entry, place, height }) {
  if (!entry) return <div />
  return (
    <Link href={`/teams/${encodeURIComponent(entry.name)}`} className="group flex flex-col items-center">
      <div className="w-14 h-14 sm:w-16 sm:h-16 mb-2 flex items-center justify-center">
        <TeamLogo
          name={entry.name}
          teamId={entry.teamId}
          className="w-full h-full"
          imgClassName="w-full h-full object-contain drop-shadow-[0_0_14px_rgba(59,130,246,0.3)] group-hover:scale-110 transition-transform"
        />
      </div>
      <div className="text-xs sm:text-sm font-black text-white text-center truncate w-full px-1">
        {entry.name} <TrendChip trend={entry.trend} />
      </div>
      <div
        className={`mt-2 w-full ${height} rounded-t-xl border-x border-t flex items-start justify-center pt-3`}
        style={place === 1
          ? { background: 'linear-gradient(180deg, rgba(250,204,21,0.18), rgba(250,204,21,0.02))', borderColor: 'rgba(250,204,21,0.4)' }
          : place === 2
            ? { background: 'linear-gradient(180deg, rgba(148,163,184,0.18), rgba(148,163,184,0.02))', borderColor: 'rgba(226,232,240,0.35)' }
            : { background: 'linear-gradient(180deg, rgba(251,146,60,0.16), rgba(251,146,60,0.02))', borderColor: 'rgba(251,146,60,0.35)' }}
      >
        <div style={{ ...rankBadgeStyle(place), width: 34, height: 34, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 15 }}>
          {place}
        </div>
      </div>
    </Link>
  )
}

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
            <div className="text-[9px] font-bold tracking-[0.2em] uppercase text-blue-300/60">{subtitle}</div>
          </div>
        </div>
      </div>
      <div className="divide-y divide-white/5">{children}</div>
    </div>
  )
}

function RankBadge({ rank }) {
  return (
    <div style={{ ...rankBadgeStyle(rank), width: 42, height: 42, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, flexShrink: 0 }}>
      {rank}
    </div>
  )
}

function TeamRow({ entry }) {
  return (
    <div className="px-5 py-4 flex items-center gap-4 hover:bg-white/[0.03] transition">
      <RankBadge rank={entry.rank} />
      <div className="w-11 h-11 flex-shrink-0 flex items-center justify-center">
        <TeamLogo name={entry.name} teamId={entry.teamId} className="w-full h-full" imgClassName="w-full h-full object-contain drop-shadow-[0_0_10px_rgba(59,130,246,0.2)]" />
      </div>
      <div className="flex-1 min-w-0">
        <Link href={`/teams/${encodeURIComponent(entry.name)}`} className="inline-flex items-center gap-1.5 text-sm font-bold text-white hover:text-blue-200 transition-colors truncate max-w-full">
          <span className="truncate">{entry.name}</span> <TrendChip trend={entry.trend} />
        </Link>
        {entry.note && <div className="text-[11px] text-blue-200/55 truncate mt-0.5">{entry.note}</div>}
      </div>
    </div>
  )
}

function PlayerRow({ entry }) {
  return (
    <div className="px-5 py-4 flex items-center gap-4 hover:bg-white/[0.03] transition">
      <RankBadge rank={entry.rank} />
      <Avatar src={entry.avatarUrl} name={entry.name} size={44} className="flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <Link href={`/players/${encodeURIComponent(entry.discordId || entry.name)}`} className="inline-flex items-center gap-1.5 text-sm font-bold text-white hover:text-blue-200 transition-colors truncate max-w-full">
          <span className="truncate">{entry.name}</span> <TrendChip trend={entry.trend} />
        </Link>
        {entry.note && <div className="text-[11px] text-blue-200/55 truncate mt-0.5">{entry.note}</div>}
      </div>
    </div>
  )
}
