'use client'

// Admin — Ticket Setup: build ticket reasons (staff roles, questions, limits)
// and send panels to any channel. The bot posts/refreshes panels within ~60s.

import { useEffect, useState, useCallback } from 'react'

export default function TicketSetupPage() {
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(null) // reason object or 'new'
  const [msg, setMsg] = useState('')

  const reload = useCallback(async () => {
    const r = await fetch('/api/admin/ticket-config', { cache: 'no-store' })
    setData(await r.json())
  }, [])
  useEffect(() => { reload() }, [reload])

  async function post(payload) {
    setMsg('Working…')
    const r = await fetch('/api/admin/ticket-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const d = await r.json().catch(() => ({}))
    setMsg(r.ok ? `✓ ${d.note || 'saved'}` : `❌ ${d.error || 'failed'}`)
    setTimeout(() => setMsg(''), 3000)
    setEditing(null)
    await reload()
  }

  if (!data) return <div className="text-blue-200/60">Loading…</div>

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
        <h1 className="text-3xl font-black text-white mb-1">Ticket Setup</h1>
        <p className="text-blue-100/60 text-sm">Reasons are fully configurable — per-reason staff roles, opener questions, limits. Users open tickets from a panel; they can only <i>request</i> a close, staff confirm.</p>
        {msg && <div className="text-xs text-green-300 mt-1">{msg}</div>}
      </div>

      <section className="p-5 rounded-2xl bg-white/[0.02] border border-white/10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black text-white tracking-wide">Reasons</h2>
          <button onClick={() => setEditing('new')} className="px-3 py-1.5 text-xs font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded">+ New reason</button>
        </div>
        <ul className="space-y-1.5">
          {data.reasons.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2 rounded bg-white/[0.02] border border-white/5 text-sm">
              <span className="text-white font-bold">{r.emoji} {r.name}</span>
              <span className="text-white/40 text-xs flex-1 truncate">{(r.staff_role_ids || []).length} staff role(s) · {(r.questions || []).length} question(s) · max {r.max_open_per_user}/user</span>
              {!r.is_active && <span className="text-[9px] uppercase text-red-300">disabled</span>}
              <button onClick={() => setEditing(r)} className="text-xs font-bold text-blue-200 hover:text-white">Edit</button>
              <button onClick={() => confirm(`Delete reason "${r.name}"?`) && post({ action: 'delete-reason', id: r.id })} className="text-xs font-bold text-red-300 hover:text-red-200">✕</button>
            </li>
          ))}
          {!data.reasons.length && <li className="text-xs text-white/40 italic">No reasons yet — add your first (e.g. General Support, FFW).</li>}
        </ul>
        {editing && <ReasonEditor reason={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onSave={(reason) => post({ action: 'save-reason', reason })} />}
      </section>

      <section className="p-5 rounded-2xl bg-white/[0.02] border border-white/10">
        <h2 className="text-sm font-black text-white tracking-wide mb-3">Panels</h2>
        <PanelSender onSend={(p) => post({ action: 'send-panel', ...p })} />
        <ul className="space-y-1.5 mt-3">
          {data.panels.filter((p) => p.is_active).map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2 rounded bg-white/[0.02] border border-white/5 text-sm">
              <span className="text-white">{p.title}</span>
              <span className="text-white/40 text-xs font-mono flex-1">#{p.channel_id} {p.message_id ? '· posted ✓' : '· waiting for bot…'}</span>
              <button onClick={() => post({ action: 'delete-panel', id: p.id })} className="text-xs font-bold text-red-300 hover:text-red-200">Remove</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function ReasonEditor({ reason, onCancel, onSave }) {
  const [f, setF] = useState({
    id: reason?.id, name: reason?.name || '', emoji: reason?.emoji || '',
    description: reason?.description || '', welcomeMessage: reason?.welcome_message || '',
    staffRoleIds: (reason?.staff_role_ids || []).join(', '),
    maxOpenPerUser: reason?.max_open_per_user || 1,
    isActive: reason ? reason.is_active : true,
    questions: reason?.questions || [],
  })
  const set = (k, v) => setF({ ...f, [k]: v })

  return (
    <div className="mt-4 p-4 rounded-xl bg-blue-500/5 border border-blue-400/30 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Name (e.g. General Support)" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm sm:col-span-2" />
        <input value={f.emoji} onChange={(e) => set('emoji', e.target.value)} placeholder="Emoji (🎫)" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
      </div>
      <input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Short description shown on the panel" className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
      <input value={f.welcomeMessage} onChange={(e) => set('welcomeMessage', e.target.value)} placeholder="Auto-message posted inside the ticket" className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input value={f.staffRoleIds} onChange={(e) => set('staffRoleIds', e.target.value)} placeholder="Staff role IDs (comma-separated)" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white font-mono text-xs sm:col-span-2" />
        <input type="number" min={1} value={f.maxOpenPerUser} onChange={(e) => set('maxOpenPerUser', e.target.value)} placeholder="Max open/user" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Opener questions (max 5 — shown as a popup form)</div>
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
        {f.questions.length < 5 && (
          <button onClick={() => set('questions', [...f.questions, { label: '', type: 'short', required: true }])} className="text-xs text-blue-300 hover:text-blue-200">+ add question</button>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-white/80"><input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Active (shown on panels)</label>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded">Cancel</button>
        <button onClick={() => onSave(f)} disabled={!f.name} className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-40 rounded">Save reason</button>
      </div>
    </div>
  )
}

function PanelSender({ onSend }) {
  const [channelId, setChannelId] = useState('')
  const [title, setTitle] = useState('Open a ticket')
  const [description, setDescription] = useState('')
  return (
    <div className="flex flex-wrap gap-2">
      <input value={channelId} onChange={(e) => setChannelId(e.target.value.trim())} placeholder="Channel ID" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white font-mono text-xs w-44" />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Panel title" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm flex-1 min-w-[140px]" />
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Panel description (optional)" className="px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm flex-1 min-w-[180px]" />
      <button onClick={() => onSend({ channelId, title, description })} disabled={!channelId}
        className="px-4 py-2 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-40 rounded">Send panel</button>
    </div>
  )
}
