'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

/**
 * Reusable Discord-style live transcript modal. Polls `messagesUrl` every 4s and
 * renders messages exactly like the Discord chat (avatar, colored name, Bot tag,
 * timestamp, content, embeds, attachments). Used by both tickets and week threads.
 *
 * Props:
 *   title, subtitle  — header text
 *   messagesUrl      — endpoint returning { open, messages:[...] }, supports ?sinceId=
 *   onClose          — close the modal
 *   headerActions    — optional React node rendered in the header (e.g. a Close button)
 *   live             — poll for updates (default true)
 *   downloadUrl      — optional: a "Download HTML" button (self-contained transcript file)
 */
export function DiscordTranscriptModal({ title, subtitle, messagesUrl, onClose, headerActions = null, live = true, downloadUrl = null }) {
  const [messages, setMessages] = useState([])
  const [isOpen, setIsOpen] = useState(true)
  const [loading, setLoading] = useState(true)
  const lastIdRef = useRef(0)
  const scrollRef = useRef(null)

  const poll = useCallback(async () => {
    try {
      const sep = messagesUrl.includes('?') ? '&' : '?'
      const url = lastIdRef.current ? `${messagesUrl}${sep}sinceId=${lastIdRef.current}` : messagesUrl
      const r = await fetch(url, { cache: 'no-store' })
      const d = await r.json()
      if (typeof d.open === 'boolean') setIsOpen(d.open)
      if (Array.isArray(d.messages) && d.messages.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id))
          const merged = [...prev]
          for (const m of d.messages) if (!seen.has(m.id)) merged.push(m)
          return merged
        })
        lastIdRef.current = Math.max(lastIdRef.current, ...d.messages.map((m) => m.id))
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [messagesUrl])

  useEffect(() => {
    poll()
    if (!live) return
    const iv = setInterval(poll, 4000)
    return () => clearInterval(iv)
  }, [poll, live])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-6" onClick={onClose}>
      <div className="bg-[#0b1220] border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] sm:max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-3 sm:p-4 border-b border-white/10 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-black text-white truncate">{title}</h2>
            <div className="text-[10px] font-mono text-white/40 truncate">
              {subtitle} · {isOpen ? <span className="text-green-300">open</span> : <span className="text-white/50">closed</span>}{live ? ' · live' : ''}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {downloadUrl && (
              <a
                href={downloadUrl}
                className="px-3 py-1.5 text-xs font-bold text-blue-100 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/40 rounded"
                aria-label="Download this transcript as an HTML file"
              >
                Download HTML
              </a>
            )}
            {headerActions}
            <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none px-1">×</button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 min-h-[240px] sm:min-h-[300px] bg-[#0a0d16]">
          {loading ? (
            <div className="text-blue-200/60 text-sm">Loading transcript…</div>
          ) : messages.length === 0 ? (
            <div className="text-white/40 text-sm italic text-center py-12">No messages captured yet. The bot mirrors messages as they're sent.</div>
          ) : (
            messages.map((m) => <DiscordMessage key={m.id} m={m} />)
          )}
        </div>

        <div className="p-2 border-t border-white/10 text-center text-[10px] text-white/30">
          {live ? 'Transcript updates live every few seconds.' : 'Saved transcript.'}
        </div>
      </div>
    </div>
  )
}

export function DiscordMessage({ m }) {
  const time = m.createdAt ? new Date(m.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
  const color = m.authorColor || (m.isBot ? '#5865F2' : '#dbe1ff')
  return (
    <div className="flex gap-3 items-start hover:bg-white/[0.02] px-2 py-1 rounded">
      {m.authorAvatar ? (
        <img src={m.authorAvatar} alt="" className="w-9 h-9 rounded-full flex-shrink-0 bg-white/5" />
      ) : (
        <div className="w-9 h-9 rounded-full flex-shrink-0 bg-blue-500/30 flex items-center justify-center text-xs font-bold text-white">
          {(m.authorDisplay || '?').charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm" style={{ color }}>{m.authorDisplay || m.authorUsername || 'Unknown'}</span>
          {m.isBot && <span className="text-[8px] uppercase font-bold tracking-wider px-1 py-0.5 rounded bg-[#5865F2] text-white">Bot</span>}
          <span className="text-[10px] text-white/30">{time}</span>
        </div>
        {m.content && <div className="text-sm text-white/85 whitespace-pre-wrap break-words">{m.content}</div>}
        {(m.embeds || []).map((e, i) => (
          <div key={i} className="mt-1 border-l-2 border-blue-400/50 pl-2 py-1 bg-white/[0.03] rounded-r">
            {e.title && <div className="text-xs font-bold text-blue-200">{e.title}</div>}
            {e.description && <div className="text-xs text-white/70 whitespace-pre-wrap">{e.description}</div>}
          </div>
        ))}
        {(m.attachments || []).map((a, i) => {
          // Saved copy first: Discord's own attachment links expire within a day.
          const src = a.fileId ? `/api/admin/transcripts/file/${a.fileId}` : a.url
          return (
            <a key={i} href={src} target="_blank" rel="noreferrer" className="block mt-1">
              {a.contentType && a.contentType.startsWith('image/') ? (
                <img src={src} alt={a.name} className="max-h-48 rounded border border-white/10" />
              ) : (
                <span className="text-xs text-blue-300 underline">📎 {a.name}</span>
              )}
            </a>
          )
        })}
      </div>
    </div>
  )
}
