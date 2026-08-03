'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Avatar from '../../../components/Avatar'

const DIVISIONS = ['Majors', 'AAA', 'AA']
// 'same' is what the auto formula writes and what the public TrendChip renders —
// an editor offering 'stable' produced a chip that silently disappeared.
const TRENDS = [
  { value: '', label: '—' },
  { value: 'up', label: '▲ Up' },
  { value: 'down', label: '▼ Down' },
  { value: 'same', label: '= Same' },
  { value: 'new', label: '★ New' },
]

export default function RankingsPage() {
  const [seasons, setSeasons] = useState([])
  const [seasonId, setSeasonId] = useState(null)
  const [week, setWeek] = useState(null) // null = latest stored week
  const [data, setData] = useState(null) // { rankings, seasonTeams, weeks, playedWeeks, ... }
  const [entityType, setEntityType] = useState('team')
  const [division, setDivision] = useState('Majors')
  const [list, setList] = useState([])
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recalcing, setRecalcing] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      if (!seasons.length) {
        const sRes = await fetch('/api/admin/seasons', { cache: 'no-store' })
        const sData = await sRes.json()
        setSeasons(sData.seasons || [])
        if (!seasonId) setSeasonId(sData.activeSeasonId || (sData.seasons?.[0]?.id ?? null))
      }
      const sid = seasonId || 'active'
      const qs = week != null ? `&week=${week}` : ''
      const r = await fetch(`/api/admin/power-rankings?seasonId=${sid}${qs}`, { cache: 'no-store' })
      const d = await r.json()
      setData(d)
      if (!seasonId && d.seasonId) setSeasonId(d.seasonId)
      // Adopt whichever week the server actually served, so the dropdown and the
      // list below it can never disagree.
      if (week == null && d.week != null) setWeek(d.week)
    } finally {
      setLoading(false)
    }
  }, [seasonId, week, seasons.length])

  useEffect(() => { reload() }, [reload])

  // Load the editable list whenever the selected bucket or data changes.
  useEffect(() => {
    if (!data?.rankings) { setList([]); setDirty(false); return }
    const src = data.rankings?.[entityType]?.[division] || []
    setList(src.map((e) => ({
      key: e.id || `${e.teamId || e.discordId}-${e.rank}`,
      teamId: e.teamId || null,
      discordId: e.discordId || null,
      name: e.name,
      avatarUrl: e.avatarUrl || null,
      note: e.note || '',
      trend: e.trend || '',
    })))
    setDirty(false)
  }, [data, entityType, division])

  function move(index, dir) {
    const t = index + dir
    if (t < 0 || t >= list.length) return
    const next = [...list]
    ;[next[index], next[t]] = [next[t], next[index]]
    setList(next); setDirty(true)
  }
  function removeRow(index) { setList(list.filter((_, i) => i !== index)); setDirty(true) }
  function updateRow(index, patch) { setList(list.map((it, i) => (i === index ? { ...it, ...patch } : it))); setDirty(true) }
  function addEntry(entry) {
    if (entityType === 'team' && list.some((l) => l.teamId === entry.teamId)) return
    if (entityType === 'player' && list.some((l) => l.discordId === entry.discordId)) return
    setList([...list, { key: `new-${Date.now()}`, note: '', trend: '', ...entry }]); setDirty(true)
  }

  async function save() {
    if (!seasonId) return
    setSaving(true)
    try {
      const entries = list.map((l) => (
        entityType === 'team'
          ? { teamId: l.teamId, note: l.note || null, trend: l.trend || null }
          : { discordId: l.discordId, note: l.note || null, trend: l.trend || null }
      ))
      const r = await fetch('/api/admin/power-rankings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ seasonId, entityType, division, week, entries }),
      })
      const d = await r.json()
      if (r.ok) { setData((prev) => ({ ...prev, rankings: d.rankings })); setSavedAt(Date.now()); setDirty(false) }
    } finally {
      setSaving(false)
    }
  }

  // Auto-recalculate every division's team + player rankings for ONE WEEK from
  // results up to that week (same formula as the bot's /power-rankings +
  // week-close refresh). Other weeks are left untouched.
  async function recalc() {
    if (!seasonId) return
    const target = week ?? data?.defaultWeek
    if (!confirm(
      `Auto-recalculate week ${target ?? '?'} power rankings (teams + players, every division) from results up to that week?\n\n`
      + `Only week ${target ?? '?'} is replaced — other weeks are left alone. Manual reorders/notes for this week will be overwritten. `
      + 'Trend arrows are set against the previous week.'
    )) return
    setRecalcing(true)
    try {
      const r = await fetch('/api/admin/power-rankings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ action: 'recalc', seasonId, week }),
      })
      const d = await r.json()
      if (r.ok) {
        setData((prev) => ({ ...prev, rankings: d.rankings, weeks: d.weeks || prev?.weeks }))
        if (d.week != null) setWeek(d.week)
        setSavedAt(Date.now()); setDirty(false)
      } else alert(d.error || 'Recalc failed')
    } finally { setRecalcing(false) }
  }

  // Rebuild EVERY week that has results, oldest first, so trend arrows chain
  // correctly across the whole season. Used once after deploy, or after a bulk
  // stats correction.
  async function backfill() {
    if (!seasonId) return
    const played = data?.playedWeeks || []
    if (!confirm(
      `Rebuild power rankings for every week with results${played.length ? ` (weeks ${played[0]}–${played[played.length - 1]})` : ''}?\n\n`
      + 'Each week is recomputed from results up to that week, oldest first, so trend arrows chain correctly. '
      + 'This overwrites every stored week for this season, including manual edits.'
    )) return
    setBackfilling(true)
    try {
      const r = await fetch('/api/admin/power-rankings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ action: 'backfill', seasonId }),
      })
      const d = await r.json()
      if (r.ok) {
        setData((prev) => ({ ...prev, rankings: d.rankings, weeks: d.weeks || prev?.weeks }))
        if (d.week != null) setWeek(d.week)
        setSavedAt(Date.now()); setDirty(false)
        alert(`Rebuilt ${(d.weeksRebuilt || []).length} week(s): ${(d.weeksRebuilt || []).join(', ') || '—'}`)
      } else alert(d.error || 'Backfill failed')
    } finally { setBackfilling(false) }
  }

  const availableTeams = (data?.seasonTeams || []).filter((t) => t.division === division && !list.some((l) => l.teamId === t.id))
  // Every week worth offering: already stored, plus any played week not yet ranked.
  const weekOptions = Array.from(new Set([
    ...(data?.weeks || []),
    ...(data?.playedWeeks || []),
    ...(week != null ? [week] : []),
  ])).sort((a, b) => b - a)
  const storedWeeks = new Set(data?.weeks || [])

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
        <h1 className="text-3xl font-black text-white mb-2">Power Rankings</h1>
        <p className="text-blue-100/60 text-sm">
          Weekly snapshots per season. Each week is ranked from the last 5 series up to that week, so recalculating one week
          never touches the others and trend arrows compare against the week before. Reorder with the arrows, add analyst notes,
          and Save. These appear on the public Power Rankings page.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/10" data-log-section="power-rankings">
        <select value={seasonId || ''} onChange={(e) => { setSeasonId(e.target.value === '' ? null : Number(e.target.value)); setWeek(null); setData(null) }}
          aria-label="Power rankings season"
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          <option value="">— Active —</option>
          {seasons.map((s) => <option key={s.id} value={s.id}>S{s.seasonNumber}{s.name ? ` · ${s.name}` : ''}</option>)}
        </select>
        <select value={week ?? ''} onChange={(e) => { setWeek(e.target.value === '' ? null : Number(e.target.value)); setData(null) }}
          aria-label="Power rankings week"
          title="Only the selected week is recalculated or saved"
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          <option value="">— Latest week —</option>
          {weekOptions.map((w) => (
            <option key={w} value={w}>Week {w}{storedWeeks.has(w) ? '' : ' (not ranked yet)'}</option>
          ))}
        </select>
        <div className="flex gap-1.5 ml-2">
          {['team', 'player'].map((t) => (
            <button key={t} onClick={() => setEntityType(t)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded border ${entityType === t ? 'bg-blue-500/20 border-blue-400/50 text-blue-100' : 'bg-white/5 border-white/10 text-white/60'}`}>
              {t === 'team' ? 'Teams' : 'Players'}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {DIVISIONS.map((d) => (
            <button key={d} onClick={() => setDivision(d)}
              className={`px-3 py-1.5 text-xs font-bold rounded border ${division === d ? 'bg-blue-500/20 border-blue-400/50 text-blue-100' : 'bg-white/5 border-white/10 text-white/60'}`}>
              {d}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={backfill} disabled={backfilling || recalcing || saving}
            aria-label="Backfill every week"
            title="Rebuild every week with results, oldest first, so trend arrows chain correctly"
            className="px-3 py-2 text-xs font-bold text-amber-100 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 disabled:opacity-40 rounded-lg">
            {backfilling ? 'Rebuilding…' : '⤓ Backfill all weeks'}
          </button>
          <button onClick={recalc} disabled={recalcing || backfilling || saving}
            aria-label="Recalculate this week"
            title="Regenerate this week's rankings from results up to it (overwrites this week's manual edits only)"
            className="px-4 py-2 text-xs font-bold text-purple-100 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/40 disabled:opacity-40 rounded-lg">
            {recalcing ? 'Recalculating…' : `⟳ Recalculate week ${week ?? data?.defaultWeek ?? ''}`.trim()}
          </button>
          <button onClick={save} disabled={saving || !dirty} aria-label="Save power rankings"
            className="px-4 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-40 rounded-lg">
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
          {savedAt && !dirty && <span className="text-xs text-green-300">✓</span>}
        </div>
      </div>

      {!!data?.unweekedSeries && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-400/30 text-amber-100/90 text-xs">
          {data.unweekedSeries} confirmed series {data.unweekedSeries === 1 ? 'has' : 'have'} no week set (staff reports may omit it).
          Those count toward every week&apos;s form window.
        </div>
      )}

      {loading && !data ? (
        <div className="text-blue-200/60">Loading…</div>
      ) : !seasonId ? (
        <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/60">No season selected.</div>
      ) : (
        <>
          <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden mb-4">
            {list.length === 0 ? (
              <div className="p-8 text-center text-sm text-white/40">No {entityType === 'team' ? 'teams' : 'players'} ranked for {division} yet. Add some below.</div>
            ) : (
              <ul className="divide-y divide-white/5">
                {list.map((row, i) => (
                  <li key={row.key} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-7 text-center text-sm font-black text-blue-200">{i + 1}</span>
                    <div className="flex flex-col">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="text-white/50 hover:text-white disabled:opacity-20 leading-none text-xs">▲</button>
                      <button onClick={() => move(i, 1)} disabled={i === list.length - 1} className="text-white/50 hover:text-white disabled:opacity-20 leading-none text-xs">▼</button>
                    </div>
                    {entityType === 'player'
                      ? <Avatar src={row.avatarUrl} name={row.name} size={30} ring={false} />
                      : <img src={row.teamId ? `/api/teams/logo?teamId=${row.teamId}` : ''} alt="" className="w-7 h-7 object-contain" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />}
                    <span className="text-white text-sm font-medium truncate w-40">{row.name}</span>
                    <input value={row.note} onChange={(e) => updateRow(i, { note: e.target.value })} placeholder="note (optional)"
                      className="flex-1 px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-xs" />
                    <select value={row.trend} onChange={(e) => updateRow(i, { trend: e.target.value })}
                      className="px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-xs">
                      {TRENDS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <button onClick={() => removeRow(i)} className="px-2 py-1 text-[10px] uppercase font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded">Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {entityType === 'team' ? (
            <TeamAdder teams={availableTeams} onAdd={(t) => addEntry({ teamId: t.id, name: t.name })} />
          ) : (
            <PlayerAdder onAdd={(p) => addEntry({ discordId: p.id, name: p.displayName || p.username, avatarUrl: p.avatarUrl })} />
          )}
        </>
      )}
    </div>
  )
}

function TeamAdder({ teams, onAdd }) {
  return (
    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10">
      <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-2">Add a team</div>
      {teams.length === 0 ? (
        <div className="text-xs text-white/40">All teams in this division are already ranked.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {teams.map((t) => (
            <button key={t.id} onClick={() => onAdd(t)} className="px-3 py-1.5 text-xs font-semibold text-blue-200 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 rounded">
              + {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PlayerAdder({ onAdd }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/discord?kind=user&q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })
        const d = await r.json()
        setResults(d.results || [])
      } catch { setResults([]) } finally { setLoading(false) }
    }, 220)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [q])

  return (
    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10">
      <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-2">Add a player</div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by display name…"
        className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
      {(loading || results.length > 0) && (
        <div className="mt-1.5 max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-black/30 divide-y divide-white/5">
          {loading && <div className="px-3 py-2 text-xs text-white/40">Searching…</div>}
          {results.map((m) => (
            <button key={m.id} onClick={() => { onAdd(m); setQ(''); setResults([]) }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-blue-500/10">
              <Avatar src={m.avatarUrl} name={m.displayName} size={28} ring={false} />
              <span className="text-sm text-white truncate">{m.displayName || m.username}</span>
              {m.inGuild === false && <span className="ml-auto text-[9px] uppercase text-amber-300/80">left</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
