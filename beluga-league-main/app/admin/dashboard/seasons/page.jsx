'use client'

import { useEffect, useState, useCallback } from 'react'

const DIVISIONS = ['Majors', 'AAA', 'AA']
const DEFAULT_ROSTER_SIZE = 4

function StatusBadge({ status }) {
  const styles = {
    active: 'bg-green-500/15 text-green-300 border-green-400/40',
    draft: 'bg-yellow-500/15 text-yellow-200 border-yellow-400/40',
    archived: 'bg-white/5 text-white/60 border-white/15',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${styles[status] || styles.archived}`}>
      {status}
    </span>
  )
}

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function SeasonsPage() {
  const [seasons, setSeasons] = useState([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/seasons', { cache: 'no-store' })
      const data = await r.json()
      setSeasons(data.seasons || [])
    } catch (e) {
      setError('Failed to load seasons')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  async function handleActivate(id) {
    if (!confirm('Activate this season? Any other active season will be archived.')) return
    await fetch(`/api/admin/seasons/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activate' }),
    })
    reload()
  }

  async function handleArchive(id) {
    if (!confirm('Archive this season?')) return
    await fetch(`/api/admin/seasons/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'archive' }),
    })
    reload()
  }

  async function handleDelete(id, label) {
    const confirmText = `DELETE ${label}`
    const got = prompt(`Type "${confirmText}" to permanently delete this season and ALL teams, schedule, standings, stats, and champions tied to it. Cannot be undone.`)
    if (got !== confirmText) return
    await fetch(`/api/admin/seasons/${id}`, { cache: 'no-store', method: 'DELETE' })
    setExpandedId(null)
    reload()
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
          <h1 className="text-3xl font-black text-white mb-2">Seasons</h1>
          <p className="text-blue-100/60 text-sm">
            Manage league seasons. Click a season to expand metadata edit and per-division champions. Only one season can be active. Deleting a season removes all teams, schedule, standings, stats, and champions tied to it.
          </p>
        </div>
        {(() => {
          const activeSeason = seasons.find((s) => s.status === 'active')
          return activeSeason ? (
            <button
              disabled
              title={`Archive Season ${activeSeason.seasonNumber} first`}
              className="px-5 py-3 bg-white/5 text-white/40 font-bold rounded-lg border border-white/10 cursor-not-allowed"
            >
              + Start New Season
            </button>
          ) : (
            <button
              onClick={() => setShowWizard(true)}
              className="px-5 py-3 bg-blue-500 hover:bg-blue-400 text-white font-bold rounded-lg shadow-[0_0_25px_rgba(59,130,246,0.4)] transition"
            >
              + Start New Season
            </button>
          )
        })()}
      </div>

      {seasons.find((s) => s.status === 'active') && (
        <div className="mb-4 p-4 rounded-2xl bg-yellow-500/[0.06] border border-yellow-400/30 text-sm text-yellow-100/90">
          <strong className="text-yellow-200">Season {seasons.find((s) => s.status === 'active').seasonNumber} is active.</strong>{' '}
          You can&apos;t start a new season until it&apos;s archived. Expand it below and click <em>Archive</em> — all its teams, schedule, standings, stats, and champions stay saved as a past season. Then a fresh start (with franchise suggestions) unlocks.
        </div>
      )}

      {error && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}

      {loading ? (
        <div className="text-blue-200/60">Loading…</div>
      ) : seasons.length === 0 ? (
        <div className="p-8 text-center rounded-2xl border border-dashed border-white/15 text-white/50">
          No seasons yet. Click "Start New Season" to create one.
        </div>
      ) : (
        <div className="space-y-3">
          {seasons.map((s) => (
            <SeasonCard
              key={s.id}
              season={s}
              expanded={expandedId === s.id}
              onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
              onActivate={() => handleActivate(s.id)}
              onArchive={() => handleArchive(s.id)}
              onDelete={() => handleDelete(s.id, `Season ${s.seasonNumber}`)}
              onChanged={reload}
            />
          ))}
        </div>
      )}

      {showWizard && (
        <NewSeasonWizard
          onClose={() => setShowWizard(false)}
          onCreated={() => { setShowWizard(false); reload() }}
        />
      )}
    </div>
  )
}

function SeasonCard({ season, expanded, onToggle, onActivate, onArchive, onDelete, onChanged }) {
  const s = season
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
      <button onClick={onToggle} className="w-full text-left p-5 hover:bg-white/[0.02] transition">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-2xl font-black text-white">Season {s.seasonNumber}</span>
              <StatusBadge status={s.status} />
              {s.year && <span className="text-sm text-blue-200/70">· {s.year}</span>}
            </div>
            <div className="text-sm text-blue-100/60 mt-1">
              {s.name || s.statusLabel || 'Unnamed'}
              <span className="mx-2 text-white/20">·</span>
              {s.teamCount} team{s.teamCount === 1 ? '' : 's'}
              <span className="mx-2 text-white/20">·</span>
              {s.matchCount} match{s.matchCount === 1 ? '' : 'es'}
              <span className="mx-2 text-white/20">·</span>
              <span className="text-white/40">created {fmt(s.createdAt)}</span>
            </div>
          </div>
          <div className="text-blue-300/50 text-sm">
            {expanded ? '▴ collapse' : '▾ details'}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-6 border-t border-white/10 pt-5 bg-black/20">
          <SeasonMetadataPanel season={s} onSaved={onChanged} />

          <OnFieldCapsPanel seasonId={s.id} />

          <ChampionsPanel seasonId={s.id} />

          <div className="flex flex-wrap gap-2 pt-4 border-t border-white/10">
            {s.status !== 'active' && (
              <button onClick={onActivate} className="px-3 py-2 text-xs font-semibold text-green-200 hover:text-white bg-green-500/10 hover:bg-green-500/20 border border-green-400/30 rounded-lg">
                Activate
              </button>
            )}
            {s.status === 'active' && (
              <button onClick={onArchive} className="px-3 py-2 text-xs font-semibold text-yellow-200 hover:text-white bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-400/30 rounded-lg">
                Archive
              </button>
            )}
            <button onClick={onDelete} className="ml-auto px-3 py-2 text-xs font-semibold text-red-300 hover:text-red-100 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg">
              Delete season
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SeasonMetadataPanel({ season, onSaved }) {
  const [form, setForm] = useState({
    seasonNumber: season.seasonNumber,
    name: season.name || '',
    year: season.year || new Date().getFullYear(),
    statusLabel: season.statusLabel || '',
    description: season.description || '',
    recruitingOpen: !!season.recruitingOpen,
    startDate: season.startDate || '',
  })
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  async function save() {
    setSaving(true)
    try {
      await fetch(`/api/admin/seasons/${season.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setSavedAt(Date.now())
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-blue-300/70 mb-3">Metadata</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Season Number">
          <input type="number" min={1} value={form.seasonNumber || ''}
            onChange={(e) => setForm({ ...form, seasonNumber: parseInt(e.target.value, 10) || 0 })}
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
        </Field>
        <Field label="Year">
          <input type="number" min={2020} value={form.year || ''}
            onChange={(e) => setForm({ ...form, year: parseInt(e.target.value, 10) || 0 })}
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
        </Field>
      </div>
      <Field label="Name">
        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Spring 2026"
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
      </Field>
      <Field label="Status Label (homepage hero pill)">
        <input type="text" value={form.statusLabel} onChange={(e) => setForm({ ...form, statusLabel: e.target.value })}
          placeholder="e.g. SEASON 9 · NOW LIVE"
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
      </Field>
      <Field label="Description">
        <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
      </Field>
      <Field label="Season Start Date (Monday of Week 1)">
        <input type="date" value={form.startDate || ''} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
        <div className="text-[10px] text-white/40 mt-1">Drives week numbering and the Week Threads tab.</div>
      </Field>
      <label className="flex items-center justify-between cursor-pointer mt-3">
        <div>
          <div className="text-sm font-bold text-white">Recruiting Open</div>
          <div className="text-xs text-blue-100/50">Show "Recruiting Now" on the homepage</div>
        </div>
        <button type="button" onClick={() => setForm({ ...form, recruitingOpen: !form.recruitingOpen })}
          className={`relative w-12 h-6 rounded-full transition-colors ${form.recruitingOpen ? 'bg-blue-500' : 'bg-white/10'}`}>
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.recruitingOpen ? 'translate-x-6' : 'translate-x-0.5'}`} />
        </button>
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-4 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded-lg">
          {saving ? 'Saving…' : 'Save metadata'}
        </button>
        {savedAt && <span className="text-xs text-green-300">✓ saved</span>}
      </div>
    </div>
  )
}

function OnFieldCapsPanel({ seasonId }) {
  const [caps, setCaps] = useState({ Majors: '', AAA: '', AA: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/seasons/${seasonId}/config`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        const c = d?.config?.onfieldCaps || {}
        setCaps({
          Majors: c.Majors ?? '',
          AAA: c.AAA ?? '',
          AA: c.AA ?? '',
        })
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [seasonId])

  async function save() {
    setSaving(true)
    try {
      const payload = {}
      for (const d of DIVISIONS) {
        const v = caps[d]
        if (v !== '' && v != null && !Number.isNaN(Number(v))) payload[d] = Number(v)
      }
      // Re-read existing config so we don't wipe teamsPerDivision/weeks.
      const cfgRes = await fetch(`/api/admin/seasons/${seasonId}/config`, { cache: 'no-store' })
      const cfg = (await cfgRes.json())?.config || {}
      await fetch(`/api/admin/seasons/${seasonId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamsPerDivision: cfg.teamsPerDivision || {},
          weeks: cfg.weeks ?? null,
          onfieldCaps: payload,
        }),
      })
      setSavedAt(Date.now())
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-blue-300/70 mb-1">On-Field Salary Caps</div>
      <div className="text-[11px] text-white/40 mb-3">
        Max combined salary of a 3-player on-field lineup, per division. The team roster page lists every playable / over-cap trio. Leave blank to disable for a division.
      </div>
      {loading ? (
        <div className="text-blue-200/60 text-sm">Loading caps…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {DIVISIONS.map((d) => (
              <Field key={d} label={`${d} cap`}>
                <input type="number" min={0} step="0.01" value={caps[d]}
                  onChange={(e) => setCaps({ ...caps, [d]: e.target.value })}
                  placeholder="—"
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
              </Field>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={save} disabled={saving} className="px-4 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded-lg">
              {saving ? 'Saving…' : 'Save caps'}
            </button>
            {savedAt && <span className="text-xs text-green-300">✓ saved</span>}
          </div>
        </>
      )}
    </div>
  )
}

function ChampionsPanel({ seasonId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savingDivision, setSavingDivision] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/admin/seasons/${seasonId}/champions`, { cache: 'no-store' })
      const d = await r.json()
      setData(d)
    } finally {
      setLoading(false)
    }
  }, [seasonId])

  useEffect(() => { reload() }, [reload])

  async function setChampion(division, payload) {
    setSavingDivision(division)
    try {
      await fetch(`/api/admin/seasons/${seasonId}/champions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ division, ...payload }),
      })
      await reload()
    } finally {
      setSavingDivision(null)
    }
  }

  if (loading) return <div className="text-blue-200/60 text-sm">Loading champions…</div>

  const championByDivision = {}
  for (const c of (data?.champions || [])) championByDivision[c.division] = c
  const teamsByDivision = {}
  for (const t of (data?.teams || [])) {
    if (!teamsByDivision[t.division]) teamsByDivision[t.division] = []
    teamsByDivision[t.division].push(t)
  }

  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-blue-300/70 mb-3">Champions per Division</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {DIVISIONS.map((d) => {
          const champ = championByDivision[d]
          const teams = teamsByDivision[d] || []
          return (
            <ChampionCard
              key={d}
              division={d}
              champion={champ}
              teams={teams}
              saving={savingDivision === d}
              onSave={(payload) => setChampion(d, payload)}
              onClear={() => setChampion(d, { clear: true })}
            />
          )
        })}
      </div>
    </div>
  )
}

function ChampionCard({ division, champion, teams, saving, onSave, onClear }) {
  const [teamId, setTeamId] = useState(champion?.teamId ?? '')
  const [gmDisplayName, setGmDisplayName] = useState(champion?.gmDisplayName || '')
  const [gmDiscordId, setGmDiscordId] = useState(champion?.gmDiscordId || '')
  const [notes, setNotes] = useState(champion?.notes || '')

  // Sync local state when champion changes
  useEffect(() => {
    setTeamId(champion?.teamId ?? '')
    setGmDisplayName(champion?.gmDisplayName || '')
    setGmDiscordId(champion?.gmDiscordId || '')
    setNotes(champion?.notes || '')
  }, [champion?.teamId, champion?.gmDisplayName, champion?.gmDiscordId, champion?.notes])

  const dirty =
    String(teamId) !== String(champion?.teamId ?? '') ||
    gmDisplayName !== (champion?.gmDisplayName || '') ||
    gmDiscordId !== (champion?.gmDiscordId || '') ||
    notes !== (champion?.notes || '')

  return (
    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-black text-white tracking-wider uppercase">{division}</span>
        {champion ? (
          <span className="text-[10px] uppercase font-bold tracking-wider text-yellow-300 bg-yellow-500/10 border border-yellow-400/30 px-2 py-0.5 rounded">Champion set</span>
        ) : (
          <span className="text-[10px] uppercase font-bold tracking-wider text-white/40">Not set</span>
        )}
      </div>

      <Field label="Team">
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          <option value="">— None —</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}{!t.isActive ? ' (inactive)' : ''}</option>
          ))}
        </select>
      </Field>

      <Field label="GM Display Name (optional)">
        <input type="text" value={gmDisplayName} onChange={(e) => setGmDisplayName(e.target.value)}
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm" />
      </Field>

      <Field label="GM Discord ID (optional)">
        <input type="text" value={gmDiscordId} onChange={(e) => setGmDiscordId(e.target.value)}
          placeholder="e.g. 12345678901234567"
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm font-mono" />
      </Field>

      <Field label="Notes (optional)">
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
          className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm" />
      </Field>

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onSave({
            teamId: teamId === '' ? null : Number(teamId),
            gmDisplayName: gmDisplayName.trim() || null,
            gmDiscordId: gmDiscordId.trim() || null,
            notes: notes.trim() || null,
          })}
          disabled={saving || (!dirty && !!champion)}
          className="flex-1 px-3 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded-lg"
        >
          {saving ? 'Saving…' : champion ? 'Update' : 'Set Champion'}
        </button>
        {champion && (
          <button onClick={onClear} disabled={saving}
            className="px-3 py-1.5 text-xs font-semibold text-red-300 hover:text-red-100 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg">
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="mt-2">
      <label className="block text-[10px] font-bold tracking-wider uppercase text-blue-300/70 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Modal({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-[#0b1220] border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#0b1220] z-10">
          <h2 className="text-xl font-black text-white">{title}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

function NewSeasonWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(1)
  const [meta, setMeta] = useState({
    seasonNumber: 1,
    name: '',
    year: new Date().getFullYear(),
    statusLabel: '',
    description: '',
    recruitingOpen: false,
  })
  const [counts, setCounts] = useState({ Majors: 0, AAA: 0, AA: 0 })
  const [weeks, setWeeks] = useState(8)
  const [rosterSize, setRosterSize] = useState(DEFAULT_ROSTER_SIZE)
  const [picks, setPicks] = useState({ Majors: [], AAA: [], AA: [] })
  const [suggestions, setSuggestions] = useState([])
  const [working, setWorking] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    fetch('/api/admin/franchises?activeOnly=true', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setSuggestions(d.franchises || []))
      .catch(() => {})
    fetch('/api/admin/seasons', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const max = (d.seasons || []).reduce((m, s) => Math.max(m, s.seasonNumber || 0), 0)
        setMeta((m) => ({ ...m, seasonNumber: max + 1 }))
      })
      .catch(() => {})
  }, [])

  function setPick(division, idx, value) {
    setPicks((prev) => {
      const arr = [...(prev[division] || [])]
      arr[idx] = value
      return { ...prev, [division]: arr }
    })
  }

  async function finalize() {
    setWorking(true)
    setErr(null)
    try {
      // Step A: create the season + season_config + activate.
      const teamsPerDivision = { ...counts }
      const createRes = await fetch('/api/admin/seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...meta,
          teamsPerDivision,
          weeks: Number(weeks) || null,
          activate: true,
        }),
      })
      const createData = await createRes.json()
      if (!createRes.ok) throw new Error(createData.error || 'Create season failed')
      const seasonId = createData.season.id

      // Step B: flatten ALL picks into a single bulk payload.
      const flat = []
      for (const division of DIVISIONS) {
        const arr = picks[division] || []
        for (let idx = 0; idx < arr.length; idx += 1) {
          const pick = arr[idx]
          if (!pick) continue
          flat.push({
            division,
            franchiseId: pick.franchiseId || null,
            name: pick.name ? String(pick.name).trim() : null,
            rosterLimit: Number(rosterSize) || DEFAULT_ROSTER_SIZE,
          })
        }
      }

      if (flat.length === 0) {
        setErr('No team picks were selected. Go back to Step 3 and pick or add at least one team per division.')
        return
      }

      // Step C: bulk add atomically.
      const bulkRes = await fetch(`/api/admin/seasons/${seasonId}/bulk-teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picks: flat }),
      })
      const bulkData = await bulkRes.json()
      if (!bulkRes.ok) {
        // Show partial results so the user knows what was attempted.
        const lines = (bulkData.results || []).map((r) => {
          if (r.status === 'created' || r.status === 'updated') return `✓ ${r.division}: ${r.name} (${r.status})`
          if (r.status === 'skipped') return `– ${r.division || '?'}: skipped (${r.error})`
          return `✗ ${r.division || '?'}: ${r.error || 'unknown'}`
        })
        setErr(`Season ${createData.season.seasonNumber} created, but bulk-teams failed:\n${bulkData.error || ''}\n\nResults so far:\n${lines.join('\n')}\n\nNothing was committed. Fix and retry.`)
        return
      }

      // Validate that every division the user requested teams for actually got teams.
      const summary = bulkData.summary || {}
      const expected = Object.entries(teamsPerDivision).filter(([_, n]) => n > 0)
      const unmet = expected.filter(([d, n]) => (summary[d] || 0) < n)
      if (unmet.length > 0) {
        const detail = unmet.map(([d, n]) => `${d}: expected ${n}, got ${summary[d] || 0}`).join(', ')
        const skipDetail = (bulkData.results || [])
          .filter((r) => r.status === 'skipped')
          .map((r) => `${r.division || '?'}: ${r.error}`)
          .join(', ')
        setErr(`Season created. Teams added: ${JSON.stringify(summary)}.\n\nNot every slot was filled — ${detail}.${skipDetail ? `\n\nSkipped: ${skipDetail}` : ''}\n\nGo back to Step 3 and pick teams for the empty slots, then close and retry the wizard, or add them via Teams & Franchises tab.`)
        return
      }

      onCreated()
    } catch (e) {
      setErr(e.message || 'Failed')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal onClose={onClose} title={`New Season — Step ${step} of 3`}>
      {err && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm whitespace-pre-line">{err}</div>}

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-blue-100/60">Basic season info. You can edit any of this later.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Season Number">
              <input type="number" min={1} value={meta.seasonNumber || ''}
                onChange={(e) => setMeta({ ...meta, seasonNumber: parseInt(e.target.value, 10) || 0 })}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
            </Field>
            <Field label="Year">
              <input type="number" min={2020} value={meta.year || ''}
                onChange={(e) => setMeta({ ...meta, year: parseInt(e.target.value, 10) || 0 })}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
            </Field>
          </div>
          <Field label="Name">
            <input type="text" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })}
              placeholder="e.g. Spring 2026"
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
          </Field>
          <Field label="Status Label">
            <input type="text" value={meta.statusLabel} onChange={(e) => setMeta({ ...meta, statusLabel: e.target.value })}
              placeholder="e.g. SEASON 9 · NOW LIVE"
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
          </Field>
          <Field label="Description">
            <input type="text" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })}
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
          </Field>
          <label className="flex items-center justify-between cursor-pointer pt-1">
            <div>
              <div className="text-sm font-bold text-white">Recruiting Open</div>
              <div className="text-xs text-blue-100/50">Show "Recruiting Now" messaging</div>
            </div>
            <button type="button" onClick={() => setMeta({ ...meta, recruitingOpen: !meta.recruitingOpen })}
              className={`relative w-12 h-6 rounded-full transition-colors ${meta.recruitingOpen ? 'bg-blue-500' : 'bg-white/10'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${meta.recruitingOpen ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </label>

          <div className="flex justify-end gap-2 pt-4">
            <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-white/70 bg-white/5 rounded-lg">Cancel</button>
            <button onClick={() => setStep(2)} disabled={!meta.seasonNumber}
              className="px-4 py-2 text-sm font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded-lg">
              Next →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-blue-100/60">How many teams per division? Drives standings layout and the schedule generator.</p>
          <div className="grid grid-cols-3 gap-3">
            {DIVISIONS.map((d) => (
              <Field key={d} label={d}>
                <input type="number" min={0} max={32} value={counts[d]}
                  onChange={(e) => setCounts({ ...counts, [d]: parseInt(e.target.value, 10) || 0 })}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-lg font-bold" />
              </Field>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Regular Season Weeks">
              <input type="number" min={1} max={20} value={weeks}
                onChange={(e) => setWeeks(parseInt(e.target.value, 10) || 0)}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
            </Field>
            <Field label="Roster Size (per team)">
              <input type="number" min={1} max={20} value={rosterSize}
                onChange={(e) => setRosterSize(parseInt(e.target.value, 10) || 0)}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
            </Field>
          </div>
          <div className="text-[10px] text-white/40">
            Roster size applies to every team created here. You can change it per-team afterward in Teams & Franchises.
          </div>
          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-sm font-semibold text-white/70 bg-white/5 rounded-lg">← Back</button>
            <button onClick={() => setStep(3)}
              disabled={Object.values(counts).every((c) => !c) || !rosterSize || rosterSize < 1}
              className="px-4 py-2 text-sm font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded-lg">
              Next →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <p className="text-sm text-blue-100/60">Pick teams for each division. Existing franchises are sorted by recency.</p>
          {suggestions.length === 0 && (
            <div className="text-xs text-yellow-300/80 bg-yellow-500/10 border border-yellow-400/30 rounded-lg p-3">
              No franchises yet. Add new teams below — they'll be saved as franchises and appear as suggestions in future seasons.
            </div>
          )}
          {DIVISIONS.map((d) => {
            const slots = counts[d] || 0
            if (!slots) return null
            const ranked = [...suggestions].sort((a, b) => {
              const aMatch = a.defaultDivision === d ? 0 : 1
              const bMatch = b.defaultDivision === d ? 0 : 1
              if (aMatch !== bMatch) return aMatch - bMatch
              return (b.lastSeasonNumber || 0) - (a.lastSeasonNumber || 0)
            })
            return (
              <div key={d} className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
                <div className="text-sm font-bold text-white mb-3 uppercase tracking-wider">{d} <span className="text-blue-300/70 text-xs">({slots} slots)</span></div>
                <div className="space-y-2">
                  {Array.from({ length: slots }).map((_, i) => {
                    const pick = picks[d]?.[i]
                    const selectValue = pick?.franchiseId ? String(pick.franchiseId) : (pick && !pick.franchiseId ? '__new__' : '')
                    return (
                      <div key={i} className="flex gap-2 items-center">
                        <span className="text-xs text-white/40 w-6">{i + 1}.</span>
                        <select value={selectValue}
                          onChange={(e) => {
                            const v = e.target.value
                            if (v === '__new__') setPick(d, i, { name: '' })
                            else if (v === '') setPick(d, i, null)
                            else {
                              const f = ranked.find((s) => String(s.id) === v)
                              if (f) setPick(d, i, { franchiseId: f.id, name: f.name })
                            }
                          }}
                          className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
                          <option value="">— Select —</option>
                          {ranked.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}{s.defaultDivision ? ` [${s.defaultDivision}]` : ''}{s.lastSeasonNumber ? ` · last S${s.lastSeasonNumber}` : ' · new'}
                            </option>
                          ))}
                          <option value="__new__">+ Add new team…</option>
                        </select>
                        {pick && !pick.franchiseId && (
                          <input type="text" placeholder="New team name"
                            value={pick.name || ''}
                            onChange={(e) => setPick(d, i, { name: e.target.value })}
                            className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-sm font-semibold text-white/70 bg-white/5 rounded-lg">← Back</button>
            <button onClick={finalize} disabled={working}
              className="px-5 py-2.5 text-sm font-bold text-white bg-green-500 hover:bg-green-400 disabled:opacity-50 rounded-lg">
              {working ? 'Creating…' : 'Create Season'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
