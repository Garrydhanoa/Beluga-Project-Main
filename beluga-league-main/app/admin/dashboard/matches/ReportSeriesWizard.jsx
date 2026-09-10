'use client'

// Admin — "Report a series" by hand.
//
// The bot's captain flow demands a complete, parseable Ballchasing group. This is
// the escape hatch for everything else: a series that was played and scored but
// whose replay group was never made, a forfeit, a double forfeit, or a series where
// staff have the individual replay links but no group.
//
// Stats are still REAL wherever links exist — attach a group link for the whole
// series, or a replay link per game, and the bot pulls the player lines in exactly
// as it would for a normal report. With no links at all, the typed scores stand and
// player stats can be filled in afterwards from the series modal.

import { useEffect, useState } from 'react'

const DIVISIONS = ['Majors', 'AAA', 'AA']

const RESULT_TYPES = [
  { value: 'normal', label: 'Normal series', hint: 'Games were played — enter scores and/or replay links.' },
  { value: 'full', label: 'Full forfeit', hint: 'One team forfeited: a 1–0 series win, no player stats.' },
  { value: 'double', label: 'Double forfeit', hint: 'Both teams forfeited: each is charged a 0–1 loss, no winner.' },
]

const blankGame = (n) => ({ key: `g${n}${Math.random().toString(36).slice(2, 7)}`, homeGoals: '', awayGoals: '', replayUrl: '', overtime: false })

export default function ReportSeriesWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(1)
  const [teams, setTeams] = useState([])
  const [seasonId, setSeasonId] = useState(null)
  const [currentWeek, setCurrentWeek] = useState('')
  const [schedule, setSchedule] = useState([])

  const [form, setForm] = useState({
    division: 'Majors', week: '', isPlayoff: false,
    homeTeamId: '', awayTeamId: '', format: 'bo5',
    resultType: 'normal', groupUrl: '', scheduleMatchId: '',
  })
  const [games, setGames] = useState([blankGame(1), blankGame(2), blankGame(3)])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [dupe, setDupe] = useState(null)
  const [progress, setProgress] = useState(null)

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const isFF = form.resultType !== 'normal'

  // Prefill: teams for the active season + the current league week.
  useEffect(() => {
    fetch('/api/admin/teams', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { setTeams(Array.isArray(d.teams) ? d.teams : []); setSeasonId(d.seasonId || null) })
      .catch(() => {})
    fetch('/api/admin/week-threads', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.currentWeek) { setCurrentWeek(String(d.currentWeek)); setForm((f) => (f.week ? f : { ...f, week: String(d.currentWeek) })) } })
      .catch(() => {})
  }, [])

  // Scheduled matches for this division + week, so staff can pick the fixture
  // instead of re-selecting both teams (and so the series links back to it).
  useEffect(() => {
    if (!seasonId || !form.week) { setSchedule([]); return }
    fetch(`/api/admin/seasons/${seasonId}/schedule`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const all = Array.isArray(d.matches) ? d.matches : []
        setSchedule(all.filter((m) => m.division === form.division && String(m.week) === String(form.week)))
      })
      .catch(() => setSchedule([]))
  }, [seasonId, form.division, form.week])

  const divisionTeams = teams.filter((t) => t.division === form.division && t.isActive)
  const teamName = (id) => teams.find((t) => String(t.id) === String(id))?.name || ''

  // Games with something in them. A game needs a score OR a replay link to count.
  const usableGames = games.filter((g) => g.replayUrl.trim() || g.homeGoals !== '' || g.awayGoals !== '')
  const linkCount = usableGames.filter((g) => g.replayUrl.trim()).length
  const willImport = !isFF && (Boolean(form.groupUrl.trim()) || linkCount > 0)

  const step1Ready = form.division && form.week !== '' && form.homeTeamId && form.awayTeamId
    && String(form.homeTeamId) !== String(form.awayTeamId)

  function applyFixture(matchId) {
    const m = schedule.find((x) => String(x.id) === String(matchId))
    set({
      scheduleMatchId: matchId,
      ...(m ? { homeTeamId: String(m.homeTeamId || ''), awayTeamId: String(m.awayTeamId || '') } : {}),
    })
  }

  async function submit(allowDuplicate = false) {
    setBusy(true); setErr(null); setDupe(null)
    try {
      const payload = {
        seasonId,
        division: form.division,
        week: Number(form.week),
        isPlayoff: form.isPlayoff,
        format: form.isPlayoff ? 'bo7' : form.format,
        homeTeamId: Number(form.homeTeamId),
        awayTeamId: Number(form.awayTeamId),
        isForfeit: isFF,
        forfeitKind: form.resultType === 'double' ? 'double' : form.resultType === 'full' ? 'full' : null,
        groupUrl: form.groupUrl.trim() || null,
        scheduleMatchId: form.scheduleMatchId || null,
        allowDuplicate,
        games: isFF ? [] : usableGames.map((g, i) => ({
          gameNumber: i + 1,
          homeGoals: Number(g.homeGoals) || 0,
          awayGoals: Number(g.awayGoals) || 0,
          replayUrl: g.replayUrl.trim() || null,
          overtime: g.overtime,
        })),
      }
      const r = await fetch('/api/admin/stats-series', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!r.ok) {
        if (d.code === 'DUPLICATE') { setDupe(d); return }
        throw new Error(d.error || `HTTP ${r.status}`)
      }

      if (d.importJobId) {
        setProgress({ state: 'running', text: 'Reading Ballchasing…' })
        const outcome = await pollImport(d.seriesId)
        setProgress(outcome)
        // Leave the result on screen so warnings actually get read.
        onCreated?.(d.seriesId)
        return
      }
      onCreated?.(d.seriesId)
      onClose()
    } catch (e) {
      setErr(e.message || 'Could not report the series')
    } finally {
      setBusy(false)
    }
  }

  async function pollImport(seriesId) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((res) => setTimeout(res, 2000))
      try {
        const r = await fetch(`/api/admin/stats-series/${seriesId}/import`, { cache: 'no-store' })
        const d = await r.json()
        const job = d.job
        if (!job) continue
        if (job.status === 'done') {
          const res = job.result || {}
          return {
            state: 'done',
            text: `Imported ${res.gamesWritten || 0} game(s) and ${res.playerRows || 0} player stat line(s) from the ${res.source === 'group' ? 'replay group' : 'replay links'}. Series score ${res.homeScore}–${res.awayScore}.`,
            warnings: res.warnings || [],
          }
        }
        if (job.status === 'failed') return { state: 'failed', text: job.error || 'The import failed.' }
      } catch { /* keep polling */ }
    }
    return { state: 'failed', text: 'The import is taking longer than expected. Check the series in a minute — the bot may still be working, or it may be offline.' }
  }

  return (
    <Shell title={`Report a series — step ${step} of 3`} onClose={onClose}>
      {err && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm whitespace-pre-line">{err}</div>}

      {dupe && (
        <div className="mb-4 p-3 rounded bg-yellow-500/10 border border-yellow-400/30 text-yellow-100 text-sm">
          <div className="font-bold mb-1">Already reported</div>
          <div className="mb-3">{dupe.error}</div>
          <div className="flex gap-2">
            <button onClick={() => setDupe(null)} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded" aria-label="Cancel duplicate series report">Cancel</button>
            <button onClick={() => submit(true)} disabled={busy}
              className="px-3 py-1.5 text-xs font-bold text-yellow-100 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-400/40 rounded disabled:opacity-50"
              aria-label="Report this series anyway despite the duplicate">
              Report it anyway
            </button>
          </div>
        </div>
      )}

      {progress && (
        <div className={`mb-4 p-3 rounded text-sm border ${
          progress.state === 'failed' ? 'bg-red-500/10 border-red-500/30 text-red-200'
            : progress.state === 'done' ? 'bg-green-500/10 border-green-400/30 text-green-100'
            : 'bg-blue-500/10 border-blue-400/30 text-blue-100'}`}>
          <div className="font-bold mb-1">
            {progress.state === 'running' ? 'Importing…' : progress.state === 'done' ? 'Series reported' : 'Import failed'}
          </div>
          <div>{progress.text}</div>
          {progress.warnings?.length > 0 && (
            <ul className="mt-2 space-y-1 list-disc list-inside text-yellow-200/90 text-xs">
              {progress.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {progress.state !== 'running' && (
            <button onClick={onClose} className="mt-3 px-3 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 rounded" aria-label="Close the report series wizard">Done</button>
          )}
        </div>
      )}

      {!progress && step === 1 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Division">
              <select value={form.division} onChange={(e) => set({ division: e.target.value, homeTeamId: '', awayTeamId: '', scheduleMatchId: '' })}
                className={INPUT} aria-label="Division">
                {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Week">
              <input type="number" min={1} value={form.week} onChange={(e) => set({ week: e.target.value, scheduleMatchId: '' })}
                className={INPUT} aria-label="Week number" placeholder={currentWeek || '1'} />
            </Field>
            <Field label="Format">
              <select value={form.isPlayoff ? 'bo7' : form.format} disabled={form.isPlayoff}
                onChange={(e) => set({ format: e.target.value })} className={INPUT} aria-label="Series format">
                <option value="bo5">Best of 5</option>
                <option value="bo7">Best of 7</option>
              </select>
            </Field>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.isPlayoff} onChange={(e) => set({ isPlayoff: e.target.checked })} aria-label="Playoff series" />
                <span className="text-white/80">Playoff</span>
              </label>
            </div>
          </div>

          <p className="text-[11px] text-blue-200/60 -mt-1">
            The week is required — without it this series can never be matched to its week thread, and that week could never be closed.
          </p>

          {schedule.length > 0 && (
            <Field label={`Scheduled matches in ${form.division} week ${form.week}`}>
              <select value={form.scheduleMatchId} onChange={(e) => applyFixture(e.target.value)} className={INPUT} aria-label="Pick a scheduled match">
                <option value="">— pick teams manually —</option>
                {schedule.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.homeTeam || teamName(m.homeTeamId)} vs {m.awayTeam || teamName(m.awayTeamId)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Home team">
              <select value={form.homeTeamId} onChange={(e) => set({ homeTeamId: e.target.value })} className={INPUT} aria-label="Home team">
                <option value="">— select —</option>
                {divisionTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Away team">
              <select value={form.awayTeamId} onChange={(e) => set({ awayTeamId: e.target.value })} className={INPUT} aria-label="Away team">
                <option value="">— select —</option>
                {divisionTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Result type">
            <div className="space-y-2">
              {RESULT_TYPES.map((rt) => (
                <label key={rt.value} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${
                  form.resultType === rt.value ? 'bg-blue-500/10 border-blue-400/40' : 'bg-black/20 border-white/10'}`}>
                  <input type="radio" name="resultType" className="mt-1" checked={form.resultType === rt.value}
                    onChange={() => set({ resultType: rt.value })} aria-label={rt.label} />
                  <span>
                    <span className="block text-sm font-bold text-white">{rt.label}</span>
                    <span className="block text-[11px] text-blue-200/60">{rt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>

          {form.resultType === 'full' && (
            <div className="p-2 rounded bg-orange-500/10 border border-orange-400/30 text-orange-100 text-xs">
              The <strong>home team</strong> takes the 1–0 win. Put the forfeiting team in the away slot.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded" aria-label="Cancel">Cancel</button>
            <button onClick={() => setStep(isFF ? 3 : 2)} disabled={!step1Ready}
              className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 rounded disabled:opacity-50" aria-label="Continue to next step">
              Next →
            </button>
          </div>
        </div>
      )}

      {!progress && step === 2 && (
        <div className="space-y-4">
          <Field label="Ballchasing replay group (optional — covers the whole series)">
            <input value={form.groupUrl} onChange={(e) => set({ groupUrl: e.target.value })}
              placeholder="https://ballchasing.com/group/…" className={INPUT} aria-label="Ballchasing group link" />
          </Field>
          <p className="text-[11px] text-blue-200/60 -mt-2">
            Give a group link, or a replay link per game below, and the bot pulls the real player stats in. With neither, the scores you type stand on their own and stats can be added later.
          </p>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-blue-300/70 mb-2 font-bold">Games</div>
            <div className="space-y-2">
              {games.map((g, idx) => (
                <div key={g.key} className="p-2 rounded-lg bg-white/[0.03] border border-white/10">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-white/60 w-14 shrink-0">Game {idx + 1}</span>
                    <input type="number" min={0} value={g.homeGoals} placeholder="0" aria-label={`Game ${idx + 1} home goals`}
                      onChange={(e) => setGames((gs) => gs.map((x, i) => (i === idx ? { ...x, homeGoals: e.target.value } : x)))}
                      className="w-14 px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-center font-mono text-sm" />
                    <span className="text-white/40 font-mono">-</span>
                    <input type="number" min={0} value={g.awayGoals} placeholder="0" aria-label={`Game ${idx + 1} away goals`}
                      onChange={(e) => setGames((gs) => gs.map((x, i) => (i === idx ? { ...x, awayGoals: e.target.value } : x)))}
                      className="w-14 px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-center font-mono text-sm" />
                    <label className="flex items-center gap-1 text-[11px] text-white/70 cursor-pointer">
                      <input type="checkbox" checked={g.overtime} aria-label={`Game ${idx + 1} went to overtime`}
                        onChange={(e) => setGames((gs) => gs.map((x, i) => (i === idx ? { ...x, overtime: e.target.checked } : x)))} />
                      OT
                    </label>
                    {games.length > 1 && (
                      <button onClick={() => setGames((gs) => gs.filter((_, i) => i !== idx))}
                        className="ml-auto text-red-300/70 hover:text-red-200 text-xs px-2" aria-label={`Remove game ${idx + 1}`}>Remove</button>
                    )}
                  </div>
                  <input value={g.replayUrl} placeholder="Replay link for this game (optional)" aria-label={`Game ${idx + 1} replay link`}
                    onChange={(e) => setGames((gs) => gs.map((x, i) => (i === idx ? { ...x, replayUrl: e.target.value } : x)))}
                    className="mt-2 w-full px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-xs" />
                </div>
              ))}
            </div>
            <button onClick={() => setGames((gs) => [...gs, blankGame(gs.length + 1)])}
              className="mt-2 px-3 py-1.5 text-xs font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded"
              aria-label="Add another game">+ Add game</button>
          </div>

          <div className="flex justify-between gap-2 pt-2">
            <button onClick={() => setStep(1)} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded" aria-label="Back to matchup step">← Back</button>
            {/* A group link alone is enough — the import fills in every game, so
                don't force staff to type scores they're about to have replaced. */}
            <button onClick={() => setStep(3)} disabled={!usableGames.length && !form.groupUrl.trim()}
              className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 rounded disabled:opacity-50" aria-label="Continue to review step">
              Next →
            </button>
          </div>
        </div>
      )}

      {!progress && step === 3 && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-2 text-sm">
            <Row k="Matchup" v={`${teamName(form.homeTeamId)} vs ${teamName(form.awayTeamId)}`} />
            <Row k="Where" v={`${form.division} · Week ${form.week}${form.isPlayoff ? ' · Playoff' : ''} · ${form.isPlayoff ? 'BO7' : form.format.toUpperCase()}`} />
            <Row k="Result" v={
              form.resultType === 'double' ? 'Double forfeit — both teams charged a 0–1 loss, no winner'
                : form.resultType === 'full' ? `Full forfeit — ${teamName(form.homeTeamId)} wins 1–0`
                : usableGames.length
                  ? `${usableGames.length} game(s): ${usableGames.map((g) => `${g.homeGoals || 0}-${g.awayGoals || 0}`).join(', ')}`
                  : 'Taken entirely from the replay group — games and the series score come from Ballchasing'
            } />
            {!isFF && <Row k="Ballchasing" v={
              form.groupUrl.trim() ? 'Group link — the bot will import the whole series'
                : linkCount ? `${linkCount} replay link(s) — the bot will import those games`
                : 'No links — scores only, stats can be added later'
            } />}
          </div>

          {willImport && (
            <div className="p-3 rounded bg-blue-500/10 border border-blue-400/30 text-blue-100 text-xs">
              After the series is created the bot reads Ballchasing and fills in the real player stats. That usually takes a few seconds — this window will tell you how it went.
            </div>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <button onClick={() => setStep(isFF ? 1 : 2)} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded" aria-label="Back a step">← Back</button>
            <button onClick={() => submit(false)} disabled={busy}
              className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 rounded disabled:opacity-50" aria-label="Report the series">
              {busy ? 'Reporting…' : 'Report series'}
            </button>
          </div>
        </div>
      )}
    </Shell>
  )
}

const INPUT = 'w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm'

function Row({ k, v }) {
  return (
    <div className="flex gap-3">
      <span className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold w-24 shrink-0 pt-0.5">{k}</span>
      <span className="text-white/90">{v}</span>
    </div>
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

function Shell({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-[#0b1220] border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()} data-log-section="report-series">
        <div className="p-5 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#0b1220] z-10">
          <h2 className="text-lg font-black text-white">{title}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none" aria-label="Close">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
