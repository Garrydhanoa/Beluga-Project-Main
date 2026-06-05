'use client'

import { useEffect, useState, useCallback } from 'react'

const DIVISIONS = ['Majors', 'AAA', 'AA']

export default function StatsEditorPage() {
  const [tab, setTab] = useState('teams') // 'teams' | 'players'
  const [seasons, setSeasons] = useState([])
  const [seasonId, setSeasonId] = useState(null)
  const [division, setDivision] = useState('all')

  useEffect(() => {
    fetch('/api/admin/seasons', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setSeasons(d.seasons || [])
        setSeasonId(d.activeSeasonId || (d.seasons?.[0]?.id ?? null))
      })
      .catch(() => {})
  }, [])

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
        <h1 className="text-3xl font-black text-white mb-2">Stats Editor</h1>
        <p className="text-blue-100/60 text-sm max-w-3xl">
          Manually edit team standings and per-player stats. Any save flips <code className="text-blue-300">manual_override</code> on that row so automated stat processing won't overwrite it. Clear the override (toggle on a row) to let automated population resume.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <select
          value={seasonId || ''}
          onChange={(e) => setSeasonId(e.target.value === '' ? null : Number(e.target.value))}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm"
        >
          <option value="">— Select season —</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>S{s.seasonNumber}{s.name ? ` · ${s.name}` : ''}</option>
          ))}
        </select>
        <select
          value={division}
          onChange={(e) => setDivision(e.target.value)}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm"
        >
          <option value="all">All divisions</option>
          {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="mb-4 inline-flex p-1 rounded-xl bg-white/[0.03] border border-white/10">
        <button onClick={() => setTab('teams')} className={`px-4 py-2 text-sm font-bold rounded-lg ${tab === 'teams' ? 'bg-blue-500 text-white' : 'text-white/60 hover:text-white'}`}>
          Team Records
        </button>
        <button onClick={() => setTab('players')} className={`px-4 py-2 text-sm font-bold rounded-lg ${tab === 'players' ? 'bg-blue-500 text-white' : 'text-white/60 hover:text-white'}`}>
          Player Records
        </button>
      </div>

      {seasonId == null ? (
        <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">
          Pick a season above.
        </div>
      ) : tab === 'teams' ? (
        <TeamRecordsView seasonId={seasonId} division={division} />
      ) : (
        <PlayerRecordsView seasonId={seasonId} division={division} />
      )}
    </div>
  )
}

function TeamRecordsView({ seasonId, division }) {
  const [data, setData] = useState({ records: [], teamsByDivision: {} })
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ seasonId: String(seasonId) })
    if (division !== 'all') params.set('division', division)
    const r = await fetch(`/api/admin/team-records?${params}`, { cache: 'no-store' })
    const d = await r.json()
    setData(d)
    setLoading(false)
  }, [seasonId, division])

  useEffect(() => { load() }, [load])

  async function patch(id, payload) {
    setBusyId(id)
    await fetch(`/api/admin/team-records/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(payload),
    })
    setBusyId(null)
    await load()
  }

  async function deleteRecord(id) {
    if (!confirm('Delete this team record? The bot can re-create it next time stats apply.')) return
    setBusyId(id)
    await fetch(`/api/admin/team-records/${id}`, { method: 'DELETE', cache: 'no-store' })
    setBusyId(null)
    await load()
  }

  if (loading) return <div className="text-blue-200/60">Loading…</div>

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-white/50">{data.records.length} record{data.records.length === 1 ? '' : 's'}</span>
        <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 text-xs font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded">
          + Add team record
        </button>
      </div>

      {data.records.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-white/10 text-center text-white/50 text-sm">
          No team records yet. Add one manually here.
        </div>
      ) : (
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/30">
              <tr className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
                <th className="px-3 py-2 text-left">Div</th>
                <th className="px-3 py-2 text-left">Team</th>
                <th className="px-3 py-2 text-center">W</th>
                <th className="px-3 py-2 text-center">L</th>
                <th className="px-3 py-2 text-center">GW</th>
                <th className="px-3 py-2 text-center">GL</th>
                <th className="px-3 py-2 text-center">GF</th>
                <th className="px-3 py-2 text-center">GA</th>
                <th className="px-3 py-2 text-center">Override</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((r) => (
                <TeamRecordRow key={r.id} record={r} busy={busyId === r.id} onPatch={(p) => patch(r.id, p)} onDelete={() => deleteRecord(r.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddTeamRecordModal
          seasonId={seasonId}
          teamsByDivision={data.teamsByDivision}
          existing={data.records}
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); load() }}
        />
      )}
    </div>
  )
}

function TeamRecordRow({ record, busy, onPatch, onDelete }) {
  const [draft, setDraft] = useState({
    wins: record.wins, losses: record.losses,
    gameWins: record.gameWins, gameLosses: record.gameLosses,
    goalsFor: record.goalsFor, goalsAgainst: record.goalsAgainst,
  })
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDraft({
      wins: record.wins, losses: record.losses,
      gameWins: record.gameWins, gameLosses: record.gameLosses,
      goalsFor: record.goalsFor, goalsAgainst: record.goalsAgainst,
    })
    setDirty(false)
  }, [record.id, record.updatedAt])

  function setField(k, v) {
    setDraft({ ...draft, [k]: v })
    setDirty(true)
  }

  async function save() {
    await onPatch(draft)
    setDirty(false)
  }

  function intInput(field) {
    return (
      <input
        type="number" min={0} value={draft[field]}
        onChange={(e) => setField(field, parseInt(e.target.value, 10) || 0)}
        className="w-12 px-1 py-0.5 bg-black/40 border border-white/10 rounded text-white text-center text-xs"
      />
    )
  }

  return (
    <tr className="border-t border-white/5 hover:bg-white/[0.02]">
      <td className="px-3 py-1.5 text-blue-200/80 font-bold">{record.division}</td>
      <td className="px-3 py-1.5 text-white">{record.teamName || `#${record.teamId}`}</td>
      <td className="px-3 py-1.5 text-center">{intInput('wins')}</td>
      <td className="px-3 py-1.5 text-center">{intInput('losses')}</td>
      <td className="px-3 py-1.5 text-center">{intInput('gameWins')}</td>
      <td className="px-3 py-1.5 text-center">{intInput('gameLosses')}</td>
      <td className="px-3 py-1.5 text-center">{intInput('goalsFor')}</td>
      <td className="px-3 py-1.5 text-center">{intInput('goalsAgainst')}</td>
      <td className="px-3 py-1.5 text-center">
        <button
          onClick={() => onPatch({ manualOverride: !record.manualOverride })}
          disabled={busy}
          className={`px-1.5 py-0.5 text-[9px] uppercase font-bold rounded ${record.manualOverride ? 'bg-yellow-500/15 text-yellow-300 border border-yellow-400/30' : 'bg-white/5 text-white/50 border border-white/10'}`}
        >
          {record.manualOverride ? '🔒 Locked' : 'Auto'}
        </button>
      </td>
      <td className="px-3 py-1.5 text-right">
        <div className="flex gap-1 justify-end">
          {dirty && (
            <button onClick={save} disabled={busy} className="px-2 py-0.5 text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-400 rounded">Save</button>
          )}
          <button onClick={onDelete} disabled={busy} className="px-2 py-0.5 text-[10px] font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded">Del</button>
        </div>
      </td>
    </tr>
  )
}

function AddTeamRecordModal({ seasonId, teamsByDivision, existing, onClose, onAdded }) {
  const [division, setDivision] = useState(DIVISIONS[0])
  const [teamId, setTeamId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const teams = (teamsByDivision[division] || []).filter(
    (t) => !existing.some((e) => e.teamId === t.id && e.division === division)
  )

  async function submit() {
    if (!teamId) { setErr('Pick a team'); return }
    setBusy(true)
    setErr(null)
    const r = await fetch('/api/admin/team-records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ seasonId, division, teamId: Number(teamId), manualOverride: true }),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setErr(d.error || 'Failed')
      setBusy(false)
      return
    }
    onAdded()
  }

  return (
    <Modal onClose={onClose} title="Add team record">
      <div className="space-y-3">
        {err && <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{err}</div>}
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Division</label>
          <select value={division} onChange={(e) => { setDivision(e.target.value); setTeamId('') }} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white">
            {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Team</label>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white">
            <option value="">— Pick team —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded">Cancel</button>
          <button onClick={submit} disabled={busy} className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded">{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </div>
    </Modal>
  )
}

function PlayerRecordsView({ seasonId, division }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ seasonId: String(seasonId) })
    if (division !== 'all') params.set('division', division)
    const r = await fetch(`/api/admin/player-records?${params}`, { cache: 'no-store' })
    const d = await r.json()
    setRecords(d.records || [])
    setLoading(false)
  }, [seasonId, division])

  useEffect(() => { load() }, [load])

  async function patch(id, payload) {
    setBusyId(id)
    await fetch(`/api/admin/player-records/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(payload),
    })
    setBusyId(null)
    await load()
  }

  async function deleteRecord(id) {
    if (!confirm('Delete this player record?')) return
    setBusyId(id)
    await fetch(`/api/admin/player-records/${id}`, { method: 'DELETE', cache: 'no-store' })
    setBusyId(null)
    await load()
  }

  const filtered = search
    ? records.filter((r) => r.playerName.toLowerCase().includes(search.toLowerCase()))
    : records

  if (loading) return <div className="text-blue-200/60">Loading…</div>

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <input
          type="text" placeholder="Search player…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm w-64"
        />
        <span className="text-xs text-white/50">{filtered.length} of {records.length} record{records.length === 1 ? '' : 's'}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-white/10 text-center text-white/50 text-sm">
          No player records yet. Add one manually here.
        </div>
      ) : (
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/30">
              <tr className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
                <th className="px-3 py-2 text-left">Div</th>
                <th className="px-3 py-2 text-left">Team</th>
                <th className="px-3 py-2 text-left">Player</th>
                <th className="px-3 py-2 text-center">GP</th>
                <th className="px-3 py-2 text-center">G</th>
                <th className="px-3 py-2 text-center">A</th>
                <th className="px-3 py-2 text-center">Sv</th>
                <th className="px-3 py-2 text-center">Sh</th>
                <th className="px-3 py-2 text-center">Score</th>
                <th className="px-3 py-2 text-center">Override</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <PlayerRecordRow key={r.id} record={r} busy={busyId === r.id} onPatch={(p) => patch(r.id, p)} onDelete={() => deleteRecord(r.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PlayerRecordRow({ record, busy, onPatch, onDelete }) {
  const [draft, setDraft] = useState({
    gamesPlayed: record.gamesPlayed, goals: record.goals, assists: record.assists,
    saves: record.saves, shots: record.shots, score: record.score,
  })
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDraft({
      gamesPlayed: record.gamesPlayed, goals: record.goals, assists: record.assists,
      saves: record.saves, shots: record.shots, score: record.score,
    })
    setDirty(false)
  }, [record.id, record.updatedAt])

  function setField(k, v) {
    setDraft({ ...draft, [k]: v })
    setDirty(true)
  }

  function intInput(field, w = 'w-14') {
    return (
      <input
        type="number" min={0} value={draft[field]}
        onChange={(e) => setField(field, parseInt(e.target.value, 10) || 0)}
        className={`${w} px-1 py-0.5 bg-black/40 border border-white/10 rounded text-white text-center text-xs`}
      />
    )
  }

  return (
    <tr className="border-t border-white/5 hover:bg-white/[0.02]">
      <td className="px-3 py-1.5 text-blue-200/80 font-bold">{record.division}</td>
      <td className="px-3 py-1.5 text-blue-200/70 truncate max-w-[120px]">{record.teamName || '—'}</td>
      <td className="px-3 py-1.5 text-white truncate max-w-[160px]">{record.playerName}</td>
      <td className="px-3 py-1.5 text-center">{intInput('gamesPlayed')}</td>
      <td className="px-3 py-1.5 text-center">{intInput('goals')}</td>
      <td className="px-3 py-1.5 text-center">{intInput('assists')}</td>
      <td className="px-3 py-1.5 text-center">{intInput('saves')}</td>
      <td className="px-3 py-1.5 text-center">{intInput('shots')}</td>
      <td className="px-3 py-1.5 text-center">{intInput('score', 'w-16')}</td>
      <td className="px-3 py-1.5 text-center">
        <button
          onClick={() => onPatch({ manualOverride: !record.manualOverride })}
          disabled={busy}
          className={`px-1.5 py-0.5 text-[9px] uppercase font-bold rounded ${record.manualOverride ? 'bg-yellow-500/15 text-yellow-300 border border-yellow-400/30' : 'bg-white/5 text-white/50 border border-white/10'}`}
        >
          {record.manualOverride ? '🔒 Locked' : 'Auto'}
        </button>
      </td>
      <td className="px-3 py-1.5 text-right">
        <div className="flex gap-1 justify-end">
          {dirty && (
            <button onClick={async () => { await onPatch(draft); setDirty(false) }} disabled={busy} className="px-2 py-0.5 text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-400 rounded">Save</button>
          )}
          <button onClick={onDelete} disabled={busy} className="px-2 py-0.5 text-[10px] font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded">Del</button>
        </div>
      </td>
    </tr>
  )
}

function Modal({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-[#0b1220] border border-white/10 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-black text-white">{title}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
