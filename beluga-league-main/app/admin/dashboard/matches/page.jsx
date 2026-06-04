'use client'

import { useEffect, useState, useCallback } from 'react'

const DIVISIONS = ['all', 'Majors', 'AAA', 'AA']
const STATUSES = ['all', 'pending_captains', 'pending_salary', 'completed', 'final', 'rejected']

export default function MatchResultsPage() {
  const [seasons, setSeasons] = useState([])
  const [seasonId, setSeasonId] = useState(null)
  const [filters, setFilters] = useState({ division: 'all', week: '', status: 'all' })
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sRes = await fetch('/api/admin/seasons', { cache: 'no-store' })
      const sData = await sRes.json()
      setSeasons(sData.seasons || [])
      const activeId = seasonId || sData.activeSeasonId || (sData.seasons?.[0]?.id ?? null)
      setSeasonId(activeId)

      const params = new URLSearchParams()
      if (activeId) params.set('seasonId', String(activeId))
      if (filters.division !== 'all') params.set('division', filters.division)
      if (filters.week) params.set('week', filters.week)
      if (filters.status !== 'all') params.set('status', filters.status)

      const r = await fetch(`/api/admin/matches?${params}`, { cache: 'no-store' })
      const d = await r.json()
      setMatches(d.matches || [])
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [seasonId, filters])

  useEffect(() => { reload() }, [reload])

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
        <h1 className="text-3xl font-black text-white mb-2">Match Results</h1>
        <p className="text-blue-100/60 text-sm">
          Every score-reported series. Click a row to view replays, player stats, and approval log. Edit scores, mark forfeits, or delete a series.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <select
          value={seasonId || ''}
          onChange={(e) => setSeasonId(e.target.value === '' ? null : Number(e.target.value))}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm"
        >
          <option value="">— Active —</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>S{s.seasonNumber}{s.name ? ` · ${s.name}` : ''}</option>
          ))}
        </select>
        <select
          value={filters.division}
          onChange={(e) => setFilters({ ...filters, division: e.target.value })}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm"
        >
          {DIVISIONS.map((d) => <option key={d} value={d}>{d === 'all' ? 'All divisions' : d}</option>)}
        </select>
        <input
          type="number" min={1} placeholder="Week"
          value={filters.week}
          onChange={(e) => setFilters({ ...filters, week: e.target.value })}
          className="w-20 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm"
        />
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm"
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'Any status' : s}</option>)}
        </select>
        <span className="text-xs text-white/50 ml-auto">{matches.length} match{matches.length === 1 ? '' : 'es'}</span>
      </div>

      {error && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}

      {loading ? (
        <div className="text-blue-200/60">Loading…</div>
      ) : matches.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">
          No matches reported yet for this filter.
        </div>
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
                <th className="px-3 py-2 text-center">Replays</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => <MatchRow key={m.id} match={m} onSelect={() => setSelected(m.id)} />)}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <MatchDetailModal
          seriesId={selected}
          onClose={() => setSelected(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}

function StatusBadge({ status, isForfeit }) {
  const map = {
    completed: 'bg-green-500/15 text-green-300 border-green-400/30',
    final: 'bg-green-500/15 text-green-300 border-green-400/30',
    pending_captains: 'bg-yellow-500/15 text-yellow-200 border-yellow-400/30',
    pending_salary: 'bg-yellow-500/15 text-yellow-200 border-yellow-400/30',
    rejected: 'bg-red-500/15 text-red-300 border-red-400/30',
  }
  return (
    <span className="flex flex-wrap gap-1">
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${map[status] || 'bg-white/5 text-white/60 border-white/15'}`}>
        {status}
      </span>
      {isForfeit && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border bg-orange-500/15 text-orange-300 border-orange-400/30">FF</span>}
    </span>
  )
}

function MatchRow({ match, onSelect }) {
  return (
    <tr onClick={onSelect} className="border-t border-white/5 hover:bg-white/[0.04] cursor-pointer">
      <td className="px-3 py-2 text-blue-200/80 font-bold">{match.division}</td>
      <td className="px-3 py-2 text-white/70">W{match.week ?? '—'}{match.isPlayoff && <span className="ml-1 text-yellow-300 text-[10px]">PO</span>}</td>
      <td className="px-3 py-2 text-white">
        <span className="font-medium">{match.homeTeam || `team#${match.homeTeamId}`}</span>
        <span className="text-white/40 mx-2">vs</span>
        <span className="font-medium">{match.awayTeam || `team#${match.awayTeamId}`}</span>
      </td>
      <td className="px-3 py-2 text-center font-mono font-bold text-white">{match.homeScore} - {match.awayScore}</td>
      <td className="px-3 py-2"><StatusBadge status={match.status} isForfeit={match.isForfeit} /></td>
      <td className="px-3 py-2 text-center text-white/60">{match.replayCount}</td>
      <td className="px-3 py-2 text-right">
        <button onClick={(e) => { e.stopPropagation(); onSelect() }} className="text-[10px] uppercase font-bold text-blue-200 hover:text-white px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 rounded">View</button>
      </td>
    </tr>
  )
}

function MatchDetailModal({ seriesId, onClose, onChanged }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/admin/matches/${seriesId}`, { cache: 'no-store' })
      if (!r.ok) {
        const t = await r.text()
        throw new Error(`HTTP ${r.status}: ${t.slice(0, 150)}`)
      }
      const d = await r.json()
      setData(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [seriesId])

  useEffect(() => { load() }, [load])

  async function save(form) {
    await fetch(`/api/admin/matches/${seriesId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(form),
    })
    setEditing(false)
    await load()
    onChanged?.()
  }

  async function hardDelete() {
    if (!confirm('Delete this entire match series and all replays/approvals tied to it? Cannot be undone.')) return
    await fetch(`/api/admin/matches/${seriesId}`, { method: 'DELETE', cache: 'no-store' })
    onChanged?.()
    onClose()
  }

  return (
    <Modal onClose={onClose} title={`Match Series #${seriesId}`}>
      {loading && <div className="text-blue-200/60 text-sm">Loading…</div>}
      {error && <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}
      {data && (
        <div className="space-y-4">
          <SeriesSummary series={data.series} />
          {editing ? (
            <SeriesEditForm series={data.series} onCancel={() => setEditing(false)} onSave={save} />
          ) : (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-xs font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded">Edit series</button>
              <button onClick={hardDelete} className="px-3 py-1.5 text-xs font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded ml-auto">Delete series</button>
            </div>
          )}
          <ReplaysSection replays={data.replays} />
          <ApprovalsSection approvals={data.approvals} />
        </div>
      )}
    </Modal>
  )
}

function SeriesSummary({ series }) {
  return (
    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-3">
          <span className="text-blue-200 font-bold text-sm uppercase">{series.division}</span>
          <span className="text-white/50 text-sm">Week {series.week ?? '—'}</span>
          {series.isPlayoff && <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider bg-yellow-500/15 text-yellow-300 border border-yellow-400/30 rounded">PLAYOFF</span>}
          <StatusBadge status={series.status} isForfeit={series.isForfeit} />
        </div>
        <span className="text-[10px] text-white/40">Reported by {series.reportedByUsername || '?'}</span>
      </div>
      <div className="text-xl font-bold text-white">
        {series.homeTeam || `team#${series.homeTeamId}`}
        <span className="font-mono mx-3 text-blue-300">{series.homeScore} - {series.awayScore}</span>
        {series.awayTeam || `team#${series.awayTeamId}`}
      </div>
      <div className="text-[11px] text-white/40 mt-1">
        Created {new Date(series.createdAt).toLocaleString()}
        {series.statsApplied && <span className="ml-2 text-green-300">· stats applied</span>}
      </div>
    </div>
  )
}

function SeriesEditForm({ series, onCancel, onSave }) {
  const [home, setHome] = useState(series.homeScore)
  const [away, setAway] = useState(series.awayScore)
  const [forfeit, setForfeit] = useState(!!series.isForfeit)
  const [status, setStatus] = useState(series.status)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    await onSave({
      homeScore: Number(home),
      awayScore: Number(away),
      isForfeit: forfeit,
      status,
    })
    setBusy(false)
  }

  return (
    <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-400/30 space-y-3">
      <div className="text-xs font-bold uppercase tracking-wider text-blue-300/80">Edit series</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Home Score</label>
          <input type="number" min={0} value={home} onChange={(e) => setHome(parseInt(e.target.value, 10) || 0)} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Away Score</label>
          <input type="number" min={0} value={away} onChange={(e) => setAway(parseInt(e.target.value, 10) || 0)} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer pt-5">
          <input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} />
          <span className="text-white/80">Forfeit</span>
        </label>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white">
            {['pending_captains', 'pending_salary', 'completed', 'final', 'rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded">Cancel</button>
        <button onClick={submit} disabled={busy} className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

function ReplaysSection({ replays }) {
  if (!replays || replays.length === 0) {
    return (
      <div className="text-xs text-white/40 italic px-4">No replays attached.</div>
    )
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-blue-300/70 mb-2 font-bold">Replays ({replays.length})</div>
      <div className="space-y-2">
        {replays.map((r) => (
          <div key={r.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <a href={r.ballchasingUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-300 hover:text-blue-200 underline truncate">
                {r.ballchasingId}
              </a>
              <span className="font-mono text-sm font-bold text-white">{r.homeGoals ?? '?'} - {r.awayGoals ?? '?'}</span>
            </div>
            {r.players && r.players.length > 0 && (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wider text-white/40">
                    <th className="text-left py-0.5">Player</th>
                    <th className="text-left py-0.5">Team</th>
                    <th className="text-right py-0.5">Goals</th>
                    <th className="text-right py-0.5">Assists</th>
                    <th className="text-right py-0.5">Saves</th>
                    <th className="text-right py-0.5">Shots</th>
                    <th className="text-right py-0.5">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {r.players.map((p) => {
                    const core = p.stats?.core || {}
                    return (
                      <tr key={p.id} className="border-t border-white/5">
                        <td className="py-0.5 text-white truncate">{p.playerName}</td>
                        <td className="py-0.5 text-blue-200/70 truncate">{p.teamName || '—'}</td>
                        <td className="py-0.5 text-right text-white/80">{core.goals ?? '—'}</td>
                        <td className="py-0.5 text-right text-white/80">{core.assists ?? '—'}</td>
                        <td className="py-0.5 text-right text-white/80">{core.saves ?? '—'}</td>
                        <td className="py-0.5 text-right text-white/80">{core.shots ?? '—'}</td>
                        <td className="py-0.5 text-right text-white font-bold">{core.score ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ApprovalsSection({ approvals }) {
  if (!approvals || approvals.length === 0) {
    return <div className="text-xs text-white/40 italic px-4">No approvals recorded.</div>
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-blue-300/70 mb-2 font-bold">Approvals ({approvals.length})</div>
      <ul className="space-y-1">
        {approvals.map((a) => (
          <li key={a.id} className="flex items-center gap-2 px-3 py-1.5 rounded text-xs bg-white/[0.02] border border-white/5">
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${a.decision === 'approve' || a.decision === 'approved' ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>
              {a.decision}
            </span>
            <span className="text-white/80">{a.approverUsername || a.approverDiscordId}</span>
            <span className="text-white/40 text-[10px]">({a.approverRole})</span>
            {a.teamName && <span className="text-blue-200/70 ml-auto">{a.teamName}</span>}
            <span className="text-white/30 text-[10px]">{new Date(a.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Modal({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-[#0b1220] border border-white/10 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#0b1220] z-10">
          <h2 className="text-lg font-black text-white">{title}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
