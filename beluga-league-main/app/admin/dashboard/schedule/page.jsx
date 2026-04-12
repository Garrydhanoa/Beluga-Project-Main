'use client'

import { useEffect, useMemo, useState, useRef } from 'react'

const DIVISIONS = ['Majors', 'AAA', 'AA']

// Division rosters — mirrors the current real schedule in lib/scheduleData.js.
// Majors is 10 teams; AAA/AA share all 14 teams.
const DIVISION_TEAMS = {
  Majors: [
    '6 Speed', 'Archangels', 'Aviators', 'Clovis Esports', 'InTraCate',
    'Lotus', 'Malfeasance', 'Panthers', 'Sublunary', 'Surge',
  ],
  AAA: [
    '6 Speed', 'Archangels', 'Aviators', 'Clovis Esports', 'Griffins',
    'Immortals', 'InTraCate', 'Kingdom', 'Lotus', 'Malfeasance',
    'MNML', 'Panthers', 'Sublunary', 'Surge',
  ],
  AA: [
    '6 Speed', 'Archangels', 'Aviators', 'Clovis Esports', 'Griffins',
    'Immortals', 'InTraCate', 'Kingdom', 'Lotus', 'Malfeasance',
    'MNML', 'Panthers', 'Sublunary', 'Surge',
  ],
}

// ----- Helpers -----
const pairKey = (a, b) => [a, b].sort().join('|')

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function pairTeams(teams) {
  const shuffled = shuffle(teams)
  const pairs = []
  for (let i = 0; i < shuffled.length - 1; i += 2) {
    pairs.push([shuffled[i], shuffled[i + 1]])
  }
  return pairs
}

// Generate one week of matches for a division, preferring pairings that
// haven't been used yet in `existingPairKeys`. Each team plays twice
// (two rounds), and we try to avoid round1==round2 pairings within the week.
function generateWeekSmart(teams, existingPairKeys, attempts = 120) {
  if (teams.length % 2 !== 0) return []

  let best = null
  let bestScore = Infinity

  for (let i = 0; i < attempts; i++) {
    const round1 = pairTeams(teams)
    const round1Keys = new Set(round1.map(([a, b]) => pairKey(a, b)))

    let round2 = []
    for (let r = 0; r < 30; r++) {
      const candidate = pairTeams(teams)
      const intraDup = candidate.some(([a, b]) => round1Keys.has(pairKey(a, b)))
      if (!intraDup) {
        round2 = candidate
        break
      }
      round2 = candidate
    }

    const all = [...round1, ...round2]
    const rematches = all.filter(([a, b]) => existingPairKeys.has(pairKey(a, b))).length

    if (rematches < bestScore) {
      best = all
      bestScore = rematches
      if (rematches === 0) break
    }
  }

  return best || []
}

function makeMatchId(div, week, home, away) {
  return `${div}-W${week}-${home}-${away}-${Math.random().toString(36).slice(2, 8)}`
}

function generateScheduleForDivision(divisionName, weekCount, seedExistingPairs = new Set()) {
  const teams = DIVISION_TEAMS[divisionName] || []
  const items = []
  const seenPairs = new Set(seedExistingPairs)

  for (let week = 1; week <= weekCount; week++) {
    const matches = generateWeekSmart(teams, seenPairs)
    matches.forEach(([home, away]) => {
      seenPairs.add(pairKey(home, away))
      items.push({
        id: makeMatchId(divisionName, week, home, away),
        division: divisionName,
        week,
        homeTeam: home,
        awayTeam: away,
      })
    })
  }
  return items
}

function groupByWeek(items) {
  const map = items.reduce((acc, m) => {
    const w = m.week || 1
    if (!acc[w]) acc[w] = []
    acc[w].push(m)
    return acc
  }, {})
  return Object.entries(map)
    .map(([week, matches]) => [Number(week), matches])
    .sort((a, b) => a[0] - b[0])
}

// ----- Validation -----
function validateSchedule(schedule) {
  const byMatch = {} // id -> issues[]
  const byWeek = {} // week -> issues[]

  // Per-match checks
  schedule.forEach((m) => {
    const issues = []
    if (m.homeTeam && m.awayTeam && m.homeTeam === m.awayTeam) {
      issues.push('Team scheduled to play itself')
    }
    const roster = DIVISION_TEAMS[m.division] || []
    if (m.homeTeam && !roster.includes(m.homeTeam)) {
      issues.push(`${m.homeTeam} is not in ${m.division}`)
    }
    if (m.awayTeam && !roster.includes(m.awayTeam)) {
      issues.push(`${m.awayTeam} is not in ${m.division}`)
    }
    if (!m.homeTeam || !m.awayTeam) {
      issues.push('Match is missing a team')
    }
    if (issues.length > 0) byMatch[m.id] = issues
  })

  // Duplicate matchups within week+division
  const pairSeen = {}
  schedule.forEach((m) => {
    if (!m.homeTeam || !m.awayTeam) return
    const key = `${m.week}|${m.division}|${pairKey(m.homeTeam, m.awayTeam)}`
    if (pairSeen[key]) {
      const prevId = pairSeen[key]
      ;[m.id, prevId].forEach((id) => {
        if (!byMatch[id]) byMatch[id] = []
        if (!byMatch[id].includes('Duplicate matchup this week')) {
          byMatch[id].push('Duplicate matchup this week')
        }
      })
    } else {
      pairSeen[key] = m.id
    }
  })

  // Per-team appearance counts per week per division
  const counts = {} // `${week}|${division}` -> { team: count }
  schedule.forEach((m) => {
    const key = `${m.week || 1}|${m.division}`
    if (!counts[key]) counts[key] = {}
    ;[m.homeTeam, m.awayTeam].forEach((t) => {
      if (t) counts[key][t] = (counts[key][t] || 0) + 1
    })
  })

  Object.entries(counts).forEach(([key, teamCounts]) => {
    const [week, division] = key.split('|')
    const roster = DIVISION_TEAMS[division] || []
    const weekNum = Number(week)

    // Roster teams with wrong count
    roster.forEach((t) => {
      const c = teamCounts[t] || 0
      if (c !== 2) {
        if (!byWeek[weekNum]) byWeek[weekNum] = []
        byWeek[weekNum].push(
          c === 0
            ? `${t} (${division}): 0 games`
            : c === 1
              ? `${t} (${division}): only 1 game`
              : `${t} (${division}): ${c} games (should be 2)`
        )
      }
    })
  })

  const matchWarningCount = Object.values(byMatch).reduce((s, a) => s + a.length, 0)
  const weekWarningCount = Object.values(byWeek).reduce((s, a) => s + a.length, 0)
  const total = matchWarningCount + weekWarningCount

  return { byMatch, byWeek, total }
}

// ----- Team select helper -----
function TeamSelect({ value, division, onChange, placeholder, align = 'left' }) {
  const roster = DIVISION_TEAMS[division] || []
  const isValid = !value || roster.includes(value)
  const alignment = align === 'right' ? 'text-right' : 'text-left'

  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className={`flex-1 min-w-0 px-3 py-2.5 rounded-lg text-base font-bold cursor-pointer focus:outline-none truncate transition ${alignment} ${
        isValid
          ? 'bg-black/30 hover:bg-black/50 border border-transparent hover:border-white/10 focus:border-blue-400/60 focus:bg-black/50 text-white'
          : 'bg-red-500/10 border border-red-400/60 text-red-200'
      }`}
    >
      <option value="" className="bg-gray-900 text-white/60">
        {placeholder || '— select team —'}
      </option>
      {!isValid && value && (
        <option value={value} className="bg-red-900 text-red-200">
          {value} (invalid)
        </option>
      )}
      {roster.map((t) => (
        <option key={t} value={t} className="bg-gray-900 text-white">
          {t}
        </option>
      ))}
    </select>
  )
}

export default function SchedulePage() {
  const [schedule, setSchedule] = useState(null)
  const [published, setPublished] = useState([])
  const [hasDraft, setHasDraft] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [toast, setToast] = useState(null)

  // Undo
  const [snapshot, setSnapshot] = useState(null)
  const [undoLabel, setUndoLabel] = useState(null)
  const [undoRemaining, setUndoRemaining] = useState(0)
  const undoTimerRef = useRef(null)
  const undoIntervalRef = useRef(null)

  // Randomizer state
  const [showRandomizer, setShowRandomizer] = useState(false)
  const [randDivision, setRandDivision] = useState('all')
  const [randWeeks, setRandWeeks] = useState(8)
  const [randMode, setRandMode] = useState('replace')

  // Load both published schedule and draft on mount
  useEffect(() => {
    fetch('/api/admin/data')
      .then((r) => r.json())
      .then((data) => {
        const pub = data.schedule || []
        const draft = data.scheduleDraft
        setPublished(pub)
        if (Array.isArray(draft) && draft.length > 0) {
          setSchedule(draft)
          setHasDraft(true)
        } else {
          setSchedule(pub)
          setHasDraft(false)
        }
      })
      .catch(() => setSchedule([]))
  }, [])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    }
  }, [])

  function showToast(message) {
    setToast(message)
    setTimeout(() => setToast(null), 2500)
  }

  function takeSnapshot(label) {
    setSnapshot(schedule)
    setUndoLabel(label)
    setUndoRemaining(10)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    undoIntervalRef.current = setInterval(() => {
      setUndoRemaining((r) => Math.max(0, r - 1))
    }, 1000)
    undoTimerRef.current = setTimeout(() => {
      setSnapshot(null)
      setUndoLabel(null)
      setUndoRemaining(0)
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    }, 10000)
  }

  function undo() {
    if (!snapshot) return
    setSchedule(snapshot)
    setSnapshot(null)
    setUndoLabel(null)
    setUndoRemaining(0)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    showToast('↩ Undone')
  }

  async function saveLater() {
    setSavingDraft(true)
    try {
      const res = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'scheduleDraft', data: schedule }),
      })
      if (res.ok) {
        setHasDraft(true)
        showToast('✓ Draft saved')
      }
    } finally {
      setSavingDraft(false)
    }
  }

  async function publish() {
    setPublishing(true)
    try {
      const res = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'schedule', data: schedule }),
      })
      if (res.ok) {
        setPublished(schedule)
        await fetch('/api/admin/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'scheduleDraft', data: null }),
        })
        setHasDraft(false)
        showToast('✓ Published')
      }
    } finally {
      setPublishing(false)
    }
  }

  function update(id, patch) {
    setSchedule(schedule.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function add() {
    setSchedule([
      ...schedule,
      {
        id: `new-${Date.now()}`,
        division: 'Majors',
        week: 1,
        homeTeam: '',
        awayTeam: '',
      },
    ])
  }

  function remove(id) {
    setSchedule(schedule.filter((s) => s.id !== id))
  }

  function handleRandomize() {
    takeSnapshot('Randomize')
    const divisionsToGenerate = randDivision === 'all' ? DIVISIONS : [randDivision]
    const generated = divisionsToGenerate.flatMap((d) =>
      generateScheduleForDivision(d, randWeeks)
    )
    if (randMode === 'replace') {
      const preserved = schedule.filter((s) => !divisionsToGenerate.includes(s.division))
      setSchedule([...preserved, ...generated])
    } else {
      setSchedule([...schedule, ...generated])
    }
    setShowRandomizer(false)
  }

  // Re-roll a single week — keeps other weeks intact and tries to avoid
  // repeating pairings from those other weeks.
  function reRollWeek(week) {
    takeSnapshot(`Re-roll W${week}`)
    const newItems = []
    DIVISIONS.forEach((division) => {
      const divisionMatches = schedule.filter((s) => s.division === division)
      const hasAnyInWeek = divisionMatches.some((s) => s.week === week)
      if (!hasAnyInWeek) return

      // Gather pairings from all weeks EXCEPT this one
      const otherPairs = new Set()
      divisionMatches
        .filter((s) => s.week !== week && s.homeTeam && s.awayTeam)
        .forEach((s) => otherPairs.add(pairKey(s.homeTeam, s.awayTeam)))

      const teams = DIVISION_TEAMS[division] || []
      const matches = generateWeekSmart(teams, otherPairs)
      matches.forEach(([home, away]) => {
        newItems.push({
          id: makeMatchId(division, week, home, away),
          division,
          week,
          homeTeam: home,
          awayTeam: away,
        })
      })
    })

    // Remove old week entries, add new
    const preserved = schedule.filter((s) => s.week !== week)
    setSchedule([...preserved, ...newItems])
  }

  // Derived views
  const groupedEditor = useMemo(() => (schedule ? groupByWeek(schedule) : []), [schedule])
  const groupedPublished = useMemo(() => groupByWeek(published), [published])
  const validation = useMemo(
    () => (schedule ? validateSchedule(schedule) : { byMatch: {}, byWeek: {}, total: 0 }),
    [schedule]
  )

  if (!schedule) return <div className="text-blue-200/60">Loading…</div>

  return (
    <div className="max-w-[1440px]">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70">
              Upcoming Matches
            </div>
            {hasDraft && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-400/40 text-[9px] font-bold tracking-wider uppercase text-blue-200">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                Draft
              </span>
            )}
            {validation.total > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/20 border border-red-400/50 text-[9px] font-bold tracking-wider uppercase text-red-200">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {validation.total} {validation.total === 1 ? 'warning' : 'warnings'}
              </span>
            )}
          </div>
          <h1 className="text-3xl font-black text-white mb-2">Schedule Builder</h1>
          <p className="text-blue-100/60 text-sm">
            Each team plays two matches per week in their division.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {snapshot && (
            <button
              onClick={undo}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-blue-500/20 border border-blue-400/60 text-blue-100 hover:bg-blue-500/30 transition-all inline-flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              Undo {undoLabel} ({undoRemaining}s)
            </button>
          )}
          <button
            onClick={() => setShowRandomizer(!showRandomizer)}
            className={`px-4 py-2 text-sm font-bold rounded-lg border transition-all ${
              showRandomizer
                ? 'bg-blue-500/20 border-blue-400/60 text-blue-100'
                : 'bg-blue-500/10 border-blue-400/40 text-blue-200 hover:bg-blue-500/20 hover:border-blue-400/60'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Randomize
            </span>
          </button>
          <button
            onClick={saveLater}
            disabled={savingDraft}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-white/5 hover:bg-white/10 border border-white/20 hover:border-blue-400/50 text-white disabled:opacity-50 transition-all"
          >
            {savingDraft ? 'Saving…' : 'Save Later'}
          </button>
          <button
            onClick={add}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/20 hover:border-blue-400/50 text-white text-sm font-bold rounded-lg transition"
          >
            + New Match
          </button>
          <button
            onClick={publish}
            disabled={publishing}
            className="px-5 py-2 bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/50 text-white text-sm font-bold rounded-lg shadow-[0_0_25px_rgba(59,130,246,0.4)] hover:shadow-[0_0_40px_rgba(59,130,246,0.7)] transition-all"
          >
            {publishing ? 'Publishing…' : 'Publish Schedule'}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="mb-4 inline-block px-4 py-2 rounded-lg bg-blue-500/15 border border-blue-400/40 text-sm text-blue-200 font-semibold">
          {toast}
        </div>
      )}

      {/* Randomizer panel */}
      {showRandomizer && (
        <div className="mb-6 p-5 rounded-2xl bg-blue-500/10 border border-blue-400/40 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-bold tracking-[0.2em] uppercase text-blue-300">
                Generate Random Schedule
              </div>
              <div className="text-xs text-blue-100/60 mt-0.5">
                Minimizes rematches across the full season. Each team plays 2 per week.
              </div>
            </div>
            <button
              onClick={() => setShowRandomizer(false)}
              className="text-blue-300/60 hover:text-blue-200 p-1"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-[1fr_120px_1fr_auto] gap-3 items-end">
            <div>
              <label className="block text-[10px] font-bold tracking-wider uppercase text-blue-300/70 mb-1">
                Division
              </label>
              <select
                value={randDivision}
                onChange={(e) => setRandDivision(e.target.value)}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-400/60"
              >
                <option value="all">All Divisions</option>
                {DIVISIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} ({DIVISION_TEAMS[d].length} teams)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-wider uppercase text-blue-300/70 mb-1">
                Weeks
              </label>
              <input
                type="number"
                value={randWeeks}
                onChange={(e) => setRandWeeks(Math.max(1, parseInt(e.target.value, 10) || 1))}
                min={1}
                max={20}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-400/60"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold tracking-wider uppercase text-blue-300/70 mb-1">
                Mode
              </label>
              <select
                value={randMode}
                onChange={(e) => setRandMode(e.target.value)}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-400/60"
              >
                <option value="replace">Replace existing</option>
                <option value="append">Append to existing</option>
              </select>
            </div>
            <button
              onClick={handleRandomize}
              className="px-5 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-bold rounded-lg shadow-[0_0_20px_rgba(59,130,246,0.4)] transition"
            >
              Generate →
            </button>
          </div>
        </div>
      )}

      {/* Main layout: editor + published sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        {/* LEFT — Editor */}
        <div>
          {schedule.length === 0 ? (
            <div className="text-center py-16 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
              No matches yet — use Randomize or + New Match to start.
            </div>
          ) : (
            <div className="space-y-8">
              {groupedEditor.map(([week, matches]) => {
                const divCounts = DIVISIONS.reduce((acc, d) => {
                  acc[d] = matches.filter((m) => m.division === d).length
                  return acc
                }, {})
                const weekIssues = validation.byWeek[week] || []
                const sortedMatches = matches.slice().sort((a, b) => {
                  if (a.division !== b.division) return a.division.localeCompare(b.division)
                  return String(a.id).localeCompare(String(b.id))
                })

                return (
                  <section key={week}>
                    {/* Week header */}
                    <div className="flex items-center gap-4 mb-4">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/60">
                          Week
                        </span>
                        <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-300 leading-none">
                          {String(week).padStart(2, '0')}
                        </span>
                      </div>
                      <button
                        onClick={() => reRollWeek(week)}
                        title="Re-roll this week (keeps other weeks intact)"
                        className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 hover:border-blue-400/60 text-blue-200 text-[10px] font-bold tracking-wider uppercase transition"
                      >
                        <svg className="h-3 w-3 group-hover:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Re-roll
                      </button>
                      <div className="flex-1 h-px bg-gradient-to-r from-blue-400/40 via-blue-400/20 to-transparent" />
                      <div className="flex items-center gap-2 text-[10px] font-bold tracking-wider uppercase">
                        {DIVISIONS.map((d) =>
                          divCounts[d] > 0 ? (
                            <span
                              key={d}
                              className="px-2 py-1 rounded-full bg-blue-500/10 border border-blue-400/30 text-blue-200"
                            >
                              {d} · {divCounts[d]}
                            </span>
                          ) : null
                        )}
                        {weekIssues.length > 0 && (
                          <span
                            className="px-2 py-1 rounded-full bg-red-500/20 border border-red-400/50 text-red-200 cursor-help"
                            title={weekIssues.join('\n')}
                          >
                            ⚠ {weekIssues.length}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Match cards grid */}
                    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                      {sortedMatches.map((s) => {
                        const matchIssues = validation.byMatch[s.id] || []
                        const hasIssues = matchIssues.length > 0
                        return (
                          <div
                            key={s.id}
                            className={`group relative p-4 rounded-xl bg-white/[0.03] border transition-all ${
                              hasIssues
                                ? 'border-red-400/50 hover:border-red-400/70 bg-red-500/[0.04] hover:shadow-[0_4px_20px_rgba(239,68,68,0.2)]'
                                : 'border-white/10 hover:border-blue-400/50 hover:bg-blue-500/5 hover:shadow-[0_4px_20px_rgba(59,130,246,0.15)]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <div className="flex items-center gap-2">
                                <select
                                  value={s.division}
                                  onChange={(e) => update(s.id, { division: e.target.value })}
                                  className="px-2.5 py-1 bg-blue-500/15 border border-blue-400/40 hover:border-blue-400/70 rounded-full text-blue-200 text-[10px] font-bold tracking-wider uppercase focus:outline-none cursor-pointer transition"
                                >
                                  {DIVISIONS.map((d) => (
                                    <option key={d} value={d} className="bg-gray-900">
                                      {d}
                                    </option>
                                  ))}
                                </select>
                                <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 border border-white/10">
                                  <span className="text-[9px] font-bold tracking-wider uppercase text-blue-300/60">W</span>
                                  <input
                                    type="number"
                                    value={s.week}
                                    onChange={(e) =>
                                      update(s.id, { week: parseInt(e.target.value, 10) || 1 })
                                    }
                                    min={1}
                                    className="w-6 bg-transparent text-[10px] font-black text-white text-center focus:outline-none"
                                  />
                                </div>
                                {hasIssues && (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/20 border border-red-400/50 text-red-200 text-[10px] font-bold cursor-help"
                                    title={matchIssues.join('\n')}
                                  >
                                    ⚠ {matchIssues.length}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span
                                  className="text-[9px] font-mono text-blue-300/40 truncate max-w-[140px]"
                                  title={String(s.id)}
                                >
                                  #{String(s.id)}
                                </span>
                                <button
                                  onClick={() => remove(s.id)}
                                  className="opacity-0 group-hover:opacity-100 text-red-400/70 hover:text-red-300 hover:bg-red-500/10 rounded w-6 h-6 flex items-center justify-center transition"
                                  aria-label="Delete"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <TeamSelect
                                value={s.homeTeam}
                                division={s.division}
                                onChange={(v) => update(s.id, { homeTeam: v })}
                                placeholder="— home —"
                                align="right"
                              />
                              <div className="flex-shrink-0 relative">
                                <div className="absolute inset-0 bg-blue-500/20 blur-md rounded-full" />
                                <div className="relative w-10 h-10 rounded-full bg-blue-500/20 border border-blue-400/50 flex items-center justify-center">
                                  <span className="text-[10px] font-black text-blue-200 tracking-wider">VS</span>
                                </div>
                              </div>
                              <TeamSelect
                                value={s.awayTeam}
                                division={s.division}
                                onChange={(v) => update(s.id, { awayTeam: v })}
                                placeholder="— away —"
                                align="left"
                              />
                            </div>
                            {hasIssues && (
                              <div className="mt-3 pt-3 border-t border-red-400/20 space-y-1">
                                {matchIssues.map((issue, i) => (
                                  <div key={i} className="flex items-start gap-2 text-[11px] text-red-200/90">
                                    <span className="text-red-400 leading-tight">⚠</span>
                                    <span>{issue}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          )}
          <div className="mt-6 text-xs text-blue-200/50">
            {schedule.length} {schedule.length === 1 ? 'match' : 'matches'} in editor
          </div>
        </div>

        {/* RIGHT — Published sidebar */}
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 bg-black/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
                  <div className="text-xs font-bold tracking-[0.2em] uppercase text-blue-200">
                    Published
                  </div>
                </div>
                <div className="text-[10px] text-blue-300/60 font-semibold">
                  {published.length} {published.length === 1 ? 'match' : 'matches'}
                </div>
              </div>
              <div className="text-[10px] text-white/40 mt-1">
                What&apos;s live on the site right now
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto">
              {published.length === 0 ? (
                <div className="p-8 text-center text-xs text-white/40">
                  Nothing published yet.
                </div>
              ) : (
                <div className="p-3 space-y-4">
                  {groupedPublished.map(([week, matches]) => (
                    <div key={week}>
                      <div className="flex items-center gap-2 px-2 mb-2">
                        <span className="text-[9px] font-bold tracking-wider uppercase text-blue-300/60">
                          Week
                        </span>
                        <span className="text-sm font-black text-white leading-none">
                          {String(week).padStart(2, '0')}
                        </span>
                        <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
                        <span className="text-[9px] text-white/40">{matches.length}</span>
                      </div>
                      <div className="space-y-1.5">
                        {matches
                          .slice()
                          .sort((a, b) => {
                            if (a.division !== b.division) return a.division.localeCompare(b.division)
                            return 0
                          })
                          .map((m) => (
                            <div
                              key={m.id}
                              className="group flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 hover:border-blue-400/30 transition"
                            >
                              <span className="flex-shrink-0 text-[8px] font-bold tracking-wider uppercase text-blue-300/60 w-10">
                                {m.division}
                              </span>
                              <div className="flex-1 min-w-0 flex items-center gap-1.5 text-[11px]">
                                <span className="flex-1 text-right text-white/90 font-semibold truncate">
                                  {m.homeTeam || '—'}
                                </span>
                                <span className="flex-shrink-0 text-[8px] text-blue-300/60 font-black">
                                  VS
                                </span>
                                <span className="flex-1 text-left text-white/90 font-semibold truncate">
                                  {m.awayTeam || '—'}
                                </span>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
