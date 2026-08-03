'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cx, MAX_LEN, renderPreview, SearchPicker, TagBar } from './dmUi'

/**
 * Inbox tab — a Discord-style two-pane DM client for the bot's own inbox.
 *
 * Left: conversations, unread first and bold with a count.
 * Right: the thread, oldest→newest, with a composer you type straight into —
 * no need to go back to Compose to message someone you're already talking to.
 *
 * Live-ness is short polling (2s): the conversation list refreshes, and the open
 * thread asks only for messages newer than the last id it has, so an open chat
 * stays cheap. On mobile the two panes swap (list ⇄ chat) with a back button.
 */

const POLL_MS = 2000

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString()
}

function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(Date.now() - 86400e3)
  const same = (a, b) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, yest)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

function Avatar({ src, name, size = 'w-9 h-9' }) {
  if (src) return <img src={src} alt="" className={cx(size, 'rounded-full object-cover shrink-0')} />
  return (
    <span className={cx(size, 'rounded-full bg-blue-500/25 border border-blue-400/30 shrink-0',
      'flex items-center justify-center text-[10px] font-bold text-blue-100')}>
      {String(name || '?').slice(0, 2).toUpperCase()}
    </span>
  )
}

/** Source badge on outgoing messages so a blast never looks like a hand-typed reply. */
function SourceTag({ source, authorName }) {
  if (source === 'blast') return <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-500/25 text-purple-200">Broadcast</span>
  if (source === 'ai') {
    // The bot stamps the persona into author_name, so a roast reply is obvious
    // in the transcript without having to guess which mode was on at the time.
    const roast = /unhinged/i.test(String(authorName || ''))
    return (
      <span className={cx('text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
        roast ? 'bg-red-500/25 text-red-200' : 'bg-emerald-500/25 text-emerald-200')}>
        {roast ? 'AI · Unhinged' : 'AI'}
      </span>
    )
  }
  // Onboarding DMs the bot sends on its own (join / verified), so they never read
  // as something a staff member typed.
  if (source === 'welcome' || source === 'verified') {
    return (
      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/25 text-cyan-200">
        {source === 'welcome' ? 'Welcome' : 'Verified'}
      </span>
    )
  }
  return null
}

const AI_MODES = [
  {
    id: 'professional',
    label: 'Professional',
    blurb: 'The bot’s normal helpful voice.',
    dot: 'bg-emerald-400',
  },
  {
    id: 'unhinged',
    label: 'Unhinged',
    blurb: 'Roast mode — rude, sarcastic and swears, and it uses their real stats against them.',
    dot: 'bg-red-400',
  },
]

/**
 * AI switch + persona picker for the open conversation.
 *
 * The two settings are NOT the same scope and the panel says so:
 *   - Auto-reply is DM-only (does the bot answer their DMs by itself?)
 *   - Personality applies EVERYWHERE, server channels included
 *
 * Collapsed into one pill so the chat header stays usable on a phone.
 */
function AiControls({ aiEnabled, aiMode, onChange }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const roast = aiMode === 'unhinged'
  const pill = !aiEnabled ? 'AI OFF' : roast ? 'AI · Unhinged' : 'AI · Pro'

  return (
    <div className="relative shrink-0" ref={boxRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Choose whether the bot answers this person automatically, and in which voice."
        className={cx('px-2.5 py-1 rounded-full border text-[11px] font-bold transition whitespace-nowrap',
          !aiEnabled
            ? 'bg-white/[0.03] border-white/15 text-white/50 hover:text-white'
            : roast
              ? 'bg-red-500/20 border-red-400/50 text-red-200'
              : 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200')}
      >
        {pill}
      </button>

      {open && (
        /* max-h + overflow-y-auto because the pane wrapper is overflow-hidden:
           without it the bottom of this panel is silently clipped on a phone. */
        <div className="absolute right-0 top-full mt-1.5 w-64 z-20 p-3 rounded-xl border border-white/15 bg-[#0d1117] shadow-2xl space-y-3 max-h-[min(52vh,420px)] overflow-y-auto">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white">Auto-reply <span className="text-white/35 font-normal">· DMs only</span></div>
              <div className="text-[10px] text-white/40 leading-snug">
                {aiEnabled ? 'The bot answers this person’s DMs on its own.' : 'Off — only what you type is sent.'}
              </div>
            </div>
            <button
              onClick={() => onChange({ enabled: !aiEnabled })}
              aria-pressed={aiEnabled}
              /* p-0 + explicit left-0 on the knob: a button's default UA padding
                 otherwise pushes the absolute knob outside the track when ON. */
              className={cx('relative w-11 h-6 p-0 rounded-full transition-colors shrink-0 border-0',
                aiEnabled ? 'bg-emerald-500' : 'bg-white/15')}
            >
              <span className={cx('absolute left-0 top-0.5 w-5 h-5 rounded-full bg-white transition-transform',
                aiEnabled ? 'translate-x-[22px]' : 'translate-x-0.5')} />
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              Personality
            </div>
            <div className="text-[10px] text-blue-300/70 leading-snug -mt-1">
              Applies in DMs <strong>and</strong> server channels.
            </div>
            {AI_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => onChange({ mode: m.id })}
                className={cx('w-full text-left px-2.5 py-2 rounded-lg border transition',
                  aiMode === m.id
                    ? 'bg-white/[0.07] border-white/25'
                    : 'bg-transparent border-white/10 hover:bg-white/[0.04]')}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cx('w-1.5 h-1.5 rounded-full', m.dot)} />
                  <span className="text-xs font-bold text-white">{m.label}</span>
                  {aiMode === m.id && <span className="ml-auto text-[9px] font-bold text-white/40">SELECTED</span>}
                </div>
                <div className="text-[10px] text-white/45 leading-snug mt-0.5">{m.blurb}</div>
              </button>
            ))}
          </div>

          <div className="text-[10px] text-white/30 leading-snug border-t border-white/10 pt-2">
            The bot can see their team, division, salary and stats. In DMs it remembers the last
            15 messages of this thread only.
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Who the bot is currently NOT being professional with, plus a way to set the
 * persona for anyone at all.
 *
 * This exists because the persona is global: you may well want to roast someone
 * in the server who has never sent the bot a DM, and there'd otherwise be no
 * conversation to open in order to reach the setting.
 */
function PersonalitiesPanel() {
  const [open, setOpen] = useState(false)
  const [personas, setPersonas] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/dm/personas', { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      setPersonas(Array.isArray(j.personas) ? j.personas : [])
    } catch { /* transient */ }
  }, [])

  useEffect(() => { load() }, [load])

  async function setMode(discordId, mode) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/dm/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId, mode }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error || 'Could not save that.')
        return
      }
      await load()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-b border-white/10">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition"
      >
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/50 flex-1">
          Personalities
        </span>
        {personas.length > 0 && (
          <span className="text-[10px] font-bold px-1.5 rounded-full bg-red-500/25 text-red-200">
            {personas.length}
          </span>
        )}
        <span className="text-white/30 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="text-[10px] text-white/40 leading-snug">
            Applies in DMs <strong>and</strong> server channels. Everyone not listed is professional.
          </div>

          <SearchPicker
            kind="user"
            placeholder="Search a member to set unhinged…"
            selected={[]}
            color="red"
            onAdd={(u) => setMode(u.id, 'unhinged')}
          />

          {error && <div className="text-[10px] text-red-300">{error}</div>}

          {!personas.length ? (
            <div className="text-[10px] text-white/30 italic">
              Nobody is on a custom personality.
            </div>
          ) : (
            personas.map((p) => (
              <div key={p.discordId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/[0.04] border border-white/10">
                <Avatar src={p.avatarUrl} name={p.displayName} size="w-6 h-6" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold text-white truncate">{p.displayName}</div>
                  <div className="text-[9px] text-red-200/80 uppercase tracking-wider font-bold">{p.mode}</div>
                </div>
                <button
                  disabled={busy}
                  onClick={() => setMode(p.discordId, 'professional')}
                  title="Back to the normal voice"
                  className="text-[10px] font-bold px-2 py-1 rounded bg-white/[0.06] hover:bg-white/10 border border-white/10 text-white/60 hover:text-white transition disabled:opacity-40"
                >
                  Reset
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function InboxTab({ onUnreadChange }) {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [convo, setConvo] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [notifyOn, setNotifyOn] = useState(false)
  // Resolved after mount, never read during render on the server — branching on
  // `'Notification' in globalThis` inside JSX causes a hydration mismatch.
  const [notifySupported, setNotifySupported] = useState(false)
  const [channels, setChannels] = useState([])

  const [showTools, setShowTools] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const scrollRef = useRef(null)
  const draftRef = useRef(null)
  const lastIdRef = useRef(0)
  const atBottomRef = useRef(true)
  const seenUnreadRef = useRef(0)

  // ---- browser notifications ------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    setNotifySupported(true)
    setNotifyOn(Notification.permission === 'granted')
  }, [])

  // Channel names so a <#id> tag in a message renders as #channel-name rather
  // than #unknown-channel.
  useEffect(() => {
    fetch('/api/admin/dm/targets', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.channels) setChannels(j.channels) })
      .catch(() => {})
  }, [])

  async function enableNotifications() {
    if (!('Notification' in window)) return
    const p = await Notification.requestPermission()
    setNotifyOn(p === 'granted')
  }

  // ---- conversation list poll -----------------------------------------
  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/dm/inbox${search ? `?q=${encodeURIComponent(search)}` : ''}`, { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      // Defensive: never let an unexpected payload shape put a non-array into
      // state — that turns a bad response into a full white-screen crash.
      const list = Array.isArray(j.conversations) ? j.conversations : []
      setConversations(list)
      onUnreadChange?.(j.unread || 0)

      // Notify only when the unread total actually grows, and only for a
      // conversation that isn't the one currently open on screen.
      const total = j.unread || 0
      if (notifyOn && total > seenUnreadRef.current && document.visibilityState !== 'visible') {
        const top = list.find((c) => c.unread > 0 && c.discordId !== activeId)
        if (top) {
          try {
            new Notification(`New DM from ${top.displayName}`, { body: top.preview || '', tag: 'beluga-dm' })
          } catch { /* notifications unavailable */ }
        }
      }
      seenUnreadRef.current = total
    } catch { /* transient */ }
  }, [search, notifyOn, activeId, onUnreadChange])

  useEffect(() => {
    loadList()
    const t = setInterval(loadList, POLL_MS)
    return () => clearInterval(t)
  }, [loadList])

  // ---- open a conversation --------------------------------------------
  const openConversation = useCallback(async (discordId) => {
    setActiveId(discordId)
    setConvo(null)
    setMessages([])
    lastIdRef.current = 0
    atBottomRef.current = true
    try {
      const res = await fetch(`/api/admin/dm/inbox/${discordId}?read=1`, { cache: 'no-store' })
      if (!res.ok) { setError('Could not open that conversation.'); return }
      const j = await res.json()
      const msgs = Array.isArray(j.messages) ? j.messages : []
      setConvo(j.conversation || null)
      setMessages(msgs)
      lastIdRef.current = msgs.length ? msgs[msgs.length - 1].id : 0
      loadList()
    } catch (e) {
      setError(String(e.message || e))
    }
  }, [loadList])

  // ---- open thread poll (incremental) ---------------------------------
  useEffect(() => {
    if (!activeId) return undefined
    const t = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/admin/dm/inbox/${activeId}?read=1${lastIdRef.current ? `&after=${lastIdRef.current}` : ''}`,
          { cache: 'no-store' }
        )
        if (!res.ok) return
        const j = await res.json()
        const msgs = Array.isArray(j.messages) ? j.messages : []
        if (j.conversation) setConvo(j.conversation)
        if (msgs.length) {
          setMessages((prev) => {
            const known = new Set(prev.map((m) => m.id))
            const fresh = msgs.filter((m) => !known.has(m.id))
            return fresh.length ? [...prev, ...fresh] : prev
          })
          lastIdRef.current = Math.max(lastIdRef.current, ...msgs.map((m) => m.id))
        }
      } catch { /* transient */ }
    }, POLL_MS)
    return () => clearInterval(t)
  }, [activeId])

  // A queued reply flips to sent/failed a beat later — re-sync the tail so its
  // status pill updates without reloading the whole thread.
  useEffect(() => {
    if (!activeId) return undefined
    if (!messages.some((m) => m.status === 'queued')) return undefined
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/dm/inbox/${activeId}`, { cache: 'no-store' })
        if (!res.ok) return
        const j = await res.json()
        setMessages(j.messages)
        lastIdRef.current = j.messages.length ? j.messages[j.messages.length - 1].id : 0
      } catch { /* transient */ }
    }, 2500)
    return () => clearTimeout(t)
  }, [messages, activeId])

  // ---- autoscroll ------------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  // ---- send ------------------------------------------------------------
  async function sendReply() {
    const text = draft.trim()
    if (!text || !activeId || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/dm/inbox/${activeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error || 'Could not send.'); return }
      setDraft('')
      atBottomRef.current = true
      setMessages((prev) => [...prev, j.message])
      lastIdRef.current = Math.max(lastIdRef.current, j.message.id)
      loadList()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setSending(false)
    }
  }

  /**
   * Update the AI switch and/or its persona. Both fields are independent on the
   * server, so passing only one leaves the other alone.
   */
  async function updateAi(patch) {
    if (!convo) return
    const optimistic = { ...convo }
    if (patch.enabled != null) optimistic.aiEnabled = patch.enabled
    if (patch.mode != null) optimistic.aiMode = patch.mode
    setConvo(optimistic)
    try {
      const res = await fetch(`/api/admin/dm/inbox/${activeId}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('AI setting did not save')
      const j = await res.json()
      // Trust the server's answer over the optimistic one.
      setConvo((c) => (c ? { ...c, aiEnabled: j.aiEnabled, aiMode: j.aiMode } : c))
    } catch {
      setConvo(convo) // roll back
      setError('Could not change the AI setting.')
    }
  }

  /** Insert a tag/token at the caret, exactly like the Compose tab does. */
  function insertAtCursor(text) {
    const el = draftRef.current
    if (!el) { setDraft((d) => d + text); return }
    const start = el.selectionStart ?? draft.length
    const end = el.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + text + draft.slice(end)
    setDraft(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })
  }

  // Enter sends, Shift+Enter makes a newline — same as Discord.
  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendReply()
    }
  }

  // ---- grouping --------------------------------------------------------
  const grouped = useMemo(() => {
    const out = []
    let lastDay = null
    for (const m of messages) {
      const day = dayLabel(m.createdAt)
      if (day !== lastDay) { out.push({ divider: day, key: `d-${m.id}` }); lastDay = day }
      out.push({ message: m, key: `m-${m.id}` })
    }
    return out
  }, [messages])

  const totalUnread = conversations.reduce((n, c) => n + c.unread, 0)

  // ---------------------------------------------------------------- render
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
      <div className="flex h-[68vh] min-h-[460px]">
        {/* -------------------------------------------- conversation list */}
        <div className={cx(
          'flex-col border-r border-white/10 bg-black/25 w-full md:w-72 md:flex shrink-0',
          activeId ? 'hidden md:flex' : 'flex'
        )}>
          <div className="p-3 border-b border-white/10 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-[0.2em] uppercase text-blue-300/70 flex-1">
                Direct Messages
              </span>
              {totalUnread > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white">{totalUnread}</span>
              )}
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations…"
              className="w-full px-2.5 py-1.5 bg-black/40 border border-white/10 focus:border-blue-400/60 rounded text-white text-xs focus:outline-none"
            />
            <button
              onClick={() => setShowNew((v) => !v)}
              className="w-full px-2.5 py-1.5 rounded bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 text-blue-100 text-xs font-bold transition"
            >
              {showNew ? 'Cancel' : '+ New message'}
            </button>
            {showNew && (
              <SearchPicker
                kind="user"
                placeholder="Search a member by name…"
                selected={[]}
                color="blue"
                onAdd={(u) => { setShowNew(false); setSearch(''); openConversation(u.id) }}
              />
            )}
            {!notifyOn && notifySupported && (
              <button onClick={enableNotifications} className="w-full text-[10px] text-blue-300/70 hover:text-blue-200">
                Enable browser notifications
              </button>
            )}
          </div>

          <PersonalitiesPanel />

          <div className="flex-1 overflow-y-auto">
            {!conversations.length && (
              <div className="p-4 text-xs text-white/35 italic">
                No conversations yet. Anyone who DMs the bot appears here.
              </div>
            )}
            {conversations.map((c) => (
              <button
                key={c.discordId}
                onClick={() => openConversation(c.discordId)}
                className={cx(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-white/5 transition',
                  activeId === c.discordId ? 'bg-blue-500/15' : 'hover:bg-white/5'
                )}
              >
                <Avatar src={c.avatarUrl} name={c.displayName} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cx('text-sm truncate flex-1',
                      c.unread > 0 ? 'font-bold text-white' : 'font-semibold text-white/80')}>
                      {c.displayName}
                    </span>
                    {/* A conversation the bot is answering on its own is worth
                        spotting from the list, especially on roast mode. */}
                    {c.aiEnabled && (
                      <span
                        title={c.aiMode === 'unhinged' ? 'Auto-reply: Unhinged' : 'Auto-reply: Professional'}
                        className={cx('text-[9px] font-bold px-1 rounded shrink-0',
                          c.aiMode === 'unhinged' ? 'bg-red-500/25 text-red-200' : 'bg-emerald-500/25 text-emerald-200')}
                      >
                        AI
                      </span>
                    )}
                    <span className="text-[10px] text-white/35 shrink-0">{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cx('text-[11px] truncate flex-1',
                      c.unread > 0 ? 'text-white/80' : 'text-white/40')}>
                      {c.lastDirection === 'out' && <span className="text-white/30">You: </span>}
                      {c.preview || '—'}
                    </span>
                    {c.unread > 0 && (
                      <span className="text-[10px] font-bold px-1.5 rounded-full bg-blue-500 text-white shrink-0">
                        {c.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* -------------------------------------------- chat pane */}
        <div className={cx('flex-col flex-1 min-w-0', activeId ? 'flex' : 'hidden md:flex')}>
          {!activeId ? (
            <div className="flex-1 flex items-center justify-center text-center p-6">
              <div>
                <div className="text-4xl mb-2 opacity-30">💬</div>
                <div className="text-sm text-white/40">Pick a conversation to read and reply.</div>
              </div>
            </div>
          ) : (
            <>
              {/* header */}
              <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-white/10 bg-black/20">
                <button
                  onClick={() => { setActiveId(null); setConvo(null); setMessages([]) }}
                  className="md:hidden p-1 -ml-1 text-white/60 hover:text-white shrink-0"
                  aria-label="Back to conversations"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <Avatar src={convo?.avatarUrl} name={convo?.displayName} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-white truncate">{convo?.displayName || '…'}</div>
                  <div className="text-[10px] text-white/40">
                    {convo?.inGuild === false ? 'Not in the server' : 'Direct message'}
                  </div>
                </div>
                <AiControls
                  aiEnabled={Boolean(convo?.aiEnabled)}
                  aiMode={convo?.aiMode || 'professional'}
                  onChange={updateAi}
                />
              </div>

              {error && (
                <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/30 text-xs text-red-200">{error}</div>
              )}

              {/* messages */}
              <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                {!messages.length && (
                  <div className="text-xs text-white/30 italic text-center py-6">
                    No messages yet — say something below.
                  </div>
                )}
                {grouped.map((row) =>
                  row.divider ? (
                    <div key={row.key} className="flex items-center gap-3 py-2">
                      <div className="h-px bg-white/10 flex-1" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">{row.divider}</span>
                      <div className="h-px bg-white/10 flex-1" />
                    </div>
                  ) : (
                    <Message key={row.key} m={row.message} convo={convo} channels={channels} />
                  )
                )}
              </div>

              {/* composer */}
              <div className="p-3 border-t border-white/10 bg-black/20">
                {/* Same tagging tools as the Compose tab: real <#channel> /
                    @person / @role tags and personalization tokens. */}
                {showTools && (
                  <div className="mb-2">
                    <TagBar
                      channels={channels}
                      onInsert={insertAtCursor}
                      tokens={['name', 'team', 'franchise', 'division', 'season']}
                    />
                  </div>
                )}

                {showPreview && draft.trim() && (
                  <div className="mb-2 p-2.5 rounded-lg border border-white/10 bg-[#0d1117]">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1">Preview</div>
                    <div
                      className="text-sm text-white/90 leading-relaxed break-words"
                      dangerouslySetInnerHTML={{
                        __html: renderPreview(draft, {
                          channels,
                          users: convo ? [{ id: convo.discordId, displayName: convo.displayName }] : [],
                          roles: [],
                        }),
                      }}
                    />
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTools((v) => !v)}
                    title="Tag a channel, person or role"
                    className={cx('px-2.5 py-2 rounded-lg border text-sm font-bold transition shrink-0',
                      showTools
                        ? 'bg-blue-500/25 border-blue-400/60 text-blue-100'
                        : 'bg-white/[0.03] border-white/10 text-white/50 hover:text-white')}
                  >
                    #@
                  </button>
                  <textarea
                    ref={draftRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={1}
                    placeholder={`Message ${convo?.displayName || ''}…`}
                    className="flex-1 min-w-0 px-3 py-2 bg-black/45 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-sm focus:outline-none resize-none max-h-32"
                    onInput={(e) => {
                      e.target.style.height = 'auto'
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`
                    }}
                  />
                  <button
                    onClick={sendReply}
                    disabled={!draft.trim() || sending || draft.length > MAX_LEN}
                    className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/25 disabled:text-white/40 text-white text-sm font-bold transition shrink-0"
                  >
                    {sending ? '…' : 'Send'}
                  </button>
                </div>

                <div className="flex items-center justify-between mt-1 gap-2">
                  <span className="text-[10px] text-white/30 truncate">
                    Enter to send · Shift+Enter for a new line
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowPreview((v) => !v)}
                      className="text-[10px] font-bold text-blue-300/70 hover:text-blue-200"
                    >
                      {showPreview ? 'Hide preview' : 'Preview'}
                    </button>
                    <span className={cx('text-[10px] font-mono', draft.length > MAX_LEN ? 'text-red-300' : 'text-white/30')}>
                      {draft.length}/{MAX_LEN}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Message({ m, convo, channels }) {
  const out = m.direction === 'out'
  const html = useMemo(
    () => renderPreview(m.content || '', {
      channels,
      // The only user in a DM thread is the person you're talking to.
      users: convo ? [{ id: convo.discordId, displayName: convo.displayName }] : [],
      roles: [],
    }),
    [m.content, channels, convo]
  )

  return (
    <div className={cx('flex gap-2.5', out && 'flex-row-reverse')}>
      {!out && <Avatar src={convo?.avatarUrl} name={convo?.displayName} size="w-8 h-8" />}
      <div className={cx('min-w-0 max-w-[78%]', out && 'items-end flex flex-col')}>
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[11px] font-bold text-white/70">
            {out ? (m.authorName || 'Staff') : (convo?.displayName || 'Member')}
          </span>
          <SourceTag source={m.source} authorName={m.authorName} />
          <span className="text-[10px] text-white/30">
            {m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}
          </span>
        </div>

        <div className={cx('px-3 py-2 rounded-2xl text-sm leading-relaxed break-words',
          out
            ? cx('bg-blue-600/85 text-white rounded-br-sm', m.status === 'failed' && 'bg-red-600/70')
            : 'bg-white/[0.07] text-white/90 rounded-bl-sm')}>
          {m.content
            ? <span dangerouslySetInnerHTML={{ __html: html }} />
            : <span className="italic opacity-60">(no text)</span>}

          {(m.attachments || []).map((a, i) => (
            <div key={i} className="mt-1.5">
              {a.contentType?.startsWith('image/')
                ? <img src={a.url} alt={a.name} className="max-w-full rounded-lg border border-white/15" />
                : <a href={a.url} target="_blank" rel="noreferrer" className="text-xs underline text-blue-200 break-all">
                    📎 {a.name}
                  </a>}
            </div>
          ))}
        </div>

        {out && m.status !== 'sent' && (
          <div className={cx('text-[10px] mt-0.5', m.status === 'failed' ? 'text-red-300' : 'text-white/35')}>
            {m.status === 'queued' ? 'Sending…' : m.error || 'Failed'}
          </div>
        )}
      </div>
    </div>
  )
}
