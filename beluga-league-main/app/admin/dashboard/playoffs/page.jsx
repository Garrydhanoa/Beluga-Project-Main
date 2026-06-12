'use client'

import { useEffect, useMemo, useState } from 'react'

const DIVISIONS = ['Majors', 'AAA', 'AA']

function emptyBracket() {
  return {
    id: `bracket-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    division: 'Majors',
    name: 'Playoffs',
    rounds: [
      {
        id: `round-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        roundNumber: 1,
        name: 'Round 1',
        matchups: [
          {
            id: `match-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            homeTeam: '',
            awayTeam: '',
          },
        ],
      },
    ],
  }
}

// Auto-bracket (top 8 from live standings) + playoff thread creation per round.
function AutoBracketTools({ onStatus, onChanged }) {
  const [division, setDivision] = useState('Majors')
  const [round, setRound] = useState(1)
  const [busy, setBusy] = useState(false)

  async function post(payload, okMsg) {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/playoffs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const d = await r.json().catch(() => ({}))
      onStatus(r.ok ? `✓ ${okMsg}${d.note ? ` — ${d.note}` : ''}${d.seeded ? ` — ${d.seeded.join(' · ')}` : ''}` : `❌ ${d.error || 'failed'}`)
      if (r.ok) onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-6 p-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300/70 mr-2">Auto tools</span>
      <select value={division} onChange={(e) => setDivision(e.target.value)}
        className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
        {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <button disabled={busy}
        onClick={() => confirm(`Replace the ${division} bracket with an auto-seeded top-8 from the current standings?`) && post({ action: 'auto-bracket', division }, `${division} bracket seeded from standings`)}
        className="px-4 py-2 text-sm font-bold rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/40 text-purple-100">
        ⚡ Auto bracket (top 8)
      </button>
      <span className="mx-2 h-6 w-px bg-white/10" />
      <select value={round} onChange={(e) => setRound(Number(e.target.value))}
        className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
        <option value={1}>Round 1 (QF)</option>
        <option value={2}>Round 2 (Semis)</option>
        <option value={3}>Round 3 (Finals)</option>
      </select>
      <button disabled={busy}
        onClick={() => post({ action: 'create-threads', division, roundNumber: round }, 'playoff threads queued')}
        className="px-4 py-2 text-sm font-bold rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/40 text-blue-100">
        🧵 Create playoff threads
      </button>
      <span className="text-[10px] text-white/40 basis-full">Threads are named “Playoffs QF/Semis/Finals: DIV: A vs B”. Captains report playoff series in them like normal (Bo7 auto-detected). Reporting the Finals records the division champions automatically.</span>
    </div>
  )
}

export default function PlayoffsAdminPage() {
  const [brackets, setBrackets] = useState([])
  const [teamsByDivision, setTeamsByDivision] = useState({})
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    fetch('/api/admin/playoffs')
      .then((r) => r.json())
      .then((data) => setBrackets(Array.isArray(data.brackets) ? data.brackets : []))
      .catch(() => setStatus('Failed to load playoff brackets'))

    fetch('/api/admin/teams')
      .then((r) => r.json())
      .then((data) => {
        const next = {}
        for (const team of data.teams || []) {
          if (!team.isActive) continue
          if (!next[team.division]) next[team.division] = []
          next[team.division].push(team.name)
        }
        for (const key of Object.keys(next)) {
          next[key] = next[key].sort((a, b) => a.localeCompare(b))
        }
        setTeamsByDivision(next)
      })
      .catch(() => setStatus('Failed to load teams'))
  }, [])

  const normalized = useMemo(() => {
    return brackets.map((b, bIndex) => ({
      ...b,
      rounds: (b.rounds || []).map((r, rIndex) => ({
        ...r,
        roundNumber: Number(r.roundNumber || rIndex + 1),
        name: r.name || `Round ${rIndex + 1}`,
        matchups: (r.matchups || []).map((m) => ({
          ...m,
          homeTeam: m.homeTeam || '',
          awayTeam: m.awayTeam || '',
        })),
      })),
      name: b.name || `Bracket ${bIndex + 1}`,
      division: b.division || 'Majors',
    }))
  }, [brackets])

  function updateBracket(index, patch) {
    setBrackets((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)))
  }

  function addBracket() {
    setBrackets((prev) => [...prev, emptyBracket()])
  }

  function removeBracket(index) {
    setBrackets((prev) => prev.filter((_, i) => i !== index))
  }

  function addRound(bracketIndex) {
    setBrackets((prev) =>
      prev.map((b, i) => {
        if (i !== bracketIndex) return b
        const roundNumber = (b.rounds?.length || 0) + 1
        const nextRound = {
          id: `round-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          roundNumber,
          name: `Round ${roundNumber}`,
          matchups: [],
        }
        return { ...b, rounds: [...(b.rounds || []), nextRound] }
      })
    )
  }

  function removeRound(bracketIndex, roundIndex) {
    setBrackets((prev) =>
      prev.map((b, i) => {
        if (i !== bracketIndex) return b
        return { ...b, rounds: (b.rounds || []).filter((_, r) => r !== roundIndex) }
      })
    )
  }

  function addMatchup(bracketIndex, roundIndex) {
    setBrackets((prev) =>
      prev.map((b, i) => {
        if (i !== bracketIndex) return b
        const rounds = (b.rounds || []).map((r, rIndex) => {
          if (rIndex !== roundIndex) return r
          return {
            ...r,
            matchups: [
              ...(r.matchups || []),
              {
                id: `match-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                homeTeam: '',
                awayTeam: '',
              },
            ],
          }
        })
        return { ...b, rounds }
      })
    )
  }

  function removeMatchup(bracketIndex, roundIndex, matchupIndex) {
    setBrackets((prev) =>
      prev.map((b, i) => {
        if (i !== bracketIndex) return b
        const rounds = (b.rounds || []).map((r, rIndex) => {
          if (rIndex !== roundIndex) return r
          return {
            ...r,
            matchups: (r.matchups || []).filter((_, m) => m !== matchupIndex),
          }
        })
        return { ...b, rounds }
      })
    )
  }

  function updateRound(bracketIndex, roundIndex, patch) {
    setBrackets((prev) =>
      prev.map((b, i) => {
        if (i !== bracketIndex) return b
        const rounds = (b.rounds || []).map((r, rIndex) => (rIndex === roundIndex ? { ...r, ...patch } : r))
        return { ...b, rounds }
      })
    )
  }

  function updateMatchup(bracketIndex, roundIndex, matchupIndex, patch) {
    setBrackets((prev) =>
      prev.map((b, i) => {
        if (i !== bracketIndex) return b
        const rounds = (b.rounds || []).map((r, rIndex) => {
          if (rIndex !== roundIndex) return r
          const matchups = (r.matchups || []).map((m, mIndex) => (mIndex === matchupIndex ? { ...m, ...patch } : m))
          return { ...r, matchups }
        })
        return { ...b, rounds }
      })
    )
  }

  async function save() {
    setSaving(true)
    setStatus('')

    try {
      const res = await fetch('/api/admin/playoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brackets: normalized }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setStatus(payload.error || 'Failed to save playoffs')
        return
      }

      setStatus('Playoff brackets saved')
    } catch {
      setStatus('Failed to save playoffs')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-8 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">
            Brackets
          </div>
          <h1 className="text-3xl font-black text-white mb-2">Playoffs Builder</h1>
          <p className="text-blue-100/60 text-sm">Create rounds, choose matchups, and publish to the schedules page.</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={addBracket}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-white/5 hover:bg-white/10 border border-white/20 text-white"
          >
            + Add Bracket
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/50 text-white text-sm font-bold rounded-lg"
          >
            {saving ? 'Saving...' : 'Save Playoffs'}
          </button>
        </div>
      </div>

      {status && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-blue-500/10 border border-blue-400/40 text-blue-100 text-sm">
          {status}
        </div>
      )}

      <AutoBracketTools onStatus={setStatus} onChanged={() => {
        fetch('/api/admin/playoffs').then((r) => r.json()).then((d) => setBrackets(Array.isArray(d.brackets) ? d.brackets : []))
      }} />

      <div className="space-y-5">
        {normalized.map((bracket, bIndex) => {
          const teams = teamsByDivision[bracket.division] || []
          return (
            <section key={bracket.id || bIndex} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-3 flex-wrap mb-4">
                <input
                  value={bracket.name}
                  onChange={(e) => updateBracket(bIndex, { name: e.target.value })}
                  className="px-3 py-2 bg-black/30 border border-white/10 rounded text-white text-sm"
                />
                <select
                  value={bracket.division}
                  onChange={(e) => updateBracket(bIndex, { division: e.target.value })}
                  className="px-3 py-2 bg-black/30 border border-white/10 rounded text-white text-sm"
                >
                  {DIVISIONS.map((division) => (
                    <option key={division} value={division}>
                      {division}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => addRound(bIndex)}
                  className="px-3 py-2 text-xs font-bold rounded bg-blue-500/20 border border-blue-400/40 text-blue-100"
                >
                  + Round
                </button>
                <button
                  onClick={() => removeBracket(bIndex)}
                  className="px-3 py-2 text-xs font-bold rounded bg-red-500/20 border border-red-400/40 text-red-100"
                >
                  Remove Bracket
                </button>
              </div>

              <div className="space-y-4">
                {(bracket.rounds || []).map((round, rIndex) => (
                  <div key={round.id || rIndex} className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      <input
                        value={round.name}
                        onChange={(e) => updateRound(bIndex, rIndex, { name: e.target.value })}
                        className="px-3 py-2 bg-black/30 border border-white/10 rounded text-white text-sm"
                      />
                      <input
                        type="number"
                        value={round.roundNumber}
                        min={1}
                        onChange={(e) => updateRound(bIndex, rIndex, { roundNumber: Number(e.target.value) || 1 })}
                        className="w-20 px-3 py-2 bg-black/30 border border-white/10 rounded text-white text-sm"
                      />
                      <button
                        onClick={() => addMatchup(bIndex, rIndex)}
                        className="px-3 py-2 text-xs font-bold rounded bg-blue-500/20 border border-blue-400/40 text-blue-100"
                      >
                        + Matchup
                      </button>
                      <button
                        onClick={() => removeRound(bIndex, rIndex)}
                        className="px-3 py-2 text-xs font-bold rounded bg-red-500/20 border border-red-400/40 text-red-100"
                      >
                        Remove Round
                      </button>
                    </div>

                    <div className="space-y-2">
                      {(round.matchups || []).map((matchup, mIndex) => (
                        <div key={matchup.id || mIndex} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
                          <select
                            value={matchup.homeTeam}
                            onChange={(e) => updateMatchup(bIndex, rIndex, mIndex, { homeTeam: e.target.value })}
                            className="px-3 py-2 bg-black/30 border border-white/10 rounded text-white text-sm"
                          >
                            <option value="">Home Team</option>
                            {teams.map((team) => (
                              <option key={team} value={team}>{team}</option>
                            ))}
                          </select>
                          <span className="text-white/60 text-xs font-bold">VS</span>
                          <select
                            value={matchup.awayTeam}
                            onChange={(e) => updateMatchup(bIndex, rIndex, mIndex, { awayTeam: e.target.value })}
                            className="px-3 py-2 bg-black/30 border border-white/10 rounded text-white text-sm"
                          >
                            <option value="">Away Team</option>
                            {teams.map((team) => (
                              <option key={team} value={team}>{team}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => removeMatchup(bIndex, rIndex, mIndex)}
                            className="px-2 py-2 text-xs font-bold rounded bg-red-500/20 border border-red-400/40 text-red-100"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
