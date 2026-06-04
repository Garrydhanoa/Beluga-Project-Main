'use client'

import { useEffect, useState, useCallback } from 'react'
import { DiscordTranscriptModal } from '../../../components/DiscordTranscript'

const DIVISIONS = ['Majors', 'AAA', 'AA']

export default function WeekThreadsPage() {
  const [data, setData] = useState(null)
  const [seasons, setSeasons] = useState([])
  const [seasonId, setSeasonId] = useState(null)
  const [transcriptThread, setTranscriptThread] = useState(null) // { threadId, label }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [makeWeekNum, setMakeWeekNum] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (!seasons.length) {
        const sRes = await fetch('/api/admin/seasons', { cache: 'no-store' })
        const sData = await sRes.json()
        setSeasons(sData.seasons || [])
        if (!seasonId) setSeasonId(sData.activeSeasonId || (sData.seasons?.[0]?.id ?? null))
      }
      const sid = seasonId || 'active'
      const r = await fetch(`/api/admin/week-threads?seasonId=${sid}`, { cache: 'no-store' })
      const d = await r.json()
      setData(d)
      if (!seasonId && d.seasonId) setSeasonId(d.seasonId)
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [seasonId, seasons.length])

  useEffect(() => { reload() }, [reload])

  async function saveStartDate(date) {
    if (!data?.season?.id) return
    setBusy(true)
    await fetch(`/api/admin/seasons/${data.season.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ startDate: date || null }),
    })
    setBusy(false)
    await reload()
  }

  async function materializeCurrentWeek() {
    if (!data?.season?.id || !data?.currentWeek) return
    setBusy(true)
    await fetch('/api/admin/week-threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ action: 'materialize_week', seasonId: data.season.id, weekNumber: data.currentWeek }),
    })
    setBusy(false)
    await reload()
  }

  async function backfillAll() {
    if (!data?.season?.id || !data?.currentWeek) return
    if (!confirm(`This will create week_threads rows for every week from 1 through ${data.currentWeek} based on the schedule. Existing rows are kept (no duplicates). Proceed?`)) return
    setBusy(true)
    await fetch('/api/admin/week-threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ action: 'materialize_range', seasonId: data.season.id, fromWeek: 1, toWeek: data.currentWeek }),
    })
    setBusy(false)
    await reload()
  }

  async function makeSpecificWeek() {
    const w = Number(makeWeekNum)
    if (!data?.season?.id || !Number.isInteger(w) || w < 1) return
    setBusy(true)
    await fetch('/api/admin/week-threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ action: 'materialize_week', seasonId: data.season.id, weekNumber: w }),
    })
    setBusy(false)
    setMakeWeekNum('')
    alert(`Week ${w} materialized from the schedule. The bot will create the Discord thread(s) within ~1 minute.`)
    await reload()
  }

  async function deleteWeek(week) {
    if (!data?.season?.id) return
    if (!confirm(
      `Delete Week ${week}?\n\nThe bot will delete the Discord thread(s) for this week AND save each transcript on the website — exactly like the /week-thread delete command. This runs within ~1 minute.`
    )) return
    setBusy(true)
    await fetch('/api/admin/week-threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ action: 'delete_week', seasonId: data.season.id, weekNumber: week }),
    })
    setBusy(false)
    alert(`Week ${week} delete queued. The bot will remove the Discord thread(s) and save the transcripts shortly.`)
    await reload()
  }

  const threads = data?.threads || []
  // Group by week_number
  const byWeek = threads.reduce((acc, t) => {
    if (!acc[t.weekNumber]) acc[t.weekNumber] = []
    acc[t.weekNumber].push(t)
    return acc
  }, {})
  const weekNumbers = Object.keys(byWeek).map(Number).sort((a, b) => b - a)

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
        <h1 className="text-3xl font-black text-white mb-2">Week Threads</h1>
        <p className="text-blue-100/60 text-sm">
          Week threads are tied to the schedule and the season start date. Set the start date (a Monday) and the current week is derived from it automatically. <strong className="text-blue-200">Make</strong> a week → the bot creates the Discord threads. <strong className="text-blue-200">Delete Week</strong> → the bot deletes the Discord thread(s) and saves each transcript here (exactly like the <code className="text-blue-300">/week-thread delete</code> command). Transcripts are kept on the website forever.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <select value={seasonId || ''} onChange={(e) => { setSeasonId(e.target.value === '' ? null : Number(e.target.value)); setData(null) }}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          <option value="">— Active —</option>
          {seasons.map((s) => <option key={s.id} value={s.id}>S{s.seasonNumber}{s.name ? ` · ${s.name}` : ''}</option>)}
        </select>
        <span className="text-xs text-white/50 ml-auto">{threads.length} thread{threads.length === 1 ? '' : 's'}</span>
      </div>

      {error && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}

      {loading && !data ? (
        <div className="text-blue-200/60">Loading…</div>
      ) : !data?.season ? (
        <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/60">
          No season selected. <a href="/admin/dashboard/seasons" className="text-blue-300 hover:underline">Manage seasons →</a>
        </div>
      ) : (
        <>
          <StartDateBar season={data.season} currentWeek={data.currentWeek} nextMondayIso={data.nextMondayIso} busy={busy} onSave={saveStartDate} onMaterializeCurrent={materializeCurrentWeek} onBackfill={backfillAll} onShowCreate={() => setShowCreate(true)} onShowBulk={() => setShowBulk(true)} />

          {/* Make a SPECIFIC week (any week number) — materializes from the DB schedule, bot creates threads */}
          <div className="mb-4 p-3 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">Make a specific week</span>
            <input type="number" min={1} value={makeWeekNum} onChange={(e) => setMakeWeekNum(e.target.value)} placeholder="week #"
              className="w-24 px-3 py-1.5 bg-black/40 border border-white/10 rounded text-white text-sm" />
            <button onClick={makeSpecificWeek} disabled={busy || !makeWeekNum}
              className="px-3 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded">
              Make Week
            </button>
            <span className="text-[10px] text-white/40">Materializes that week's matchups from the published schedule; the bot opens the Discord thread(s).</span>
          </div>

          <OpenCrossSeasonPanel threads={data.openCrossSeason || []} currentSeasonId={data.season?.id} onViewTranscript={setTranscriptThread} />

          {weekNumbers.length === 0 ? (
            <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">
              No week threads yet. {data.season.startDate ? 'Click "Backfill weeks 1..current" to materialize from the schedule.' : 'Set a season start date first.'}
            </div>
          ) : (
            <div className="space-y-4">
              {weekNumbers.map((week) => (
                <WeekSection key={week} week={week} threads={byWeek[week]} currentWeek={data.currentWeek} onDeleteWeek={() => deleteWeek(week)} onViewTranscript={setTranscriptThread} />
              ))}
            </div>
          )}

          <ArchivedThreadsSection archives={data.archives || []} onViewTranscript={setTranscriptThread} />
        </>
      )}

      {showCreate && (
        <CreateOneModal seasonId={data?.season?.id} defaultWeek={data?.currentWeek || 1} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); reload() }} />
      )}
      {showBulk && (
        <BulkMaterializeModal seasonId={data?.season?.id} currentWeek={data?.currentWeek} onClose={() => setShowBulk(false)} onDone={() => { setShowBulk(false); reload() }} />
      )}
      {transcriptThread && (
        <DiscordTranscriptModal
          title={transcriptThread.label}
          subtitle={`thread ${transcriptThread.threadId}`}
          messagesUrl={`/api/admin/thread-messages/${encodeURIComponent(transcriptThread.threadId)}`}
          onClose={() => setTranscriptThread(null)}
        />
      )}
    </div>
  )
}

function ArchivedThreadsSection({ archives, onViewTranscript }) {
  if (!archives || archives.length === 0) return null
  // Group by week for readability.
  const byWeek = archives.reduce((acc, a) => {
    const k = a.weekNumber ?? '—'
    if (!acc[k]) acc[k] = []
    acc[k].push(a)
    return acc
  }, {})
  const weeks = Object.keys(byWeek).sort((a, b) => Number(b) - Number(a))

  return (
    <div className="mt-6 rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 bg-black/30 flex items-center justify-between">
        <h3 className="text-sm font-black text-white">Closed / Archived Threads</h3>
        <span className="text-[10px] text-white/40">{archives.length} saved transcript{archives.length === 1 ? '' : 's'}</span>
      </div>
      <div className="p-3 space-y-3">
        {weeks.map((w) => (
          <div key={w}>
            <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-1.5">Week {w}</div>
            <ul className="space-y-1">
              {byWeek[w].map((a) => (
                <li key={a.threadId} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs bg-white/[0.02] border border-white/5">
                  <span className="text-blue-200/80 w-14 text-[10px] uppercase font-bold">{a.division}</span>
                  <span className="text-white truncate flex-1">{a.team1} <span className="text-white/40 mx-1">vs</span> {a.team2}</span>
                  <span className="text-white/40 text-[10px]">{a.messageCount ?? 0} msg{a.messageCount === 1 ? '' : 's'}</span>
                  {a.closedAt && <span className="text-white/30 text-[10px]">{new Date(a.closedAt).toLocaleDateString()}</span>}
                  <button onClick={() => onViewTranscript({ threadId: a.threadId, label: `${a.team1} vs ${a.team2} (W${a.weekNumber})` })}
                    className="px-2 py-0.5 text-[9px] uppercase font-bold rounded bg-blue-500/15 text-blue-200 border border-blue-400/30">
                    Transcript
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function OpenCrossSeasonPanel({ threads, currentSeasonId, onViewTranscript }) {
  if (!threads || threads.length === 0) return null
  return (
    <div className="mb-4 p-4 rounded-2xl bg-green-500/[0.05] border border-green-400/30">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider font-bold text-green-300">
          🟢 All Open Threads — Cross-Season ({threads.length})
        </div>
        <span className="text-[10px] text-white/40">always visible · delete a whole week below</span>
      </div>
      <ul className="space-y-1 max-h-72 overflow-y-auto">
        {threads.map((t) => (
          <li key={t.id} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs bg-white/[0.02] border border-white/5 ${
            t.seasonId === currentSeasonId ? '' : 'border-l-2 border-l-yellow-400/50'
          }`}>
            <span className="text-blue-300/70 font-bold w-12 text-[10px]">S{t.seasonNumber || '?'}</span>
            <span className="text-white/60 w-12 text-[10px]">W{t.weekNumber}</span>
            <span className="text-blue-200/80 w-14 text-[10px] uppercase font-bold">{t.division}</span>
            <span className="text-white truncate flex-1">{t.team1} <span className="text-white/40 mx-1">vs</span> {t.team2}</span>
            {t.threadId && <span className="text-[9px] font-mono text-blue-300/70 truncate max-w-[80px]">{t.threadId.slice(-8)}</span>}
            {t.threadId && <button onClick={() => onViewTranscript({ threadId: t.threadId, label: `${t.team1} vs ${t.team2}` })} className="px-2 py-0.5 text-[9px] uppercase font-bold rounded bg-blue-500/15 text-blue-200 border border-blue-400/30">Transcript</button>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function StartDateBar({ season, currentWeek, nextMondayIso, busy, onSave, onMaterializeCurrent, onBackfill, onShowCreate, onShowBulk }) {
  const [date, setDate] = useState(season.startDate || '')
  const dayName = season.startDate ? new Date(season.startDate + 'T00:00:00Z').toUTCString().split(' ')[0] : null
  const isMonday = dayName === 'Mon,'

  return (
    <div className="mb-4 p-4 rounded-2xl bg-blue-500/5 border border-blue-400/30">
      <div className="flex items-end flex-wrap gap-3 mb-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Season Start Date (Monday of Week 1)</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white" />
        </div>
        <button onClick={() => onSave(date)} disabled={busy || date === (season.startDate || '')}
          className="px-3 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded-lg">
          {busy ? 'Saving…' : 'Save start date'}
        </button>
        {season.startDate && (
          <button onClick={() => { setDate(''); onSave('') }} disabled={busy}
            className="px-3 py-2 text-xs font-semibold text-yellow-200 hover:text-white bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-400/30 rounded-lg">
            Clear
          </button>
        )}
      </div>

      {!season.startDate ? (
        <div className="text-xs text-yellow-300">
          ⚠ No start date set — week numbers can't be auto-computed. Set a Monday above to enable.
        </div>
      ) : (
        <div className="text-xs text-blue-100/80 leading-relaxed">
          Start date: <strong className="text-white">{season.startDate}</strong> ({dayName} {!isMonday && <span className="text-yellow-300">— not a Monday! Week math will still work but is off by N days.</span>})
          <br />
          Current week: <strong className="text-white">Week {currentWeek ?? '—'}</strong>
          {nextMondayIso && <span> · Next Monday: {nextMondayIso}</span>}
        </div>
      )}

      {season.startDate && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={onMaterializeCurrent} disabled={busy || !currentWeek}
            className="px-3 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded">
            Materialize Week {currentWeek}
          </button>
          <button onClick={onBackfill} disabled={busy || !currentWeek}
            className="px-3 py-1.5 text-xs font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded">
            Backfill weeks 1..{currentWeek}
          </button>
          <button onClick={onShowBulk} disabled={busy}
            className="px-3 py-1.5 text-xs font-bold text-blue-200 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 rounded">
            Bulk range…
          </button>
          <button onClick={onShowCreate} disabled={busy}
            className="px-3 py-1.5 text-xs font-bold text-blue-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded ml-auto">
            + Add one manually
          </button>
        </div>
      )}
    </div>
  )
}

function WeekSection({ week, threads, currentWeek, onDeleteWeek, onViewTranscript }) {
  const isCurrent = week === currentWeek
  const byDivision = threads.reduce((acc, t) => {
    if (!acc[t.division]) acc[t.division] = []
    acc[t.division].push(t)
    return acc
  }, {})

  return (
    <div className={`rounded-2xl border overflow-hidden ${isCurrent ? 'bg-blue-500/[0.05] border-blue-400/30' : 'bg-white/[0.02] border-white/10'}`}>
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <h3 className="text-sm font-black text-white">
          Week {week}
          {isCurrent && <span className="ml-2 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-400/30">Current</span>}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/40">{threads.length} thread{threads.length === 1 ? '' : 's'}</span>
          <button onClick={onDeleteWeek} title="Bot deletes the Discord thread(s) and saves each transcript on the website"
            className="px-2 py-1 text-[10px] uppercase font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded">
            Delete Week
          </button>
        </div>
      </div>
      <div className="p-3 space-y-3">
        {DIVISIONS.filter((d) => byDivision[d]).map((d) => (
          <div key={d}>
            <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-1.5">{d}</div>
            <ul className="space-y-1">
              {(byDivision[d] || []).map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs bg-white/[0.02] border border-white/5">
                  <span className="text-white/50 w-6 text-center">{t.matchNumber || '—'}</span>
                  <span className="text-white truncate flex-1">{t.team1} <span className="text-white/40 mx-1">vs</span> {t.team2}</span>
                  {t.threadId
                    ? <span className="text-[9px] uppercase font-bold text-green-300/80">live</span>
                    : <span className="text-[9px] uppercase text-white/30">pending bot</span>}
                  {t.threadId && <button onClick={() => onViewTranscript({ threadId: t.threadId, label: `${t.team1} vs ${t.team2}` })} className="px-2 py-0.5 text-[9px] uppercase font-bold rounded bg-blue-500/15 text-blue-200 border border-blue-400/30">Transcript</button>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function CreateOneModal({ seasonId, defaultWeek, onClose, onCreated }) {
  const [form, setForm] = useState({ weekNumber: defaultWeek, division: 'Majors', team1: '', team2: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit() {
    setBusy(true); setErr(null)
    const r = await fetch('/api/admin/week-threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ action: 'create_one', seasonId, ...form, weekNumber: Number(form.weekNumber) }),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setErr(d.error || 'Failed'); setBusy(false); return
    }
    onCreated()
  }

  return (
    <Modal onClose={onClose} title="Add week thread (manual)">
      {err && <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm mb-2">{err}</div>}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Week"><input type="number" min={1} value={form.weekNumber} onChange={(e) => setForm({ ...form, weekNumber: e.target.value })} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white" /></Field>
          <Field label="Division">
            <select value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white">
              {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Team 1"><input type="text" value={form.team1} onChange={(e) => setForm({ ...form, team1: e.target.value })} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white" /></Field>
        <Field label="Team 2"><input type="text" value={form.team2} onChange={(e) => setForm({ ...form, team2: e.target.value })} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white" /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded">Cancel</button>
          <button onClick={submit} disabled={busy} className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded">{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </div>
    </Modal>
  )
}

function BulkMaterializeModal({ seasonId, currentWeek, onClose, onDone }) {
  const [fromWeek, setFromWeek] = useState(1)
  const [toWeek, setToWeek] = useState(currentWeek || 1)
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function submit() {
    setBusy(true)
    const r = await fetch('/api/admin/week-threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ action: 'materialize_range', seasonId, fromWeek: Number(fromWeek), toWeek: Number(toWeek), replace }),
    })
    const d = await r.json()
    setResult(d)
    setBusy(false)
    if (r.ok) setTimeout(onDone, 1200)
  }

  return (
    <Modal onClose={onClose} title="Bulk materialize range">
      <div className="space-y-3">
        <div className="text-xs text-blue-100/60">Materialize threads from the schedule for every week in this range. Skips existing rows by default (toggle Replace to wipe and re-create).</div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From week"><input type="number" min={1} value={fromWeek} onChange={(e) => setFromWeek(e.target.value)} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white" /></Field>
          <Field label="To week"><input type="number" min={1} value={toWeek} onChange={(e) => setToWeek(e.target.value)} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white" /></Field>
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /><span className="text-white/80">Replace existing (deletes rows for each week first)</span></label>
        {result && (
          <div className="p-3 rounded bg-white/5 border border-white/10 text-xs text-white/80">
            <div>Inserted total: <strong className="text-white">{result.total ?? '?'}</strong></div>
            {result.perWeek && (
              <div className="mt-1 font-mono">{Object.entries(result.perWeek).map(([w, n]) => `W${w}: ${n}`).join(' · ')}</div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded">Cancel</button>
          <button onClick={submit} disabled={busy} className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded">{busy ? 'Materializing…' : 'Run'}</button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold tracking-wider uppercase text-blue-300/70 mb-1">{label}</label>
      {children}
    </div>
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
