'use client'

// A person's own ban or suspension: the details, when they can appeal, the form, and
// the result. A banned person can't be DMed, so this page is how they find out.

import { useCallback, useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { authErrorMessage } from '../../../lib/authRouting'

function fmt(d, withTime = true) {
  if (!d) return ''
  return new Date(d).toLocaleString('en-US', withTime
    ? { dateStyle: 'long', timeStyle: 'short' }
    : { dateStyle: 'long' })
}

const STATUS_TEXT = {
  voting: 'Your appeal is with staff.',
  director: 'Your appeal is waiting for a final decision.',
  approved: 'Your appeal was approved.',
  denied: 'Your appeal was denied.',
}

function AppealForm({ item, questions, onSent }) {
  const [answers, setAnswers] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function submit() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/applications/appeal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: item.caseId, answers }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) onSent()
    else setError(data.error || 'The appeal could not be sent.')
  }
  return (
    <div className="mt-4 pt-4 border-t border-white/10 space-y-3" data-log-section="Appeal form">
      <p className="text-xs text-amber-200/90">You can only appeal this once, so take your time.</p>
      {questions.map((q) => (
        <label key={q.key} className="block">
          <span className="block text-sm font-bold text-white mb-1">{q.label}{q.required ? '' : ' (optional)'}</span>
          <textarea rows={4} maxLength={1500} aria-label={q.label} data-log-ignore
            value={answers[q.key] || ''} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white focus:outline-none focus:border-blue-400/60" />
        </label>
      ))}
      {error && <div className="text-sm text-red-200" role="alert">{error}</div>}
      <button type="button" onClick={submit} disabled={busy}
        className="px-6 py-2.5 rounded-full bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-bold text-sm">
        {busy ? 'Sending…' : 'Send appeal'}
      </button>
    </div>
  )
}

function Item({ item, questions, onSent }) {
  const title = item.kind === 'ban'
    ? (item.banType === 'temp' ? 'Temporary ban' : 'Ban')
    : `Suspension: ${item.lengthText}`
  return (
    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10">
      <div className="text-white font-bold text-lg">{title}</div>
      <div className="text-sm text-blue-100/70 mt-1">Reason: {item.reason}</div>
      {item.ruleLabel && <div className="text-xs text-blue-100/50 mt-0.5">{item.ruleLabel}</div>}

      {item.banType === 'temp' && item.unbanAt && (
        <p className="text-sm text-white/80 mt-3">You can rejoin after {fmt(item.unbanAt)}.</p>
      )}
      {item.inviteUrl && (
        <a href={item.inviteUrl} className="inline-block mt-3 px-5 py-2 rounded-full bg-blue-500 hover:bg-blue-400 text-white font-bold text-sm">
          Discord invite
        </a>
      )}
      {item.kind === 'ban' && item.banType === 'appealable' && !item.appeal && !item.canAppeal && item.opensAt && (
        <p className="text-sm text-white/80 mt-3">You can appeal from {fmt(item.opensAt, false)}.</p>
      )}
      {item.appeal && (
        <div className="mt-3 text-sm text-white/80">
          <p>{STATUS_TEXT[item.appeal.status] || 'Your appeal has been received.'}</p>
          {item.appeal.decision_note && <p className="text-blue-100/70 mt-1">{item.appeal.decision_note}</p>}
          {item.appeal.status === 'approved' && item.kind === 'ban' && (
            <p className="text-amber-200/90 text-xs mt-2">One strike has been removed. Under rule 6.1.4, no warnings are given on return and any infraction means a ban.</p>
          )}
        </div>
      )}
      {item.canAppeal && <AppealForm item={item} questions={questions} onSent={onSent} />}
    </div>
  )
}

export default function AppealPage() {
  const [data, setData] = useState(null)
  const [authError, setAuthError] = useState(null)

  const load = useCallback(() => {
    fetch('/api/applications/appeal', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ signedIn: false, items: [], questions: [], loadError: true }))
  }, [])

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error')
    if (code) setAuthError(authErrorMessage(code))
    load()
  }, [load])

  return (
    <main className="min-h-screen px-4 py-12 max-w-2xl mx-auto">
      <div className="mb-8 text-center">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">Beluga League</div>
        <h1 className="text-3xl sm:text-4xl font-black text-white mb-2">Appeals</h1>
        <p className="text-blue-100/60 text-sm">Your bans, suspensions and appeals. Only you can see this page.</p>
      </div>

      {authError && <div className="mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-400/30 text-center text-sm text-amber-100">{authError}</div>}

      {!data ? (
        <div className="text-center text-blue-200/60">Loading…</div>
      ) : data.blocked ? (
        <div className="p-6 rounded-2xl bg-red-500/10 border border-red-400/30 text-center text-sm text-red-100/80">{data.message}</div>
      ) : !data.signedIn ? (
        <div className="p-6 rounded-2xl bg-blue-500/10 border border-blue-400/30 text-center">
          <p className="text-blue-100 mb-4 text-sm">Sign in with the Discord account that was banned or suspended. This works even if you are not in the server.</p>
          <button type="button" onClick={() => signIn('discord', { callbackUrl: '/applications/appeal' })}
            className="px-6 py-2.5 rounded-full bg-blue-500 hover:bg-blue-400 text-white font-bold text-sm">
            Sign in with Discord
          </button>
        </div>
      ) : data.items?.length ? (
        <div className="space-y-4">
          {data.items.map((item) => <Item key={item.caseId} item={item} questions={data.questions} onSent={load} />)}
        </div>
      ) : (
        <div className="text-center py-16 text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
          There is nothing to appeal on this account.
        </div>
      )}
    </main>
  )
}
