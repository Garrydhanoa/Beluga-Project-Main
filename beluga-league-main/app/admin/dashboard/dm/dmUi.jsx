'use client'

import { useEffect, useMemo, useState } from 'react'

/**
 * Shared building blocks for the DM Center's Inbox and Compose tabs.
 */

export const DIVISIONS = ['Majors', 'AAA', 'AA']
export const MAX_LEN = 2000
export const CONFIRM_THRESHOLD = 100
export const TOKENS = ['name', 'team', 'franchise', 'division', 'season']

// ---------------------------------------------------------------- helpers

export const cx = (...c) => c.filter(Boolean).join(' ')

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Render a Discord-ish preview of the message. Input is escaped FIRST, so every
 * tag below is one we introduced ourselves.
 */
export function renderPreview(text, { channels, users, roles }) {
  const chanMap = new Map((channels || []).map((c) => [c.id, c.name]))
  const userMap = new Map((users || []).map((u) => [u.id, u.displayName]))
  const roleMap = new Map((roles || []).map((r) => [r.id, r.name]))

  let html = escapeHtml(text)

  const chip = (label, cls) =>
    `<span class="${cls} rounded px-1 py-[1px] font-medium">${escapeHtml(label)}</span>`

  html = html
    .replace(/&lt;#(\d+)&gt;/g, (_m, id) =>
      chip(`#${chanMap.get(id) || 'unknown-channel'}`, 'bg-blue-500/25 text-blue-200'))
    .replace(/&lt;@&amp;(\d+)&gt;/g, (_m, id) =>
      chip(`@${roleMap.get(id) || 'unknown-role'}`, 'bg-amber-500/25 text-amber-200'))
    .replace(/&lt;@!?(\d+)&gt;/g, (_m, id) =>
      chip(`@${userMap.get(id) || 'unknown-user'}`, 'bg-indigo-500/25 text-indigo-200'))
    // Custom emoji render as a neutral pill (we can't fetch the image here).
    .replace(/&lt;a?:(\w+):(\d+)&gt;/g, (_m, name) =>
      chip(`:${name}:`, 'bg-white/10 text-white/70'))

  // Personalization tokens preview as the sample values the bot substitutes.
  html = html.replace(/\{(name|team|franchise|division|season)\}/g, (_m, k) =>
    chip(`{${k}}`, 'bg-emerald-500/25 text-emerald-200'))

  html = html
    .replace(/```([\s\S]*?)```/g, (_m, code) =>
      `<pre class="bg-black/60 border border-white/10 rounded p-2 my-1 overflow-x-auto text-[11px]">${code}</pre>`)
    .replace(/`([^`\n]+)`/g, '<code class="bg-black/50 rounded px-1 text-[11px]">$1</code>')
    .replace(/^### (.*)$/gm, '<div class="font-bold text-white text-[13px] mt-2">$1</div>')
    .replace(/^## (.*)$/gm, '<div class="font-bold text-white text-[15px] mt-2">$1</div>')
    .replace(/^# (.*)$/gm, '<div class="font-black text-white text-[17px] mt-2">$1</div>')
    .replace(/^-# (.*)$/gm, '<div class="text-[10px] text-white/40">$1</div>')
    .replace(/^&gt; (.*)$/gm, '<div class="border-l-2 border-white/25 pl-2 text-white/80">$1</div>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/__([^_]+)__/g, '<u>$1</u>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\(&lt;?(https?:\/\/[^)\s]+?)&gt;?\)/g,
      '<span class="text-blue-300 underline">$1</span>')
    .replace(/\n/g, '<br/>')

  return html
}

// ---------------------------------------------------------------- primitives

export function Panel({ title, hint, children, right }) {
  return (
    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-xs font-bold tracking-[0.2em] uppercase text-blue-300/70">{title}</div>
          {hint && <div className="text-[11px] text-blue-100/45 mt-1">{hint}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

export function Chip({ label, color = 'blue', onRemove, dot }) {
  const palette = {
    blue: 'bg-blue-500/15 border-blue-400/40 text-blue-100',
    amber: 'bg-amber-500/15 border-amber-400/40 text-amber-100',
    purple: 'bg-purple-500/15 border-purple-400/40 text-purple-100',
    green: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-100',
    red: 'bg-red-500/15 border-red-400/40 text-red-100',
  }[color]
  return (
    <span className={cx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold', palette)}>
      {dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />}
      <span className="truncate max-w-[190px]">{label}</span>
      {onRemove && (
        <button onClick={onRemove} className="opacity-60 hover:opacity-100 text-sm leading-none" aria-label="Remove">
          ×
        </button>
      )}
    </span>
  )
}

export function Toggle({ on, onChange, label, hint, danger }) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer py-1.5">
      <div className="min-w-0">
        <div className={cx('text-sm font-bold', danger && on ? 'text-red-200' : 'text-white')}>{label}</div>
        {hint && <div className="text-[11px] text-blue-100/45">{hint}</div>}
      </div>
      {/* p-0 + explicit left-0: a <button>'s default UA padding shifts the
          absolutely-positioned knob, which pushed it past the track when ON. */}
      <button
        type="button"
        onClick={() => onChange(!on)}
        aria-pressed={on}
        className={cx('relative w-11 h-6 p-0 rounded-full transition-colors shrink-0 border-0',
          on ? (danger ? 'bg-red-500' : 'bg-blue-500') : 'bg-white/10')}
      >
        <span className={cx('absolute left-0 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
          on ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
    </label>
  )
}

/**
 * Debounced name search against the existing bot-mirrored Discord directory.
 * Always search by NAME — an id is never required anywhere in this panel.
 */
export function SearchPicker({ kind, placeholder, selected, onAdd, color }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!q.trim()) { setResults([]); return undefined }
    let alive = true
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/discord?kind=${kind}&q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        const json = await res.json()
        if (alive) setResults(json.results || [])
      } catch {
        if (alive) setResults([])
      } finally {
        if (alive) setLoading(false)
      }
    }, 220)
    return () => { alive = false; clearTimeout(t) }
  }, [q, kind])

  const has = (id) => selected.some((s) => s.id === id)

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-black/40 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-sm focus:outline-none transition"
      />
      {open && q.trim() && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-white/15 bg-[#0b1220] shadow-2xl">
          {loading && <div className="px-3 py-2 text-xs text-white/40">Searching…</div>}
          {!loading && !results.length && <div className="px-3 py-2 text-xs text-white/40">No matches</div>}
          {results.map((r) => (
            <button
              key={r.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onAdd(r); setQ('') }}
              disabled={has(r.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent"
            >
              {kind === 'user' ? (
                r.avatarUrl
                  ? <img src={r.avatarUrl} alt="" className="w-6 h-6 rounded-full shrink-0" />
                  : <span className="w-6 h-6 rounded-full bg-white/10 shrink-0" />
              ) : (
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color || '#8b9bff' }} />
              )}
              <span className="text-sm text-white truncate flex-1">{r.displayName || r.name}</span>
              {kind === 'user' && r.inGuild === false && (
                <span className="text-[10px] text-red-300/80 shrink-0">left server</span>
              )}
              {has(r.id) && <span className="text-[10px] text-blue-300 shrink-0">added</span>}
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selected.map((s) => (
            <Chip
              key={s.id}
              label={s.label}
              color={color}
              dot={s.dot}
              onRemove={() => onAdd(s, true)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function MultiSelect({ options, selected, onToggle, labelKey = 'name', color = 'purple', empty }) {
  if (!options.length) return <div className="text-xs text-white/35 italic">{empty}</div>
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.id)
        return (
          <button
            key={o.id}
            onClick={() => onToggle(o.id)}
            className={cx(
              'px-2.5 py-1 rounded-full border text-xs font-semibold transition',
              on
                ? (color === 'purple'
                  ? 'bg-purple-500/25 border-purple-400/60 text-purple-100'
                  : 'bg-blue-500/25 border-blue-400/60 text-blue-100')
                : 'bg-white/[0.03] border-white/10 text-white/60 hover:border-white/25 hover:text-white'
            )}
          >
            {o[labelKey]}
            {o.division && <span className="opacity-50 ml-1">· {o.division}</span>}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Insert-a-tag toolbar, shared by the Compose and Inbox composers.
 *
 * Emits the RAW Discord token (`<#id>`, `<@id>`, `<@&id>`) so what Discord
 * receives is a real, clickable tag rather than plain text. Channels are
 * filtered locally from the mirrored list; people and roles are searched by
 * NAME against the bot-mirrored directory — an id is never needed.
 *
 * @param {object} p
 *   channels  – [{id,name,category}] for the # picker
 *   onInsert  – (text) => void, inserts at the caret
 *   tokens    – optional personalization tokens to offer (e.g. ['name','team'])
 */
export function TagBar({ channels = [], onInsert, tokens = [] }) {
  const [open, setOpen] = useState(null) // 'channel' | 'user' | 'role' | null
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])

  useEffect(() => {
    if (!open || open === 'channel') return undefined
    if (!q.trim()) { setResults([]); return undefined }
    let alive = true
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/discord?kind=${open}&q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        const j = await res.json()
        if (alive) setResults(Array.isArray(j.results) ? j.results : [])
      } catch { if (alive) setResults([]) }
    }, 200)
    return () => { alive = false; clearTimeout(t) }
  }, [q, open])

  const channelResults = useMemo(() => {
    const term = q.trim().toLowerCase()
    const all = Array.isArray(channels) ? channels : []
    return (term ? all.filter((c) => (c.name || '').toLowerCase().includes(term)) : all).slice(0, 60)
  }, [q, channels])

  const rows = open === 'channel' ? channelResults : results

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {[['channel', '# Channel'], ['user', '@ Person'], ['role', '@ Role']].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setOpen(open === k ? null : k); setQ(''); setResults([]) }}
            className={cx('px-2.5 py-1 rounded border text-[11px] font-bold transition',
              open === k
                ? 'bg-blue-500/25 border-blue-400/60 text-blue-100'
                : 'bg-white/[0.03] border-white/10 text-white/60 hover:text-white hover:border-white/25')}
          >
            {label}
          </button>
        ))}
        {tokens.length > 0 && <span className="w-px bg-white/10 mx-1" />}
        {tokens.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onInsert(`{${t}}`)}
            title={`Replaced per recipient with their ${t}`}
            className="px-2.5 py-1 rounded border border-emerald-400/25 bg-emerald-500/10 text-emerald-200/80 hover:text-emerald-100 text-[11px] font-mono font-bold transition"
          >
            {`{${t}}`}
          </button>
        ))}
      </div>

      {open && (
        <div className="mt-2 p-2 rounded-lg bg-black/40 border border-white/15">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={open === 'channel' ? 'Filter channels…' : `Search ${open}s by name…`}
            className="w-full px-2.5 py-1.5 bg-black/50 border border-white/10 focus:border-blue-400/60 rounded text-white text-xs focus:outline-none mb-1.5"
          />
          <div className="max-h-44 overflow-y-auto">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onInsert(open === 'channel' ? `<#${r.id}>` : open === 'role' ? `<@&${r.id}>` : `<@${r.id}>`)
                  setOpen(null); setQ('')
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left rounded hover:bg-white/10"
              >
                <span className="text-xs text-white truncate flex-1">
                  {open === 'channel' ? `#${r.name}` : (r.displayName || r.name)}
                </span>
                {open === 'channel' && r.category && (
                  <span className="text-[10px] text-white/35 shrink-0">{r.category}</span>
                )}
              </button>
            ))}
            {!rows.length && (
              <div className="px-2 py-2 text-[11px] text-white/40">
                {open === 'channel'
                  ? 'No channels mirrored yet — the bot fills this on its next member pull.'
                  : q.trim() ? 'No matches' : 'Type a name to search.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
