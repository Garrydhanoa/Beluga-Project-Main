'use client'

import { useEffect, useState, useCallback } from 'react'

const DIVISIONS = ['Majors', 'AAA', 'AA']

export default function ScheduleAdminPage() {
  const [activeSeason, setActiveSeason] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sRes = await fetch('/api/admin/seasons', { cache: 'no-store' })
      if (!sRes.ok) throw new Error(`/api/admin/seasons returned ${sRes.status}`)
      const sData = await sRes.json()
      const seasons = sData.seasons || []
      const activeId = sData.activeSeasonId
      const active = seasons.find((x) => x.id === activeId) || seasons[0] || null
      setActiveSeason(active)

      if (active) {
        const r = await fetch(`/api/admin/seasons/${active.id}/schedule`, { cache: 'no-store' })
        if (!r.ok) {
          const text = await r.text()
          throw new Error(`Schedule fetch failed (${r.status}): ${text.slice(0, 200)}`)
        }
        const d = await r.json()
        setData(d)
      } else {
        setData(null)
      }
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  async function generate({ force = false } = {}) {
    if (!activeSeason) return
    if (force) {
      const txt = `RESET Season ${activeSeason.seasonNumber} schedule`
      const got = prompt(`This will DELETE all current schedule matches for Season ${activeSeason.seasonNumber} and generate a fresh round-robin.\n\nType "${txt}" to confirm.`)
      if (got !== txt) return
      // Reset endpoint clears the lock + matches
      await fetch(`/api/admin/seasons/${activeSeason.id}/schedule`, { cache: 'no-store', method: 'DELETE' })
    }
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/seasons/${activeSeason.id}/schedule/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish: true, weeks: data?.weeksConfigured || undefined }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.message || d.error || 'Failed to generate')
      await reload()
    } catch (e) {
      setError(e.message || 'Generate failed')
    } finally {
      setBusy(false)
    }
  }

  async function patchMatch(matchId, payload) {
    setBusy(true)
    await fetch(`/api/admin/schedule-matches/${matchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    await reload()
  }

  async function deleteMatch(matchId) {
    if (!confirm('Delete this match? (manual edit, lock unaffected)')) return
    setBusy(true)
    await fetch(`/api/admin/schedule-matches/${matchId}`, { cache: 'no-store', method: 'DELETE' })
    setBusy(false)
    await reload()
  }

  async function addMatch({ division, week, homeTeamId, awayTeamId }) {
    if (!activeSeason) return
    setBusy(true)
    const r = await fetch(`/api/admin/seasons/${activeSeason.id}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ division, week, homeTeamId, awayTeamId, publish: true }),
    })
    setBusy(false)
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setError(d.error || 'Add failed')
    }
    await reload()
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
        <h1 className="text-3xl font-black text-white mb-2">Schedule</h1>
        <p className="text-blue-100/60 text-sm max-w-3xl">
          One round-robin per season per division. Once generated, the season lock prevents accidental re-randomization. Individual matches can still be edited or removed manually without breaking the lock.
        </p>
      </div>

      {error && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}

      {loading ? (
        <div className="text-blue-200/60">Loading…</div>
      ) : !activeSeason ? (
        <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/60">
          No active season. <a href="/admin/dashboard/seasons" className="text-blue-300 hover:underline">Start a new season →</a>
        </div>
      ) : (
        <ScheduleBody
          season={activeSeason}
          data={data}
          busy={busy}
          onGenerate={() => generate({ force: false })}
          onResetGenerate={() => generate({ force: true })}
          onPatch={patchMatch}
          onDelete={deleteMatch}
          onAdd={addMatch}
        />
      )}
    </div>
  )
}

function ScheduleBody({ season, data, busy, onGenerate, onResetGenerate, onPatch, onDelete, onAdd }) {
  const matches = data?.matches || []
  const teamsByDivision = data?.teamsByDivision || {}
  const locked = !!data?.locked
  const weeksConfigured = data?.weeksConfigured || null
  const generatedAt = data?.generatedAt

  // Group matches: { Division: { Week: [matches] } }
  const grouped = {}
  for (const m of matches) {
    if (!grouped[m.division]) grouped[m.division] = {}
    if (!grouped[m.division][m.week]) grouped[m.division][m.week] = []
    grouped[m.division][m.week].push(m)
  }

  const allWeeks = Array.from(new Set(matches.map((m) => m.week))).sort((a, b) => a - b)
  const counts = DIVISIONS.map((d) => ({ division: d, count: matches.filter((m) => m.division === d).length }))

  return (
    <>
      {/* Status bar */}
      <div className={`mb-6 p-4 rounded-2xl border ${locked ? 'bg-green-500/5 border-green-400/30' : 'bg-yellow-500/5 border-yellow-400/30'}`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className={`text-xs font-bold tracking-wider uppercase mb-1 ${locked ? 'text-green-300' : 'text-yellow-300'}`}>
              {locked ? '🔒 Schedule Locked' : '⚠ No schedule generated yet'}
            </div>
            <div className="text-sm text-white/70">
              Season {season.seasonNumber}
              {weeksConfigured && <span> · {weeksConfigured} weeks configured</span>}
              {generatedAt && <span> · generated {new Date(generatedAt).toLocaleString()}</span>}
            </div>
            <div className="text-xs text-white/40 mt-1">
              {counts.map((c) => `${c.division}: ${c.count}`).join(' · ')} matches
            </div>
          </div>
          <div className="flex gap-2">
            {!locked && (
              <button
                onClick={onGenerate}
                disabled={busy}
                className="px-4 py-2 text-sm font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded-lg shadow-[0_0_25px_rgba(59,130,246,0.4)]"
              >
                {busy ? 'Generating…' : '🎲 Generate round-robin'}
              </button>
            )}
            {locked && (
              <button
                onClick={onResetGenerate}
                disabled={busy}
                className="px-4 py-2 text-sm font-bold text-yellow-100 bg-yellow-500/15 hover:bg-yellow-500/25 border border-yellow-400/40 rounded-lg disabled:opacity-50"
              >
                Reset & regenerate
              </button>
            )}
          </div>
        </div>
        {locked && (
          <div className="mt-3 text-[11px] text-white/50 leading-relaxed">
            Locked schedules can still be edited match-by-match (swap teams, add/delete individual matches) — those don't break the lock.
            Use "Reset & regenerate" only when you want to wipe and re-randomize the whole season.
          </div>
        )}
      </div>

      {/* Per-division quick check */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {DIVISIONS.map((d) => {
          const teams = teamsByDivision[d] || []
          const activeTeams = teams.filter((t) => t.isActive)
          const c = matches.filter((m) => m.division === d).length
          const ok = c > 0
          return (
            <div key={d} className={`p-3 rounded-xl border ${ok ? 'bg-white/[0.04] border-white/10' : 'bg-yellow-500/5 border-yellow-400/30'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-white tracking-wider uppercase">{d}</span>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${ok ? 'bg-green-500/15 text-green-300' : 'bg-yellow-500/15 text-yellow-200'}`}>
                  {ok ? `${c} matches` : 'no schedule'}
                </span>
              </div>
              <div className="text-[11px] text-blue-200/60 mt-0.5">
                {activeTeams.length} active team{activeTeams.length === 1 ? '' : 's'}
              </div>
            </div>
          )
        })}
      </div>

      {matches.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">
          <div>No schedule rendered.</div>
          <div className="text-xs mt-2 text-white/40">
            Viewing Season ID <span className="font-mono text-blue-300">{season.id}</span> · matches in response: <span className="font-mono">{matches.length}</span> · locked: <span className="font-mono">{String(locked)}</span>
            {generatedAt && <> · generated {new Date(generatedAt).toLocaleString()}</>}
          </div>
          <div className="text-xs mt-2 text-white/30">
            If the DB has rows but this is empty, hit <a href="/api/admin/diagnostic" target="_blank" className="text-blue-300 underline">/api/admin/diagnostic</a> to see what season the rows belong to.
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {DIVISIONS.map((d) => {
            const weeks = grouped[d] || {}
            const weekNums = Object.keys(weeks).map(Number).sort((a, b) => a - b)
            return (
              <div key={d} className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
                <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
                  <h3 className="text-sm font-black text-white tracking-wider uppercase">{d}</h3>
                  <span className="text-xs text-white/50">{weekNums.length} weeks · {(matches.filter((m) => m.division === d)).length} matches</span>
                </div>
                <div className="p-4 space-y-4">
                  {weekNums.map((week) => (
                    <WeekRow
                      key={week}
                      division={d}
                      week={week}
                      matches={weeks[week]}
                      teams={teamsByDivision[d] || []}
                      onPatch={onPatch}
                      onDelete={onDelete}
                    />
                  ))}
                  <AddMatchInline division={d} teams={teamsByDivision[d] || []} existingWeeks={allWeeks} onAdd={onAdd} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function WeekRow({ division, week, matches, teams, onPatch, onDelete }) {
  return (
    <div className="rounded-xl bg-black/20 border border-white/5">
      <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-blue-300/80">Week {week}</span>
        <span className="text-[10px] text-white/40">{matches.length} match{matches.length === 1 ? '' : 'es'}</span>
      </div>
      <ul className="p-2 space-y-1">
        {matches.map((m) => (
          <MatchRow key={m.id} match={m} teams={teams} onPatch={onPatch} onDelete={onDelete} />
        ))}
      </ul>
    </div>
  )
}

function MatchRow({ match, teams, onPatch, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [home, setHome] = useState(match.homeTeamId)
  const [away, setAway] = useState(match.awayTeamId)

  async function save() {
    if (home === away) { alert('Home and away must differ'); return }
    await onPatch(match.id, { homeTeamId: Number(home), awayTeamId: Number(away) })
    setEditing(false)
  }

  function swap() {
    onPatch(match.id, { homeTeamId: match.awayTeamId, awayTeamId: match.homeTeamId })
  }

  if (editing) {
    return (
      <li className="flex items-center gap-2 px-2 py-1.5 rounded bg-blue-500/5 border border-blue-400/30 text-xs">
        <select value={home} onChange={(e) => setHome(Number(e.target.value))} className="px-2 py-1 bg-black/40 border border-white/10 rounded text-white">
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="text-white/40">vs</span>
        <select value={away} onChange={(e) => setAway(Number(e.target.value))} className="px-2 py-1 bg-black/40 border border-white/10 rounded text-white">
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button onClick={save} className="ml-auto px-2 py-1 text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-400 rounded">Save</button>
        <button onClick={() => { setHome(match.homeTeamId); setAway(match.awayTeamId); setEditing(false) }} className="px-2 py-1 text-[10px] font-semibold text-white/60 hover:text-white">Cancel</button>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.03] text-xs group">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <TeamChip teamId={match.homeTeamId} name={match.homeTeam} />
        <span className="text-white/40 text-[10px] uppercase font-bold">vs</span>
        <TeamChip teamId={match.awayTeamId} name={match.awayTeam} />
      </div>
      <span className={`text-[9px] uppercase font-bold tracking-wider px-1 ${match.isPublished ? 'text-green-300' : 'text-yellow-300'}`}>
        {match.isPublished ? 'pub' : 'draft'}
      </span>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
        <button onClick={swap} className="px-1.5 py-0.5 text-[9px] uppercase font-bold text-blue-200 hover:text-white bg-blue-500/10 hover:bg-blue-500/20 rounded">swap</button>
        <button onClick={() => setEditing(true)} className="px-1.5 py-0.5 text-[9px] uppercase font-bold text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded">edit</button>
        <button onClick={() => onDelete(match.id)} className="px-1.5 py-0.5 text-[9px] uppercase font-bold text-red-300 hover:text-red-100 bg-red-500/10 hover:bg-red-500/20 rounded">del</button>
      </div>
    </li>
  )
}

function TeamChip({ teamId, name }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <img
        src={`/api/teams/logo?teamId=${teamId}`}
        alt=""
        className="w-5 h-5 rounded object-cover bg-white/5 flex-shrink-0"
        onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
      />
      <span className="text-white truncate">{name || `team#${teamId}`}</span>
    </span>
  )
}

function AddMatchInline({ division, teams, existingWeeks, onAdd }) {
  const [open, setOpen] = useState(false)
  const [week, setWeek] = useState(existingWeeks.length ? Math.max(...existingWeeks) : 1)
  const [home, setHome] = useState(teams[0]?.id || '')
  const [away, setAway] = useState(teams[1]?.id || '')

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[11px] text-blue-300 hover:text-blue-200 px-2 py-1">
        + Add match to {division}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-500/5 border border-blue-400/30 text-xs flex-wrap">
      <span className="text-white/60">Week</span>
      <input
        type="number" min={1} max={20}
        value={week}
        onChange={(e) => setWeek(parseInt(e.target.value, 10) || 1)}
        className="w-16 px-2 py-1 bg-black/40 border border-white/10 rounded text-white"
      />
      <select value={home} onChange={(e) => setHome(e.target.value)} className="px-2 py-1 bg-black/40 border border-white/10 rounded text-white">
        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <span className="text-white/40">vs</span>
      <select value={away} onChange={(e) => setAway(e.target.value)} className="px-2 py-1 bg-black/40 border border-white/10 rounded text-white">
        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <button
        onClick={async () => {
          if (Number(home) === Number(away)) { alert('Home and away must differ'); return }
          await onAdd({ division, week: Number(week), homeTeamId: Number(home), awayTeamId: Number(away) })
          setOpen(false)
        }}
        className="ml-auto px-3 py-1 text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-400 rounded"
      >
        Add
      </button>
      <button onClick={() => setOpen(false)} className="px-2 py-1 text-[10px] font-semibold text-white/60 hover:text-white">Cancel</button>
    </div>
  )
}
