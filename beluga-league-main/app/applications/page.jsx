'use client'

// Public Applications — staff-built forms (admin → Applications). Users sign in
// with Discord, fill the questions, optionally attach small files (≤8MB), and
// submit; staff get the submission as a Discord embed with voting/decisions.

import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'

export default function ApplicationsPage() {
  const [data, setData] = useState(null)
  const [openForm, setOpenForm] = useState(null)
  // Signed-in state comes from the API (the public layout has no SessionProvider).
  const status = data ? (data.signedIn ? 'authenticated' : 'unauthenticated') : 'loading'

  useEffect(() => {
    fetch('/api/applications', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        // Error responses have no forms array — still render the sign-in gate
        // instead of sitting on "Loading…" forever.
        if (!d || !Array.isArray(d.forms)) setData({ forms: [], signedIn: false, username: null, loadError: true })
        else setData(d)
      })
      .catch(() => setData({ forms: [], signedIn: false, username: null, loadError: true }))
  }, [])

  return (
    <main className="min-h-screen px-4 py-12 max-w-3xl mx-auto">
      <div className="mb-10 text-center">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">Beluga League</div>
        <h1 className="text-4xl font-black text-white mb-3">Applications</h1>
        <p className="text-blue-100/60 text-sm">Apply for league positions, submit reports, and more. Sign in with Discord to start.</p>
      </div>

      {status === 'unauthenticated' && (
        <div className="mb-8 p-6 rounded-2xl bg-blue-500/10 border border-blue-400/30 text-center">
          <p className="text-blue-100 mb-4 text-sm">You need to sign in with Discord before starting an application.</p>
          <button onClick={() => signIn('discord', { callbackUrl: '/applications' })}
            className="px-6 py-2.5 rounded-full bg-blue-500 hover:bg-blue-400 text-white font-bold text-sm">
            Sign in with Discord
          </button>
        </div>
      )}
      {status === 'authenticated' && data?.username && (
        <p className="mb-6 text-center text-xs text-blue-200/60">Signed in as <span className="font-bold text-blue-200">{data.username}</span></p>
      )}

      {!data ? (
        <div className="text-center text-blue-200/60">Loading…</div>
      ) : data.forms.length === 0 ? (
        <div className="text-center py-16 text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
          {data.loadError
            ? 'Applications couldn’t load right now — try refreshing in a minute.'
            : 'No open applications right now — check back later.'}
        </div>
      ) : (
        <div className="space-y-3">
          {data.forms.map((f) => (
            <div key={f.id} className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
              <button onClick={() => setOpenForm(openForm === f.id ? null : f.id)} className="w-full text-left px-5 py-4 hover:bg-white/[0.03]">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-white font-bold">{f.name}</div>
                    {f.description && <div className="text-xs text-blue-100/60 mt-0.5">{f.description}</div>}
                  </div>
                  <span className="text-blue-300 text-lg">{openForm === f.id ? '▴' : '▾'}</span>
                </div>
              </button>
              {openForm === f.id && (
                status === 'authenticated'
                  ? <FormFiller form={f} />
                  : <div className="px-5 pb-4 text-xs text-yellow-200/80">Sign in with Discord above to fill this out.</div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

function FormFiller({ form }) {
  const questions = Array.isArray(form.questions) ? form.questions : []
  const [values, setValues] = useState({})
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function submit() {
    setBusy(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('formId', String(form.id))
      fd.append('answers', JSON.stringify(questions.map((q) => ({ label: q.label, value: values[q.label] || '' }))))
      for (const f of files.slice(0, 3)) fd.append('files', f)
      const r = await fetch('/api/applications', { method: 'POST', body: fd })
      const d = await r.json()
      setResult(r.ok ? { ok: true, msg: '✅ Submitted! Staff will review it — you may get a DM with the decision.' } : { ok: false, msg: `❌ ${d.error || 'Failed'}` })
      if (r.ok) { setValues({}); setFiles([]) }
    } catch (e) {
      setResult({ ok: false, msg: `❌ ${e.message}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-5 pb-5 space-y-4 border-t border-white/5 pt-4">
      {questions.map((q, i) => (
        <div key={i}>
          <label className="block text-xs font-bold text-blue-200/90 mb-1">
            {q.label}{q.required !== false && <span className="text-red-300 ml-1">*</span>}
          </label>
          {q.type === 'paragraph' ? (
            <textarea rows={4} value={values[q.label] || ''} onChange={(e) => setValues({ ...values, [q.label]: e.target.value })}
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm" maxLength={1500} />
          ) : (
            <input value={values[q.label] || ''} onChange={(e) => setValues({ ...values, [q.label]: e.target.value })}
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm" maxLength={500} />
          )}
        </div>
      ))}
      <div>
        <label className="block text-xs font-bold text-blue-200/90 mb-1">Attachments <span className="text-white/40 font-normal">(optional · max 3 files · {Math.min(form.max_file_mb || 8, 8)}MB each — bigger things should be links)</span></label>
        <input type="file" multiple onChange={(e) => setFiles([...(e.target.files || [])].slice(0, 3))}
          className="text-xs text-white/60 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-blue-500/20 file:text-blue-100 file:text-xs file:font-bold" />
      </div>
      {result && <div className={`text-sm ${result.ok ? 'text-green-300' : 'text-red-300'}`}>{result.msg}</div>}
      <button onClick={submit} disabled={busy}
        className="px-6 py-2.5 rounded-full bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-bold text-sm">
        {busy ? 'Submitting…' : 'Submit application'}
      </button>
    </div>
  )
}
