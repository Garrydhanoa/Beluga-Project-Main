"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import Avatar from '../../components/Avatar'

// ====================================================================
// Color palette — matches the reference design
// ====================================================================

const STAT_COLORS = {
  goals:   { text: '#f87171', bar: '#ef4444', glow: 'rgba(239,68,68,0.4)' },   // red
  assists: { text: '#4ade80', bar: '#22c55e', glow: 'rgba(34,197,94,0.4)' },   // green
  saves:   { text: '#facc15', bar: '#eab308', glow: 'rgba(234,179,8,0.4)' },   // yellow
  shots:   { text: '#a78bfa', bar: '#8b5cf6', glow: 'rgba(139,92,246,0.4)' },  // violet
  mvps:    { text: '#f472b6', bar: '#ec4899', glow: 'rgba(236,72,153,0.4)' },  // pink
}

// Mapping of achievement keys → color theme
const ACHIEVEMENT_COLORS = {
  // Status (neutral / green)
  registered:  { bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.35)', text: '#e2e8f0', icon: '✓' },
  active:      { bg: 'rgba(16,185,129,0.10)',  border: 'rgba(52,211,153,0.45)',  text: '#6ee7b7', icon: '●' },
  // Stat clubs
  'goals-20':  { bg: 'rgba(249,115,22,0.12)',  border: 'rgba(251,146,60,0.45)',  text: '#fdba74', icon: '🔥' },
  'assists-15':{ bg: 'rgba(34,197,94,0.10)',   border: 'rgba(74,222,128,0.45)',  text: '#86efac', icon: '✨' },
  mvp:         { bg: 'rgba(236,72,153,0.12)',  border: 'rgba(244,114,182,0.45)', text: '#f9a8d4', icon: '★' },
  wall:        { bg: 'rgba(234,179,8,0.10)',   border: 'rgba(250,204,21,0.45)',  text: '#fde047', icon: '🛡' },
  sharp:       { bg: 'rgba(239,68,68,0.10)',   border: 'rgba(248,113,113,0.45)', text: '#fca5a5', icon: '🎯' },
  // Division leaders (match stat colors)
  'div-goals':   { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(248,113,113,0.50)', text: '#fca5a5', icon: '👑' },
  'div-assists': { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(74,222,128,0.50)',  text: '#86efac', icon: '👑' },
  'div-mvps':    { bg: 'rgba(236,72,153,0.12)', border: 'rgba(244,114,182,0.50)', text: '#f9a8d4', icon: '👑' },
  'div-saves':   { bg: 'rgba(234,179,8,0.12)',  border: 'rgba(250,204,21,0.50)',  text: '#fde047', icon: '👑' },
  // Role / career
  captain:     { bg: 'rgba(234,179,8,0.12)',   border: 'rgba(250,204,21,0.50)',  text: '#fde047', icon: '★' },
  vet:         { bg: 'rgba(59,130,246,0.12)',  border: 'rgba(96,165,250,0.50)',  text: '#93c5fd', icon: '🎖' },
  rookie:      { bg: 'rgba(6,182,212,0.12)',   border: 'rgba(34,211,238,0.50)',  text: '#67e8f9', icon: '✨' },
  fa:          { bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.35)', text: '#cbd5e1', icon: '🌐' },
}

const CHAMPION_COLOR = {
  bg: 'rgba(234,179,8,0.12)',
  border: 'rgba(250,204,21,0.50)',
  text: '#fde047',
  icon: '★',
}

const DEFAULT_BADGE_COLOR = {
  bg: 'rgba(59,130,246,0.10)',
  border: 'rgba(96,165,250,0.40)',
  text: '#93c5fd',
  icon: '●',
}

function getBadgeColor(achievement) {
  if (!achievement || !achievement.key) return DEFAULT_BADGE_COLOR
  if (achievement.key.includes('champ')) return CHAMPION_COLOR
  return ACHIEVEMENT_COLORS[achievement.key] || DEFAULT_BADGE_COLOR
}

// ====================================================================
// Icons
// ====================================================================

const ICONS = {
  check: 'M5 13l4 4L19 7',
  pulse: 'M22 12h-4l-3 9L9 3l-3 9H2',
  fire: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.24 17 6.2c2 2 2 5.8 0 8-2 2-5.5 1-5.5-2 0-1.5.5-2.5 1-2.5',
  star: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 9.719c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z',
  crown: 'M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 2h14v2H5v-2z',
  target: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4a6 6 0 100 12 6 6 0 000-12zm0 4a2 2 0 100 4 2 2 0 000-4z',
  shield: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  medal: 'M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zM11 12a1 1 0 102 0 1 1 0 00-2 0z',
  sparkle: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
  globe: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
}

function Icon({ name, className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[name] || ICONS.sparkle} />
    </svg>
  )
}

function FadeIn({ children, delay = 0, y = 20, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ====================================================================
// Main page
// ====================================================================

export default function PlayerProfilePage() {
  const params = useParams()
  const username = decodeURIComponent(params.username)

  const [apiData, setApiData] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/players/${encodeURIComponent(username)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 404) { setNotFound(true); return null }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => { if (d) setApiData(d) })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [username])

  // Adapt the API payload to the shape the existing UI expects (preserving the
  // dense visualization with achievements, stat bars, match history, etc.).
  const player = useMemo(() => {
    if (!apiData?.player) return null
    const current = (apiData.rosterHistory || []).find((r) => r.rosterActive) || (apiData.rosterHistory || [])[0]
    const totalStats = (apiData.stats || []).reduce((acc, s) => ({
      goals: acc.goals + (s.goals || 0),
      assists: acc.assists + (s.assists || 0),
      saves: acc.saves + (s.saves || 0),
      shots: acc.shots + (s.shots || 0),
      gp: acc.gp + (s.gamesPlayed || 0),
    }), { goals: 0, assists: 0, saves: 0, shots: 0, gp: 0 })
    const divLabel = apiData.player.division || current?.division || null
    const divKey = (() => {
      const d = String(divLabel || '').toLowerCase()
      if (d.includes('major')) return 'major'
      if (d.includes('aaa')) return 'aaa'
      if (d.includes('aa')) return 'aa'
      return 'aa'
    })()
    return {
      username: apiData.player.discordUsername || null,
      discordId: apiData.player.discordId || null,
      avatarUrl: apiData.player.avatarUrl || null,
      displayName: apiData.player.displayName,
      team: current?.teamName || apiData.player.currentTeam || null,
      divisionLabel: divKey === 'major' ? 'Majors' : divKey.toUpperCase(),
      isCaptain: current?.role === 'captain',
      isFreeAgent: !current?.rosterActive,
      role: current?.role || null,
      goals: totalStats.goals,
      assists: totalStats.assists,
      saves: totalStats.saves,
      shots: totalStats.shots,
      mvps: 0,
      salary: apiData.player.salary ?? 0,
      eligible: apiData.player.eligible,
      shootingPct: totalStats.shots > 0 ? Math.round((totalStats.goals / totalStats.shots) * 100) : 0,
      ranks: { goals: 0, assists: 0, saves: 0, shots: 0, mvps: 0 },
      achievements: [],
    }
  }, [apiData])

  const transactions = useMemo(() => apiData?.transactions || [], [apiData])

  const history = useMemo(() => {
    if (!apiData?.matches) return []
    return apiData.matches.map((m) => ({
      result: (m.homeScore || 0) > (m.awayScore || 0) ? 'W' : ((m.homeScore || 0) < (m.awayScore || 0) ? 'L' : 'T'),
      opponent: m.home && m.away ? `${m.home} vs ${m.away}` : '—',
      ownScore: m.homeScore,
      oppScore: m.awayScore,
      weekLabel: m.isPlayoff ? 'Playoffs' : `Week ${m.week ?? '—'}`,
    }))
  }, [apiData])

  const recentForm = useMemo(() => history.slice(0, 5).map((h) => h.result), [history])
  const rosterHistory = useMemo(() => apiData?.rosterHistory || [], [apiData])

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-sm text-blue-200/60">Loading…</div>
      </div>
    )
  }

  if (notFound || !player) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="text-sm text-blue-200/50 mb-4 tracking-wider uppercase">Not Found</div>
          <div className="text-2xl font-black text-white mb-4">Player &ldquo;{username}&rdquo; doesn&apos;t exist</div>
          <Link
            href="/players"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-blue-500 hover:bg-blue-400 text-white font-bold text-sm transition"
          >
            ← Back to Directory
          </Link>
        </div>
      </div>
    )
  }

  // Record (wins / losses / total) from match history
  const wins = history.filter((m) => m.result === 'W').length
  const losses = history.filter((m) => m.result === 'L').length
  const winRate = history.length > 0 ? Math.round((wins / history.length) * 100) : 0
  const goalsFor = history.reduce((s, m) => s + m.ownScore, 0)
  const goalsAgainst = history.reduce((s, m) => s + m.oppScore, 0)
  const goalDiff = goalsFor - goalsAgainst

  // Current streak
  let streakCount = 0
  let streakType = '—'
  for (let i = history.length - 1; i >= 0; i--) {
    if (i === history.length - 1) {
      streakType = history[i].result
      streakCount = 1
    } else if (history[i].result === streakType) {
      streakCount++
    } else {
      break
    }
  }

  return (
    <div className="relative text-white overflow-hidden">
      {/* ============ HERO ============ */}
      <section className="relative container mx-auto px-4 pt-16 pb-32">
        {/* Ambient glow */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[40rem] h-[40rem] rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
        {/* Ghost team logo */}
        {player.team && (
          <div
            className="absolute top-0 right-0 w-[32rem] h-[32rem] opacity-[0.04] pointer-events-none -translate-y-16 translate-x-16"
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

        <div className="relative text-center max-w-4xl mx-auto">
          {/* Avatar + team logo row */}
          <div className="mb-6 flex items-center justify-center gap-5">
            {/* Player Discord avatar */}
            <div
              style={{
                borderRadius: '9999px',
                boxShadow: '0 0 30px rgba(59,130,246,0.3)',
              }}
            >
              <Avatar src={player.avatarUrl} name={player.displayName} size={80} />
            </div>

            {/* Separator + team logo */}
            {player.team && (
              <>
                <div
                  style={{
                    width: '1px',
                    height: '48px',
                    background: 'linear-gradient(to bottom, transparent, rgba(96,165,250,0.5), transparent)',
                  }}
                />
                <Link
                  href={`/teams/${encodeURIComponent(player.team)}`}
                  style={{
                    position: 'relative',
                    width: '80px',
                    height: '80px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'transform 0.2s',
                  }}
                  title={player.team}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: '9999px',
                      backgroundColor: 'rgba(59,130,246,0.1)',
                      filter: 'blur(20px)',
                    }}
                  />
                  <img
                    src={`/logos/${player.team}.png`}
                    alt={player.team}
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      filter: 'drop-shadow(0 0 15px rgba(59,130,246,0.4))',
                    }}
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                </Link>
              </>
            )}
          </div>

          {/* Big name — plain white, like the reference */}
          <h1
            style={{
              fontSize: 'clamp(36px, 5vw, 56px)',
              fontWeight: 900,
              color: '#ffffff',
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            {player.displayName}
          </h1>
        </div>
      </section>

      {/* ============ UNIFIED PROFILE CARD ============ */}
      <section className="container mx-auto px-4 mt-8 mb-12 max-w-5xl relative z-20">
        <div
          style={{
            backgroundColor: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px',
            overflow: 'hidden',
          }}
        >
          {/* ---- Achievements ---- */}
          {(player.achievements || []).length > 0 && (
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px' }}>
                {player.achievements.map((a, i) => {
                  const c = getBadgeColor(a)
                  return (
                    <span
                      key={a.key || `ach-${i}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '7px 14px',
                        borderRadius: '9999px',
                        backgroundColor: c.bg,
                        border: `1px solid ${c.border}`,
                        color: c.text,
                        fontSize: '11px',
                        fontWeight: 700,
                        letterSpacing: '0.02em',
                      }}
                    >
                      <span style={{ fontSize: '10px', opacity: 0.9 }}>{c.icon}</span>
                      {a.label}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* ---- Info strip ---- */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {/* TEAM */}
            <div style={{ padding: '22px 16px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: '10px' }}>
                Team
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                {player.team && (
                  <img
                    src={`/logos/${player.team}.png`}
                    alt=""
                    style={{ width: '22px', height: '22px', objectFit: 'contain' }}
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                )}
                <span style={{ fontSize: '15px', fontWeight: 800, color: '#ffffff' }}>
                  {player.team || 'Free Agent'}
                </span>
              </div>
            </div>

            {/* DIVISION */}
            <div style={{ padding: '22px 16px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: '10px' }}>
                Division
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(234,179,8,0.15)',
                    border: '1px solid rgba(250,204,21,0.4)',
                    color: '#fde047',
                    fontSize: '9px',
                    fontWeight: 900,
                    letterSpacing: '0.1em',
                  }}
                >
                  {player.divisionLabel.toUpperCase()}
                </span>
                <span style={{ fontSize: '15px', fontWeight: 800, color: '#ffffff' }}>
                  {player.divisionLabel}
                </span>
              </div>
            </div>

            {/* SALARY */}
            <div style={{ padding: '22px 16px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: '10px' }}>
                Salary
              </div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#60a5fa' }}>
                {player.salary ? Number(player.salary).toFixed(2) : '—'}
              </div>
            </div>

            {/* SHOOTING */}
            <div style={{ padding: '22px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: '10px' }}>
                Shooting
              </div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#ffffff' }}>
                {player.shootingPct}%
              </div>
            </div>
          </div>

          {/* ---- Big stats row ---- */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              padding: '24px 16px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {[
              { label: 'Goals',   value: player.goals,   rank: player.ranks.goals,   color: STAT_COLORS.goals },
              { label: 'Assists', value: player.assists, rank: player.ranks.assists, color: STAT_COLORS.assists },
              { label: 'Saves',   value: player.saves,   rank: player.ranks.saves,   color: STAT_COLORS.saves },
              { label: 'Shots',   value: player.shots,   rank: player.ranks.shots,   color: STAT_COLORS.shots },
              { label: 'MVPs',    value: player.mvps,    rank: player.ranks.mvps,    color: STAT_COLORS.mvps },
            ].map((s) => (
              <ColorStat key={s.label} {...s} />
            ))}
          </div>

          {/* ---- Copy User ID footer ---- */}
          {player.discordId && (
            <div style={{ padding: '14px 24px' }}>
              <CopyUserIdButton userId={player.discordId} />
            </div>
          )}
        </div>
      </section>

      {/* ============ RECENT FORM + RECORD ============ */}
      <section className="container mx-auto px-4 mb-12 max-w-5xl">
        <FadeIn delay={0.25}>
          <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10">
            {/* Recent form */}
            <div className="flex items-center gap-3 mb-5">
              <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">
                Recent Form
              </span>
              <div className="flex items-center gap-2">
                {[0, 1, 2, 3, 4].map((i) => {
                  const result = recentForm[i]
                  return (
                    <div
                      key={i}
                      className={`w-9 h-9 rounded-lg border flex items-center justify-center font-black text-sm ${
                        result === 'W'
                          ? 'bg-blue-500/20 border-blue-400/50 text-blue-100'
                          : result === 'L'
                            ? 'bg-white/5 border-white/20 text-white/50'
                            : 'bg-white/[0.02] border-white/10 text-white/20'
                      }`}
                    >
                      {result || '–'}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Record stat row */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 pt-5 border-t border-white/10">
              <RecordStat label="Record" value={`${wins}-${losses}-0`} />
              <RecordStat label="Win Rate" value={`${winRate}%`} />
              <RecordStat label="GF" value={goalsFor} />
              <RecordStat label="GA" value={goalsAgainst} />
              <RecordStat label="GD" value={goalDiff >= 0 ? `+${goalDiff}` : `${goalDiff}`} highlight={goalDiff >= 0} />
              <RecordStat label="Streak" value={streakCount > 0 ? `${streakCount}${streakType}` : '—'} highlight={streakType === 'W'} />
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ============ MATCH HISTORY ============ */}
      <section className="container mx-auto px-4 pb-20 max-w-5xl">
        <FadeIn delay={0.3}>
          <div className="mb-4 flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">
              Match History
            </span>
            <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
            <span className="text-[10px] font-bold text-blue-300/60">
              {history.length} {history.length === 1 ? 'match' : 'matches'}
            </span>
          </div>

          {history.length === 0 ? (
            <div className="text-center py-12 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
              No match history.
            </div>
          ) : (
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
              {history.map((m, i) => (
                <MatchRow key={i} match={m} />
              ))}
            </div>
          )}
        </FadeIn>

        {/* ============ ROSTER HISTORY ============ */}
        <FadeIn delay={0.32}>
          <div className="mt-10 mb-4 flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">
              Roster History
            </span>
            <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
            <span className="text-[10px] font-bold text-blue-300/60">
              {rosterHistory.length} {rosterHistory.length === 1 ? 'stint' : 'stints'}
            </span>
          </div>
          {rosterHistory.length === 0 ? (
            <div className="text-center py-10 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
              No roster history.
            </div>
          ) : (
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden divide-y divide-white/5">
              {rosterHistory.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/[0.02]">
                  <span className="text-blue-300/90 font-bold w-14 text-xs">S{r.seasonNumber ?? '—'}</span>
                  <span className="text-blue-200/70 w-14 text-xs uppercase">{r.division}</span>
                  <span className="text-white flex-1 truncate">{r.teamName || '—'}</span>
                  {r.role && r.role !== 'player' && (
                    <span className="text-[9px] uppercase font-bold tracking-wider text-blue-300 px-1.5 py-0.5 rounded bg-blue-500/15 border border-blue-400/30">{r.role}</span>
                  )}
                  {!r.rosterActive && <span className="text-[9px] uppercase text-white/40">inactive</span>}
                </div>
              ))}
            </div>
          )}
        </FadeIn>

        {/* ============ TRANSACTION HISTORY ============ */}
        <FadeIn delay={0.35}>
          <div className="mt-10 mb-4 flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">
              Transaction History
            </span>
            <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
            <span className="text-[10px] font-bold text-blue-300/60">
              {transactions.length} {transactions.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>
          {transactions.length === 0 ? (
            <div className="text-center py-10 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
              No transactions recorded.
            </div>
          ) : (
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden divide-y divide-white/5">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/[0.02]">
                  <span className="text-blue-300/90 font-bold w-32 text-xs uppercase tracking-wide">{TX_LABELS[tx.type] || tx.type}</span>
                  <span className="text-white flex-1 truncate">
                    {tx.teamName || '—'}
                    {tx.pairedTeamName && <span className="text-white/40 mx-1">↔ {tx.pairedTeamName}</span>}
                  </span>
                  {tx.seasonNumber && <span className="text-blue-200/60 text-xs">S{tx.seasonNumber}</span>}
                  <span className="text-white/30 text-[11px] whitespace-nowrap">{tx.performedAt ? new Date(tx.performedAt).toLocaleDateString() : ''}</span>
                </div>
              ))}
            </div>
          )}
        </FadeIn>
      </section>
    </div>
  )
}

const TX_LABELS = {
  sign: 'Signed', drop: 'Dropped', release: 'Released',
  trade_in: 'Traded in', trade_out: 'Traded out',
  ir_place: 'Placed on IR', ir_return: 'Returned from IR',
  suspend: 'Suspended', reinstate: 'Reinstated',
  rfa: 'RFA', role_change: 'Role change', rename: 'Renamed',
  gm_assign: 'GM assigned', gm_remove: 'GM removed',
  captain_assign: 'Captain assigned', captain_remove: 'Captain removed',
  esub: 'Emergency sub', other: 'Other',
}

// ====================================================================
// Sub-components
// ====================================================================

function ColorStat({ label, value, rank, color }) {
  return (
    <div style={{ textAlign: 'center', padding: '6px 8px' }}>
      <div
        style={{
          fontSize: '52px',
          fontWeight: 900,
          lineHeight: 1,
          color: color.text,
          textShadow: `0 0 20px ${color.glow}`,
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}
      >
        {value}
      </div>
      <div
        style={{
          height: '3px',
          width: '60%',
          margin: '14px auto 10px',
          backgroundColor: color.bar,
          borderRadius: '2px',
          boxShadow: `0 0 10px ${color.glow}`,
        }}
      />
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>
        {label}
        {rank && (
          <span style={{ color: '#60a5fa', marginLeft: '6px', fontWeight: 800 }}>
            #{rank}
          </span>
        )}
      </div>
    </div>
  )
}

function CopyUserIdButton({ userId }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(String(userId)).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      })
    }
  }

  return (
    <button
      onClick={handleCopy}
      style={{
        width: '100%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '6px',
        background: 'transparent',
        border: 'none',
        color: copied ? '#6ee7b7' : 'rgba(255,255,255,0.5)',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.05em',
        cursor: 'pointer',
        transition: 'color 0.2s',
      }}
      onMouseEnter={(e) => {
        if (!copied) e.currentTarget.style.color = 'rgba(255,255,255,0.8)'
      }}
      onMouseLeave={(e) => {
        if (!copied) e.currentTarget.style.color = 'rgba(255,255,255,0.5)'
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      {copied ? 'Copied!' : 'Copy User ID'}
    </button>
  )
}

function RecordStat({ label, value, highlight = false }) {
  return (
    <div className="text-center">
      <div
        className={`text-xl font-black ${
          highlight
            ? 'text-transparent bg-clip-text bg-gradient-to-b from-blue-200 to-blue-400'
            : 'text-white'
        }`}
      >
        {value}
      </div>
      <div className="text-[9px] text-blue-300/60 tracking-wider uppercase font-bold mt-0.5">
        {label}
      </div>
    </div>
  )
}

function MatchRow({ match }) {
  const isWin = match.result === 'W'
  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition-colors">
      {/* Result chip */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-md border flex items-center justify-center font-black text-xs ${
          isWin
            ? 'bg-blue-500/20 border-blue-400/50 text-blue-100'
            : 'bg-white/5 border-white/20 text-white/60'
        }`}
      >
        {match.result}
      </div>

      {/* Opponent logo */}
      <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
        <img
          src={`/logos/${match.opponent}.png`}
          alt={match.opponent}
          className="w-full h-full object-contain"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      </div>

      {/* Opponent name */}
      <Link
        href={`/teams/${encodeURIComponent(match.opponent)}`}
        className="flex-1 min-w-0 text-sm font-bold text-white hover:text-blue-200 transition-colors truncate"
      >
        vs {match.opponent}
      </Link>

      {/* Score */}
      <div className="flex-shrink-0 text-right">
        <div className={`text-base font-black font-mono ${isWin ? 'text-blue-200' : 'text-white/80'}`}>
          {match.ownScore} <span className="text-white/40 text-sm">–</span> {match.oppScore}
        </div>
      </div>

      {/* Week */}
      <div className="hidden sm:block flex-shrink-0 text-[10px] font-bold tracking-wider uppercase text-blue-300/50 min-w-[80px] text-right">
        {match.weekLabel}
      </div>
    </div>
  )
}
