'use client'

// Admin — Match Results (new Ballchasing-based stats system).
// List + inspect every reported series; edit scores / per-player stat lines,
// mark forfeits, delete series (totals recompute automatically), run a full
// recalculation, and fix player identity (remap account / merge profiles).

import { useEffect, useState, useCallback } from 'react'
import ReportSeriesWizard from './ReportSeriesWizard'

const DIVISIONS = ['all', 'Majors', 'AAA', 'AA']
const STATUSES = ['all', 'confirmed', 'disputed', 'void']

export default function StatsMatchesPage() {
  const [filters, setFilters] = useState({ division: 'all', week: '', status: 'all' })
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [busyMsg, setBusyMsg] = useState('')
  const [reporting, setReporting] = useState(false)

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
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setReporting(true)}
            className="px-4 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 rounded-lg"
            aria-label="Report a series by hand">
            ＋ Report a series
          </button>
          <button onClick={runRecalc} className="px-4 py-2 text-xs font-bold text-yellow-200 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-400/30 rounded-lg"
            aria-label="Recalculate all season totals">
            {busyMsg || '↻ Recalculate all totals'}
          </button>
        </div>
      </div>

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
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
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
                  <td className="px-3 py-2"><StatusBadge status={m.status} isForfeit={m.isForfeit} forfeitKind={m.forfeitKind} /></td>
                  <td className="px-3 py-2 text-center text-white/60">{m.gameCount}</td>
                  <td className="px-3 py-2 text-white/50 text-xs">{m.reportedVia}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <SeriesModal seriesId={selected} onClose={() => setSelected(null)} onChanged={reload} />}
      {reporting && <ReportSeriesWizard onClose={() => { setReporting(false); reload() }} onCreated={reload} />}
    </div>
  )
}

function StatusBadge({ status, isForfeit, forfeitKind }) {
  const map = {
    confirmed: 'bg-green-500/15 text-green-300 border-green-400/30',
    disputed: 'bg-yellow-500/15 text-yellow-200 border-yellow-400/30',
    void: 'bg-red-500/15 text-red-300 border-red-400/30',
  }
  return (
    <span className="flex flex-wrap gap-1">
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${map[status] || 'bg-white/5 text-white/60 border-white/15'}`}>{status}</span>
      {isForfeit && (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border bg-orange-500/15 text-orange-300 border-orange-400/30">
          {forfeitKind === 'double' ? 'Double FF' : 'FF'}
        </span>
      )}
    </span>
  )
}

// Player identity tools moved to the per-player panel on the Players admin tab
// (search by name + avatar; link / unlink / re-map / merge all live there).

function SeriesModal({ seriesId, onClose, onChanged }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [playerEdits, setPlayerEdits] = useState({})
  const [gameEdits, setGameEdits] = useState({})
  const [importMsg, setImportMsg] = useState(null)

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

  async function saveStatEdits() {
    const playerEditList = Object.entries(playerEdits).map(([id, vals]) => ({ id: Number(id), ...vals }))
    const gameEditList = Object.entries(gameEdits).map(([id, vals]) => ({ id: Number(id), ...vals }))
    if (!playerEditList.length && !gameEditList.length) return
    await fetch(`/api/admin/stats-series/${seriesId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerEdits: playerEditList, gameEdits: gameEditList }),
    })
    setPlayerEdits({})
    setGameEdits({})
    await load()
    onChanged?.()
  }

  async function hardDelete() {
    if (!confirm('Delete this series? Its stats are removed from ALL totals. Cannot be undone.')) return
    await fetch(`/api/admin/stats-series/${seriesId}`, { method: 'DELETE' })
    onChanged?.()
    onClose()
  }

  // Ask the bot to (re-)read Ballchasing for this series and write the real stats.
  async function runImport() {
    if (!confirm('Pull stats from Ballchasing? A group link replaces every game in this series; per-game replay links replace only the games they are on.')) return
    setImportMsg({ tone: 'busy', text: 'Queued — the bot is reading Ballchasing…' })
    try {
      const r = await fetch(`/api/admin/stats-series/${seriesId}/import`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((res) => setTimeout(res, 2000))
        const jr = await fetch(`/api/admin/stats-series/${seriesId}/import`, { cache: 'no-store' })
        const jd = await jr.json()
        const job = jd.job
        if (job?.status === 'done') {
          const res = job.result || {}
          setImportMsg({
            tone: 'ok',
            text: `Imported ${res.gamesWritten || 0} game(s), ${res.playerRows || 0} player stat line(s). Score ${res.homeScore}–${res.awayScore}.`,
            warnings: res.warnings || [],
          })
          await load(); onChanged?.()
          return
        }
        if (job?.status === 'failed') { setImportMsg({ tone: 'bad', text: job.error || 'Import failed.' }); return }
      }
      setImportMsg({ tone: 'bad', text: 'Still running after two minutes — check back shortly, or check that the bot is online.' })
    } catch (e) {
      setImportMsg({ tone: 'bad', text: e.message })
    }
  }

  async function swapSides() {
    if (!confirm('Swap home/away sides? Every stat line, game score and the series score flip. Use this when the importer put the teams the wrong way round.')) return
    await fetch(`/api/admin/stats-series/${seriesId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ swapSides: true }),
    })
    await load(); onChanged?.()
  }

  const s = data?.series

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-[#0b1220] border border-white/10 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-log-section="series-detail">
        <div className="p-5 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#0b1220] z-10">
          <h2 className="text-lg font-black text-white">Series #{seriesId}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none" aria-label="Close series detail">×</button>
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
                    <StatusBadge status={s.status} isForfeit={s.is_forfeit} forfeitKind={s.forfeit_kind} />
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

              {importMsg && (
                <div className={`p-3 rounded text-sm border ${
                  importMsg.tone === 'bad' ? 'bg-red-500/10 border-red-500/30 text-red-200'
                    : importMsg.tone === 'ok' ? 'bg-green-500/10 border-green-400/30 text-green-100'
                    : 'bg-blue-500/10 border-blue-400/30 text-blue-100'}`}>
                  <div>{importMsg.text}</div>
                  {importMsg.warnings?.length > 0 && (
                    <ul className="mt-2 space-y-1 list-disc list-inside text-yellow-200/90 text-xs">
                      {importMsg.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {editing ? (
                <SeriesEditForm series={s} onCancel={() => setEditing(false)} onSave={saveSeries} />
              ) : (
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-xs font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded" aria-label="Edit this series">Edit series</button>
                  {(s.ballchasing_group_url || data.games.some((g) => g.ballchasing_replay_url)) && (
                    <button onClick={runImport} className="px-3 py-1.5 text-xs font-bold text-cyan-200 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/30 rounded" aria-label="Import stats from Ballchasing">
                      ↓ Import from Ballchasing
                    </button>
                  )}
                  {data.players.length > 0 && (
                    <button onClick={swapSides} className="px-3 py-1.5 text-xs font-bold text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-400/30 rounded" aria-label="Swap home and away stat sides">
                      ⇄ Swap sides
                    </button>
                  )}
                  {(Object.keys(playerEdits).length + Object.keys(gameEdits).length) > 0 && (
                    <button onClick={saveStatEdits} className="px-3 py-1.5 text-xs font-bold text-green-300 bg-green-500/15 hover:bg-green-500/25 border border-green-400/30 rounded" aria-label="Save pending stat edits">
                      Save {Object.keys(gameEdits).length + Object.keys(playerEdits).length} edit(s)
                    </button>
                  )}
                  <button onClick={hardDelete} className="px-3 py-1.5 text-xs font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded ml-auto" aria-label="Delete this series">Delete series</button>
                </div>
              )}

              <GamesSection data={data} seriesId={seriesId} playerEdits={playerEdits} setPlayerEdits={setPlayerEdits}
                gameEdits={gameEdits} setGameEdits={setGameEdits} onChanged={async () => { await load(); onChanged?.() }} />
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
  const [forfeitKind, setForfeitKind] = useState(series.forfeit_kind === 'double' ? 'double' : 'full')
  const [status, setStatus] = useState(series.status)
  const [override, setOverride] = useState(!!series.manual_override)
  const [week, setWeek] = useState(series.week ?? '')
  const [division, setDivision] = useState(series.division)
  const [isPlayoff, setIsPlayoff] = useState(!!series.is_playoff)
  const [format, setFormat] = useState(series.format || 'bo5')
  const [groupUrl, setGroupUrl] = useState(series.ballchasing_group_url || '')
  const [busy, setBusy] = useState(false)

  const cell = 'w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white'
  const lbl = 'block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1'

  return (
    <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-400/30 space-y-3">
      <div className="text-xs font-bold uppercase tracking-wider text-blue-300/80">Edit series</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <span className={lbl}>Home Score</span>
          <input type="number" min={0} value={home} onChange={(e) => setHome(parseInt(e.target.value, 10) || 0)} className={cell} aria-label="Home score" />
        </label>
        <label className="block">
          <span className={lbl}>Away Score</span>
          <input type="number" min={0} value={away} onChange={(e) => setAway(parseInt(e.target.value, 10) || 0)} className={cell} aria-label="Away score" />
        </label>
        <label className="block">
          <span className={lbl}>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={cell} aria-label="Series status">
            {['confirmed', 'disputed', 'void'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={lbl}>Week</span>
          <input type="number" min={1} value={week} onChange={(e) => setWeek(e.target.value)} className={cell} aria-label="Week number" />
        </label>
        <label className="block">
          <span className={lbl}>Division</span>
          <select value={division} onChange={(e) => setDivision(e.target.value)} className={cell} aria-label="Division">
            {['Majors', 'AAA', 'AA'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={lbl}>Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)} className={cell} aria-label="Series format">
            <option value="bo5">bo5</option>
            <option value="bo7">bo7</option>
          </select>
        </label>
        <label className="block">
          <span className={lbl}>Forfeit type</span>
          <select value={forfeitKind} onChange={(e) => setForfeitKind(e.target.value)} disabled={!forfeit} className={`${cell} disabled:opacity-40`} aria-label="Forfeit type">
            <option value="full">Full — 1-0 to the home team</option>
            <option value="double">Double — both take a 0-1 loss</option>
          </select>
        </label>
        <div className="flex flex-col gap-2 pt-5">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} aria-label="Forfeit" />
            <span className="text-white/80">Forfeit</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isPlayoff} onChange={(e) => setIsPlayoff(e.target.checked)} aria-label="Playoff series" />
            <span className="text-white/80">Playoff</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} aria-label="Lock with manual override" />
            <span className="text-white/80">Lock (manual override)</span>
          </label>
        </div>
      </div>
      <label className="block">
        <span className={lbl}>Ballchasing group link</span>
        <input value={groupUrl} onChange={(e) => setGroupUrl(e.target.value)} placeholder="https://ballchasing.com/group/…"
          className={`${cell} text-sm`} aria-label="Ballchasing group link" />
      </label>
      {forfeit && forfeitKind === 'double' && (
        <p className="text-[11px] text-orange-200/80">
          A double forfeit is stored 0–0 with no winner; both teams are charged a 0–1 loss when totals are rebuilt.
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded" aria-label="Cancel editing">Cancel</button>
        <button disabled={busy}
          onClick={async () => {
            setBusy(true)
            await onSave({
              homeScore: home, awayScore: away, isForfeit: forfeit, forfeitKind, status, manualOverride: override,
              week: week === '' ? null : Number(week), division, isPlayoff, format,
              ballchasingGroupUrl: groupUrl.trim() || null,
            })
            setBusy(false)
          }}
          className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded" aria-label="Save series changes">
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

function GamesSection({ data, seriesId, playerEdits, setPlayerEdits, gameEdits, setGameEdits, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [addingTo, setAddingTo] = useState(null)

  const byGame = new Map()
  for (const p of data.players) {
    if (!byGame.has(p.game_id)) byGame.set(p.game_id, [])
    byGame.get(p.game_id).push(p)
  }
  const setEdit = (rowId, key, value) => {
    setPlayerEdits((prev) => ({ ...prev, [rowId]: { ...prev[rowId], [key]: value === '' ? null : Number(value) } }))
  }
  // Per-game score edits. Default both goals into the patch object so editing one
  // side still sends a complete { homeGoals, awayGoals } pair.
  const setGameScore = (g, side, value) => {
    setGameEdits((prev) => {
      const cur = prev[g.id] || { homeGoals: g.home_goals, awayGoals: g.away_goals }
      return { ...prev, [g.id]: { ...cur, [side]: value === '' ? 0 : Number(value) } }
    })
  }
  const setGameField = (g, key, value) => {
    setGameEdits((prev) => {
      const cur = prev[g.id] || { homeGoals: g.home_goals, awayGoals: g.away_goals }
      return { ...prev, [g.id]: { ...cur, [key]: value } }
    })
  }

  async function patch(bodyObj) {
    setBusy(true)
    try {
      await fetch(`/api/admin/stats-series/${seriesId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj),
      })
      await onChanged?.()
    } finally { setBusy(false) }
  }

  const s = data.series
  const teamChoices = [
    { id: s.home_team_id, name: s.home_team_name || 'Home' },
    { id: s.away_team_id, name: s.away_team_name || 'Away' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
          Games ({data.games.length}) — edit game scores or any stat cell, then “Save edits”
        </div>
        <button disabled={busy} onClick={() => patch({ addGames: [{ homeGoals: 0, awayGoals: 0 }] })}
          className="px-2 py-1 text-[10px] font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded disabled:opacity-50"
          aria-label="Add a game to this series">+ Add game</button>
      </div>
      <div className="space-y-3">
        {data.games.map((g) => (
          <div key={g.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/10">
            <div className="flex items-center justify-between mb-2 gap-2">
              <span className="text-xs text-white/60 whitespace-nowrap">Game {g.game_number}{g.overtime ? ' · OT' : ''}{g.is_forfeit ? ' · FF' : ''}</span>
              <input defaultValue={g.ballchasing_replay_url || ''} placeholder="Replay link (optional)"
                onChange={(e) => setGameField(g, 'replayUrl', e.target.value)}
                className="flex-1 min-w-[8rem] px-2 py-0.5 bg-black/40 border border-white/10 rounded text-white text-[11px]"
                aria-label={`Game ${g.game_number} replay link`} />
              <div className="flex items-center gap-1">
                <input type="number" min={0} title="Home goals"
                  defaultValue={g.home_goals}
                  onChange={(e) => setGameScore(g, 'homeGoals', e.target.value)}
                  className="w-12 px-1 py-0.5 bg-black/40 border border-white/10 rounded text-white text-center font-mono text-sm"
                  aria-label={`Game ${g.game_number} home goals`} />
                <span className="text-white/40 font-mono">-</span>
                <input type="number" min={0} title="Away goals"
                  defaultValue={g.away_goals}
                  onChange={(e) => setGameScore(g, 'awayGoals', e.target.value)}
                  className="w-12 px-1 py-0.5 bg-black/40 border border-white/10 rounded text-white text-center font-mono text-sm"
                  aria-label={`Game ${g.game_number} away goals`} />
              </div>
              <button disabled={busy}
                onClick={() => { if (confirm(`Remove game ${g.game_number} and its stat lines?`)) patch({ removeGameIds: [g.id] }) }}
                className="text-red-300/70 hover:text-red-200 text-[11px] px-1 disabled:opacity-50"
                aria-label={`Remove game ${g.game_number}`}>Remove</button>
            </div>
            {(byGame.get(g.id) || []).length === 0 && (
              <div className="text-[10px] text-white/30 italic">No player stat lines for this game — game score above is editable.</div>
            )}
            {(byGame.get(g.id) || []).length > 0 && (
              <div className="overflow-x-auto">
              <table className="w-full text-[11px] min-w-[520px]">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wider text-white/40">
                    <th className="text-left py-0.5">Player</th>
                    <th className="text-left py-0.5">Team</th>
                    <th className="text-center py-0.5">MVP</th>
                    {EDIT_COLS.map(([k, label]) => <th key={k} className="text-right py-0.5">{label}</th>)}
                    <th className="py-0.5" />
                  </tr>
                </thead>
                <tbody>
                  {byGame.get(g.id).map((p) => (
                    <tr key={p.id} className="border-t border-white/5">
                      <td className="py-0.5 text-white truncate">
                        {p.ingame_name || p.discord_id || <span className="text-orange-300/80 italic">unlinked</span>}
                        {p.is_sub && <span className="ml-1 text-[8px] text-orange-300">SUB</span>}
                      </td>
                      <td className="py-0.5 text-blue-200/70 truncate">{p.team_name || '—'}</td>
                      <td className="py-0.5 text-center">{p.mvp ? '⭐' : ''}</td>
                      {EDIT_COLS.map(([k]) => (
                        <td key={k} className="py-0.5 text-right">
                          <input type="number" className="w-14 px-1 py-0.5 bg-black/40 border border-white/10 rounded text-white text-right text-[11px]"
                            defaultValue={p[DB_COL[k]] ?? 0}
                            onChange={(e) => setEdit(p.id, k, e.target.value)}
                            aria-label={`${p.ingame_name || 'player'} ${k}`} />
                        </td>
                      ))}
                      <td className="py-0.5 text-right">
                        <button disabled={busy}
                          onClick={() => { if (confirm(`Remove ${p.ingame_name || 'this player'}'s line from game ${g.game_number}?`)) patch({ removePlayerIds: [p.id] }) }}
                          className="text-red-300/60 hover:text-red-200 px-1 disabled:opacity-50"
                          aria-label={`Remove ${p.ingame_name || 'player'} stat line`}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
            {addingTo === g.id
              ? <AddPlayerRow teamChoices={teamChoices} busy={busy}
                  onCancel={() => setAddingTo(null)}
                  onAdd={async (row) => { await patch({ addPlayers: [{ ...row, gameId: g.id }] }); setAddingTo(null) }} />
              : (
                <button onClick={() => setAddingTo(g.id)}
                  className="mt-2 text-[10px] font-bold text-blue-300/80 hover:text-blue-200"
                  aria-label={`Add a player stat line to game ${g.game_number}`}>+ Add player line</button>
              )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Type a stat line onto a game by hand — for series reported with scores only, or
// a player the importer could not see.
function AddPlayerRow({ teamChoices, busy, onAdd, onCancel }) {
  const [row, setRow] = useState({
    teamId: teamChoices[0]?.id || '', discordId: '', ingameName: '',
    score: 0, goals: 0, assists: 0, saves: 0, shots: 0, demosInflicted: 0, demosTaken: 0, mvp: false,
  })
  const set = (patch) => setRow((r) => ({ ...r, ...patch }))
  const numCell = 'w-14 px-1 py-0.5 bg-black/40 border border-white/10 rounded text-white text-right text-[11px]'

  return (
    <div className="mt-2 p-2 rounded-lg bg-blue-500/5 border border-blue-400/30 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input value={row.ingameName} onChange={(e) => set({ ingameName: e.target.value })} placeholder="In-game name"
          className="px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-[11px] w-32" aria-label="In-game name" />
        <input value={row.discordId} onChange={(e) => set({ discordId: e.target.value })} placeholder="Discord ID (optional)"
          className="px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-[11px] w-40" aria-label="Discord ID" />
        <select value={row.teamId} onChange={(e) => set({ teamId: e.target.value })}
          className="px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-[11px]" aria-label="Team">
          {teamChoices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label className="flex items-center gap-1 text-[11px] text-white/70 cursor-pointer">
          <input type="checkbox" checked={row.mvp} onChange={(e) => set({ mvp: e.target.checked })} aria-label="MVP" /> MVP
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {EDIT_COLS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-1 text-[10px] text-white/50">
            {label}
            <input type="number" value={row[k]} onChange={(e) => set({ [k]: Number(e.target.value) || 0 })}
              className={numCell} aria-label={`New player line ${label}`} />
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-2 py-1 text-[10px] font-semibold text-white/60 bg-white/5 rounded" aria-label="Cancel adding a player line">Cancel</button>
        <button disabled={busy || (!row.ingameName.trim() && !row.discordId.trim())} onClick={() => onAdd(row)}
          className="px-3 py-1 text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-400 rounded disabled:opacity-50"
          aria-label="Save the new player stat line">Add line</button>
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
