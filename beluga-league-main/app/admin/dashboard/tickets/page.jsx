'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { DiscordTranscriptModal } from '../../../components/DiscordTranscript'
import Avatar from '../../../components/Avatar'

export default function TicketsPage() {
  const [data, setData] = useState({ openTickets: [], pendingRequests: [], closedTickets: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [openTicket, setOpenTicket] = useState(null) // { channelId, channelName }
  const [busy, setBusy] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/admin/tickets', { cache: 'no-store' })
      const d = await r.json()
      setData(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  async function deleteRequest(id) {
    if (!confirm('Cancel this pending ticket request?')) return
    setBusy(`r:${id}`)
    await fetch(`/api/admin/ticket-requests/${id}`, { method: 'DELETE', cache: 'no-store' })
    setBusy(null)
    reload()
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
          <h1 className="text-3xl font-black text-white mb-2">Tickets</h1>
          <p className="text-blue-100/60 text-sm">
            Currently-open tickets the bot is tracking, plus pending ticket requests created from this admin panel.
            View a ticket to see its live transcript and close it.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 text-sm font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded-lg">
          + New ticket request
        </button>
      </div>

      {error && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}

      {loading ? (
        <div className="text-blue-200/60">Loading…</div>
      ) : (
        <>
          <Section title={`Open Tickets (${data.openTickets.length})`}>
            {data.openTickets.length === 0 ? (
              <Empty>No open tickets.</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-black/30">
                  <tr className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
                    <th className="px-3 py-2 text-left">Channel</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                    <th className="px-3 py-2 text-left">Created By</th>
                    <th className="px-3 py-2 text-left">Participants</th>
                    <th className="px-3 py-2 text-left">Opened</th>
                    <th className="px-3 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.openTickets.map((t) => (
                    <tr key={t.channelId} className="border-t border-white/5 hover:bg-white/[0.04] cursor-pointer" onClick={() => setOpenTicket({ channelId: t.channelId, channelName: t.channelName })}>
                      <td className="px-3 py-1.5 text-white">
                        <div className="truncate max-w-[180px]">{t.channelName || '—'}</div>
                        <div className="text-[10px] font-mono text-white/30">{t.channelId}</div>
                      </td>
                      <td className="px-3 py-1.5 text-blue-200/80 truncate max-w-[160px]">{t.reason || '—'}</td>
                      <td className="px-3 py-1.5 text-white/80 truncate max-w-[140px]">{t.createdByUsername || t.createdBy}</td>
                      <td className="px-3 py-1.5 text-white/60 text-[11px]">{(t.userIds || []).length} user{(t.userIds || []).length === 1 ? '' : 's'}</td>
                      <td className="px-3 py-1.5 text-white/40 text-[10px]">{t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenTicket({ channelId: t.channelId, channelName: t.channelName }) }}
                          className="px-2 py-1 text-[10px] uppercase font-bold text-blue-200 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 rounded"
                        >
                          View / Close
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title={`Closed Tickets (${(data.closedTickets || []).length})`}>
            {(data.closedTickets || []).length === 0 ? (
              <Empty>No closed tickets yet. When a ticket is closed, its saved transcript appears here.</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-black/30">
                  <tr className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
                    <th className="px-3 py-2 text-left">Channel</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                    <th className="px-3 py-2 text-left">Opened By</th>
                    <th className="px-3 py-2 text-left">Closed By</th>
                    <th className="px-3 py-2 text-center">Msgs</th>
                    <th className="px-3 py-2 text-left">Closed</th>
                    <th className="px-3 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {(data.closedTickets || []).map((t) => (
                    <tr key={t.channelId} className="border-t border-white/5 hover:bg-white/[0.04] cursor-pointer opacity-90" onClick={() => setOpenTicket({ channelId: t.channelId, channelName: t.channelName })}>
                      <td className="px-3 py-1.5 text-white">
                        <div className="truncate max-w-[180px]">{t.channelName || '—'}</div>
                        <div className="text-[10px] font-mono text-white/30">{t.channelId}</div>
                      </td>
                      <td className="px-3 py-1.5 text-blue-200/80 truncate max-w-[140px]">{t.reason || '—'}</td>
                      <td className="px-3 py-1.5 text-white/70 truncate max-w-[120px]">{t.openedByUsername || '—'}</td>
                      <td className="px-3 py-1.5 text-white/70 truncate max-w-[120px]">{t.closedByUsername || '—'}</td>
                      <td className="px-3 py-1.5 text-center text-white/60">{t.messageCount ?? '—'}</td>
                      <td className="px-3 py-1.5 text-white/40 text-[10px]">{t.closedAt ? new Date(t.closedAt).toLocaleString() : '—'}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenTicket({ channelId: t.channelId, channelName: t.channelName }) }}
                          className="px-2 py-1 text-[10px] uppercase font-bold text-blue-200 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 rounded"
                        >
                          View transcript
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            if (!confirm(`Permanently delete the saved transcript for "${t.channelName}"?`)) return
                            await fetch(`/api/admin/transcripts?ticket=${encodeURIComponent(t.channelId)}`, { method: 'DELETE' })
                            reload()
                          }}
                          className="ml-1.5 px-2 py-1 text-[10px] uppercase font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title={`Pending Requests (${data.pendingRequests.length})`}>
            {data.pendingRequests.length === 0 ? (
              <Empty>No pending requests. Use "+ New ticket request" above to queue one for the bot.</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-black/30">
                  <tr className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
                    <th className="px-3 py-2 text-left">Target</th>
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                    <th className="px-3 py-2 text-left">Requested By</th>
                    <th className="px-3 py-2 text-left">Queued</th>
                    <th className="px-3 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.pendingRequests.map((r) => (
                    <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.04]">
                      <td className="px-3 py-1.5 text-blue-200 uppercase text-[10px] font-bold">{r.targetKind}</td>
                      <td className="px-3 py-1.5 text-white font-mono text-[11px]">{r.targetId}</td>
                      <td className="px-3 py-1.5 text-white/80 truncate max-w-[200px]">{r.reason || '—'}</td>
                      <td className="px-3 py-1.5 text-white/80 truncate max-w-[140px]">{r.requestedByUsername || '—'}</td>
                      <td className="px-3 py-1.5 text-white/40 text-[10px]">{r.requestedAt ? new Date(r.requestedAt).toLocaleString() : '—'}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={() => deleteRequest(r.id)}
                          disabled={busy === `r:${r.id}`}
                          className="px-2 py-1 text-[10px] uppercase font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}

      {showCreate && <CreateRequestModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); reload() }} />}
      {openTicket && <TranscriptModal ticket={openTicket} onClose={() => setOpenTicket(null)} onClosed={() => { setOpenTicket(null); reload() }} />}
    </div>
  )
}

function TranscriptModal({ ticket, onClose, onClosed }) {
  const [isOpen, setIsOpen] = useState(true)
  const [closing, setClosing] = useState(false)
  const [closeQueued, setCloseQueued] = useState(false)

  // Track open/closed by peeking the messages endpoint's `open` flag once.
  useEffect(() => {
    fetch(`/api/admin/tickets/${encodeURIComponent(ticket.channelId)}/messages`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setIsOpen(!!d.open))
      .catch(() => {})
  }, [ticket.channelId])

  async function closeTicket() {
    if (!confirm('Close this ticket? The bot will save the final transcript and delete the Discord channel — exactly like /close.')) return
    setClosing(true)
    await fetch(`/api/admin/tickets/${encodeURIComponent(ticket.channelId)}/close`, { method: 'POST', cache: 'no-store' })
    setClosing(false)
    setCloseQueued(true)
  }

  const headerActions = (
    <>
      {isOpen && !closeQueued && (
        <button onClick={closeTicket} disabled={closing} className="px-3 py-1.5 text-xs font-bold text-red-200 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 rounded">
          {closing ? 'Queuing…' : 'Close ticket'}
        </button>
      )}
      {closeQueued && <span className="text-xs text-yellow-300">Close queued — bot processing…</span>}
    </>
  )

  return (
    <DiscordTranscriptModal
      title={ticket.channelName || 'Ticket'}
      subtitle={ticket.channelId}
      messagesUrl={`/api/admin/tickets/${encodeURIComponent(ticket.channelId)}/messages`}
      onClose={onClose}
      headerActions={headerActions}
    />
  )
}

function Section({ title, children }) {
  return (
    <section className="mb-6 rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
      <div className="px-4 py-2 border-b border-white/10 bg-black/30">
        <h2 className="text-sm font-black text-white tracking-wide">{title}</h2>
      </div>
      <div>{children}</div>
    </section>
  )
}

function Empty({ children }) {
  return <div className="p-8 text-center text-sm text-white/40">{children}</div>
}

function CreateRequestModal({ onClose, onCreated }) {
  const [targetKind, setTargetKind] = useState('user')
  const [reason, setReason] = useState('')
  // Selected target resolves to a Discord ID; `picked` holds the friendly label.
  const [picked, setPicked] = useState(null) // { id, label, sub, avatarUrl, color }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  function resetPick() { setPicked(null) }

  async function submit() {
    if (!picked?.id) { setErr(`Pick a ${targetKind} first`); return }
    setBusy(true); setErr(null)
    const r = await fetch('/api/admin/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ targetKind, targetId: picked.id, reason: reason.trim() || null }),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setErr(d.error || 'Failed'); setBusy(false); return
    }
    onCreated()
  }

  return (
    <Modal onClose={onClose} title="New ticket request">
      <div className="space-y-3">
        {err && <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{err}</div>}
        <div className="text-xs text-blue-100/60">
          Queue a ticket for the bot. Search by name — the bot creates the Discord channel and it appears in open tickets.
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Open ticket for</label>
          <div className="flex gap-1.5">
            {['user', 'role'].map((k) => (
              <button
                key={k}
                onClick={() => { setTargetKind(k); resetPick() }}
                className={`flex-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded border transition ${
                  targetKind === k
                    ? 'bg-blue-500/20 border-blue-400/50 text-blue-100'
                    : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                {k === 'user' ? 'A user' : 'A role'}
              </button>
            ))}
          </div>
        </div>

        {picked ? (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-400/30">
            {targetKind === 'user' ? (
              <Avatar src={picked.avatarUrl} name={picked.label} size={36} />
            ) : (
              <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: picked.color || '#5865F2' }} />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-white truncate">{picked.label}</div>
              {picked.sub && <div className="text-[10px] text-white/50 truncate">{picked.sub}</div>}
            </div>
            <button onClick={resetPick} className="text-[10px] uppercase font-bold text-white/60 hover:text-white px-2 py-1 bg-white/5 rounded">Change</button>
          </div>
        ) : (
          <TargetPicker kind={targetKind} onPick={setPicked} />
        )}

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">Reason</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="optional"
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded">Cancel</button>
          <button onClick={submit} disabled={busy || !picked} className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded">{busy ? 'Queueing…' : 'Queue request'}</button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Type-ahead picker. For users it debounces a search against the Discord member
 * mirror and shows a "do you mean?" dropdown. For roles it loads the server's
 * roles once and filters client-side.
 */
function TargetPicker({ kind, onPick }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [allRoles, setAllRoles] = useState(null)
  const debounceRef = useRef(null)

  // Load roles once when in role mode.
  useEffect(() => {
    if (kind !== 'role') return
    let cancelled = false
    setLoading(true)
    fetch('/api/admin/discord?kind=role', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setAllRoles(d.results || []); setResults(d.results || []) } })
      .catch(() => { if (!cancelled) setAllRoles([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [kind])

  // User search (debounced) / role client-filter.
  useEffect(() => {
    if (kind === 'role') {
      const term = q.trim().toLowerCase()
      setResults(!term ? (allRoles || []) : (allRoles || []).filter((r) => (r.name || '').toLowerCase().includes(term)))
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/discord?kind=user&q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })
        const d = await r.json()
        setResults(d.results || [])
      } catch { setResults([]) } finally { setLoading(false) }
    }, 220)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [q, kind, allRoles])

  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-blue-300/70 mb-1">
        {kind === 'user' ? 'Search by name' : 'Pick a role'}
      </label>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={kind === 'user' ? 'Start typing a display name…' : 'Filter roles…'}
        autoFocus
        className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-400/60"
      />
      <div className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-black/30 divide-y divide-white/5">
        {loading && <div className="px-3 py-2 text-xs text-white/40">Searching…</div>}
        {!loading && kind === 'user' && !q.trim() && (
          <div className="px-3 py-2 text-xs text-white/40">Type a name to find the user.</div>
        )}
        {!loading && results.length === 0 && (kind === 'role' || q.trim()) && (
          <div className="px-3 py-2 text-xs text-white/40">No {kind === 'user' ? 'members' : 'roles'} match.</div>
        )}
        {results.map((item) =>
          kind === 'user' ? (
            <button
              key={item.id}
              onClick={() => onPick({ id: item.id, label: item.displayName || item.username || item.id, sub: item.username ? `@${item.username}${item.inGuild === false ? ' · left server' : ''}` : (item.inGuild === false ? 'left server' : null), avatarUrl: item.avatarUrl })}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-blue-500/10"
            >
              <Avatar src={item.avatarUrl} name={item.displayName} size={30} ring={false} />
              <div className="min-w-0">
                <div className="text-sm text-white truncate">{item.displayName || item.username}</div>
                {item.username && <div className="text-[10px] text-white/40 truncate">@{item.username}</div>}
              </div>
              {item.inGuild === false && <span className="ml-auto text-[9px] uppercase text-amber-300/80">left</span>}
            </button>
          ) : (
            <button
              key={item.id}
              onClick={() => onPick({ id: item.id, label: item.name, sub: `Role · position ${item.position}`, color: item.color })}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-blue-500/10"
            >
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: item.color || '#99aab5' }} />
              <span className="text-sm text-white truncate">{item.name}</span>
            </button>
          )
        )}
      </div>
    </div>
  )
}

function Modal({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-[#0b1220] border border-white/10 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-black text-white">{title}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
