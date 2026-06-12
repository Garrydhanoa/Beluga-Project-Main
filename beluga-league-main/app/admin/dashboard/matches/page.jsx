'use client'

// Admin — Match Results (new Ballchasing-based stats system).
// List + inspect every reported series; edit scores / per-player stat lines,
// mark forfeits, delete series (totals recompute automatically), run a full
// recalculation, and fix player identity (remap account / merge profiles).

import { useEffect, useState, useCallback } from 'react'

const DIVISIONS = ['all', 'Majors', 'AAA', 'AA']
const STATUSES = ['all', 'confirmed', 'disputed', 'void']

export default function StatsMatchesPage() {
  const [filters, setFilters] = useState({ division: 'all', week: '', status: 'all' })
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [busyMsg, setBusyMsg] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.division !== 'all') params.set('division', filters.division)
      if (filters.week) params.set('week', filters.week)
      if (filters.status !== 'all') params.set('status', filters.status)
      const r = await fetch(`/api/admin/stats-series?${params}`, { cache: 'no-store' })
      const d = await r.json()
      setSeries(d.series || [])
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { reload() }, [reload])

  async function runRecalc() {
    if (!confirm('Rebuild ALL season totals from the per-game rows?')) return
    setBusyMsg('Recalculating…')
    await fetch('/api/admin/stats-tools', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recalc' }),
    })
    setBusyMsg('')
    await reload()
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
          <h1 className="text-3xl font-black text-white mb-2">Match Results</h1>
          <p className="text-blue-100/60 text-sm">
            Every reported series from the new stats system. Click a row to view games, player lines, and the audit trail — edit or delete; totals recompute automatically.
          </p>
        </div>
        <button onClick={runRecalc} className="px-4 py-2 text-xs font-bold text-yellow-200 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-400/30 rounded-lg">
          {busyMsg || '↻ Recalculate all totals'}
        </button>
      </div>

      <IdentityTools />

      <div className="mb-4 flex flex-wrap gap-2 items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <select value={filters.division} onChange={(e) => setFilters({ ...filters, division: e.target.value })}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          {DIVISIONS.map((d) => <option key={d} value={d}>{d === 'all' ? 'All divisions' : d}</option>)}
        </select>
        <input type="number" min={1} placeholder="Week" value={filters.week}
          onChange={(e) => setFilters({ ...filters, week: e.target.value })}
          className="w-20 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm" />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'Any status' : s}</option>)}
        </select>
        <span className="text-xs text-white/50 ml-auto">{series.length} series</span>
      </div>

      {error && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}

      {loading ? (
        <div className="text-blue-200/60">Loading…</div>
      ) : series.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">No series reported yet.</div>
      ) : (
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/30">
              <tr className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
                <th className="px-3 py-2 text-left">Div</th>
                <th className="px-3 py-2 text-left">Week</th>
                <th className="px-3 py-2 text-left">Series</th>
                <th className="px-3 py-2 text-center">Score</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-center">Games</th>
                <th className="px-3 py-2 text-left">Via</th>
              </tr>
            </thead>
            <tbody>
              {series.map((m) => (
                <tr key={m.id} onClick={() => setSelected(m.id)} className="border-t border-white/5 hover:bg-white/[0.04] cursor-pointer">
                  <td className="px-3 py-2 text-blue-200/80 font-bold">{m.division}</td>
                  <td className="px-3 py-2 text-white/70">W{m.week ?? '—'}{m.isPlayoff && <span className="ml-1 text-yellow-300 text-[10px]">PO</span>}</td>
                  <td className="px-3 py-2 text-white">
                    <span className="font-medium">{m.homeTeam || '?'}</span>
                    <span className="text-white/40 mx-2">vs</span>
                    <span className="font-medium">{m.awayTeam || '?'}</span>
                  </td>
                  <td className="px-3 py-2 text-center font-mono font-bold text-white">{m.homeScore} - {m.awayScore}</td>
                  <td className="px-3 py-2"><StatusBadge status={m.status} isForfeit={m.isForfeit} /></td>
                  <td className="px-3 py-2 text-center text-white/60">{m.gameCount}</td>
                  <td className="px-3 py-2 text-white/50 text-xs">{m.reportedVia}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <SeriesModal seriesId={selected} onClose={() => setSelected(null)} onChanged={reload} />}
    </div>
  )
}

function StatusBadge({ status, isForfeit }) {
  const map = {
    confirmed: 'bg-green-500/15 text-green-300 border-green-400/30',
    disputed: 'bg-yellow-500/15 text-yellow-200 border-yellow-400/30',
    void: 'bg-red-500/15 text-red-300 border-red-400/30',
  }
  return (
    <span className="flex flex-wrap gap-1">
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${map[status] || 'bg-white/5 text-white/60 border-white/15'}`}>{status}</span>
      {isForfeit && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border bg-orange-500/15 text-orange-300 border-orange-400/30">FF</span>}
    </span>
  )
}

function IdentityTools() {
  const [open, setOpen] = useState(false)
  const [remap, setRemap] = useState({ platform: 'epic', platformId: '', discordId: '' })
  const [merge, setMerge] = useState({ fromDiscordId: '', toDiscordId: '' })
  const [msg, setMsg] = useState('')

  async function post(payload) {
    setMsg('Working…')
    const r = await fetch('/api/admin/stats-tools', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const d = await r.json().catch(() => ({}))
    setMsg(r.ok ? `✅ Done${d.movedRows != null ? ` (${d.movedRows} game rows moved)` : ''}` : `❌ ${d.error || 'Failed'}`)
  }

  return (
    <div className="mb-4 rounded-xl bg-white/[0.02] border border-white/10">
      <button onClick={() => setOpen(!open)} className="w-full px-4 py-3 text-left text-sm font-bold text-blue-200 hover:text-white">
        🛠 Player identity tools {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-black/20 border border-white/10 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">Re-map a Ballchasing account → Discord user</div>
            <div className="flex gap-2 flex-wrap">
              <select value={remap.platform} onChange={(e) => setRemap({ ...remap, platform: e.target.value })}
                className="px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs">
                {['epic', 'steam', 'ps4', 'xbox'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input placeholder="platform id" value={remap.platformId} onChange={(e) => setRemap({ ...remap, platformId: e.target.value.trim() })}
                className="flex-1 min-w-[140px] px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs" />
              <input placeholder="correct Discord ID" value={remap.discordId} onChange={(e) => setRemap({ ...remap, discordId: e.target.value.trim() })}
                className="flex-1 min-w-[140px] px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs" />
              <button onClick={() => post({ action: 'remap', ...remap })}
                disabled={!remap.platformId || !remap.discordId}
                className="px-3 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-40 rounded">Re-map</button>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-black/20 border border-white/10 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">Merge two player profiles (same person)</div>
            <div className="flex gap-2 flex-wrap">
              <input placeholder="merge FROM Discord ID" value={merge.fromDiscordId} onChange={(e) => setMerge({ ...merge, fromDiscordId: e.target.value.trim() })}
                className="flex-1 min-w-[150px] px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs" />
              <input placeholder="merge INTO Discord ID" value={merge.toDiscordId} onChange={(e) => setMerge({ ...merge, toDiscordId: e.target.value.trim() })}
                className="flex-1 min-w-[150px] px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs" />
              <button onClick={() => { if (confirm('Merge all stats from the first profile into the second? Cannot be undone.')) post({ action: 'merge', ...merge }) }}
                disabled={!merge.fromDiscordId || !merge.toDiscordId}
                className="px-3 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-40 rounded">Merge</button>
            </div>
          </div>
          {msg && <div className="lg:col-span-2 text-xs text-white/70">{msg}</div>}
        </div>
      )}
    </div>
  )
}

function SeriesModal({ seriesId, onClose, onChanged }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [playerEdits, setPlayerEdits] = useState({})

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await fetch(`/api/admin/stats-series/${seriesId}`, { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(await r.json())
    } catch (e) { setError(e.message) }
  }, [seriesId])

  useEffect(() => { load() }, [load])

  async function saveSeries(form) {
    await fetch(`/api/admin/stats-series/${seriesId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    setEditing(false)
    await load()
    onChanged?.()
  }

  async function savePlayerEdits() {
    const edits = Object.entries(playerEdits).map(([id, vals]) => ({ id: Number(id), ...vals }))
    if (!edits.length) return
    await fetch(`/api/admin/stats-series/${seriesId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerEdits: edits }),
    })
    setPlayerEdits({})
    await load()
    onChanged?.()
  }

  async function hardDelete() {
    if (!confirm('Delete this series? Its stats are removed from ALL totals. Cannot be undone.')) return
    await fetch(`/api/admin/stats-series/${seriesId}`, { method: 'DELETE' })
    onChanged?.()
    onClose()
  }

  const s = data?.series

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-[#0b1220] border border-white/10 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#0b1220] z-10">
          <h2 className="text-lg font-black text-white">Series #{seriesId}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}
          {!data ? <div className="text-blue-200/60 text-sm">Loading…</div> : (
            <>
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-blue-200 font-bold text-sm uppercase">{s.division}</span>
                    <span className="text-white/50 text-sm">Week {s.week ?? '—'}</span>
                    {s.is_playoff && <span className="px-2 py-0.5 text-[10px] uppercase font-bold bg-yellow-500/15 text-yellow-300 border border-yellow-400/30 rounded">PLAYOFF</span>}
                    <StatusBadge status={s.status} isForfeit={s.is_forfeit} />
                  </div>
                  <span className="text-[10px] text-white/40">via {s.reported_via} · by {s.reported_by_discord_id || '?'}</span>
                </div>
                <div className="text-xl font-bold text-white">
                  {s.home_team_name || `team#${s.home_team_id}`}
                  <span className="font-mono mx-3 text-blue-300">{s.home_score} - {s.away_score}</span>
                  {s.away_team_name || `team#${s.away_team_id}`}
                </div>
                {s.ballchasing_group_url && (
                  <a href={s.ballchasing_group_url} target="_blank" rel="noreferrer" className="text-xs text-blue-300 hover:text-blue-200 underline">Replay group ↗</a>
                )}
              </div>

              {editing ? (
                <SeriesEditForm series={s} onCancel={() => setEditing(false)} onSave={saveSeries} />
              ) : (
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-xs font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded">Edit series</button>
                  {Object.keys(playerEdits).length > 0 && (
                    <button onClick={savePlayerEdits} className="px-3 py-1.5 text-xs font-bold text-green-300 bg-green-500/15 hover:bg-green-500/25 border border-green-400/30 rounded">
                      Save {Object.keys(playerEdits).length} stat line edit(s)
                    </button>
                  )}
                  <button onClick={hardDelete} className="px-3 py-1.5 text-xs font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded ml-auto">Delete series</button>
                </div>
              )}

              <GamesSection data={data} playerEdits={playerEdits} setPlayerEdits={setPlayerEdits} />
              <AuditSection audit={data.audit} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SeriesEditForm({ series, onCancel, onSave }) {
  const [home, setHome] = useState(series.home_score)
  const [away, setAway] = useState(series.away_score)
  const [forfeit, setForfeit] = useState(!!series.is_forfeit)
  const [status, setStatus] = useState(series.status)
  const [override, setOverride] = useState(!!series.manual_override)
  const [busy, setBusy] = useState(false)

  return (
    <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-400/30 space-y-3">
      <div className="text-xs font-bold uppercase tracking-wider text-blue-300/80">Edit series</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Home Score</span>
          <input type="number" min={0} value={home} onChange={(e) => setHome(parseInt(e.target.value, 10) || 0)} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white" />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Away Score</span>
          <input type="number" min={0} value={away} onChange={(e) => setAway(parseInt(e.target.value, 10) || 0)} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white" />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white">
            {['confirmed', 'disputed', 'void'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-2 pt-5">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} />
            <span className="text-white/80">Forfeit</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            <span className="text-white/80">Lock (manual override)</span>
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded">Cancel</button>
        <button disabled={busy}
          onClick={async () => { setBusy(true); await onSave({ homeScore: home, awayScore: away, isForfeit: forfeit, status, manualOverride: override }); setBusy(false) }}
          className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

const EDIT_COLS = [
  ['score', 'Score'], ['goals', 'G'], ['assists', 'A'], ['saves', 'SV'], ['shots', 'SH'],
  ['demosInflicted', 'DEM'], ['demosTaken', 'DEM-T'],
]
const DB_COL = { score: 'score', goals: 'goals', assists: 'assists', saves: 'saves', shots: 'shots', demosInflicted: 'demos_inflicted', demosTaken: 'demos_taken' }

function GamesSection({ data, playerEdits, setPlayerEdits }) {
  const byGame = new Map()
  for (const p of data.players) {
    if (!byGame.has(p.game_id)) byGame.set(p.game_id, [])
    byGame.get(p.game_id).push(p)
  }
  const setEdit = (rowId, key, value) => {
    setPlayerEdits((prev) => ({ ...prev, [rowId]: { ...prev[rowId], [key]: value === '' ? null : Number(value) } }))
  }

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-blue-300/70 mb-2 font-bold">Games ({data.games.length}) — edit any stat cell, then “Save stat line edits”</div>
      <div className="space-y-3">
        {data.games.map((g) => (
          <div key={g.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-white/60">Game {g.game_number}{g.overtime ? ' · OT' : ''}{g.is_forfeit ? ' · FF' : ''}</span>
              {g.ballchasing_replay_url
                ? <a href={g.ballchasing_replay_url} target="_blank" rel="noreferrer" className="text-xs text-blue-300 hover:text-blue-200 underline truncate max-w-[40%]">{g.ballchasing_replay_id}</a>
                : <span className="text-xs text-white/30">no replay</span>}
              <span className="font-mono text-sm font-bold text-white">{g.home_goals} - {g.away_goals}</span>
            </div>
            {(byGame.get(g.id) || []).length > 0 && (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wider text-white/40">
                    <th className="text-left py-0.5">Player</th>
                    <th className="text-left py-0.5">Team</th>
                    <th className="text-center py-0.5">MVP</th>
                    {EDIT_COLS.map(([k, label]) => <th key={k} className="text-right py-0.5">{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {byGame.get(g.id).map((p) => (
                    <tr key={p.id} className="border-t border-white/5">
                      <td className="py-0.5 text-white truncate">{p.ingame_name || p.discord_id}{p.is_sub && <span className="ml-1 text-[8px] text-orange-300">SUB</span>}</td>
                      <td className="py-0.5 text-blue-200/70 truncate">{p.team_name || '—'}</td>
                      <td className="py-0.5 text-center">{p.mvp ? '⭐' : ''}</td>
                      {EDIT_COLS.map(([k]) => (
                        <td key={k} className="py-0.5 text-right">
                          <input type="number" className="w-14 px-1 py-0.5 bg-black/40 border border-white/10 rounded text-white text-right text-[11px]"
                            defaultValue={p[DB_COL[k]] ?? 0}
                            onChange={(e) => setEdit(p.id, k, e.target.value)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function AuditSection({ audit }) {
  if (!audit?.length) return null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-blue-300/70 mb-2 font-bold">Audit trail</div>
      <ul className="space-y-1">
        {audit.map((a) => (
          <li key={a.id} className="flex items-center gap-2 px-3 py-1.5 rounded text-xs bg-white/[0.02] border border-white/5">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-blue-500/15 text-blue-300">{a.action}</span>
            <span className="text-white/70">{a.actor_name || a.actor_discord_id || '?'}</span>
            <span className="text-white/40 text-[10px]">({a.actor_source})</span>
            <span className="text-white/30 text-[10px] ml-auto">{new Date(a.created_at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
