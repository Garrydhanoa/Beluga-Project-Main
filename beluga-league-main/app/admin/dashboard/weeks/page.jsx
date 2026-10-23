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
  // Set when a delete is refused because the week still has unreported series.
  const [unreportedBlock, setUnreportedBlock] = useState(null)

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

  async function deleteWeek(week, force = false) {
    if (!data?.season?.id) return
    if (!force && !confirm(
      `Delete Week ${week}?\n\nThe bot will delete the Discord thread(s) for this week AND save each transcript on the website — exactly like the /week-thread delete command. This runs within ~1 minute.`
    )) return
    setBusy(true)
    const res = await fetch('/api/admin/week-threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ action: 'delete_week', seasonId: data.season.id, weekNumber: week, force }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)

    // Blocked: some series in this week were never reported. Show exactly which,
    // and require a second, explicit confirmation to delete anyway.
    if (res.status === 409 && body.blocked) {
      setUnreportedBlock(body)
      await reload()
      return
    }

    setUnreportedBlock(null)
    alert(force
      ? `Week ${week} FORCE delete queued despite unreported series. The bot will remove the thread(s) and save the transcripts shortly.`
      : `Week ${week} delete queued. The bot will remove the Discord thread(s) and save the transcripts shortly.`)
    await reload()
  }

  async function deleteTranscripts(week) {
    if (!data?.season?.id) return
    if (!confirm(`Delete ALL saved transcripts for Week ${week}? The Discord threads are untouched - this only clears the website's stored messages/archives. Cannot be undone.`)) return
    setBusy(true)
    const r = await fetch(`/api/admin/transcripts?weekThreads=${week}&seasonId=${data.season.id}`, { method: 'DELETE' })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    alert(r.ok
      ? `Deleted ${d.deletedMessages || 0} messages + ${d.deletedArchives || 0} archives across ${d.threads || 0} thread(s).${d.note ? `\n${d.note}` : ''}`
      : (d.error || 'Failed to delete transcripts.'))
    await reload()
  }

  // Delete ONE closed/archived thread's saved transcript (the Discord thread is
  // already gone). Uses the per-ticket transcript delete (thread_messages + thread_archives).
  async function deleteOneArchive(threadId, label) {
    if (!threadId) return
    if (!confirm(`Delete the saved transcript for "${label}"? This clears its stored messages + archive snapshot from the website. Cannot be undone.`)) return
    setBusy(true)
    const r = await fetch(`/api/admin/transcripts?ticket=${encodeURIComponent(threadId)}`, { method: 'DELETE' })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    alert(r.ok ? `Deleted ${d.deletedMessages || 0} message(s) + ${d.deletedArchives || 0} archive(s).` : (d.error || 'Failed to delete transcript.'))
    await reload()
  }

  // Bulk-delete every archived transcript in one week (loops per-thread so it works
  // even when the week_threads rows are already gone).
  async function deleteArchiveWeek(week, threadIds) {
    if (!threadIds?.length) return
    if (!confirm(`Delete ALL ${threadIds.length} saved transcript(s) for Week ${week}? Cannot be undone.`)) return
    setBusy(true)
    let msgs = 0, arch = 0, lockedCount = 0
    for (const tid of threadIds) {
      const r = await fetch(`/api/admin/transcripts?ticket=${encodeURIComponent(tid)}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (r.ok) { msgs += d.deletedMessages || 0; arch += d.deletedArchives || 0 }
      else if (r.status === 423) lockedCount++
    }
    setBusy(false)
    alert(`Deleted ${msgs} message(s) + ${arch} archive(s) across ${threadIds.length - lockedCount} thread(s).`
      + (lockedCount ? `\n${lockedCount} transcript(s) are locked — transcripts can only be deleted 30 days after they close.` : ''))
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
                <WeekSection key={week} week={week} threads={byWeek[week]} currentWeek={data.currentWeek} onDeleteWeek={() => deleteWeek(week)} onDeleteTranscripts={() => deleteTranscripts(week)} onViewTranscript={setTranscriptThread} />
              ))}
            </div>
          )}

          <ArchivedThreadsSection archives={data.archives || []} onViewTranscript={setTranscriptThread} onDeleteOne={deleteOneArchive} onDeleteWeek={deleteArchiveWeek} busy={busy} />
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
          downloadUrl={`/api/admin/transcripts/export?type=thread&id=${encodeURIComponent(transcriptThread.threadId)}`}
        />
      )}
      {unreportedBlock && (
        <UnreportedWeekModal
          info={unreportedBlock}
          busy={busy}
          onCancel={() => setUnreportedBlock(null)}
          onForce={() => { const w = unreportedBlock.weekNumber; setUnreportedBlock(null); deleteWeek(w, true) }}
        />
      )}
    </div>
  )
}

function ArchivedThreadsSection({ archives, onViewTranscript, onDeleteOne, onDeleteWeek, busy }) {
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
        {weeks.map((w) => {
          const threadIds = byWeek[w].map((a) => a.threadId).filter(Boolean)
          return (
            <div key={w}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">Week {w}</div>
                {threadIds.length > 0 && (
                  <button onClick={() => onDeleteWeek?.(w, threadIds)} disabled={busy}
                    title="Delete every saved transcript in this week (threads already closed)"
                    className="px-2 py-0.5 text-[9px] uppercase font-bold rounded text-red-300/90 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 disabled:opacity-50">
                    Delete all ({threadIds.length})
                  </button>
                )}
              </div>
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
                    {a.threadId && (
                      <button onClick={() => onDeleteOne?.(a.threadId, `${a.team1} vs ${a.team2} (W${a.weekNumber})`)} disabled={busy}
                        title="Delete this saved transcript"
                        className="px-2 py-0.5 text-[9px] uppercase font-bold rounded text-red-300/80 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 disabled:opacity-50">
                        Delete
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
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

function WeekSection({ week, threads, currentWeek, onDeleteWeek, onDeleteTranscripts, onViewTranscript }) {
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
          <button onClick={onDeleteTranscripts} title="Delete this week's saved transcripts from the website (threads untouched)"
            className="px-2 py-1 text-[10px] uppercase font-bold text-white/50 hover:text-red-300 bg-white/5 border border-white/10 rounded">
            Delete Transcripts
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

/**
 * Step 2 of the guarded week delete. The API refuses while any series in the
 * week is unreported; this lists exactly which, and only unlocks the red delete
 * once the week number is typed back — deleting the threads destroys the only
 * place those series can still be reported.
 */
function UnreportedWeekModal({ info, busy, onCancel, onForce }) {
  const [typed, setTyped] = useState('')
  const week = info.weekNumber
  const armed = typed.trim() === String(week)

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6" onClick={onCancel}>
      <div
        className="bg-[#160b0b] border-2 border-red-500/60 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-red-500/30 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black tracking-[0.2em] uppercase text-red-300 mb-1">Delete blocked</div>
            <h2 className="text-lg font-black text-white">Week {week} has unreported series</h2>
          </div>
          <button onClick={onCancel} className="text-white/50 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-sm text-red-100/90">
            <b>{info.reported}</b> of <b>{info.total}</b> series are reported.{' '}
            <b className="text-red-300">{info.unreported.length}</b> {info.unreported.length === 1 ? 'is' : 'are'} still missing.
          </div>

          <div className="rounded-lg border border-red-500/30 bg-black/40 max-h-56 overflow-y-auto">
            {info.unreported.map((u) => (
              <div key={u.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 last:border-0">
                <span className="text-[10px] font-black uppercase text-red-300/80 w-14 shrink-0">{u.division}</span>
                <span className="text-xs text-white/85 truncate">{u.team1} vs {u.team2}</span>
                {!u.hasThread && <span className="text-[10px] text-white/35 ml-auto shrink-0">no thread</span>}
              </div>
            ))}
          </div>

          <div className="text-xs text-amber-200/80 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
            Salary crew have been pinged in each unreported thread. Deleting now removes the only
            place these series can still be reported — transcripts are saved, but the threads are gone.
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-red-200/70 mb-1.5">
              Type <span className="font-mono text-red-300">{week}</span> to delete anyway
            </label>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={String(week)}
              className="w-full px-3 py-2 bg-black/50 border border-red-500/40 focus:border-red-400 rounded-lg text-white text-sm font-mono focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onCancel} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-xs font-bold">
              Cancel
            </button>
            <button
              onClick={onForce}
              disabled={!armed || busy}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-red-900/40 disabled:text-white/30 text-white text-xs font-black transition"
            >
              Delete Week {week} anyway
            </button>
          </div>
        </div>
      </div>
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
