'use client'

// GM / AGM rulebook test (link-only: /gm-test, /agm-test). Discord sign-in,
// pick the franchise, answer every question (each answer is saved to the server
// the moment it's picked, so closing the tab loses nothing), sign, submit.
// Grading happens on the server; this page never sees a correct answer.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { signIn } from 'next-auth/react'
import { checkSecurityStatus, sendHeartbeat } from '../../../lib/clientSecurity'
import { authErrorMessage } from '../../../lib/authRouting'
import { divisionLabel } from '../../../lib/divisionLabels'

const card = 'rounded-2xl bg-white/[0.03] border border-white/10'

export default function CertTest({ test }) {
  const path = test === 'agm' ? '/agm-test' : '/gm-test'
  const title = test === 'agm' ? 'Assistant GM Rulebook Test' : 'GM Rulebook Test'
  const [data, setData] = useState(null)
  const [ban, setBan] = useState(null)
  const [authError, setAuthError] = useState(null)
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/cert/${test}`, { cache: 'no-store' })
      const d = await r.json()
      if (d?.banned) setBan(d.message)
      setData(d)
      setLoadError(false)
      return d
    } catch {
      setLoadError(true)
      return null
    }
  }, [test])

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error')
    if (code) setAuthError(authErrorMessage(code))
    checkSecurityStatus().then((s) => { if (s.banned) setBan(s.message) })
    load()
  }, [load])

  const signedIn = Boolean(data?.signedIn)
  useEffect(() => {
    if (!signedIn) return undefined
    sendHeartbeat(path)
    const t = setInterval(() => sendHeartbeat(path), 30000)
    return () => clearInterval(t)
  }, [signedIn, path])

  return (
    <main className="min-h-screen px-4 py-12 max-w-3xl mx-auto">
      <div className="mb-8 text-center">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">Beluga League</div>
        <h1 className="text-3xl sm:text-4xl font-black text-white mb-3">{title}</h1>
        <p className="text-blue-100/60 text-sm max-w-xl mx-auto">
          Every {test === 'agm' ? 'Assistant GM' : 'GM'} must know the current rulebook and be able to educate their team.
        </p>
      </div>

      {ban ? (
        <Notice tone="red" title="Access blocked">{ban}</Notice>
      ) : !data ? (
        <div className="text-center text-blue-200/60">{loadError ? 'The test couldn’t load — refresh in a minute.' : 'Loading…'}</div>
      ) : !data.signedIn ? (
        <>
          {authError && <div className="mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-400/30 text-center text-sm text-amber-100">{authError}</div>}
          <div className="p-6 rounded-2xl bg-blue-500/10 border border-blue-400/30 text-center">
            <p className="text-blue-100 mb-4 text-sm">Sign in with Discord to start the test.</p>
            <button onClick={() => signIn('discord', { callbackUrl: path })}
              className="px-6 py-2.5 rounded-full bg-blue-500 hover:bg-blue-400 text-white font-bold text-sm">
              Sign in with Discord
            </button>
          </div>
        </>
      ) : !data.inGuild ? (
        <Notice tone="amber" title="Join the server first">You must be a member of the Beluga League Discord to take this test.</Notice>
      ) : !data.season ? (
        <Notice tone="slate" title="No active season">There’s no active season right now.</Notice>
      ) : (
        <Flow data={data} test={test} reload={load} />
      )}
    </main>
  )
}

function Notice({ tone = 'slate', title, children }) {
  const tones = {
    red: 'bg-red-500/10 border-red-400/30',
    amber: 'bg-amber-500/10 border-amber-400/30',
    green: 'bg-emerald-500/10 border-emerald-400/30',
    slate: 'bg-white/[0.03] border-white/10',
  }
  return (
    <div className={`p-6 rounded-2xl border text-center ${tones[tone]}`}>
      {title && <p className="text-white font-bold mb-1">{title}</p>}
      <div className="text-blue-100/80 text-sm">{children}</div>
    </div>
  )
}

function Flow({ data, test, reload }) {
  const signedInAs = data.username ? (
    <p className="mb-6 text-center text-xs text-blue-200/60">Signed in as <span className="font-bold text-blue-200">{data.username}</span> · Season {data.season.number}</p>
  ) : null

  if (data.current) return (<>{signedInAs}<Attempt data={data} test={test} reload={reload} /></>)
  if (data.done) return (<>{signedInAs}<Passed result={data.latestResult} test={test} /></>)
  if (data.canStart) return (<>{signedInAs}{data.latestResult && <Result result={data.latestResult} compact />}<StartPanel data={data} test={test} reload={reload} /></>)
  if (data.latestResult) return (<>{signedInAs}<Result result={data.latestResult} /><RetakePanel data={data} test={test} reload={reload} /></>)
  return (<>{signedInAs}<Notice title="Not open yet">This test isn’t open right now. Check back soon.</Notice></>)
}

function StartPanel({ data, test, reload }) {
  const [franchiseId, setFranchiseId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const role = test === 'agm' ? 'Assistant GM' : 'GM'

  async function start() {
    setBusy(true); setErr(null)
    const r = await fetch(`/api/cert/${test}`, { method: 'POST', body: JSON.stringify({ action: 'start', franchiseId: Number(franchiseId) }) })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setErr(d.error || 'Could not start the test.'); return }
    reload()
  }

  return (
    <div className={`${card} p-5 sm:p-6`}>
      <h2 className="text-lg font-black text-white mb-1">Before you start</h2>
      <ul className="text-sm text-blue-100/75 space-y-1.5 mb-5 list-disc pl-5">
        <li>Read the current <a href="/rulebook" target="_blank" rel="noreferrer" className="text-blue-300 underline">rulebook</a> first.</li>
        <li><b className="text-white">{data.questionCount}</b> questions. You need <b className="text-white">{data.passPct}%</b> to pass. You get <b className="text-white">{Math.max(0, data.attemptsAllowed - data.attemptsUsed)}</b> attempt{data.attemptsAllowed - data.attemptsUsed === 1 ? '' : 's'}.</li>
        <li>Your answers save as you go — you can leave and come back to finish.</li>
        <li>Passing sends your request to staff for approval.</li>
      </ul>

      <label className="block text-[11px] font-bold uppercase tracking-wider text-blue-300/70 mb-1.5" htmlFor="cert-franchise">
        Which franchise are you the {role} of?
      </label>
      <select id="cert-franchise" value={franchiseId} onChange={(e) => setFranchiseId(e.target.value)}
        className="w-full px-3 py-2.5 bg-black/40 border border-white/15 rounded-lg text-white text-sm mb-4">
        <option value="">Choose a franchise…</option>
        {data.franchises.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}{f.divisions?.length ? ` — ${f.divisions.map(divisionLabel).join(' · ')}` : ''}
          </option>
        ))}
      </select>
      {err && <p className="text-sm text-red-300 mb-3">{err}</p>}
      <button onClick={start} disabled={!franchiseId || busy}
        className="w-full sm:w-auto px-6 py-2.5 rounded-full bg-blue-500 hover:bg-blue-400 disabled:opacity-40 text-white font-bold text-sm">
        {busy ? 'Starting…' : 'Start the test'}
      </button>
    </div>
  )
}

function Attempt({ data, test, reload }) {
  const att = data.current
  const questions = att.questions
  const [answers, setAnswers] = useState(() => ({ ...(att.answers || {}) }))
  const firstOpen = useMemo(() => {
    const i = questions.findIndex((q) => att.answers?.[q.id] == null)
    return i < 0 ? questions.length : i
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [idx, setIdx] = useState(firstOpen) // questions.length = review screen
  const [saving, setSaving] = useState(null)
  const [saveErr, setSaveErr] = useState(null)
  const [showGrid, setShowGrid] = useState(false)
  const attemptIdRef = useRef(att.id)
  const answered = questions.filter((q) => answers[q.id] != null).length

  // Leave / return tracking for an in-progress attempt.
  useEffect(() => {
    const url = `/api/cert/${test}`
    const send = (event, beacon) => {
      const body = JSON.stringify({ action: 'event', event, attemptId: attemptIdRef.current })
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))
      else fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {})
    }
    send('returned', false)
    const onVis = () => send(document.visibilityState === 'hidden' ? 'left' : 'returned', document.visibilityState === 'hidden')
    const onHide = () => send('left', true)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
    }
  }, [test])

  async function pick(q, choice) {
    const before = answers[q.id]
    setAnswers((a) => ({ ...a, [q.id]: choice }))
    setSaving(q.id); setSaveErr(null)
    const r = await fetch(`/api/cert/${test}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'answer', attemptId: att.id, questionId: q.id, choice }),
    }).catch(() => null)
    setSaving(null)
    if (!r || !r.ok) {
      const d = r ? await r.json().catch(() => ({})) : {}
      setAnswers((a) => ({ ...a, [q.id]: before }))
      setSaveErr(d.error || 'That answer didn’t save — check your connection and pick it again.')
      if (r?.status === 409) reload()
    }
  }

  const q = questions[idx]
  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-blue-200/70 mb-1.5">
          <span>{att.franchiseName}</span>
          <span>{answered} of {questions.length} answered</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-blue-400 transition-all" style={{ width: `${questions.length ? (answered / questions.length) * 100 : 0}%` }} />
        </div>
      </div>

      {q ? (
        <div className={`${card} p-5 sm:p-6`}>
          <div className="text-[11px] font-bold uppercase tracking-wider text-blue-300/70 mb-2">Question {idx + 1} of {questions.length}</div>
          <h2 className="text-base sm:text-lg font-bold text-white mb-4 leading-snug">{q.prompt}</h2>
          <div className="space-y-2" role="radiogroup" aria-label={`Question ${idx + 1}`}>
            {q.options.map((opt, i) => {
              const on = answers[q.id] === i
              return (
                <button key={i} role="radio" aria-checked={on} onClick={() => pick(q, i)}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition ${on
                    ? 'bg-blue-500/20 border-blue-400/60 text-white'
                    : 'bg-black/20 border-white/10 text-blue-100/85 hover:border-blue-400/40'}`}>
                  <span className={`inline-block w-5 h-5 mr-2.5 align-middle rounded-full border ${on ? 'bg-blue-400 border-blue-300' : 'border-white/30'}`} />
                  <span className="align-middle">{opt}</span>
                </button>
              )
            })}
          </div>
          <div className="h-5 mt-2 text-xs">
            {saving === q.id ? <span className="text-blue-200/60">Saving…</span>
              : saveErr ? <span className="text-red-300">{saveErr}</span>
              : answers[q.id] != null ? <span className="text-emerald-300/80">Saved</span> : null}
          </div>
          <div className="flex items-center justify-between gap-2 mt-3">
            <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}
              className="px-4 py-2 rounded-full text-sm font-bold bg-white/5 border border-white/10 text-white/80 disabled:opacity-30">Back</button>
            <button onClick={() => setShowGrid((s) => !s)} className="text-xs text-blue-300 underline">
              {showGrid ? 'Hide question list' : 'Jump to a question'}
            </button>
            <button onClick={() => setIdx(idx + 1)}
              className="px-4 py-2 rounded-full text-sm font-bold bg-blue-500 hover:bg-blue-400 text-white">
              {idx === questions.length - 1 ? 'Review' : 'Next'}
            </button>
          </div>
        </div>
      ) : (
        <Review data={data} test={test} answered={answered} total={questions.length} onBack={() => setIdx(questions.length - 1)} reload={reload} />
      )}

      {showGrid && (
        <div className={`${card} p-4 mt-3`}>
          <div className="grid grid-cols-8 sm:grid-cols-12 gap-1.5">
            {questions.map((qq, i) => (
              <button key={qq.id} onClick={() => { setIdx(i); setShowGrid(false) }}
                aria-label={`Go to question ${i + 1}${answers[qq.id] != null ? ' (answered)' : ''}`}
                className={`h-8 rounded-md text-xs font-bold border ${i === idx ? 'ring-2 ring-blue-300' : ''} ${answers[qq.id] != null
                  ? 'bg-blue-500/25 border-blue-400/40 text-white' : 'bg-black/20 border-white/10 text-white/50'}`}>
                {i + 1}
              </button>
            ))}
            <button onClick={() => { setIdx(questions.length); setShowGrid(false) }}
              className="col-span-4 h-8 rounded-md text-xs font-bold border bg-emerald-500/15 border-emerald-400/30 text-emerald-100">Review &amp; submit</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Review({ data, test, answered, total, onBack, reload }) {
  const statements = data.ackStatements || []
  const [ack, setAck] = useState(statements.map(() => false))
  const [signature, setSignature] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const unanswered = total - answered
  const ready = ack.every(Boolean) && signature.trim().length >= 2

  async function submit() {
    if (unanswered > 0 && !window.confirm(`${unanswered} question${unanswered === 1 ? ' is' : 's are'} unanswered and will count as wrong. Submit anyway?`)) return
    setBusy(true); setErr(null)
    const r = await fetch(`/api/cert/${test}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'submit', attemptId: data.current.id, signature: signature.trim(), acknowledged: ack }),
    })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setErr(d.error || 'Could not submit.'); return }
    reload()
  }

  return (
    <div className={`${card} p-5 sm:p-6`}>
      <h2 className="text-lg font-black text-white mb-1">Review &amp; sign</h2>
      <p className="text-sm text-blue-100/70 mb-4">
        {answered} of {total} answered{unanswered > 0 ? ` — ${unanswered} left blank will count as wrong.` : '.'}
      </p>
      <div className="space-y-2.5 mb-4">
        {statements.map((s, i) => (
          <label key={i} className="flex items-start gap-3 text-sm text-blue-100/90 cursor-pointer">
            <input type="checkbox" checked={ack[i]} onChange={(e) => setAck((a) => a.map((v, j) => (j === i ? e.target.checked : v)))}
              className="mt-0.5 w-4 h-4 accent-blue-500" />
            <span>{s}</span>
          </label>
        ))}
      </div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-blue-300/70 mb-1.5" htmlFor="cert-signature">Signature — type your name</label>
      <input id="cert-signature" value={signature} onChange={(e) => setSignature(e.target.value)} maxLength={80}
        autoComplete="off" placeholder="Your name"
        className="w-full px-3 py-2.5 bg-black/40 border border-white/15 rounded-lg text-white text-sm mb-4 font-serif italic" />
      {err && <p className="text-sm text-red-300 mb-3">{err}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onBack} className="px-4 py-2 rounded-full text-sm font-bold bg-white/5 border border-white/10 text-white/80">Back to questions</button>
        <button onClick={submit} disabled={!ready || busy}
          className="px-6 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white font-bold text-sm">
          {busy ? 'Submitting…' : 'Submit test'}
        </button>
      </div>
    </div>
  )
}

function Passed({ result, test }) {
  const role = test === 'agm' ? 'Assistant GM' : 'GM'
  const status = result?.requestStatus
  return (
    <div className="space-y-4">
      <Notice tone="green" title="You passed">
        {result ? <>Score: <b className="text-white">{result.score}/{result.total}</b> ({result.pct}%)</> : null}
      </Notice>
      <div className={`${card} p-5 text-sm text-blue-100/80 text-center`}>
        {status === 'approved'
          ? <>You’re approved as {role} of <b className="text-white">{result.franchiseName}</b>. Your roles have been given in Discord.</>
          : status === 'approving' || status === 'approve_running'
            ? <>Approved — your roles are being given in Discord now.</>
            : <>Your request to be {role} of <b className="text-white">{result?.franchiseName}</b> is with staff for approval. You’ll get a DM when it’s decided.</>}
      </div>
    </div>
  )
}

function Result({ result, compact = false }) {
  if (!result) return null
  if (result.passed && result.requestStatus === 'denied') {
    return (
      <div className="mb-4">
        <Notice tone="amber" title="Request denied">
          Your last request was denied by staff.{result.decisionNote ? <> Note: “{result.decisionNote}”</> : null}
        </Notice>
      </div>
    )
  }
  return (
    <div className="mb-4">
      <Notice tone="amber" title={compact ? 'Previous attempt' : 'You didn’t pass this time'}>
        <p>Score: <b className="text-white">{result.score}/{result.total}</b> ({result.pct}%)</p>
        {result.reviewSections?.length > 0 && (
          <p className="mt-2">Re-read these rulebook sections: <span className="text-white">{result.reviewSections.join(', ')}</span></p>
        )}
      </Notice>
    </div>
  )
}

function RetakePanel({ data, test, reload }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const pending = data.retakeRequest?.status === 'pending'

  async function ask() {
    setBusy(true); setErr(null)
    const r = await fetch(`/api/cert/${test}`, { method: 'POST', body: JSON.stringify({ action: 'retake', note: note.trim() }) })
    const d = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setErr(d.error || 'Could not send the request.'); return }
    reload()
  }

  if (pending) return <Notice title="Request sent">Your request for another attempt is with staff.</Notice>
  return (
    <div className={`${card} p-5 sm:p-6`}>
      <h2 className="text-base font-black text-white mb-1">Want another attempt?</h2>
      <p className="text-sm text-blue-100/70 mb-3">Staff decide whether to give you another try.</p>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2}
        placeholder="Optional note for staff"
        className="w-full px-3 py-2 bg-black/40 border border-white/15 rounded-lg text-white text-sm mb-3" />
      {err && <p className="text-sm text-red-300 mb-3">{err}</p>}
      <button onClick={ask} disabled={busy}
        className="px-6 py-2.5 rounded-full bg-blue-500 hover:bg-blue-400 disabled:opacity-40 text-white font-bold text-sm">
        {busy ? 'Sending…' : 'Request another attempt'}
      </button>
    </div>
  )
}
