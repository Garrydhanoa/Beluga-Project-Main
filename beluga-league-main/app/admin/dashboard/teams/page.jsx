'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

const DIVISIONS = ['Majors', 'AAA', 'AA']

function RosterLimitField({ team, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(team.rosterLimit)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setValue(team.rosterLimit) }, [team.rosterLimit])

  async function save() {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      setValue(team.rosterLimit)
      setEditing(false)
      return
    }
    if (n === team.rosterLimit) { setEditing(false); return }
    setBusy(true)
    await fetch(`/api/admin/teams/${team.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ rosterLimit: n }),
    })
    setBusy(false)
    setEditing(false)
    onSaved?.()
  }

  if (editing) {
    return (
      <input
        type="number" min={1} max={30}
        value={value}
        onChange={(e) => setValue(parseInt(e.target.value, 10) || 0)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setValue(team.rosterLimit); setEditing(false) } }}
        autoFocus
        disabled={busy}
        className="w-12 px-1.5 py-0 bg-black/40 border border-blue-400/40 rounded text-white text-xs"
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to edit roster size"
      className="text-blue-200/80 hover:text-white underline decoration-dotted decoration-blue-400/40 underline-offset-2"
    >
      {team.rosterLimit}
    </button>
  )
}

export default function TeamsAdminPage() {
  const [view, setView] = useState('teams') // 'teams' | 'franchises'
  const [activeSeason, setActiveSeason] = useState(null)
  const [teamsByDivision, setTeamsByDivision] = useState({})
  const [suggestions, setSuggestions] = useState([])
  const [franchises, setFranchises] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAdd, setShowAdd] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sRes = await fetch('/api/admin/seasons', { cache: 'no-store' })
      const sData = await sRes.json()
      const seasons = sData.seasons || []
      const activeId = sData.activeSeasonId
      const active = seasons.find((x) => x.id === activeId) || seasons[0] || null
      setActiveSeason(active)

      const fRes = await fetch('/api/admin/franchises', { cache: 'no-store' })
      const fData = await fRes.json()
      setFranchises(fData.franchises || [])

      if (active) {
        const teamsRes = await fetch(`/api/admin/seasons/${active.id}/teams`, { cache: 'no-store' })
        const teamsData = await teamsRes.json()
        setTeamsByDivision(teamsData.teams || {})
        setSuggestions(teamsData.suggestions || [])
      } else {
        setTeamsByDivision({})
        setSuggestions([])
      }
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
          <h1 className="text-3xl font-black text-white mb-2">Teams & Franchises</h1>
          <p className="text-blue-100/60 text-sm max-w-3xl">
            Per-season teams on the left, the global franchise registry on the right. Rosters are managed by Discord roles via the bot — read-only here.
          </p>
        </div>
      </div>

      <div className="mb-6 inline-flex p-1 rounded-xl bg-white/[0.03] border border-white/10">
        <button
          onClick={() => setView('teams')}
          className={`px-4 py-2 text-sm font-bold rounded-lg transition ${view === 'teams' ? 'bg-blue-500 text-white shadow' : 'text-white/60 hover:text-white'}`}
        >
          Active Season Teams
          {activeSeason && (
            <span className="ml-2 text-xs opacity-70">S{activeSeason.seasonNumber}</span>
          )}
        </button>
        <button
          onClick={() => setView('franchises')}
          className={`px-4 py-2 text-sm font-bold rounded-lg transition ${view === 'franchises' ? 'bg-blue-500 text-white shadow' : 'text-white/60 hover:text-white'}`}
        >
          Franchise Registry
          <span className="ml-2 text-xs opacity-70">{franchises.length}</span>
        </button>
      </div>

      {error && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}

      {loading ? (
        <div className="text-blue-200/60">Loading…</div>
      ) : view === 'teams' ? (
        <ActiveSeasonTeamsView
          activeSeason={activeSeason}
          teamsByDivision={teamsByDivision}
          suggestions={suggestions}
          onChanged={reload}
          onAddTeam={(division) => setShowAdd({ division })}
        />
      ) : (
        <FranchiseRegistryView franchises={franchises} onChanged={reload} />
      )}

      {showAdd && activeSeason && (
        <AddTeamModal
          division={showAdd.division}
          activeSeasonId={activeSeason.id}
          suggestions={suggestions}
          onClose={() => setShowAdd(null)}
          onAdded={() => { setShowAdd(null); reload() }}
        />
      )}
    </div>
  )
}

function ActiveSeasonTeamsView({ activeSeason, teamsByDivision, suggestions, onChanged, onAddTeam }) {
  if (!activeSeason) {
    return (
      <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/60">
        No active season. <a href="/admin/dashboard/seasons" className="text-blue-300 hover:underline">Start a new season →</a>
      </div>
    )
  }

  return (
    <>
      <div className="mb-4 px-4 py-3 rounded-xl bg-blue-500/5 border border-blue-400/20 text-sm">
        <span className="text-white/50">Showing teams for </span>
        <span className="text-white font-bold">Season {activeSeason.seasonNumber}</span>
        {activeSeason.name && <span className="text-blue-200/70"> · {activeSeason.name}</span>}
        <span className="text-green-300 ml-2 text-xs font-bold uppercase">Active</span>
      </div>

      {DIVISIONS.map((d) => {
        const list = teamsByDivision[d] || []
        return (
          <div key={d} className="mb-6 p-5 rounded-2xl bg-white/[0.03] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black text-white">
                {d}
                <span className="text-blue-300/60 text-xs font-medium ml-2">({list.length} team{list.length === 1 ? '' : 's'})</span>
              </h2>
              <button
                onClick={() => onAddTeam(d)}
                className="text-xs font-semibold text-blue-200 hover:text-white bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded-lg px-3 py-1.5"
              >
                + Add Team
              </button>
            </div>

            {list.length === 0 ? (
              <div className="text-white/40 text-sm italic">No teams in {d}.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {list.map((t) => (
                  <TeamCard key={t.id} team={t} onChanged={onChanged} />
                ))}
              </div>
            )}

            <SuggestionsStrip suggestions={suggestions} division={d} activeSeasonId={activeSeason.id} onAdded={onChanged} />
          </div>
        )
      })}
    </>
  )
}

function TeamCard({ team, onChanged }) {
  const [showRoster, setShowRoster] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(team.name)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  async function toggleActive() {
    setBusy(true)
    await fetch(`/api/admin/teams/${team.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !team.isActive }),
    })
    setBusy(false)
    onChanged()
  }

  async function saveName() {
    if (!name.trim() || name === team.name) { setEditing(false); return }
    setBusy(true)
    await fetch(`/api/admin/teams/${team.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    setBusy(false)
    setEditing(false)
    onChanged()
  }

  async function hardDelete() {
    if (!confirm(`Permanently remove "${team.name}" from this season? Roster, schedule, stats, and standings for this team in this season will be deleted. The franchise stays.`)) return
    setBusy(true)
    await fetch(`/api/admin/teams/${team.id}`, { cache: 'no-store', method: 'DELETE' })
    setBusy(false)
    onChanged()
  }

  const [logoError, setLogoError] = useState(null)
  const [logoBust, setLogoBust] = useState(0)

  async function uploadLogo(file) {
    if (!file) return
    setLogoError(null)
    if (file.size > 2 * 1024 * 1024) {
      setLogoError(`Too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 2 MB.`)
      return
    }
    setBusy(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('teamId', String(team.id))
    try {
      const r = await fetch('/api/admin/teams/logo', {
        method: 'POST',
        cache: 'no-store',
        body: fd,
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error || `Upload failed (${r.status})`)
      }
      setLogoBust(Date.now())
      onChanged()
    } catch (e) {
      setLogoError(e.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`p-4 rounded-xl border ${team.isActive ? 'bg-white/[0.04] border-white/10' : 'bg-white/[0.01] border-white/5 opacity-60'}`}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          className="relative w-12 h-12 rounded-lg bg-white/5 border border-white/10 hover:border-blue-400/40 flex items-center justify-center text-[10px] text-white/40 overflow-hidden flex-shrink-0"
          title="Click to upload logo"
        >
          {team.hasLogo || logoBust ? (
            <img
              src={`/api/teams/logo?teamId=${team.id}&v=${logoBust || team.updatedAt || team.id}`}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          ) : (
            <span>no logo</span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => uploadLogo(e.target.files?.[0])}
          />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {editing ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(team.name); setEditing(false) } }}
                autoFocus
                className="px-2 py-1 bg-black/40 border border-blue-400/40 rounded text-white text-sm font-bold flex-1"
              />
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="text-white font-bold truncate hover:text-blue-200 text-left"
                title="Click to rename"
              >
                {team.name}
              </button>
            )}
            {!team.isActive && <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-white/60">Disabled</span>}
            {team.franchiseActive === false && <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">Franchise off</span>}
          </div>
          <div className="text-xs text-blue-200/50 flex items-center gap-1.5 flex-wrap">
            <span>{team.roster?.length || 0}/</span>
            <RosterLimitField team={team} onSaved={onChanged} />
            <span>roster</span>
            {team.franchiseName && team.franchiseName !== team.name && (
              <span>· Franchise: {team.franchiseName}</span>
            )}
          </div>
          {logoError && (
            <div className="mt-1 text-[10px] text-red-300">Logo: {logoError}</div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <button
            onClick={toggleActive}
            disabled={busy}
            className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg transition ${
              team.isActive
                ? 'text-yellow-200 hover:text-white bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-400/30'
                : 'text-green-200 hover:text-white bg-green-500/10 hover:bg-green-500/20 border border-green-400/30'
            }`}
          >
            {team.isActive ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={hardDelete}
            disabled={busy}
            className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-red-300 hover:text-red-100 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition"
          >
            Delete
          </button>
        </div>
      </div>

      <RoleIdRow team={team} onChanged={onChanged} />

      {team.roster && team.roster.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <button
            onClick={() => setShowRoster(!showRoster)}
            className="text-[10px] font-bold uppercase tracking-wider text-blue-300/70 hover:text-blue-200"
          >
            {showRoster ? '▴ Hide roster' : '▾ Show roster'} ({team.roster.length})
          </button>
          {showRoster && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {team.roster.map((m) => (
                <li key={m.discordId} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.03]">
                  <span className="text-white truncate flex-1">{m.displayName || m.discordUsername}</span>
                  {m.role && m.role !== 'player' && (
                    <span className="text-[9px] uppercase font-bold tracking-wider text-blue-300">{m.role}</span>
                  )}
                  <span className="text-[10px] text-white/30 font-mono">{m.discordId.slice(-6)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function RoleIdRow({ team, onChanged }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    discordRoleId: team.discordRoleId || '',
    discordGmRoleId: team.discordGmRoleId || '',
    discordCaptainRoleId: team.discordCaptainRoleId || '',
    discordNpRoleId: team.discordNpRoleId || '',
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setForm({
      discordRoleId: team.discordRoleId || '',
      discordGmRoleId: team.discordGmRoleId || '',
      discordCaptainRoleId: team.discordCaptainRoleId || '',
      discordNpRoleId: team.discordNpRoleId || '',
    })
  }, [team.id, team.discordRoleId, team.discordGmRoleId, team.discordCaptainRoleId, team.discordNpRoleId])

  const anySet = team.discordRoleId || team.discordGmRoleId || team.discordCaptainRoleId || team.discordNpRoleId

  async function save() {
    setBusy(true)
    const payload = {}
    for (const k of ['discordRoleId', 'discordGmRoleId', 'discordCaptainRoleId', 'discordNpRoleId']) {
      payload[k] = form[k].trim() || null
    }
    await fetch(`/api/admin/teams/${team.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify(payload),
    })
    setBusy(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onChanged?.()
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/5">
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] font-bold uppercase tracking-wider text-blue-300/70 hover:text-blue-200 flex items-center gap-1"
      >
        {open ? '▴' : '▾'} Discord role IDs
        {anySet && <span className="text-green-300 ml-1">✓</span>}
        {!anySet && <span className="text-yellow-300/70 ml-1">⚠ not set</span>}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
          {[
            { key: 'discordRoleId', label: 'Team role ID' },
            { key: 'discordGmRoleId', label: 'GM role ID' },
            { key: 'discordCaptainRoleId', label: 'Captain role ID' },
            { key: 'discordNpRoleId', label: 'NP (non-playing) role ID' },
          ].map(({ key, label }) => (
            <div key={key}>
              <label className="block text-[9px] uppercase tracking-wider text-blue-300/70 mb-0.5">{label}</label>
              <input
                type="text"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                placeholder="role snowflake (or blank)"
                className="w-full px-2 py-1 bg-black/40 border border-white/10 rounded text-white font-mono text-[11px]"
              />
            </div>
          ))}
          <div className="col-span-full flex items-center gap-2 mt-1">
            <button onClick={save} disabled={busy} className="px-2 py-1 text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded">{busy ? 'Saving…' : 'Save role IDs'}</button>
            {saved && <span className="text-[10px] text-green-300">✓ saved</span>}
            <span className="text-[10px] text-white/40 ml-auto">Used by the bot when assigning/removing roles.</span>
          </div>
        </div>
      )}
    </div>
  )
}

function SuggestionsStrip({ suggestions, division, activeSeasonId, onAdded }) {
  const [busy, setBusy] = useState(null)
  const ranked = [...suggestions].sort((a, b) => {
    const aMatch = a.defaultDivision === division ? 0 : 1
    const bMatch = b.defaultDivision === division ? 0 : 1
    if (aMatch !== bMatch) return aMatch - bMatch
    return (b.lastSeasonNumber || 0) - (a.lastSeasonNumber || 0)
  })
  if (ranked.length === 0) return null

  async function add(f) {
    setBusy(f.id)
    await fetch(`/api/admin/seasons/${activeSeasonId}/teams`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ franchiseId: f.id, division, rosterLimit: 4 }),
    })
    setBusy(null)
    onAdded()
  }

  return (
    <div className="mt-4 pt-4 border-t border-white/5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-blue-300/70 mb-2">
        Suggestions <span className="text-white/30 font-normal normal-case">— franchises not in this season</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {ranked.map((f) => (
          <button
            key={f.id}
            onClick={() => add(f)}
            disabled={busy === f.id}
            className="px-3 py-1.5 text-xs font-semibold text-white/80 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400/40 rounded-lg transition disabled:opacity-50"
          >
            + {f.name}
            {f.defaultDivision && <span className="ml-1 text-blue-200/60">[{f.defaultDivision}]</span>}
            {f.lastSeasonNumber && <span className="ml-1 text-blue-300/60">(S{f.lastSeasonNumber})</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function FranchiseRegistryView({ franchises, onChanged }) {
  const [showCreate, setShowCreate] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-blue-100/60">
          {franchises.length} franchise{franchises.length === 1 ? '' : 's'} on record. These persist across seasons.
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-2 text-xs font-bold text-blue-200 hover:text-white bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded-lg"
        >
          + New Franchise
        </button>
      </div>

      <div className="space-y-2">
        {franchises.map((f) => (
          <FranchiseRow
            key={f.id}
            franchise={f}
            expanded={expandedId === f.id}
            onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)}
            onChanged={onChanged}
          />
        ))}
      </div>

      {showCreate && (
        <CreateFranchiseModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); onChanged() }} />
      )}
    </div>
  )
}

function FranchiseRow({ franchise, expanded, onToggle, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(franchise.name)
  const [defaultDivision, setDefaultDivision] = useState(franchise.defaultDivision || '')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const [logoBust, setLogoBust] = useState(0)

  async function patch(payload) {
    setBusy(true)
    await fetch(`/api/admin/franchises/${franchise.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    onChanged()
  }

  async function saveEdits() {
    const payload = {}
    if (name.trim() && name !== franchise.name) payload.name = name.trim()
    if (defaultDivision !== (franchise.defaultDivision || '')) payload.defaultDivision = defaultDivision || null
    if (Object.keys(payload).length === 0) { setEditing(false); return }
    await patch(payload)
    setEditing(false)
  }

  async function hardDelete() {
    const confirmText = `DELETE ${franchise.name}`
    const got = prompt(`Type "${confirmText}" to permanently delete this franchise. Per-season teams that reference it will lose the franchise link (rows survive). Disabling is usually better than deleting.`)
    if (got !== confirmText) return
    setBusy(true)
    await fetch(`/api/admin/franchises/${franchise.id}`, { cache: 'no-store', method: 'DELETE' })
    setBusy(false)
    onChanged()
  }

  async function uploadLogo(file) {
    if (!file) return
    setBusy(true)
    const fd = new FormData()
    fd.append('file', file)
    await fetch(`/api/admin/franchises/${franchise.id}/logo`, { cache: 'no-store', method: 'POST', body: fd })
    setBusy(false)
    setLogoBust(Date.now())
    onChanged()
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${franchise.isActive ? 'bg-white/[0.03] border-white/10' : 'bg-white/[0.01] border-white/5 opacity-70'}`}>
      <div className="flex items-center gap-3 p-3">
        <button
          onClick={() => fileRef.current?.click()}
          className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 hover:border-blue-400/40 flex items-center justify-center text-[9px] text-white/40 overflow-hidden flex-shrink-0"
          title="Upload logo"
        >
          {franchise.hasLogo ? (
            <img src={`/api/admin/franchises/${franchise.id}/logo?v=${logoBust}`} alt="" className="w-full h-full object-cover" />
          ) : (
            <span>logo</span>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
        </button>

        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="px-2 py-1 bg-black/40 border border-blue-400/40 rounded text-white text-sm font-bold"
                autoFocus
              />
              <select
                value={defaultDivision}
                onChange={(e) => setDefaultDivision(e.target.value)}
                className="px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-xs"
              >
                <option value="">— Any —</option>
                <option value="Majors">Majors</option>
                <option value="AAA">AAA</option>
                <option value="AA">AA</option>
              </select>
              <button onClick={saveEdits} disabled={busy} className="px-2 py-1 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded">Save</button>
              <button onClick={() => { setName(franchise.name); setDefaultDivision(franchise.defaultDivision || ''); setEditing(false) }} className="px-2 py-1 text-xs font-semibold text-white/60 hover:text-white">Cancel</button>
            </div>
          ) : (
            <button onClick={onToggle} className="text-left w-full">
              <div className="text-sm font-bold text-white truncate hover:text-blue-200">{franchise.name}</div>
              <div className="text-[11px] text-blue-200/50">
                {franchise.defaultDivision || 'Any division'} · {franchise.seasonCount || 0} season{franchise.seasonCount === 1 ? '' : 's'}
                {franchise.lastSeasonNumber ? ` · last S${franchise.lastSeasonNumber}` : ''}
                {!franchise.isActive && <span className="text-red-300/80"> · Disabled</span>}
              </div>
            </button>
          )}
        </div>

        <div className="flex gap-1.5 flex-shrink-0">
          {!editing && (
            <button onClick={() => setEditing(true)} className="px-2 py-1 text-[10px] font-bold uppercase text-blue-200 hover:text-white bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 rounded">Edit</button>
          )}
          <button
            onClick={() => patch({ isActive: !franchise.isActive })}
            disabled={busy}
            className={`px-2 py-1 text-[10px] font-bold uppercase rounded ${
              franchise.isActive
                ? 'text-yellow-200 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-400/30'
                : 'text-green-200 bg-green-500/10 hover:bg-green-500/20 border border-green-400/30'
            }`}
          >
            {franchise.isActive ? 'Disable' : 'Enable'}
          </button>
          <button onClick={hardDelete} disabled={busy} className="px-2 py-1 text-[10px] font-bold uppercase text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded">Del</button>
          <button onClick={onToggle} className="px-2 py-1 text-[10px] font-semibold text-white/50 hover:text-white">{expanded ? '▴' : '▾'}</button>
        </div>
      </div>

      {expanded && <FranchiseHistory franchiseId={franchise.id} />}
    </div>
  )
}

function FranchiseHistory({ franchiseId }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    fetch(`/api/admin/franchises/${franchiseId}/history`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
  }, [franchiseId])

  if (!data) return <div className="px-4 pb-3 text-xs text-blue-200/60">Loading history…</div>

  const { seasonsPlayed = [], transactions = [], championships = [], pastPlayers = [] } = data
  const playerSet = new Map()
  for (const p of pastPlayers) {
    if (!playerSet.has(p.discordId)) playerSet.set(p.discordId, p)
  }

  return (
    <div className="bg-black/20 border-t border-white/5 px-4 py-4 space-y-4">
      {championships.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-yellow-300/80 mb-1.5">🏆 Championships</div>
          <div className="flex flex-wrap gap-1.5">
            {championships.map((c, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-yellow-500/10 border border-yellow-400/30 text-yellow-200">
                S{c.seasonNumber} {c.division}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-300/70 mb-1.5">Seasons played ({seasonsPlayed.length})</div>
        {seasonsPlayed.length === 0 ? (
          <div className="text-xs text-white/40 italic">Never appeared in a season.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {seasonsPlayed.map((s) => (
              <span key={s.teamId} className="text-[11px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/80">
                S{s.seasonNumber} {s.division} · "{s.teamName}"
                {!s.isActive && <span className="text-white/40"> · disabled</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-300/70 mb-1.5">Past players ({playerSet.size})</div>
        {playerSet.size === 0 ? (
          <div className="text-xs text-white/40 italic">No roster history yet.</div>
        ) : (
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-0.5 text-xs">
            {Array.from(playerSet.values()).slice(0, 30).map((p) => (
              <li key={p.discordId} className="text-white/70 truncate">
                {p.displayName} <span className="text-white/30 text-[10px]">S{p.seasonNumber}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-300/70 mb-1.5">Transactions ({transactions.length})</div>
        {transactions.length === 0 ? (
          <div className="text-xs text-white/40 italic">No transactions logged yet.</div>
        ) : (
          <ul className="space-y-0.5 text-xs max-h-40 overflow-y-auto">
            {transactions.slice(0, 25).map((tx) => (
              <li key={tx.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.03]">
                <span className="text-blue-300/80 font-bold w-20 truncate text-[10px] uppercase">{tx.type}</span>
                <span className="text-white truncate flex-1">{tx.displayName}</span>
                <span className="text-white/40 text-[10px]">S{tx.seasonNumber || '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function CreateFranchiseModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [defaultDivision, setDefaultDivision] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit() {
    if (!name.trim()) { setErr('Name required'); return }
    setBusy(true); setErr(null)
    const r = await fetch('/api/admin/franchises', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), defaultDivision: defaultDivision || null }),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setErr(d.error || 'Failed')
      setBusy(false)
      return
    }
    onCreated()
  }

  return (
    <Modal onClose={onClose} title="New Franchise">
      <div className="space-y-3">
        {err && <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{err}</div>}
        <div>
          <label className="block text-[10px] font-bold tracking-wider uppercase text-blue-300/70 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sublunary"
            autoFocus
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white"
          />
          <div className="text-[10px] text-white/40 mt-1">Saved exactly as typed — no division suffix added.</div>
        </div>
        <div>
          <label className="block text-[10px] font-bold tracking-wider uppercase text-blue-300/70 mb-1">Default Division (optional)</label>
          <select
            value={defaultDivision}
            onChange={(e) => setDefaultDivision(e.target.value)}
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white"
          >
            <option value="">— Any —</option>
            <option value="Majors">Majors</option>
            <option value="AAA">AAA</option>
            <option value="AA">AA</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-white/70 bg-white/5 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 text-sm font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded-lg">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function AddTeamModal({ division, activeSeasonId, suggestions, onClose, onAdded }) {
  const [mode, setMode] = useState('suggest')
  const [picked, setPicked] = useState(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const filtered = suggestions

  async function submit() {
    setBusy(true); setErr(null)
    try {
      const body = mode === 'suggest' && picked
        ? { franchiseId: picked.id, division, rosterLimit: 4 }
        : { name: newName.trim(), division, rosterLimit: 4 }
      if (mode === 'new' && !newName.trim()) throw new Error('Name required')
      if (mode === 'suggest' && !picked) throw new Error('Pick a franchise')
      const r = await fetch(`/api/admin/seasons/${activeSeasonId}/teams`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      onAdded()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} title={`Add Team to ${division}`}>
      <div className="space-y-4">
        {err && <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{err}</div>}
        <div className="flex gap-2">
          <button onClick={() => setMode('suggest')} className={`flex-1 px-3 py-2 text-sm font-bold rounded-lg ${mode === 'suggest' ? 'bg-blue-500 text-white' : 'bg-white/5 text-white/70'}`}>From franchise ({filtered.length})</button>
          <button onClick={() => setMode('new')} className={`flex-1 px-3 py-2 text-sm font-bold rounded-lg ${mode === 'new' ? 'bg-blue-500 text-white' : 'bg-white/5 text-white/70'}`}>New team</button>
        </div>

        {mode === 'suggest' ? (
          filtered.length === 0 ? (
            <div className="text-white/50 text-sm">No franchises available. Switch to "New team" or create one in the Franchise Registry.</div>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filtered.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setPicked(f)}
                  className={`w-full text-left px-3 py-2 rounded-lg border ${picked?.id === f.id ? 'bg-blue-500/15 border-blue-400/50' : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'}`}
                >
                  <div className="text-sm font-bold text-white">{f.name}</div>
                  <div className="text-xs text-blue-200/50">
                    {f.defaultDivision || 'Any'} · {f.seasonCount || 0} seasons
                    {f.lastSeasonNumber ? ` · last S${f.lastSeasonNumber}` : ' · new'}
                  </div>
                </button>
              ))}
            </div>
          )
        ) : (
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Team name (saved as-is)"
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white"
            autoFocus
          />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-white/70 bg-white/5 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 text-sm font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded-lg">
            {busy ? 'Adding…' : 'Add Team'}
          </button>
        </div>
      </div>
    </Modal>
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
