'use client'

/**
 * higgenlogs → Tests (super admins only). The GM / AGM rulebook certification:
 *   - Requests: everyone who passed, the Salary Crew ✅/❌ tally from the Discord
 *     notice (advisory), who currently holds that franchise's role, and the final
 *     Approve / Deny (the bot then grants roles + DMs the applicant).
 *   - Attempts: every attempt, who is mid-test, how often they left, and a
 *     per-question breakdown + timeline.
 *   - Retakes: requests for another attempt; grant +N or dismiss.
 *   - Questions: the bank — edit, enable/disable, GM / AGM tags, order.
 *   - Activity: the live timeline. Settings: pass mark, channel, roles, open/closed.
 * Lives here (not a normal admin tab) because many directors are GMs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

const card = 'rounded-xl bg-white/[0.03] border border-white/10'
const input = 'px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs'

function when(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return String(value) }
}

function Pill({ tone = 'slate', children }) {
  const tones = {
    green: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30',
    red: 'bg-red-500/15 text-red-200 border-red-400/30',
    amber: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
    blue: 'bg-blue-500/15 text-blue-200 border-blue-400/30',
    violet: 'bg-violet-500/15 text-violet-200 border-violet-400/30',
    slate: 'bg-white/5 text-white/60 border-white/15',
  }
  return <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide ${tones[tone]}`}>{children}</span>
}

const TestPill = ({ test }) => <Pill tone={test === 'agm' ? 'violet' : 'blue'}>{test === 'agm' ? 'AGM' : 'GM'}</Pill>

const REQUEST_STATUS = {
  pending: ['amber', 'Waiting for you'],
  approving: ['blue', 'Approving…'],
  approve_running: ['blue', 'Approving…'],
  approved: ['green', 'Approved'],
  denying: ['blue', 'Denying…'],
  deny_running: ['blue', 'Denying…'],
  denied: ['red', 'Denied'],
  approve_failed: ['red', 'Approve FAILED'],
  deny_failed: ['red', 'Deny FAILED'],
}

const TABS = [
  { value: 'requests', label: 'Requests' },
  { value: 'attempts', label: 'Attempts' },
  { value: 'retakes', label: 'Retakes' },
  { value: 'questions', label: 'Questions' },
  { value: 'activity', label: 'Activity' },
  { value: 'settings', label: 'Settings' },
]
const LIVE_TABS = new Set(['requests', 'attempts', 'retakes', 'activity'])

export default function TestsPanel() {
  const [tab, setTab] = useState('requests')
  const [seasonId, setSeasonId] = useState('')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/higgenlogs/tests${seasonId ? `?seasonId=${seasonId}` : ''}`, { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setData({
        ...d,
        requests: Array.isArray(d.requests) ? d.requests : [],
        attempts: Array.isArray(d.attempts) ? d.attempts : [],
        retakes: Array.isArray(d.retakes) ? d.retakes : [],
        grants: Array.isArray(d.grants) ? d.grants : [],
        events: Array.isArray(d.events) ? d.events : [],
        questions: Array.isArray(d.questions) ? d.questions : [],
        seasons: Array.isArray(d.seasons) ? d.seasons : [],
      })
      setErr(null)
    } catch (e) {
      setErr(e.message)
    }
  }, [seasonId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!LIVE_TABS.has(tab)) return undefined
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [tab, load])

  const post = useCallback(async (body, okText) => {
    setNotice(null)
    const r = await fetch('/api/admin/higgenlogs/tests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setNotice({ tone: 'red', text: d.error || `Failed (HTTP ${r.status})` }); return null }
    if (okText) setNotice({ tone: 'green', text: okText })
    await load()
    return d
  }, [load])

  const counts = useMemo(() => {
    if (!data) return {}
    return {
      requests: data.requests.filter((r) => ['pending', 'approve_failed', 'deny_failed'].includes(r.status)).length,
      attempts: data.attempts.filter((a) => a.status === 'in_progress').length,
      retakes: data.retakes.filter((r) => r.status === 'pending').length,
    }
  }, [data])

  return (
    <div data-log-section="Rulebook tests">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {TABS.map((t) => (
          <button key={t.value} onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${tab === t.value
              ? 'bg-blue-500/20 text-blue-100 border-blue-400/50' : 'bg-white/[0.03] text-white/60 border-white/10 hover:text-white'}`}>
            {t.label}{counts[t.value] ? <span className="ml-1.5 px-1.5 rounded-full bg-amber-400/80 text-black text-[10px]">{counts[t.value]}</span> : null}
          </button>
        ))}
        {data?.seasons?.length > 0 && (
          <select aria-label="Season" value={seasonId || data.seasonId || ''} onChange={(e) => setSeasonId(e.target.value)} className={`${input} ml-auto`}>
            {data.seasons.map((s) => <option key={s.id} value={s.id}>Season {s.number}{s.status === 'active' ? ' (active)' : ''} · {s.attempts} attempts</option>)}
          </select>
        )}
      </div>

      {notice && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-xs border ${notice.tone === 'red' ? 'bg-red-500/10 border-red-400/30 text-red-100' : 'bg-emerald-500/10 border-emerald-400/30 text-emerald-100'}`}>
          {notice.text}
        </div>
      )}
      {err && <div className="mb-3 px-3 py-2 rounded-lg text-xs bg-red-500/10 border border-red-400/30 text-red-100">Couldn’t load: {err}</div>}
      {!data ? <div className="text-sm text-white/50">Loading…</div> : (
        <>
          {tab === 'requests' && <Requests data={data} post={post} />}
          {tab === 'attempts' && <Attempts data={data} />}
          {tab === 'retakes' && <Retakes data={data} post={post} />}
          {tab === 'questions' && <Questions data={data} post={post} />}
          {tab === 'activity' && <Activity events={data.events} />}
          {tab === 'settings' && <Settings settings={data.settings} post={post} />}
        </>
      )}
    </div>
  )
}

// ── Requests ─────────────────────────────────────────────────────────────────

function Requests({ data, post }) {
  if (!data.requests.length) return <Empty>No one has passed a test this season yet.</Empty>
  return <div className="space-y-2">{data.requests.map((r) => <RequestRow key={r.id} r={r} post={post} />)}</div>
}

function RequestRow({ r, post }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [tone, label] = REQUEST_STATUS[r.status] || ['slate', r.status]
  const open = ['pending', 'approve_failed', 'deny_failed'].includes(r.status)
  const role = r.test === 'agm' ? 'Assistant GM' : 'GM'

  async function decide(decision) {
    if (decision === 'approve' && !confirm(`Approve ${r.name} as ${role} of ${r.franchiseName}?\n\nThe bot will give them the franchise ${role} role${r.test === 'gm' ? ' and the GM role' : ''} and DM them.`)) return
    if (decision === 'deny' && !confirm(`Deny ${r.name}'s request to be ${role} of ${r.franchiseName}?`)) return
    setBusy(true)
    await post({ action: 'decide', requestId: r.id, decision, note: note.trim() || null }, decision === 'approve' ? `Approval queued — the bot is giving ${r.name} their roles.` : `Denied — ${r.name} will get a DM.`)
    setBusy(false)
  }

  return (
    <div className={`${card} p-3`}>
      <div className="flex flex-wrap items-center gap-2">
        {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="w-7 h-7 rounded-full" /> : null}
        <span className="text-sm font-bold text-white">{r.name}</span>
        <TestPill test={r.test} />
        <span className="text-xs text-blue-100/80">for <b className="text-white">{r.franchiseName || '—'}</b></span>
        <Pill tone={tone}>{label}</Pill>
        <span className="ml-auto text-[11px] text-white/50">{r.score}/{r.total} · {r.pct}% · {when(r.submittedAt)}</span>
      </div>
      <div className="mt-2 grid sm:grid-cols-3 gap-2 text-[11px]">
        <div className="text-white/60">Signed: <span className="font-serif italic text-white/90">{r.signature || '—'}</span></div>
        <div className="text-white/60">
          Salary Crew: <b className="text-emerald-300">✅ {r.crewApprovals.length}</b>/5 · <b className="text-red-300">❌ {r.crewDenials.length}</b>
          {(r.crewApprovals.length > 0 || r.crewDenials.length > 0) && (
            <div className="text-white/45 mt-0.5">
              {r.crewApprovals.map((v) => v.name || v.id).join(', ')}{r.crewDenials.length ? ` · denied by ${r.crewDenials.map((v) => v.name || v.id).join(', ')}` : ''}
            </div>
          )}
          {!r.noticePosted && <div className={r.noticeFailed ? 'text-red-300' : 'text-white/40'}>{r.noticeFailed ? 'Discord notice failed to post' : 'Discord notice not posted yet'}</div>}
        </div>
        <div className="text-white/60">
          Current {role} role holders: {r.franchiseRoleId
            ? (r.currentHolders.length ? <span className="text-white/90">{r.currentHolders.map((h) => h.name).join(', ')}</span> : <span className="text-white/40">nobody</span>)
            : <span className="text-amber-300">no {role} role ID set on this franchise</span>}
        </div>
      </div>
      {(r.result || r.decidedByName) && (
        <div className="mt-2 text-[11px] text-white/55">
          {r.decidedByName && <>Decided by <b className="text-white/80">{r.decidedByName}</b> {when(r.decidedAt)}{r.decisionNote ? ` — “${r.decisionNote}”` : ''}. </>}
          {r.result && <span className={/fail|could not|error/i.test(r.result) ? 'text-red-300' : ''}>{r.result}</span>}
        </div>
      )}
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (sent to them with the decision)" maxLength={300}
            className={`${input} flex-1 min-w-[200px]`} aria-label="Decision note" />
          <button disabled={busy} onClick={() => decide('approve')} className="px-3 py-1.5 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
            {r.status === 'approve_failed' ? 'Retry approve' : 'Approve'}
          </button>
          <button disabled={busy} onClick={() => decide('deny')} className="px-3 py-1.5 rounded text-xs font-bold bg-red-600/80 hover:bg-red-500 text-white disabled:opacity-50">
            {r.status === 'deny_failed' ? 'Retry deny' : 'Deny'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Attempts ─────────────────────────────────────────────────────────────────

function Attempts({ data }) {
  const [openId, setOpenId] = useState(null)
  const [filter, setFilter] = useState('all')
  const rows = data.attempts.filter((a) => filter === 'all'
    || (filter === 'live' && a.status === 'in_progress')
    || (filter === 'passed' && a.passed)
    || (filter === 'failed' && a.status === 'submitted' && !a.passed))
  return (
    <div>
      <div className="flex gap-2 mb-2">
        {[['all', 'All'], ['live', 'In progress'], ['passed', 'Passed'], ['failed', 'Failed']].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)} className={`px-2 py-1 rounded text-[11px] font-bold border ${filter === v ? 'bg-blue-500/20 border-blue-400/40 text-blue-100' : 'bg-white/[0.03] border-white/10 text-white/60'}`}>{l}</button>
        ))}
      </div>
      {!rows.length ? <Empty>No attempts here.</Empty> : (
        <div className="space-y-1.5">
          {rows.map((a) => (
            <div key={a.id} className={card}>
              <button onClick={() => setOpenId(openId === a.id ? null : a.id)} className="w-full text-left px-3 py-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-white">{a.name}</span>
                <TestPill test={a.test} />
                <span className="text-xs text-blue-100/70">{a.franchiseName}</span>
                {a.status === 'in_progress'
                  ? <Pill tone="amber">In progress · {a.answered}/{a.questionCount}</Pill>
                  : <Pill tone={a.passed ? 'green' : 'red'}>{a.passed ? 'Passed' : 'Failed'} · {a.pct}%</Pill>}
                {a.timesLeft > 0 && <Pill tone="slate">Left {a.timesLeft}×</Pill>}
                {a.requestStatus && <Pill tone={(REQUEST_STATUS[a.requestStatus] || ['slate'])[0]}>{(REQUEST_STATUS[a.requestStatus] || [null, a.requestStatus])[1]}</Pill>}
                <span className="ml-auto text-[11px] text-white/45">
                  {a.status === 'in_progress' ? `started ${when(a.startedAt)} · last active ${when(a.lastActiveAt)}` : `submitted ${when(a.submittedAt)}`}
                </span>
              </button>
              {openId === a.id && <AttemptDetail id={a.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AttemptDetail({ id }) {
  const [d, setD] = useState(null)
  const [show, setShow] = useState('all')
  useEffect(() => {
    let alive = true
    const load = () => fetch(`/api/admin/higgenlogs/tests?attemptId=${id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j?.attempt) setD(j.attempt) }).catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [id])
  if (!d) return <div className="px-3 pb-3 text-xs text-white/50">Loading…</div>
  const qs = d.questions.filter((q) => show === 'all' || (show === 'wrong' && !q.right) || (show === 'blank' && q.chosen == null))
  return (
    <div className="px-3 pb-3 grid lg:grid-cols-2 gap-3">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">Answers</span>
          {[['all', 'All'], ['wrong', 'Wrong'], ['blank', 'Blank']].map(([v, l]) => (
            <button key={v} onClick={() => setShow(v)} className={`px-1.5 py-0.5 rounded text-[10px] border ${show === v ? 'border-blue-400/50 text-blue-100' : 'border-white/10 text-white/50'}`}>{l}</button>
          ))}
        </div>
        <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
          {qs.map((q) => (
            <div key={q.id} className={`p-2 rounded border text-[11px] ${q.chosen == null ? 'border-white/10' : q.right ? 'border-emerald-400/25 bg-emerald-500/5' : 'border-red-400/25 bg-red-500/5'}`}>
              <div className="text-white/90"><b>{q.n}.</b> {q.prompt} <span className="text-white/35">({q.ruleRef || '—'})</span></div>
              <div className="mt-0.5 text-white/60">
                Picked: <span className={q.right ? 'text-emerald-300' : 'text-red-300'}>{q.chosen == null ? '— blank —' : q.options[q.chosen]}</span>
                {!q.right && <> · Correct: <span className="text-emerald-300">{q.options[q.correct]}</span></>}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-white/50">
          Signature: <span className="font-serif italic text-white/80">{d.signature || '—'}</span> · IP {d.ip || '—'}
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-1.5">Timeline</div>
        <Timeline events={d.events} />
      </div>
    </div>
  )
}

function Timeline({ events, showName = false }) {
  if (!events?.length) return <div className="text-xs text-white/40">Nothing yet.</div>
  return (
    <div className="space-y-1 max-h-[460px] overflow-y-auto pr-1">
      {events.map((e) => (
        <div key={e.id} className="text-[11px] border-l-2 border-white/10 pl-2">
          <span className="text-white/40">{when(e.createdAt)}</span>{' '}
          {showName && <b className="text-white/90">{e.name} </b>}
          {showName && e.test && <TestPill test={e.test} />}{' '}
          <span className={e.event === 'left' ? 'text-amber-200' : e.event === 'failed' || e.event === 'error' ? 'text-red-300' : e.event === 'passed' ? 'text-emerald-300' : 'text-white/80'}>{e.words}</span>
          {Array.isArray(e.details) && e.details.length > 0 && (
            <span className="text-white/45"> — {e.details.map((p) => (Array.isArray(p) ? `${p[0]}: ${p[1]}` : String(p))).join(' · ')}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Retakes ──────────────────────────────────────────────────────────────────

function Retakes({ data, post }) {
  const people = useMemo(() => {
    const m = new Map()
    for (const a of data.attempts) if (!m.has(`${a.discordId}|${a.test}`)) m.set(`${a.discordId}|${a.test}`, { discordId: a.discordId, name: a.name, test: a.test })
    return [...m.values()]
  }, [data.attempts])
  const [manual, setManual] = useState({ key: '', extra: 1, reason: '' })

  return (
    <div className="space-y-3">
      {data.retakes.length === 0 ? <Empty>No one has asked for another attempt.</Empty> : (
        <div className="space-y-2">{data.retakes.map((t) => <RetakeRow key={t.id} t={t} seasonId={data.seasonId} post={post} />)}</div>
      )}
      <div className={`${card} p-3`}>
        <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-2">Grant attempts directly</div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Person" value={manual.key} onChange={(e) => setManual({ ...manual, key: e.target.value })} className={input}>
            <option value="">Choose someone who has taken a test…</option>
            {people.map((p) => <option key={`${p.discordId}|${p.test}`} value={`${p.discordId}|${p.test}`}>{p.name} — {p.test.toUpperCase()}</option>)}
          </select>
          <input type="number" min={1} max={10} aria-label="Extra attempts" value={manual.extra} onChange={(e) => setManual({ ...manual, extra: e.target.value })} className={`${input} w-16`} />
          <input placeholder="Reason (optional)" aria-label="Reason" value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} className={`${input} flex-1 min-w-[160px]`} maxLength={300} />
          <button disabled={!manual.key} onClick={async () => {
            const [discordId, test] = manual.key.split('|')
            const ok = await post({ action: 'grant', seasonId: data.seasonId, discordId, test, extra: Number(manual.extra), reason: manual.reason.trim() || null }, 'Attempts granted.')
            if (ok) setManual({ key: '', extra: 1, reason: '' })
          }} className="px-3 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40">Grant</button>
        </div>
      </div>
      {data.grants.length > 0 && (
        <div className={`${card} p-3`}>
          <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-1.5">Grants this season</div>
          {data.grants.map((g) => (
            <div key={g.id} className="text-[11px] text-white/70">
              {when(g.createdAt)} — <b className="text-white">{g.name}</b> <TestPill test={g.test} /> +{g.extra} by {g.grantedByName || '—'}{g.reason ? ` (“${g.reason}”)` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RetakeRow({ t, seasonId, post }) {
  const [extra, setExtra] = useState(1)
  const [reason, setReason] = useState('')
  const pending = t.status === 'pending'
  return (
    <div className={`${card} p-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-white">{t.name}</span>
        <TestPill test={t.test} />
        <Pill tone={pending ? 'amber' : t.status === 'granted' ? 'green' : 'slate'}>{t.status}</Pill>
        <span className="ml-auto text-[11px] text-white/45">{when(t.createdAt)}{t.resolvedByName ? ` · by ${t.resolvedByName}` : ''}</span>
      </div>
      {t.note && <div className="mt-1 text-[11px] text-white/60">Their note: “{t.note}”</div>}
      {pending && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-white/60">Grant</span>
          <input type="number" min={1} max={10} aria-label="Extra attempts" value={extra} onChange={(e) => setExtra(e.target.value)} className={`${input} w-16`} />
          <input placeholder="Reason (optional)" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className={`${input} flex-1 min-w-[160px]`} maxLength={300} />
          <button onClick={() => post({ action: 'grant', seasonId, discordId: t.discordId, test: t.test, extra: Number(extra), reason: reason.trim() || null, retakeRequestId: t.id }, `Granted ${t.name} ${extra} more attempt${Number(extra) === 1 ? '' : 's'}.`)}
            className="px-3 py-1.5 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white">Grant</button>
          <button onClick={() => { if (confirm(`Dismiss ${t.name}'s request?`)) post({ action: 'dismiss-retake', retakeRequestId: t.id }, 'Dismissed.') }}
            className="px-3 py-1.5 rounded text-xs font-bold bg-white/10 hover:bg-white/15 text-white/80">Dismiss</button>
        </div>
      )}
    </div>
  )
}

// ── Questions ────────────────────────────────────────────────────────────────

const BLANK = { prompt: '', kind: 'mc', options: ['', '', '', ''], correctIndex: 0, ruleRef: '', forGm: true, forAgm: true, enabled: true }

function Questions({ data, post }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const qs = data.questions
  const gmCount = qs.filter((q) => q.enabled && q.forGm).length
  const agmCount = qs.filter((q) => q.enabled && q.forAgm).length
  const rows = qs.filter((q) => (filter === 'all' || (filter === 'gm' && q.forGm) || (filter === 'agm' && q.forAgm) || (filter === 'off' && !q.enabled))
    && (!search.trim() || `${q.prompt} ${q.ruleRef}`.toLowerCase().includes(search.trim().toLowerCase())))

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs text-white/70">
          GM test: <b className="text-white">{gmCount}</b> selected, asks <b className="text-white">{data.settings.gmQuestionCount > 0 ? Math.min(data.settings.gmQuestionCount, gmCount) : gmCount}</b>
          {' · '}AGM test: <b className="text-white">{agmCount}</b> selected, asks <b className="text-white">{data.settings.agmQuestionCount > 0 ? Math.min(data.settings.agmQuestionCount, agmCount) : agmCount}</b>
          {' · '}pass mark {data.settings.passPct}%
        </span>
        <div className="ml-auto flex gap-1.5">
          {[['all', 'All'], ['gm', 'GM'], ['agm', 'AGM'], ['off', 'Disabled']].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} className={`px-2 py-1 rounded text-[11px] font-bold border ${filter === v ? 'bg-blue-500/20 border-blue-400/40 text-blue-100' : 'bg-white/[0.03] border-white/10 text-white/60'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 mb-3">
        <input placeholder="Search questions or rule numbers" aria-label="Search questions" value={search} onChange={(e) => setSearch(e.target.value)} className={`${input} flex-1`} />
        <button onClick={() => setEditing({ ...BLANK })} className="px-3 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white">+ Add question</button>
      </div>
      {editing && !editing.id && <QuestionEditor q={editing} onCancel={() => setEditing(null)} onSave={async (q) => { if (await post({ action: 'question-save', question: q }, 'Question added.')) setEditing(null) }} />}
      <div className="space-y-1.5">
        {rows.map((q, i) => (
          editing?.id === q.id
            ? <QuestionEditor key={q.id} q={editing} onCancel={() => setEditing(null)} onSave={async (nq) => { if (await post({ action: 'question-save', question: nq }, 'Question saved.')) setEditing(null) }} />
            : (
              <div key={q.id} className={`${card} p-2.5 ${q.enabled ? '' : 'opacity-50'}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white"><span className="text-white/35 mr-1">{q.ruleRef || '—'}</span>{q.prompt}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {q.options.map((o, k) => (
                        <span key={k} className={`px-1.5 py-0.5 rounded text-[10px] border ${k === q.correctIndex ? 'border-emerald-400/40 text-emerald-200 bg-emerald-500/10' : 'border-white/10 text-white/50'}`}>{o}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <div className="flex items-center gap-2 text-[10px] text-white/70">
                      {[['enabled', 'On'], ['forGm', 'GM'], ['forAgm', 'AGM']].map(([k, l]) => (
                        <label key={k} className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={Boolean(q[k])} onChange={(e) => post({ action: 'question-flags', id: q.id, flags: { [k]: e.target.checked } })} className="accent-blue-500" />
                          {l}
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <button aria-label="Move question up" disabled={filter !== 'all' || search || i === 0} onClick={() => post({ action: 'question-move', id: q.id, direction: 'up' })} className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-white/70 disabled:opacity-30">↑</button>
                      <button aria-label="Move question down" disabled={filter !== 'all' || search || i === rows.length - 1} onClick={() => post({ action: 'question-move', id: q.id, direction: 'down' })} className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-white/70 disabled:opacity-30">↓</button>
                      <button onClick={() => setEditing({ ...q, options: [...q.options] })} className="px-2 py-0.5 rounded bg-white/10 text-[10px] font-bold text-white/80">Edit</button>
                      <button onClick={() => { if (confirm('Delete this question? Past attempts keep their own copy.')) post({ action: 'question-delete', id: q.id }, 'Question deleted.') }} className="px-2 py-0.5 rounded bg-red-600/40 text-[10px] font-bold text-red-100">Delete</button>
                    </div>
                  </div>
                </div>
              </div>
            )
        ))}
      </div>
    </div>
  )
}

function QuestionEditor({ q, onCancel, onSave }) {
  const [f, setF] = useState(q)
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const opts = f.kind === 'tf' ? ['True', 'False'] : f.options
  return (
    <div className={`${card} p-3 mb-2 border-blue-400/30`}>
      <div className="grid gap-2">
        <textarea value={f.prompt} onChange={(e) => set({ prompt: e.target.value })} rows={2} placeholder="Question" aria-label="Question" className={`${input} w-full`} />
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/70">
          <select aria-label="Question type" value={f.kind} onChange={(e) => set({ kind: e.target.value, correctIndex: 0, options: e.target.value === 'tf' ? ['True', 'False'] : (f.options.length >= 2 && f.kind !== 'tf' ? f.options : ['', '', '', '']) })} className={input}>
            <option value="mc">Multiple choice</option>
            <option value="tf">True / False</option>
          </select>
          <input value={f.ruleRef} onChange={(e) => set({ ruleRef: e.target.value })} placeholder="Rule # (e.g. 4.3)" aria-label="Rule number" className={`${input} w-32`} maxLength={40} />
          {[['enabled', 'Enabled'], ['forGm', 'GM test'], ['forAgm', 'AGM test']].map(([k, l]) => (
            <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={Boolean(f[k])} onChange={(e) => set({ [k]: e.target.checked })} className="accent-blue-500" />{l}</label>
          ))}
        </div>
        <div className="space-y-1">
          {opts.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name={`correct-${f.id || 'new'}`} checked={f.correctIndex === i} onChange={() => set({ correctIndex: i })} aria-label={`Mark option ${i + 1} correct`} className="accent-emerald-500" />
              {f.kind === 'tf'
                ? <span className="text-xs text-white/80">{o}</span>
                : <input value={o} onChange={(e) => set({ options: f.options.map((x, j) => (j === i ? e.target.value : x)) })} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} className={`${input} flex-1`} />}
              {f.kind !== 'tf' && f.options.length > 2 && (
                <button aria-label={`Remove option ${i + 1}`} onClick={() => set({ options: f.options.filter((_, j) => j !== i), correctIndex: f.correctIndex === i ? 0 : f.correctIndex > i ? f.correctIndex - 1 : f.correctIndex })} className="text-[10px] text-white/40 hover:text-red-300">remove</button>
              )}
            </div>
          ))}
          {f.kind !== 'tf' && f.options.length < 6 && (
            <button onClick={() => set({ options: [...f.options, ''] })} className="text-[11px] text-blue-300">+ add option</button>
          )}
        </div>
        <div className="text-[10px] text-white/40">The selected circle is the correct answer. Options are shuffled for every attempt.</div>
        <div className="flex gap-2">
          <button onClick={() => onSave({ ...f, options: opts })} className="px-3 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white">Save</button>
          <button onClick={onCancel} className="px-3 py-1.5 rounded text-xs font-bold bg-white/10 text-white/80">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Activity / Settings ──────────────────────────────────────────────────────

function Activity({ events }) {
  const [who, setWho] = useState('all')
  const people = useMemo(() => [...new Map(events.map((e) => [e.discordId, e.name])).entries()], [events])
  const rows = who === 'all' ? events : events.filter((e) => e.discordId === who)
  return (
    <div>
      <select aria-label="Filter by person" value={who} onChange={(e) => setWho(e.target.value)} className={`${input} mb-2`}>
        <option value="all">Everyone</option>
        {people.map(([id, name]) => <option key={id || 'none'} value={id || ''}>{name}</option>)}
      </select>
      <div className={`${card} p-3`}><Timeline events={rows} showName /></div>
    </div>
  )
}

function Settings({ settings, post }) {
  const [f, setF] = useState(settings)
  useEffect(() => { setF(settings) }, [settings])
  const [origin, setOrigin] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])
  const field = (k, label, ph) => (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-0.5">{label}</span>
      <input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} className={`${input} w-full font-mono`} />
    </label>
  )
  return (
    <div className={`${card} p-4 space-y-3`}>
      <div className="grid sm:grid-cols-2 gap-3">
        {field('passPct', 'Pass mark (%)', '90')}
        {field('noticeChannelId', 'Staff notice channel ID (no ping)', '1299015210702737429')}
        {field('gmRoleId', 'Generic GM role ID (given on GM approval)', 'role snowflake')}
        {field('agmRoleId', 'Generic AGM role ID (given on AGM approval)', 'role snowflake — optional')}
        {field('gmQuestionCount', 'GM test — questions per attempt (0 = all selected)', '0')}
        {field('agmQuestionCount', 'AGM test — questions per attempt (0 = all selected)', '0')}
      </div>
      <div className="text-[11px] text-white/50">Each attempt draws that many at random from the questions switched on for that test (Questions tab), so two people rarely get the same set.</div>
      <div className="flex flex-wrap gap-4 text-xs text-white/80">
        <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(f.gmOpen)} onChange={(e) => setF({ ...f, gmOpen: e.target.checked })} className="accent-blue-500" />GM test open</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(f.agmOpen)} onChange={(e) => setF({ ...f, agmOpen: e.target.checked })} className="accent-blue-500" />AGM test open</label>
      </div>
      <div className="text-[11px] text-white/50">
        Links to share: <span className="font-mono text-white/80">{origin}/gm-test</span> · <span className="font-mono text-white/80">{origin}/agm-test</span>.
        The franchise GM/AGM role comes from Teams &amp; Franchises; the generic role above is given on top.
      </div>
      <button onClick={() => post({ action: 'settings', settings: { ...f, passPct: Number(f.passPct), gmQuestionCount: Number(f.gmQuestionCount || 0), agmQuestionCount: Number(f.agmQuestionCount || 0) } }, 'Settings saved.')}
        className="px-3 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white">Save settings</button>
    </div>
  )
}

function Empty({ children }) {
  return <div className="p-6 rounded-xl border border-dashed border-white/15 text-center text-sm text-white/45">{children}</div>
}
