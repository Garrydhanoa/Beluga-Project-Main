"use client"

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { majorsSchedule, aaaSchedule, getTeamInitials } from '../../../lib/scheduleData'
import Avatar from '../../components/Avatar'
import TeamLogoImg from '../../components/TeamLogo'

const ROLE_LABEL = { gm: 'General Manager', captain: 'Captain', player: 'Player', sub: 'Sub', np: 'Non-Playing' }
// fakePlayers retired — when the API has no roster data, getTeamRoster()
// returns an empty roster + null GM so the page renders an honest empty state.
const getAllPlayers = () => []

// ====================================================================
// Deterministic fake data generation
// ====================================================================

const FAKE_NAMES = [
  'AstroVibe', 'NovaDrift', 'ZenRL', 'MirageX', 'BluStrk', 'VoltCore',
  'Cipher7', 'EchoStorm', 'PulseWave', 'NyxRL', 'Zephyr', 'Fractal',
  'SableRL', 'Kairo', 'VexStrike', 'Quasar', 'RiftBreaker', 'Halcyon',
  'Stratos', 'OrionFlux', 'Vanta', 'Luxo', 'Caelum', 'Drift9',
  'Phase', 'Apex', 'VortexRL', 'Specter', 'Glyph', 'Torque',
]

function hashString(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

// Seeded pseudo-random number in range [min, max]
function seededRand(seed, min, max) {
  const x = Math.sin(seed) * 10000
  const r = x - Math.floor(x)
  return Math.floor(r * (max - min + 1)) + min
}

function generateTeamStats(teamName) {
  const seed = hashString(teamName)
  const totalGames = 14 // 8 week season, 2 per week ≈ 14-16 games
  const wins = seededRand(seed, 4, totalGames - 1)
  const losses = totalGames - wins
  const goalsFor = seededRand(seed + 1, 40, 90)
  const goalsAgainst = seededRand(seed + 2, 30, 80)
  const diff = goalsFor - goalsAgainst
  const position = seededRand(seed + 3, 1, 10)
  const winPct = Math.round((wins / totalGames) * 100)
  const streak = seededRand(seed + 4, 1, 5)
  const streakType = seededRand(seed + 5, 0, 1) === 0 ? 'W' : 'L'

  // Last 5 results
  const recentForm = []
  for (let i = 0; i < 5; i++) {
    recentForm.push(seededRand(seed + 10 + i, 0, 2) > 0 ? 'W' : 'L')
  }

  return {
    wins,
    losses,
    goalsFor,
    goalsAgainst,
    diff,
    position,
    winPct,
    streak,
    streakType,
    recentForm,
    totalGames,
    biggestWin: `${seededRand(seed + 20, 4, 8)}-${seededRand(seed + 21, 0, 2)}`,
    biggestLoss: `${seededRand(seed + 22, 0, 2)}-${seededRand(seed + 23, 4, 7)}`,
    avgGoalsFor: (goalsFor / totalGames).toFixed(1),
    avgGoalsAgainst: (goalsAgainst / totalGames).toFixed(1),
  }
}

// Pull the roster for this team+division directly from the shared fake-player
// generator so every page sees the same players, and so player cards can
// link to working profile pages with badges.
function getTeamRoster(teamName, division) {
  const all = getAllPlayers()
  const players = all
    .filter((p) => p.team === teamName && p.division === division)
    // Captain first, then player, then sub
    .sort((a, b) => {
      const weight = (r) => (r === 'Captain' ? 0 : r === 'Player' ? 1 : 2)
      return weight(a.role) - weight(b.role)
    })

  // GM is a separate "fake" record tied to the team name (not in fakePlayers).
  const gmSeed = hashString(`gm|${teamName}`)
  const gmName = FAKE_NAMES[gmSeed % FAKE_NAMES.length]
  return {
    gm: {
      displayName: gmName,
      username: gmName.toLowerCase(),
      seasons: seededRand(gmSeed + 1, 2, 8),
    },
    players,
  }
}

// Figure out which divisions a team is in
function getTeamDivisions(teamName) {
  const divisions = []
  const inMajors = Object.values(majorsSchedule).some((matches) =>
    matches.some((m) => m[0] === teamName || m[1] === teamName)
  )
  if (inMajors) divisions.push('major')

  const inAAA = Object.values(aaaSchedule).some((matches) =>
    matches.some((m) => m[0] === teamName || m[1] === teamName)
  )
  if (inAAA) {
    divisions.push('aaa')
    divisions.push('aa') // AA shares with AAA
  }
  return divisions
}

function getTeamSchedule(teamName, division) {
  const source = division === 'major' ? majorsSchedule : aaaSchedule
  const result = {}
  Object.entries(source).forEach(([week, matches]) => {
    const teamMatches = matches.filter((m) => m[0] === teamName || m[1] === teamName)
    if (teamMatches.length > 0) result[week] = teamMatches
  })
  return result
}

const DIVISION_LABEL = {
  major: 'Majors',
  aaa: 'AAA',
  aa: 'AA',
}

// ====================================================================
// Shared components
// ====================================================================

function FadeIn({ children, delay = 0, y = 30, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

function TeamLogo({ name, size = 'md', link = true }) {
  const sizes = {
    sm: 'w-12 h-12',
    md: 'w-16 h-16',
    lg: 'w-32 h-32',
    xl: 'w-40 h-40',
  }

  const content = (
    <div className={`relative ${sizes[size]} flex items-center justify-center`}>
      <div className="absolute inset-0 rounded-full bg-blue-500/10 blur-xl" />
      <TeamLogoImg
        name={name}
        className="relative w-full h-full text-3xl"
        imgClassName="relative w-full h-full object-contain drop-shadow-[0_0_20px_rgba(59,130,246,0.4)]"
      />
    </div>
  )

  return link ? (
    <Link href={`/teams/${encodeURIComponent(name)}`} className="hover:scale-105 transition-transform">
      {content}
    </Link>
  ) : (
    content
  )
}

// ====================================================================
// Main page
// ====================================================================

export default function TeamPage() {
  const params = useParams()
  const teamName = decodeURIComponent(params.teamName)

  const [activeTab, setActiveTab] = useState('roster')
  const [apiData, setApiData] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/public/team/${encodeURIComponent(teamName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setApiData(d); setLoaded(true) } })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [teamName])

  // Division keys come from the DB (e.g. ['Majors','AAA','AA']). Map to the
  // lowercase keys the UI uses. Fall back to hardcoded inference pre-load.
  const DIV_TO_KEY = { Majors: 'major', AAA: 'aaa', AA: 'aa' }
  const KEY_TO_DIV = { major: 'Majors', aaa: 'AAA', aa: 'AA' }

  const divisions = useMemo(() => {
    if (apiData?.divisions?.length) {
      return apiData.divisions.map((d) => DIV_TO_KEY[d] || d.toLowerCase())
    }
    return loaded ? [] : getTeamDivisions(teamName)
  }, [apiData, loaded, teamName])

  const [activeDivision, setActiveDivision] = useState('major')
  // Keep activeDivision valid as divisions resolve.
  useEffect(() => {
    if (divisions.length && !divisions.includes(activeDivision)) {
      setActiveDivision(divisions[0])
    }
  }, [divisions, activeDivision])

  // The currently-selected division's DB payload.
  const divData = useMemo(() => {
    if (!apiData?.byDivision) return null
    const dbDiv = KEY_TO_DIV[activeDivision] || activeDivision
    return apiData.byDivision[dbDiv] || null
  }, [apiData, activeDivision])

  // Real, record-only stats from the DB — no seeded/placeholder values.
  const stats = useMemo(() => {
    const rec = divData?.record || {}
    const wins = rec.wins || 0
    const losses = rec.losses || 0
    const goalsFor = rec.goalsFor || 0
    const goalsAgainst = rec.goalsAgainst || 0
    const totalGames = wins + losses
    return {
      wins, losses, goalsFor, goalsAgainst,
      gameWins: rec.gameWins || 0, gameLosses: rec.gameLosses || 0,
      diff: goalsFor - goalsAgainst,
      totalGames,
      winPct: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
      avgGoalsFor: totalGames > 0 ? (goalsFor / totalGames).toFixed(1) : '0.0',
      avgGoalsAgainst: totalGames > 0 ? (goalsAgainst / totalGames).toFixed(1) : '0.0',
      hasData: totalGames > 0,
    }
  }, [divData])

  const roster = useMemo(() => {
    if (divData?.roster) {
      const mapMember = (m) => ({
        discordId: m.discordId,
        username: m.discordUsername || null,
        displayName: m.displayName || m.discordUsername || `User ${String(m.discordId).slice(-4)}`,
        avatarUrl: m.avatarUrl || null,
        role: m.role || 'player',
        isCaptain: m.role === 'captain',
        salary: typeof m.salary === 'number' ? m.salary : (m.salary != null ? Number(m.salary) : null),
      })
      const players = divData.roster.filter((m) => m.role !== 'gm').map(mapMember)
      const gmEntry = divData.roster.find((m) => m.role === 'gm')
      const gm = gmEntry ? mapMember(gmEntry) : null
      const captain = players.find((p) => p.isCaptain) || null
      return { gm, captain, players }
    }
    return { gm: null, captain: null, players: [] }
  }, [divData])

  const onfieldCap = divData?.onfieldCap ?? null

  const schedule = useMemo(() => {
    if (divData?.schedule) {
      const byWeek = {}
      for (const m of divData.schedule) {
        const key = `Week ${m.week}`
        if (!byWeek[key]) byWeek[key] = []
        byWeek[key].push({
          opponent: m.isHome ? m.away : m.home,
          isHome: m.isHome,
          matchup: `${m.home} vs ${m.away}`,
        })
      }
      return byWeek
    }
    return {}
  }, [divData])

  return (
    <div className="relative text-white overflow-hidden">
      {/* ============ HERO ============ */}
      <section className="relative container mx-auto px-4 pt-16 pb-12">
        {/* Ghost logo background */}
        <div
          className="absolute top-0 right-0 w-[40rem] h-[40rem] opacity-[0.04] pointer-events-none -translate-y-16 translate-x-16"
          aria-hidden="true"
        >
          <img
            src={`/api/teams/logo?name=${encodeURIComponent(teamName)}`}
            alt=""
            className="w-full h-full object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        </div>
        <div className="absolute top-20 left-1/4 w-96 h-96 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />

        <FadeIn>
          <div className="relative text-center max-w-4xl mx-auto">
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 backdrop-blur-sm mb-8">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-xs text-blue-200 font-medium tracking-[0.2em] uppercase">
                Beluga League{apiData?.season?.season_number ? ` · Season ${apiData.season.season_number}` : ''}
              </span>
            </div>

            {/* Logo */}
            <div className="mb-6 flex justify-center">
              <TeamLogo name={teamName} size="xl" link={false} />
            </div>

            {/* Team name */}
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight mb-4 leading-[0.95]">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-200 via-blue-300 to-blue-500 drop-shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                {teamName}
              </span>
            </h1>

            {/* Divisions */}
            <div className="flex items-center justify-center gap-2 text-blue-100/70 text-sm mb-10">
              {divisions.map((d, i) => (
                <span key={d} className="flex items-center gap-2">
                  {i > 0 && <span className="w-1 h-1 rounded-full bg-blue-400/60" />}
                  <span className="font-semibold tracking-wide uppercase">{DIVISION_LABEL[d]}</span>
                </span>
              ))}
              {divisions.length === 0 && <span className="text-white/40 italic">Not currently active</span>}
            </div>

            {/* Stat row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
              {[
                { value: `${stats.wins}-${stats.losses}`, label: 'Record' },
                { value: stats.diff > 0 ? `+${stats.diff}` : `${stats.diff}`, label: 'Goal Diff' },
                { value: stats.goalsFor, label: 'Goals For' },
                { value: `${stats.winPct}%`, label: 'Win Rate' },
              ].map((s) => (
                <div key={s.label} className="p-4 rounded-xl bg-white/[0.03] border border-white/10 backdrop-blur-sm">
                  <div className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-300 leading-none">
                    {s.value}
                  </div>
                  <div className="text-[10px] text-blue-300/60 tracking-[0.2em] uppercase mt-2">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ============ TAB NAV ============ */}
      <section className="container mx-auto px-4 mb-10">
        <FadeIn delay={0.1}>
          <div className="flex justify-center gap-2 sm:gap-3">
            {[
              { key: 'roster', label: 'Roster' },
              { key: 'schedule', label: 'Schedule' },
              { key: 'stats', label: 'Stats' },
              { key: 'history', label: 'History' },
            ].map((tab) => {
              const active = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`relative px-6 sm:px-8 py-3 rounded-full font-bold text-sm sm:text-base transition-all ${
                    active
                      ? 'bg-blue-500 text-white shadow-[0_0_30px_rgba(59,130,246,0.5)] scale-105'
                      : 'bg-white/5 hover:bg-white/10 border border-white/15 hover:border-blue-400/50 text-white/70 hover:text-blue-200'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </FadeIn>
      </section>

      {/* ============ DIVISION SUB-TABS ============ */}
      {divisions.length > 1 && (
        <section className="container mx-auto px-4 mb-8">
          <FadeIn delay={0.15}>
            <div className="flex justify-center gap-2">
              {divisions.map((d) => {
                const active = activeDivision === d
                return (
                  <button
                    key={d}
                    onClick={() => setActiveDivision(d)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-[0.2em] uppercase transition ${
                      active
                        ? 'bg-blue-500/20 border border-blue-400/60 text-blue-100'
                        : 'bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400/40 text-white/60'
                    }`}
                  >
                    {DIVISION_LABEL[d]}
                  </button>
                )
              })}
            </div>
          </FadeIn>
        </section>
      )}

      {/* ============ TAB CONTENT ============ */}
      <section className="container mx-auto px-4 pb-24 max-w-6xl">
        {activeTab === 'roster' && <RosterTab teamName={teamName} roster={roster} onfieldCap={onfieldCap} />}
        {activeTab === 'schedule' && (
          <ScheduleTab teamName={teamName} schedule={schedule} division={activeDivision} />
        )}
        {activeTab === 'stats' && <StatsTab stats={stats} />}
        {activeTab === 'history' && <HistoryTab divData={divData} division={activeDivision} />}
      </section>
    </div>
  )
}

// ====================================================================
// HISTORY TAB — series results (with replay links) + roster transactions
// ====================================================================

function HistoryTab({ divData, division }) {
  const results = divData?.results || []
  const transactions = divData?.transactions || []
  const slogan = divData?.slogan

  const txLabel = (type) => ({
    sign: 'Signed', drop: 'Dropped', release: 'Released', trade_in: 'Traded in', trade_out: 'Traded out',
    ir_place: 'Placed on IR', ir_return: 'Returned from IR', suspend: 'Suspended', reinstate: 'Reinstated',
    esub: 'Emergency sub', adminesub: 'Emergency sub (admin)', gm_assign: 'GM assigned', gm_remove: 'GM removed',
    captain_assign: 'Captain assigned', captain_remove: 'Captain removed', rename: 'Renamed',
  }[type] || type)

  return (
    <div className="space-y-12 max-w-4xl mx-auto">
      {slogan && (
        <p className="text-center text-blue-200/80 italic text-lg">“{slogan}”</p>
      )}

      <section>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">Series Results — {DIVISION_LABEL[division]}</span>
          <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
          <span className="text-[10px] font-bold text-blue-300/60">{results.length}</span>
        </div>
        {results.length === 0 ? (
          <div className="text-center py-12 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">No reported series yet.</div>
        ) : (
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden divide-y divide-white/5">
            {results.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
                <span className={`flex-shrink-0 w-8 h-8 rounded-md border flex items-center justify-center font-black text-xs ${r.won ? 'bg-blue-500/20 border-blue-400/50 text-blue-100' : 'bg-white/5 border-white/20 text-white/60'}`}>
                  {r.won ? 'W' : 'L'}
                </span>
                <span className="text-white/50 text-xs w-16">{r.isPlayoff ? 'Playoffs' : `Week ${r.week ?? '—'}`}</span>
                <Link href={`/teams/${encodeURIComponent(r.opponent || '')}`} className="flex-1 text-sm font-bold text-white hover:text-blue-200 truncate">
                  vs {r.opponent}
                </Link>
                <span className={`font-mono font-black ${r.won ? 'text-blue-200' : 'text-white/70'}`}>{r.ourScore}–{r.theirScore}</span>
                {r.isForfeit && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-orange-500/15 text-orange-300 border border-orange-400/30">FF</span>}
                {r.replayGroupUrl && (
                  <a href={r.replayGroupUrl} target="_blank" rel="noreferrer"
                    className="text-[10px] uppercase font-bold text-blue-200 hover:text-white px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 rounded">
                    Replays
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">Transaction History</span>
          <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
          <span className="text-[10px] font-bold text-blue-300/60">{transactions.length}</span>
        </div>
        {transactions.length === 0 ? (
          <div className="text-center py-12 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">No transactions recorded.</div>
        ) : (
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden divide-y divide-white/5">
            {transactions.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/[0.02]">
                <span className="text-blue-300/80 font-bold text-xs w-32 truncate">{txLabel(t.type)}</span>
                <Link href={`/players/${encodeURIComponent(t.discordId || t.playerName)}`} className="text-white flex-1 truncate hover:text-blue-200">
                  {t.playerName}
                </Link>
                <span className="text-white/30 text-[10px] whitespace-nowrap">
                  {t.performedAt ? new Date(t.performedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ====================================================================
// ROSTER TAB
// ====================================================================

function LeaderCard({ icon, label, member, teamName, emptyText }) {
  const body = (
    <div className="relative flex items-center gap-4">
      {member ? (
        <Avatar src={member.avatarUrl} name={member.displayName} size={56} className="flex-shrink-0" />
      ) : (
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-400/30 to-blue-700/20 border border-blue-300/50 flex items-center justify-center flex-shrink-0">
          <svg className="h-7 w-7 text-blue-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] tracking-[0.25em] uppercase text-blue-300/70 font-bold mb-1">{label}</div>
        <div className="text-xl font-black text-white truncate">{member?.displayName || '—'}</div>
        <div className="text-xs text-blue-200/60 mt-0.5">{member ? `with ${teamName}` : emptyText}</div>
      </div>
    </div>
  )
  const cls = "relative p-6 rounded-2xl bg-gradient-to-br from-blue-500/15 via-blue-800/10 to-blue-950/20 border border-blue-400/30 overflow-hidden"
  return member?.discordId ? (
    <Link href={`/players/${encodeURIComponent(member.discordId)}`} className={`${cls} block hover:border-blue-400/60 transition-colors`}>
      <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-blue-500/20 blur-3xl pointer-events-none" />
      {body}
    </Link>
  ) : (
    <div className={cls}>
      <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-blue-500/20 blur-3xl pointer-events-none" />
      {body}
    </div>
  )
}

// On-field eligibility: actual players (player/captain/sub) — exclude GM + non-playing.
const ONFIELD_ROLES = new Set(['player', 'captain', 'sub'])

function buildOnfieldCombos(players, cap) {
  const eligible = players.filter((p) => ONFIELD_ROLES.has(p.role) && typeof p.salary === 'number')
  const combos = []
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      for (let k = j + 1; k < eligible.length; k++) {
        const trio = [eligible[i], eligible[j], eligible[k]]
        const sum = trio.reduce((s, p) => s + p.salary, 0)
        combos.push({ trio, sum, playable: cap == null ? true : sum <= cap + 1e-9 })
      }
    }
  }
  const missingSalary = players.filter((p) => ONFIELD_ROLES.has(p.role) && typeof p.salary !== 'number')
  // Not-playable (over cap) listed first, then playable (closest to cap first).
  const notPlayable = combos.filter((c) => !c.playable).sort((a, b) => a.sum - b.sum)
  const playable = combos.filter((c) => c.playable).sort((a, b) => b.sum - a.sum)
  return { notPlayable, playable, eligibleCount: eligible.length, missingSalary }
}

function OnFieldLineups({ players, cap }) {
  const { notPlayable, playable, eligibleCount, missingSalary } = buildOnfieldCombos(players, cap)
  if (eligibleCount < 3) {
    return (
      <div className="text-center py-10 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
        Need at least 3 players with a listed salary to compute on-field lineups.
        {missingSalary.length > 0 && <div className="mt-1 text-[11px] text-white/30">{missingSalary.length} player(s) missing a salary.</div>}
      </div>
    )
  }

  const Row = ({ c }) => (
    <li className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
      c.playable ? 'bg-blue-500/[0.04] border-blue-400/20' : 'bg-red-500/[0.06] border-red-400/30'
    }`}>
      <span className="flex-1 min-w-0 truncate text-white/90">
        {c.trio.map((p) => p.displayName).join('  ·  ')}
      </span>
      <span className={`font-mono font-bold ${c.playable ? 'text-blue-200' : 'text-red-300'}`}>{c.sum.toFixed(2)}</span>
      {!c.playable && <span className="text-[9px] uppercase font-bold text-red-300/80">over cap</span>}
    </li>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-blue-100/70">
          On-field cap: <strong className="text-white">{cap != null ? cap.toFixed(2) : '—'}</strong>
          <span className="text-white/40"> · 3-player lineups (salaries from the sheet)</span>
        </div>
        <div className="text-[11px] text-white/50">
          <span className="text-green-300 font-bold">{playable.length}</span> playable · <span className="text-red-300 font-bold">{notPlayable.length}</span> over cap
        </div>
      </div>

      {missingSalary.length > 0 && (
        <div className="text-[11px] text-amber-300/70">
          Note: {missingSalary.map((p) => p.displayName).join(', ')} {missingSalary.length === 1 ? 'has' : 'have'} no listed salary and {missingSalary.length === 1 ? 'is' : 'are'} excluded from lineups.
        </div>
      )}

      {notPlayable.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-red-300/80 mb-2">Not Playable (over cap)</div>
          <ul className="space-y-1.5">{notPlayable.map((c, i) => <Row key={`np-${i}`} c={c} />)}</ul>
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-blue-300/80 mb-2">Playable Lineups</div>
        {playable.length === 0 ? (
          <div className="text-sm text-white/40 italic py-4">No 3-player lineup fits under the cap.</div>
        ) : (
          <ul className="space-y-1.5">{playable.map((c, i) => <Row key={`p-${i}`} c={c} />)}</ul>
        )}
      </div>
    </div>
  )
}

function RosterTab({ teamName, roster, onfieldCap }) {
  const hasRoster = roster.players.length > 0 || roster.gm
  return (
    <div className="space-y-10">
      {/* On-field lineup calculator (only when this division has a cap set) */}
      {onfieldCap != null && roster.players.length > 0 && (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">On-Field Lineups</span>
            <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
          </div>
          <OnFieldLineups players={roster.players} cap={onfieldCap} />
        </div>
      )}

      {/* Leadership */}
      <FadeIn>
        <div className="mb-4 flex items-center gap-3">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">
            Leadership
          </span>
          <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <LeaderCard
            label="General Manager"
            icon="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
            member={roster.gm}
            teamName={teamName}
            emptyText="No GM assigned"
          />
          <LeaderCard
            label="Team Captain"
            icon="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2M16.5 7.5l2.83 2.83a2 2 0 010 2.83l-.83.83a2 2 0 01-2.83 0L12.84 10.67M9 7a4 4 0 100 8 4 4 0 000-8z"
            member={roster.captain}
            teamName={teamName}
            emptyText="No captain assigned"
          />
        </div>
      </FadeIn>

      {/* Players */}
      <div>
        <FadeIn>
          <div className="mb-4 flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">
              Active Roster
            </span>
            <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
            <span className="text-[10px] font-bold text-blue-300/60">
              {roster.players.length} {roster.players.length === 1 ? 'player' : 'players'}
            </span>
          </div>
        </FadeIn>

        {!hasRoster ? (
          <div className="text-center py-16 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
            No roster set for this team yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {roster.players.map((p, i) => (
              <FadeIn key={p.discordId || p.displayName} delay={i * 0.04} y={20}>
                <Link
                  href={`/players/${encodeURIComponent(p.discordId || p.displayName)}`}
                  className="group relative flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-blue-400/50 hover:bg-blue-500/5 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(59,130,246,0.18)] transition-all overflow-hidden"
                >
                  <Avatar src={p.avatarUrl} name={p.displayName} size={52} className="flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-black text-white group-hover:text-blue-200 transition-colors truncate">
                      {p.displayName}
                    </div>
                    {p.username && <div className="text-[10px] text-blue-300/50 truncate">@{p.username}</div>}
                  </div>
                  <span
                    className={`flex-shrink-0 text-[9px] font-bold tracking-[0.15em] uppercase px-2.5 py-1 rounded-full border ${
                      p.isCaptain
                        ? 'bg-blue-500/20 border-blue-400/50 text-blue-100'
                        : 'bg-white/5 border-white/15 text-white/60'
                    }`}
                  >
                    {ROLE_LABEL[p.role] || p.role}
                  </span>
                </Link>
              </FadeIn>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ====================================================================
// SCHEDULE TAB — ticket stub match cards (matches the public schedules page)
// ====================================================================

function ScheduleTab({ teamName, schedule, division }) {
  const entries = Object.entries(schedule)

  if (entries.length === 0) {
    return (
      <div className="text-center py-20 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
        No matches scheduled for {teamName} in {DIVISION_LABEL[division]}.
      </div>
    )
  }

  return (
    <div className="space-y-10">
      {entries.map(([week, matches], weekIndex) => {
        const weekNum = week.split(' ')[1] || String(weekIndex + 1)
        return (
          <FadeIn key={week} delay={weekIndex * 0.04} y={20}>
            <section>
              {/* Week header */}
              <div className="flex items-center gap-4 mb-5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/60">
                    Week
                  </span>
                  <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-300 leading-none">
                    {String(weekNum).padStart(2, '0')}
                  </span>
                </div>
                <div className="flex-1 h-px bg-gradient-to-r from-blue-400/40 via-blue-400/20 to-transparent" />
                <div className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-400/30 text-[10px] font-bold tracking-wider uppercase text-blue-200">
                  {matches.length} {matches.length === 1 ? 'match' : 'matches'}
                </div>
              </div>

              {/* Match cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {matches.map((match, i) => {
                  // Always render the current team on top (home half)
                  const teamIsFirst = match[0] === teamName
                  const ownTeam = teamIsFirst ? match[0] : match[1]
                  const opponent = teamIsFirst ? match[1] : match[0]
                  return (
                    <MatchTicketCard
                      key={`${week}-${i}`}
                      ownTeam={ownTeam}
                      opponent={opponent}
                      isHome={teamIsFirst}
                    />
                  )
                })}
              </div>
            </section>
          </FadeIn>
        )
      })}
    </div>
  )
}

function MatchTicketCard({ ownTeam, opponent, isHome }) {
  return (
    <div className="group relative rounded-2xl border border-white/10 hover:border-blue-400/50 hover:shadow-[0_10px_40px_rgba(59,130,246,0.25)] hover:-translate-y-1 transition-all duration-500 overflow-hidden bg-black/20">
      {/* OWN TEAM half */}
      <div className="relative px-5 pt-5 pb-9 overflow-hidden bg-gradient-to-br from-blue-600/15 via-blue-500/5 to-transparent">
        <div className="absolute -top-10 -right-10 w-44 h-44 opacity-[0.1] group-hover:opacity-[0.22] transition-opacity duration-700 pointer-events-none">
          <img
            src={`/api/teams/logo?name=${encodeURIComponent(ownTeam)}`}
            alt=""
            className="w-full h-full object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        </div>
        <div className="relative flex items-center justify-end gap-3">
          <div className="text-right">
            <div className="text-[9px] font-bold tracking-[0.25em] uppercase text-blue-300/60">
              {isHome ? 'Home' : 'Away'}
            </div>
            <div className="text-base sm:text-lg font-bold text-white truncate max-w-[180px]">
              {ownTeam}
            </div>
          </div>
          <div className="flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center">
            <TeamLogoImg name={ownTeam} className="w-full h-full" imgClassName="w-full h-full object-contain drop-shadow-lg" />
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="relative h-0 z-20">
        <div className="absolute inset-x-8 top-0 border-t border-dashed border-blue-400/30" />
        <div className="absolute left-0 top-0 -translate-y-1/2 w-4 h-4 rounded-full bg-[#0a0f1e] border border-blue-400/30" />
        <div className="absolute right-0 top-0 -translate-y-1/2 w-4 h-4 rounded-full bg-[#0a0f1e] border border-blue-400/30" />
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/40 blur-xl rounded-full" />
            <div className="relative w-14 h-14 rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 border-2 border-blue-200/50 flex items-center justify-center shadow-[0_0_30px_rgba(59,130,246,0.7)] group-hover:shadow-[0_0_45px_rgba(59,130,246,1)] transition-shadow">
              <span className="text-xs font-black text-white tracking-[0.1em] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                VS
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* OPPONENT half */}
      <Link
        href={`/teams/${encodeURIComponent(opponent)}`}
        className="relative block px-5 pt-9 pb-5 overflow-hidden bg-gradient-to-tr from-transparent via-blue-500/5 to-blue-400/10"
      >
        <div className="absolute -bottom-10 -left-10 w-44 h-44 opacity-[0.1] group-hover:opacity-[0.22] transition-opacity duration-700 pointer-events-none">
          <img
            src={`/api/teams/logo?name=${encodeURIComponent(opponent)}`}
            alt=""
            className="w-full h-full object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        </div>
        <div className="relative flex items-center gap-3">
          <div className="flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center">
            <TeamLogoImg name={opponent} className="w-full h-full" imgClassName="w-full h-full object-contain drop-shadow-lg" />
          </div>
          <div className="text-left">
            <div className="text-[9px] font-bold tracking-[0.25em] uppercase text-blue-300/60">
              Opponent
            </div>
            <div className="text-base sm:text-lg font-bold text-white hover:text-blue-200 transition-colors truncate max-w-[180px]">
              {opponent}
            </div>
          </div>
        </div>
      </Link>
    </div>
  )
}

// ====================================================================
// STATS TAB
// ====================================================================

function StatsTab({ stats }) {
  if (!stats.hasData) {
    return (
      <div className="text-center py-20 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
        No games recorded for this team yet. Stats appear here once matches are reported.
      </div>
    )
  }

  return (
    <div className="space-y-10">
      {/* Big stat blocks */}
      <FadeIn>
        <div className="mb-4 flex items-center gap-3">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">
            Season Record
          </span>
          <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Wins', value: stats.wins, glow: true },
            { label: 'Losses', value: stats.losses },
            { label: 'Goals For', value: stats.goalsFor },
            { label: 'Goals Against', value: stats.goalsAgainst },
          ].map((s) => (
            <div
              key={s.label}
              className={`p-5 rounded-2xl border backdrop-blur-sm ${
                s.glow
                  ? 'bg-blue-500/10 border-blue-400/50 shadow-[0_0_30px_rgba(59,130,246,0.15)]'
                  : 'bg-white/[0.03] border-white/10'
              }`}
            >
              <div className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-300">
                {s.value}
              </div>
              <div className="text-[10px] text-blue-300/60 tracking-[0.2em] uppercase mt-2">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </FadeIn>

      {/* Detail grid — all derived from the real record */}
      <FadeIn delay={0.1}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 p-6 rounded-2xl bg-white/[0.03] border border-white/10">
            <div className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-4">Summary</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-[9px] font-bold tracking-wider uppercase text-blue-300/60">Games</div>
                <div className="text-lg font-black text-white mt-0.5">{stats.totalGames}</div>
              </div>
              <div>
                <div className="text-[9px] font-bold tracking-wider uppercase text-blue-300/60">Win Rate</div>
                <div className="text-lg font-black text-white mt-0.5">{stats.winPct}%</div>
              </div>
              <div>
                <div className="text-[9px] font-bold tracking-wider uppercase text-blue-300/60">Game W-L</div>
                <div className="text-lg font-black text-white mt-0.5">{stats.gameWins}-{stats.gameLosses}</div>
              </div>
              <div>
                <div className="text-[9px] font-bold tracking-wider uppercase text-blue-300/60">Avg GF / GA</div>
                <div className="text-lg font-black text-white mt-0.5">{stats.avgGoalsFor} / {stats.avgGoalsAgainst}</div>
              </div>
            </div>
          </div>

          {/* Goal differential badge */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-blue-500/15 via-blue-800/10 to-blue-950/20 border border-blue-400/40">
            <div className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">
              Goal Differential
            </div>
            <div className="text-6xl font-black leading-none text-transparent bg-clip-text bg-gradient-to-b from-blue-200 to-blue-500">
              {stats.diff > 0 ? `+${stats.diff}` : stats.diff}
            </div>
            <div className="text-xs text-blue-200/60 mt-3">
              Avg {stats.avgGoalsFor} per game · {stats.avgGoalsAgainst} against
            </div>
          </div>
        </div>
      </FadeIn>
    </div>
  )
}
