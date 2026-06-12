'use client'

// Admin — Applications: Google-Forms-style builder + submissions inbox.
// Submissions post to each form's Discord channel (votes + Accept/Deny there);
// this page is the master record with manual decide/delete.

import { useEffect, useState, useCallback } from 'react'

export default function ApplicationsAdminPage() {
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(null)
  const [view, setView] = useState('forms') // forms | submissions | logins
  const [msg, setMsg] = useState('')

  const reload = useCallback(async () => {
    const r = await fetch('/api/admin/applications', { cache: 'no-store' })
    setData(await r.json())
  }, [])
  useEffect(() => { reload() }, [reload])

  async function post(payload) {
    setMsg('Working…')
    const r = await fetch('/api/admin/applications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const d = await r.json().catch(() => ({}))
    setMsg(r.ok ? '✓ saved' : `❌ ${d.error || 'failed'}`)
    setTimeout(() => setMsg(''), 2500)
    setEditing(null)
    await reload()
  }

  if (!data) return <div className="text-blue-200/60">Loading…</div>

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
        <h1 className="text-3xl font-black text-white mb-1">Applications</h1>
        <p className="text-blue-100/60 text-sm">Build forms, pick where submissions post, who can vote, and who decides. Public page: <code className="text-blue-300">/applications</code>.</p>
        {msg && <div className="text-xs text-green-300 mt-1">{msg}</div>}
      </div>

      <div className="flex gap-2">
        {['forms', 'submissions', 'logins'].map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-2 text-sm font-bold rounded-lg ${view === v ? 'bg-blue-500 text-white' : 'bg-white/5 text-white/60 hover:text-white'}`}>
            {v === 'forms' ? `Forms (${data.forms.length})` : v === 'submissions' ? `Submissions (${data.submissions.length})` : 'Login history'}
          </button>
        ))}
      </div>

      {view === 'forms' && (
        <section className="p-5 rounded-2xl bg-white/[0.02] border border-white/10">
          <div className="flex justify-end mb-3">
            <button onClick={() => setEditing('new')} className="px-3 py-1.5 text-xs font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded">+ New form</button>
          </div>
          <ul className="space-y-1.5">
            {data.forms.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2 rounded bg-white/[0.02] border border-white/5 text-sm">
                <span className="text-white font-bold">{f.name}</span>
                <span className="text-white/40 text-xs flex-1 truncate">
                  {(f.questions || []).length} question(s) · #{f.channel_id || 'no channel'} · {f.require_in_server ? 'server-only' : 'open to all'} {f.allow_votes ? '· votes' : ''}
                </span>
                {!f.is_active && <span className="text-[9px] uppercase text-red-300">closed</span>}
                <button onClick={() => setEditing(f)} className="text-xs font-bold text-blue-200 hover:text-white">Edit</button>
                <button onClick={() => confirm(`Delete form "${f.name}" and ALL its submissions?`) && post({ action: 'delete-form', id: f.id })} className="text-xs font-bold text-red-300 hover:text-red-200">✕</button>
              </li>
            ))}
            {!data.forms.length && <li className="text-xs text-white/40 italic">No forms yet.</li>}
          </ul>
          {editing && <FormEditor form={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onSave={(form) => post({ action: 'save-form', form })} />}
        </section>
      )}

      {view === 'submissions' && (
        <section className="space-y-2">
          {data.submissions.map((s) => (
            <div key={s.id} className="p-4 rounded-xl bg-white/[0.02] border border-white/10">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <span className="text-white font-bold text-sm">#{s.id} · {s.form_name}</span>
                <span className="text-blue-200/70 text-xs">{s.display_name || s.username || s.discord_id}</span>
                <StatusBadge status={s.status} />
                {s.post_failed && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-red-500/15 text-red-300 border border-red-400/30">discord post failed — review here</span>}
                {s.file_count > 0 && <span className="text-[10px] text-white/40">{s.file_count} file(s){s.stored_file_count ? ` (${s.stored_file_count} stored)` : ''}</span>}
                <span className="text-white/30 text-[10px] ml-auto">{new Date(s.created_at).toLocaleString()}</span>
              </div>
              <div className="space-y-1 mb-2">
                {(s.answers || []).map((a, i) => (
                  <div key={i} className="text-xs"><span className="text-blue-300/80 font-bold">{a.label}:</span> <span className="text-white/80">{a.value}</span></div>
                ))}
              </div>
              <div className="flex gap-2">
                {s.status === 'pending' && (
                  <>
                    <button onClick={() => post({ action: 'decide', id: s.id, status: 'accepted' })} className="px-3 py-1 text-[11px] font-bold text-green-300 bg-green-500/10 border border-green-400/30 rounded">Accept</button>
                    <button onClick={() => post({ action: 'decide', id: s.id, status: 'denied' })} className="px-3 py-1 text-[11px] font-bold text-red-300 bg-red-500/10 border border-red-500/30 rounded">Deny</button>
                  </>
                )}
                <button onClick={() => confirm('Delete this submission (and its files)?') && post({ action: 'delete-submission', id: s.id })}
                  className="px-3 py-1 text-[11px] font-bold text-white/50 hover:text-red-300 bg-white/5 rounded ml-auto">Delete</button>
              </div>
            </div>
          ))}
          {!data.submissions.length && <div className="text-center py-12 text-white/40 text-sm rounded-2xl bg-white/[0.02] border border-dashed border-white/10">No submissions yet.</div>}
        </section>
      )}

      {view === 'logins' && (
        <section className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/30"><tr className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
              <th className="px-3 py-2 text-left">User</th><th className="px-3 py-2 text-left">Discord ID</th>
              <th className="px-3 py-2 text-left">Context</th><th className="px-3 py-2 text-right">When</th>
            </tr></thead>
            <tbody>
              {data.logins.map((l, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-3 py-1.5 text-white">{l.username || '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-white/50">{l.discord_id}</td>
                  <td className="px-3 py-1.5 text-white/60 text-xs">{l.context || '—'}</td>
                  <td className="px-3 py-1.5 text-right text-white/40 text-xs">{new Date(l.logged_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.logins.length && <div className="text-center py-10 text-white/40 text-sm">No activity logged yet.</div>}
        </section>
      )}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    pending: 'bg-yellow-500/15 text-yellow-200 border-yellow-400/30',
    accepted: 'bg-green-500/15 text-green-300 border-green-400/30',
    denied: 'bg-red-500/15 text-red-300 border-red-400/30',
  }
  return <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${map[status] || ''}`}>{status}</span>
}

function FormEditor({ form, onCancel, onSave }) {
  const [f, setF] = useState({
    id: form?.id, name: form?.name || '', description: form?.description || '',
    channelId: form?.channel_id || '', requireInServer: form ? form.require_in_server : true,
    allowVotes: form ? form.allow_votes : true,
    voteRoleIds: (form?.vote_role_ids || []).join(', '),
    decisionRoleIds: (form?.decision_role_ids || []).join(', '),
    pingRoleIds: (form?.ping_role_ids || []).join(', '),
    dmOnDecision: form ? form.dm_on_decision : true,
    acceptMessage: form?.accept_message || '', denyMessage: form?.deny_message || '',
    isActive: form ? form.is_active : true,
    questions: form?.questions || [],
  })
  const set = (k, v) => setF({ ...f, [k]: v })

  return (
    <div className="mt-4 p-4 rounded-xl bg-blue-500/5 border border-blue-400/30 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Form name (e.g. Staff Application)" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
        <input value={f.channelId} onChange={(e) => set('channelId', e.target.value.trim())} placeholder="Discord channel ID for submissions" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white font-mono text-xs" />
      </div>
      <input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Description shown to applicants" className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input value={f.pingRoleIds} onChange={(e) => set('pingRoleIds', e.target.value)} placeholder="Ping role IDs" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white font-mono text-xs" />
        <input value={f.voteRoleIds} onChange={(e) => set('voteRoleIds', e.target.value)} placeholder="Vote role IDs (blank = anyone)" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white font-mono text-xs" />
        <input value={f.decisionRoleIds} onChange={(e) => set('decisionRoleIds', e.target.value)} placeholder="Decision role IDs (Accept/Deny)" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white font-mono text-xs" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={f.acceptMessage} onChange={(e) => set('acceptMessage', e.target.value)} placeholder="DM on accept ({form} = form name)" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-xs" />
        <input value={f.denyMessage} onChange={(e) => set('denyMessage', e.target.value)} placeholder="DM on deny ({form} = form name)" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-xs" />
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-white/80">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.requireInServer} onChange={(e) => set('requireInServer', e.target.checked)} /> Must be in the server</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.allowVotes} onChange={(e) => set('allowVotes', e.target.checked)} /> Staff voting (👍/👎)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.dmOnDecision} onChange={(e) => set('dmOnDecision', e.target.checked)} /> DM applicant on decision</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Open (listed publicly)</label>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Questions</div>
        {f.questions.map((q, i) => (
          <div key={i} className="flex gap-2 mb-1.5">
            <input value={q.label} onChange={(e) => set('questions', f.questions.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
              className="flex-1 px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs" placeholder="Question" />
            <select value={q.type || 'short'} onChange={(e) => set('questions', f.questions.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
              className="px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs">
              <option value="short">Short</option><option value="paragraph">Paragraph</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-white/60"><input type="checkbox" checked={q.required !== false} onChange={(e) => set('questions', f.questions.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))} />req</label>
            <button onClick={() => set('questions', f.questions.filter((_, j) => j !== i))} className="text-red-300 text-xs font-bold">✕</button>
          </div>
        ))}
        {f.questions.length < 25 && (
          <button onClick={() => set('questions', [...f.questions, { label: '', type: 'short', required: true }])} className="text-xs text-blue-300 hover:text-blue-200">+ add question</button>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded">Cancel</button>
        <button onClick={() => onSave(f)} disabled={!f.name} className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-40 rounded">Save form</button>
      </div>
    </div>
  )
}
