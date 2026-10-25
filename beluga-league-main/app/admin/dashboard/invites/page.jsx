'use client'

// Admin → Invites. Everything about the invite campaign in one place: the review
// queue, every invite record, /claim-invite claims, manual adjustments, invite-code
// tagging (general links), the campaign itself and the live-board settings.
//
// Staff decisions here always win: any record staff touch is locked against the
// bot's automation. Anything that has to be SAID in Discord (the "your invitee
// registered" ping, claim results, the end-of-campaign post) is queued for the bot.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Avatar from '../../../components/Avatar'
import PlayerPicker from '../../../components/PlayerPicker'

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) } }
  catch { return { ok: res.ok, status: res.status, data: text } }
}
const act = (body) => api('/api/admin/invites', 'POST', body)
const view = (v, params = {}) => api(`/api/admin/invites?${new URLSearchParams({ view: v, ...params })}`)

const TABS = [
  ['overview', 'Overview'],
  ['queue', 'Review queue'],
  ['all', 'All invites'],
  ['claims', 'Claims'],
  ['adjust', 'Adjust'],
  ['codes', 'Invite codes'],
  ['campaign', 'Campaign'],
  ['settings', 'Settings'],
]

const STATUS_STYLE = {
  counted: 'bg-green-500/15 text-green-200 border-green-400/30',
  pending_review: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
  claimable: 'bg-cyan-500/15 text-cyan-200 border-cyan-400/30',
  tracked: 'bg-white/10 text-white/60 border-white/20',
  unattributed: 'bg-white/5 text-white/50 border-white/15',
  rejected: 'bg-red-500/15 text-red-200 border-red-400/30',
}
const STATUS_TEXT = { tracked: 'Not registered', counted: 'Counted', pending_review: 'Needs review', claimable: 'Claimable', unattributed: 'No inviter', rejected: 'Rejected' }
const SOURCES = ['invite', 'vanity', 'discovery', 'general', 'bot_invite', 'oauth', 'integration', 'manual', 'unknown']
const FLAGS = ['new_account', 'rejoiner', 'self_invite', 'ambiguous', 'inviter_left', 'disagreement', 'unverified', 'sheet_only']

function fmt(d, withTime = true) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', withTime
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}
function ageDays(created, at) {
  if (!created) return null
  return Math.floor((new Date(at || Date.now()) - new Date(created)) / 86400000)
}
function toLocalInput(d) {
  if (!d) return ''
  const dt = new Date(d)
  const off = dt.getTimezoneOffset() * 60000
  return new Date(dt - off).toISOString().slice(0, 16)
}

function Person({ p, size = 24, muted = false }) {
  if (!p) return <span className="text-white/35 text-xs italic">nobody</span>
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 align-middle">
      <Avatar src={p.avatarUrl} name={p.name} size={size} ring={false} className="flex-shrink-0" />
      <span className={`truncate ${muted ? 'text-white/60' : 'text-white'} text-sm`}>{p.name}</span>
      {p.inGuild === false && <span className="text-[9px] uppercase font-bold text-red-300/80">left</span>}
    </span>
  )
}

function StatusBadge({ status }) {
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded border whitespace-nowrap ${STATUS_STYLE[status] || STATUS_STYLE.tracked}`}>{STATUS_TEXT[status] || status}</span>
}

function Flags({ flags }) {
  if (!flags?.length) return null
  return (
    <ul className="space-y-0.5">
      {flags.map((f) => (
        <li key={f.key} className="text-xs text-amber-200/90 flex gap-1.5"><span aria-hidden>•</span>{f.text}</li>
      ))}
    </ul>
  )
}

function Card({ children, className = '', ...rest }) {
  return <div className={`p-4 sm:p-5 rounded-2xl bg-white/[0.03] border border-white/10 ${className}`} {...rest}>{children}</div>
}

function Btn({ children, tone = 'default', className = '', ...rest }) {
  const tones = {
    default: 'bg-white/5 text-white/80 border-white/15 hover:bg-white/10',
    primary: 'bg-cyan-500/20 text-cyan-100 border-cyan-400/40 hover:bg-cyan-500/30',
    good: 'bg-green-500/20 text-green-100 border-green-400/40 hover:bg-green-500/30',
    danger: 'bg-red-500/20 text-red-100 border-red-400/40 hover:bg-red-500/30',
  }
  return <button type="button" className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition disabled:opacity-40 ${tones[tone]} ${className}`} {...rest}>{children}</button>
}

/** A picked person with a clear button, or the search box. */
function PersonField({ value, onChange, placeholder }) {
  if (value) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-black/40 border border-white/10">
        <Avatar src={value.avatarUrl} name={value.displayName} size={22} ring={false} />
        <span className="flex-1 text-xs text-white truncate">{value.displayName}</span>
        <button type="button" aria-label="Clear selection" onClick={() => onChange(null)} className="text-white/40 hover:text-white text-xs">✕</button>
      </div>
    )
  }
  return <PlayerPicker onPick={onChange} placeholder={placeholder} />
}

// ── tabs ──────────────────────────────────────────────────────────────────────

function OverviewTab({ onOpen }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { view('overview').then((r) => (r.ok ? setD(r.data) : setErr(r.data?.error || 'Failed to load'))) }, [])
  if (err) return <div className="text-red-200 text-sm">{err}</div>
  if (!d) return <div className="text-white/50 text-sm">Loading…</div>
  const h = d.settings?.health
  const t = d.totals || {}
  const tiles = [
    ['Counted (in server)', t.counted],
    ['Needs review', t.pending],
    ['Claimable', t.claimable],
    ['Pending claims', t.pendingClaims],
    ['Not registered yet', t.tracked],
    ['No inviter', t.unattributed],
  ]
  const Top = ({ title, rows }) => (
    <Card>
      <div className="text-[11px] uppercase tracking-wider font-bold text-blue-300/70 mb-3">{title}</div>
      {rows.length === 0 ? <div className="text-xs text-white/40 italic">Nobody yet.</div> : (
        <ol className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.discordId} className="flex items-center gap-2">
              <span className="w-5 text-xs text-white/40 font-bold text-right">{r.rank}</span>
              <span className="flex-1 min-w-0"><Person p={r} /></span>
              <span className="font-mono font-bold text-cyan-200">{r.total}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
  return (
    <div className="space-y-4" data-log-section="Invites · overview">
      <div className="grid sm:grid-cols-2 gap-3">
        <Card>
          <div className="text-[11px] uppercase tracking-wider font-bold text-blue-300/70">Active campaign</div>
          <div className="text-xl font-black text-white mt-1">{d.campaign?.name || 'None'}</div>
          <div className="text-xs text-white/50 mt-1">
            Started {fmt(d.campaign?.startsAt, false)}{d.campaign?.endsAt ? ` · ends ${fmt(d.campaign.endsAt)}` : ' · no end date'} · last reset {d.lastReset ? fmt(d.lastReset, false) : 'never'}
          </div>
          {d.campaign?.prize && <div className="text-xs text-cyan-100/80 mt-1">Prize: {d.campaign.prize}</div>}
        </Card>
        <Card>
          <div className="text-[11px] uppercase tracking-wider font-bold text-blue-300/70">Discord join data</div>
          <div className="flex items-center gap-2 mt-2">
            <span className={`h-2.5 w-2.5 rounded-full ${h?.ok === false ? 'bg-red-400' : h?.ok ? 'bg-green-400' : 'bg-white/30'}`} />
            <span className="text-sm text-white">{h?.ok === false ? 'Unavailable — using the backup invite count' : h?.ok ? 'Working' : 'Not checked yet'}</span>
          </div>
          <div className="text-xs text-white/40 mt-1">
            {h?.at ? `Last change ${fmt(h.at)}` : ''}{d.settings?.last_reconcile_at ? ` · last sweep ${fmt(d.settings.last_reconcile_at)}` : ''}
          </div>
          {h?.ok === false && h.error && <div className="text-xs text-red-200/80 mt-1">{h.error}</div>}
        </Card>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {tiles.map(([label, n]) => (
          <div key={label} className="p-3 rounded-xl bg-white/[0.03] border border-white/10">
            <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
            <div className="text-2xl font-black text-white">{n ?? 0}</div>
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Top title={`${d.campaign?.name || 'Campaign'} — top 10`} rows={d.campaignTop || []} />
        <Top title="Lifetime — top 10" rows={d.lifetimeTop || []} />
      </div>
      {t.pending > 0 && <Btn tone="primary" onClick={() => onOpen('queue')}>Open the review queue ({t.pending})</Btn>}
    </div>
  )
}

function QueueItem({ item, onDone, onDetail }) {
  const [busy, setBusy] = useState(false)
  const [other, setOther] = useState(null)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState(null)
  const run = async (body) => {
    setBusy(true); setMsg(null)
    const r = await act({ inviteeId: item.invitee.discordId, note: note || undefined, ...body })
    setBusy(false)
    if (!r.ok) return setMsg(r.data?.error || 'Failed')
    onDone()
  }
  const age = ageDays(item.accountCreatedAt, item.joinedAt)
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap"><Person p={item.invitee} size={28} /><StatusBadge status={item.status} /></div>
          <div className="text-xs text-white/50">
            Registered {fmt(item.registeredAt)} · joined {fmt(item.joinedAt)}{age != null ? ` · account ${age} day${age === 1 ? '' : 's'} old` : ''}{item.joinCount > 1 ? ` · join #${item.joinCount}` : ''}
          </div>
        </div>
        <Btn onClick={() => onDetail(item.invitee.discordId)}>History</Btn>
      </div>
      <div className="grid sm:grid-cols-2 gap-2 text-xs">
        <div className="p-2 rounded bg-white/5">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Credit would go to</div>
          <Person p={item.inviter} />
          <div className="text-white/40 mt-1">{item.sourceText}{item.inviteCode ? ` · ${item.inviteCode}` : ''}</div>
        </div>
        <div className="p-2 rounded bg-white/5">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">The two sources</div>
          <div className="flex items-center gap-2 flex-wrap"><span className="text-white/40 w-24">Discord&apos;s data:</span><Person p={item.discordInviter} muted /></div>
          <div className="flex items-center gap-2 flex-wrap mt-1"><span className="text-white/40 w-24">Invite count:</span>{item.diffResult === 'match' ? <Person p={item.diffInviter} muted /> : <span className="text-white/50">{item.diffResult === 'ambiguous' ? 'could not tell' : 'no match'}</span>}</div>
          {item.diffCode && <div className="text-white/40 mt-1">Invite count saw code {item.diffCode}</div>}
        </div>
      </div>
      <div><div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Why it is here</div><Flags flags={item.flags} /></div>
      {item.pendingClaims > 0 && <div className="text-xs text-cyan-200">{item.pendingClaims} pending claim(s) on this member — see Claims.</div>}
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Decision note"
          className="px-2.5 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-blue-400/60" />
        <PersonField value={other} onChange={setOther} placeholder="…or credit someone else" />
      </div>
      <div className="flex flex-wrap gap-2">
        {item.inviter && !other && <Btn tone="good" disabled={busy} onClick={() => run({ action: 'approve' })}>Approve for {item.inviter.name}</Btn>}
        {other && <Btn tone="good" disabled={busy} onClick={() => run({ action: 'approve', inviterId: other.discordId })}>Credit {other.displayName}</Btn>}
        <Btn tone="danger" disabled={busy} onClick={() => run({ action: 'reject' })}>Reject</Btn>
        <Btn disabled={busy} onClick={() => run({ action: 'no-inviter' })}>No inviter</Btn>
      </div>
      {msg && <div className="text-xs text-red-200">{msg}</div>}
    </Card>
  )
}

function ClaimRow({ c, onDone, onDetail }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState(null)
  const run = async (action) => {
    setBusy(true); setMsg(null)
    const r = await act({ action, claimId: c.id, note: note || undefined })
    setBusy(false)
    if (!r.ok) return setMsg(r.data?.error || 'Failed')
    onDone()
  }
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Person p={c.claimer} /><span className="text-white/50">says they invited</span><Person p={c.invitee} />
        {c.status !== 'pending' && <span className="text-[10px] font-bold uppercase text-white/50">{c.status}{c.decidedBy ? ` by ${c.decidedBy}` : ''}</span>}
      </div>
      <div className="text-xs text-white/45">
        Filed {fmt(c.createdAt)}
        {c.invite ? ` · ${c.invite.statusText}${c.invite.registeredAt ? `, registered ${fmt(c.invite.registeredAt, false)}` : ''} · ${c.invite.sourceText}` : ''}
        {c.note ? ` · ${c.note}` : ''}
      </div>
      {c.status === 'pending' && (
        <div className="flex flex-wrap gap-2 items-center">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason if rejecting (shown in the invite channel)" aria-label="Rejection reason"
            className="flex-1 min-w-[12rem] px-2.5 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-blue-400/60" />
          <Btn tone="good" disabled={busy} onClick={() => run('claim-approve')}>Approve</Btn>
          <Btn tone="danger" disabled={busy} onClick={() => run('claim-reject')}>Reject</Btn>
          <Btn onClick={() => onDetail(c.invitee.discordId)}>History</Btn>
        </div>
      )}
      {msg && <div className="text-xs text-red-200">{msg}</div>}
    </Card>
  )
}

function QueueTab({ onDetail }) {
  const [d, setD] = useState(null)
  const load = useCallback(() => view('queue').then((r) => r.ok && setD(r.data)), [])
  useEffect(() => { load() }, [load])
  if (!d) return <div className="text-white/50 text-sm">Loading…</div>
  const items = Array.isArray(d.items) ? d.items : []
  const claims = Array.isArray(d.claims) ? d.claims : []
  return (
    <div className="space-y-6" data-log-section="Invites · review queue">
      <section className="space-y-3">
        <h2 className="text-lg font-black text-white">Flagged invites ({items.length})</h2>
        {items.length === 0 && <div className="text-sm text-white/40 italic">Nothing waiting. Flagged invites land here when the member registers.</div>}
        {items.map((it) => <QueueItem key={it.invitee.discordId} item={it} onDone={load} onDetail={onDetail} />)}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-black text-white">Pending claims ({claims.length})</h2>
        {claims.length === 0 && <div className="text-sm text-white/40 italic">No pending /claim-invite claims.</div>}
        {claims.map((c) => <ClaimRow key={c.id} c={c} onDone={load} onDetail={onDetail} />)}
      </section>
    </div>
  )
}

function AllTab({ onDetail }) {
  const [filters, setFilters] = useState({ q: '', status: '', source: '', flag: '' })
  const [applied, setApplied] = useState(filters)
  const [offset, setOffset] = useState(0)
  const [d, setD] = useState(null)
  useEffect(() => {
    setD(null)
    view('invites', { ...applied, offset: String(offset), limit: '50' }).then((r) => r.ok && setD(r.data))
  }, [applied, offset])
  const items = Array.isArray(d?.items) ? d.items : []
  const sel = 'px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none'
  return (
    <div className="space-y-3" data-log-section="Invites · all records">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setOffset(0); setApplied(filters) }}>
        <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Name, Discord ID or invite code" aria-label="Search invites"
          className="flex-1 min-w-[12rem] px-2.5 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-blue-400/60" />
        <select aria-label="Filter by status" className={sel} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Any status</option>
          {Object.entries(STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Filter by source" className={sel} value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
          <option value="">Any source</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Filter by flag" className={sel} value={filters.flag} onChange={(e) => setFilters({ ...filters, flag: e.target.value })}>
          <option value="">Any flag</option>
          {FLAGS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Btn tone="primary" type="submit">Search</Btn>
      </form>
      {!d ? <div className="text-white/50 text-sm">Loading…</div> : (
        <>
          <div className="text-xs text-white/40">{d.total} record(s)</div>
          <div className="space-y-1.5">
            {items.map((it) => (
              <button key={it.invitee.discordId} type="button" onClick={() => onDetail(it.invitee.discordId)}
                aria-label={`Open invite record for ${it.invitee.name}`}
                className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10 hover:border-blue-400/30">
                <span className="min-w-0 flex-1 basis-40"><Person p={it.invitee} /></span>
                <span className="text-xs text-white/40">←</span>
                <span className="min-w-0 flex-1 basis-40"><Person p={it.inviter} muted /></span>
                <span className="text-[11px] text-white/45 basis-28">{it.sourceText}</span>
                <StatusBadge status={it.status} />
                {it.adminLocked && <span className="text-[9px] uppercase font-bold text-cyan-300/80">staff</span>}
                {!it.inGuild && <span className="text-[9px] uppercase font-bold text-red-300/80">left</span>}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Btn disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>◀ Prev</Btn>
            <Btn disabled={offset + 50 >= d.total} onClick={() => setOffset(offset + 50)}>Next ▶</Btn>
          </div>
        </>
      )}
    </div>
  )
}

function ClaimsTab({ onDetail }) {
  const [status, setStatus] = useState('pending')
  const [claims, setClaims] = useState(null)
  const load = useCallback(() => { setClaims(null); view('claims', { status }).then((r) => r.ok && setClaims(Array.isArray(r.data.claims) ? r.data.claims : [])) }, [status])
  useEffect(() => { load() }, [load])
  return (
    <div className="space-y-3" data-log-section="Invites · claims">
      <div className="inline-flex rounded-xl overflow-hidden border border-white/10 bg-black/30">
        {['pending', 'approved', 'rejected', 'all'].map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={`px-4 py-1.5 text-xs font-bold capitalize ${status === s ? 'bg-blue-500 text-white' : 'text-white/60 hover:text-white'}`}>{s}</button>
        ))}
      </div>
      {!claims ? <div className="text-white/50 text-sm">Loading…</div> : claims.length === 0
        ? <div className="text-sm text-white/40 italic">No {status === 'all' ? '' : status} claims.</div>
        : claims.map((c) => <ClaimRow key={c.id} c={c} onDone={load} onDetail={onDetail} />)}
    </div>
  )
}

function AdjustTab() {
  const [who, setWho] = useState(null)
  const [delta, setDelta] = useState('1')
  const [scope, setScope] = useState('both')
  const [reason, setReason] = useState('')
  const [invitee, setInvitee] = useState(null)
  const [inviter, setInviter] = useState(null)
  const [aScope, setAScope] = useState('both')
  const [announce, setAnnounce] = useState(false)
  const [aNote, setANote] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState([])
  const loadRecent = useCallback(() => view('campaigns').then((r) => r.ok && setRecent(Array.isArray(r.data.adjustments) ? r.data.adjustments : [])), [])
  useEffect(() => { loadRecent() }, [loadRecent])
  const input = 'px-2.5 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-blue-400/60'

  const adjust = async () => {
    setBusy(true); setMsg(null)
    const r = await act({ action: 'adjust', inviterId: who?.discordId, delta, scope, reason })
    setBusy(false)
    if (!r.ok) return setMsg({ bad: true, text: r.data?.error || 'Failed' })
    setMsg({ text: `Adjusted ${who.displayName} by ${delta}.` }); setReason(''); loadRecent()
  }
  const assign = async () => {
    setBusy(true); setMsg(null)
    const r = await act({ action: 'assign', inviteeId: invitee?.discordId, inviterId: inviter?.discordId, scope: aScope, announce, note: aNote || undefined })
    setBusy(false)
    if (!r.ok) return setMsg({ bad: true, text: r.data?.error || 'Failed' })
    setMsg({ text: `${invitee.displayName} is now credited to ${inviter.displayName}.${r.data?.warning ? ` ${r.data.warning}` : ''}` })
    setInvitee(null); setANote('')
  }
  return (
    <div className="space-y-4">
      {msg && <div className={`text-sm p-2 rounded border ${msg.bad ? 'text-red-200 bg-red-500/10 border-red-500/30' : 'text-green-200 bg-green-500/10 border-green-500/30'}`}>{msg.text}</div>}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="space-y-3" data-log-section="Invites · credit a member">
          <div>
            <h2 className="text-base font-black text-white">Credit a member to an inviter</h2>
            <p className="text-xs text-white/50">Works even if they are already credited to someone else — staff decisions always win and lock the record.</p>
          </div>
          <label className="block text-[11px] text-white/50">Invited member<PersonField value={invitee} onChange={setInvitee} placeholder="Who was invited…" /></label>
          <label className="block text-[11px] text-white/50">Gets the credit<PersonField value={inviter} onChange={setInviter} placeholder="Who invited them…" /></label>
          <select aria-label="What the credit counts toward" className={`${input} w-full`} value={aScope} onChange={(e) => setAScope(e.target.value)}>
            <option value="both">Current campaign + lifetime</option>
            <option value="lifetime">Lifetime only</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-white/70">
            <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} aria-label="Announce in the invite channel" />
            Post the &quot;your invitee registered&quot; message (only if it was never posted)
          </label>
          <input value={aNote} onChange={(e) => setANote(e.target.value)} placeholder="Note (optional)" aria-label="Credit note" className={`${input} w-full`} />
          <Btn tone="good" disabled={busy || !invitee || !inviter} onClick={assign}>Credit member</Btn>
        </Card>
        <Card className="space-y-3" data-log-section="Invites · adjust a count">
          <div>
            <h2 className="text-base font-black text-white">Adjust a count</h2>
            <p className="text-xs text-white/50">Add or remove invites without a specific member — e.g. a correction or a bonus.</p>
          </div>
          <label className="block text-[11px] text-white/50">Member<PersonField value={who} onChange={setWho} placeholder="Whose count…" /></label>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} aria-label="Amount (negative to remove)" className={input} />
            <select aria-label="What the adjustment affects" className={input} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="both">Campaign + lifetime</option>
              <option value="lifetime">Lifetime only</option>
              <option value="campaign">Campaign only</option>
            </select>
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Adjustment reason" className={`${input} w-full`} />
          <Btn tone="primary" disabled={busy || !who || !reason.trim()} onClick={adjust}>Apply adjustment</Btn>
        </Card>
      </div>
      <Card>
        <div className="text-[11px] uppercase tracking-wider font-bold text-blue-300/70 mb-2">Recent adjustments</div>
        {recent.length === 0 ? <div className="text-xs text-white/40 italic">None yet.</div> : (
          <ul className="space-y-1.5">
            {recent.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
                <Person p={a.inviter} size={20} />
                <span className={`font-mono font-bold ${a.delta > 0 ? 'text-green-300' : 'text-red-300'}`}>{a.delta > 0 ? '+' : ''}{a.delta}</span>
                <span className="text-white/40">{a.scope}</span>
                <span className="text-white/60 flex-1 min-w-0 truncate">{a.reason}</span>
                <span className="text-white/35">{a.actor} · {fmt(a.at, false)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function CodeRow({ c, onSaved }) {
  const [label, setLabel] = useState(c.label || '')
  const [busy, setBusy] = useState(false)
  const save = async (isGeneral) => {
    setBusy(true)
    const r = await act({ action: 'tag-code', code: c.code, isGeneral, label })
    setBusy(false)
    if (r.ok) onSaved()
  }
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 rounded-xl border ${c.deletedAt ? 'opacity-50 border-white/5' : 'border-white/10'} bg-white/[0.03]`}>
      <span className="font-mono text-xs text-white basis-32 truncate">{c.code}</span>
      <span className="basis-40 min-w-0 flex-1">{c.isVanity ? <span className="text-xs text-cyan-200">Vanity URL</span> : <Person p={c.creator} size={20} muted />}{c.creatorIsBot && <span className="ml-1 text-[9px] uppercase text-white/40">bot</span>}</span>
      <span className="text-[11px] text-white/45 whitespace-nowrap">{c.uses} use{c.uses === 1 ? '' : 's'}{c.maxUses ? `/${c.maxUses}` : ''} · {c.trackedJoins} tracked</span>
      {c.deletedAt && <span className="text-[9px] uppercase font-bold text-white/40">deleted</span>}
      {!c.isVanity && (
        <span className="flex items-center gap-2 flex-wrap">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. Website link" aria-label={`Label for invite ${c.code}`}
            className="w-40 px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none" />
          {c.isGeneral
            ? <><Btn disabled={busy} onClick={() => save(true)}>Save label</Btn><Btn disabled={busy} onClick={() => save(false)}>Untag</Btn></>
            : <Btn tone="primary" disabled={busy} onClick={() => save(true)}>Mark general</Btn>}
        </span>
      )}
      {c.isGeneral && <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-cyan-500/15 text-cyan-200 border-cyan-400/30">General{c.label ? `: ${c.label}` : ''}</span>}
    </div>
  )
}

function CodesTab() {
  const [codes, setCodes] = useState(null)
  const [q, setQ] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const [note, setNote] = useState(null)
  const load = useCallback(() => view('codes').then((r) => r.ok && setCodes(Array.isArray(r.data.codes) ? r.data.codes : [])), [])
  useEffect(() => { load() }, [load])
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (codes || []).filter((c) => (showDeleted || !c.deletedAt) && (!n || c.code.toLowerCase().includes(n) || (c.creator?.name || '').toLowerCase().includes(n) || (c.label || '').toLowerCase().includes(n)))
  }, [codes, q, showDeleted])
  return (
    <div className="space-y-3" data-log-section="Invites · invite codes">
      <p className="text-xs text-white/50">
        A person&apos;s invite credits them. Mark staff-made links (the website, Reddit, server lists) as <b>general</b> — joins through them become claimable instead of crediting whoever created the link. Vanity, Discovery and bot-made invites are general automatically.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by code, creator or label" aria-label="Filter invite codes"
          className="flex-1 min-w-[12rem] px-2.5 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none" />
        <label className="flex items-center gap-1.5 text-xs text-white/60"><input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} aria-label="Show deleted invites" />Show deleted</label>
        <Btn onClick={async () => { const r = await act({ action: 'refresh-codes' }); setNote(r.ok ? 'Asked the bot to re-sync — reload in a few seconds.' : (r.data?.error || 'Failed')) }}>Re-sync from Discord</Btn>
      </div>
      {note && <div className="text-xs text-cyan-200">{note}</div>}
      {!codes ? <div className="text-white/50 text-sm">Loading…</div> : (
        <div className="space-y-1.5">
          {shown.slice(0, 300).map((c) => <CodeRow key={c.code} c={c} onSaved={load} />)}
          {shown.length > 300 && <div className="text-xs text-white/40">Showing 300 of {shown.length} — filter to narrow it down.</div>}
          {shown.length === 0 && <div className="text-sm text-white/40 italic">No invite codes match.</div>}
        </div>
      )}
    </div>
  )
}

function CampaignTab() {
  const [list, setList] = useState(null)
  const [form, setForm] = useState({ name: '', prize: '', endsAt: '' })
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => view('campaigns').then((r) => {
    if (!r.ok) return
    const cs = Array.isArray(r.data.campaigns) ? r.data.campaigns : []
    setList(cs)
    const a = cs.find((c) => c.status === 'active')
    if (a) setForm({ name: a.name || '', prize: a.prize || '', endsAt: toLocalInput(a.endsAt) })
  }), [])
  useEffect(() => { load() }, [load])
  const active = (list || []).find((c) => c.status === 'active')
  const input = 'w-full px-2.5 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-blue-400/60'

  const save = async () => {
    setBusy(true); setMsg(null)
    const r = await act({ action: 'campaign-update', name: form.name, prize: form.prize, endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null })
    setBusy(false)
    setMsg(r.ok ? { text: 'Campaign saved. The live board updates within 30 seconds.' } : { bad: true, text: r.data?.error || 'Failed' })
    if (r.ok) load()
  }
  const end = async () => {
    setBusy(true); setMsg(null)
    const r = await act({ action: 'campaign-end', campaignId: active?.id, confirmName: confirm })
    setBusy(false)
    if (!r.ok) return setMsg({ bad: true, text: r.data?.error || 'Failed' })
    setMsg({ text: `${r.data.ended} is archived and ${r.data.next} has started. The bot will post the final top 3.` })
    setConfirm(''); load()
  }
  if (!list) return <div className="text-white/50 text-sm">Loading…</div>
  return (
    <div className="space-y-4">
      {msg && <div className={`text-sm p-2 rounded border ${msg.bad ? 'text-red-200 bg-red-500/10 border-red-500/30' : 'text-green-200 bg-green-500/10 border-green-500/30'}`}>{msg.text}</div>}
      {active && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="space-y-3" data-log-section="Invites · campaign details">
            <h2 className="text-base font-black text-white">Current campaign</h2>
            <label className="block text-[11px] text-white/50">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Campaign name" className={input} /></label>
            <label className="block text-[11px] text-white/50">Prize (optional)<input value={form.prize} onChange={(e) => setForm({ ...form, prize: e.target.value })} aria-label="Campaign prize" className={input} /></label>
            <label className="block text-[11px] text-white/50">End date (optional — Salary Crew get one reminder; nothing ends on its own)
              <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} aria-label="Campaign end date" className={input} />
            </label>
            <Btn tone="primary" disabled={busy} onClick={save}>Save campaign</Btn>
          </Card>
          <Card className="space-y-3 border-red-500/20" data-log-section="Invites · end campaign">
            <h2 className="text-base font-black text-white">End &amp; archive</h2>
            <p className="text-xs text-white/50">Freezes the final top 10, sets campaign counts back to 0 and starts the next campaign. Lifetime counts are never touched. Same as <span className="font-mono">/invite-reset</span>.</p>
            <label className="block text-[11px] text-white/50">Type <b className="text-white">{active.name}</b> to confirm
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type the campaign name to confirm" className={input} />
            </label>
            <Btn tone="danger" disabled={busy || confirm.trim() !== active.name} onClick={end}>End {active.name}</Btn>
          </Card>
        </div>
      )}
      <Card>
        <div className="text-[11px] uppercase tracking-wider font-bold text-blue-300/70 mb-3">Archive</div>
        {list.filter((c) => c.status === 'ended').length === 0 ? <div className="text-xs text-white/40 italic">No campaigns have ended yet.</div> : (
          <div className="grid sm:grid-cols-2 gap-3">
            {list.filter((c) => c.status === 'ended').map((c) => (
              <div key={c.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/10">
                <div className="font-bold text-white">{c.name}</div>
                <div className="text-[11px] text-white/40 mb-2">{fmt(c.startsAt, false)} – {fmt(c.endedAt, false)}{c.endedBy ? ` · ended by ${c.endedBy}` : ''}{c.prize ? ` · ${c.prize}` : ''}</div>
                <ol className="space-y-1">
                  {c.finalTop.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 text-xs"><span className="w-4 text-white/40 text-right">{t.rank}</span><span className="flex-1 min-w-0"><Person p={t} size={18} /></span><span className="font-mono font-bold text-white">{t.total}</span></li>
                  ))}
                  {c.finalTop.length === 0 && <li className="text-xs text-white/40 italic">No invites counted.</li>}
                </ol>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function SettingsTab() {
  const [d, setD] = useState(null)
  const [vals, setVals] = useState({})
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    view('settings').then((r) => {
      if (!r.ok) return
      setD(r.data)
      const s = r.data.settings || {}
      setVals({
        live_board_channel_id: s.live_board_channel_id || '',
        invite_channel_id: s.invite_channel_id || '',
        staff_channel_id: s.staff_channel_id || '',
        min_account_age_days: s.min_account_age_days || '30',
        claim_window_days: s.claim_window_days || '5',
        dm_inviter: s.dm_inviter || 'true',
      })
    })
  }, [])
  if (!d) return <div className="text-white/50 text-sm">Loading…</div>
  const channels = Array.isArray(d.channels) ? d.channels : []
  const input = 'w-full px-2.5 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:outline-none focus:border-blue-400/60'
  const ChannelSelect = ({ k, label, allowNone }) => (
    <label className="block text-[11px] text-white/50">{label}
      <select value={vals[k] || ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} aria-label={label} className={input}>
        {allowNone && <option value="">Off — no live board</option>}
        {!allowNone && !channels.some((c) => c.id === vals[k]) && vals[k] && <option value={vals[k]}>#{vals[k]}</option>}
        {channels.map((c) => <option key={c.id} value={c.id}>{c.category ? `${c.category} › ` : ''}#{c.name}</option>)}
      </select>
    </label>
  )
  const save = async () => {
    setBusy(true); setMsg(null)
    const r = await act({ action: 'settings', values: vals })
    setBusy(false)
    setMsg(r.ok ? { text: r.data.changed?.length ? `Saved: ${r.data.changed.join(', ')}.` : 'Nothing changed.' } : { bad: true, text: r.data?.error || 'Failed' })
  }
  return (
    <Card className="space-y-3 max-w-xl" data-log-section="Invites · settings">
      {msg && <div className={`text-sm p-2 rounded border ${msg.bad ? 'text-red-200 bg-red-500/10 border-red-500/30' : 'text-green-200 bg-green-500/10 border-green-500/30'}`}>{msg.text}</div>}
      <ChannelSelect k="live_board_channel_id" label="Live leaderboard channel (campaign top 10, refreshed every 30 s, kept at the bottom)" allowNone />
      <ChannelSelect k="invite_channel_id" label="Invite announcements channel" />
      <ChannelSelect k="staff_channel_id" label="Staff notices channel (review notices, claims, campaign end reminder)" />
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px] text-white/50">Minimum account age (days)
          <input type="number" min="0" max="365" value={vals.min_account_age_days} onChange={(e) => setVals({ ...vals, min_account_age_days: e.target.value })} aria-label="Minimum account age in days" className={input} />
        </label>
        <label className="block text-[11px] text-white/50">Claim window after registering (days)
          <input type="number" min="0" max="365" value={vals.claim_window_days} onChange={(e) => setVals({ ...vals, claim_window_days: e.target.value })} aria-label="Claim window in days" className={input} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-white/70">
        <input type="checkbox" checked={vals.dm_inviter !== 'false'} onChange={(e) => setVals({ ...vals, dm_inviter: e.target.checked ? 'true' : 'false' })} aria-label="Also DM the inviter" />
        Also DM the inviter when their invitee registers
      </label>
      <Btn tone="primary" disabled={busy} onClick={save}>Save settings</Btn>
    </Card>
  )
}

function DetailDrawer({ id, onClose }) {
  const [d, setD] = useState(null)
  const [other, setOther] = useState(null)
  const [scope, setScope] = useState('both')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => view('detail', { id }).then((r) => r.ok && setD(r.data)), [id])
  useEffect(() => { load() }, [load])
  const run = async (body) => {
    setBusy(true); setMsg(null)
    const r = await act({ inviteeId: id, note: note || undefined, ...body })
    setBusy(false)
    if (!r.ok) return setMsg({ bad: true, text: r.data?.error || 'Failed' })
    setMsg({ text: r.data?.warning || 'Saved.' }); setOther(null); load()
  }
  const it = d?.invite
  const events = Array.isArray(d?.events) ? d.events : []
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg h-full overflow-y-auto bg-[#0b1220] border-l border-white/10 p-4 sm:p-5 space-y-4" onClick={(e) => e.stopPropagation()} data-log-section="Invites · record">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-white">Invite record</h2>
          <button type="button" aria-label="Close invite record" onClick={onClose} className="text-white/50 hover:text-white">✕</button>
        </div>
        {!d ? <div className="text-white/50 text-sm">Loading…</div> : !it ? <div className="text-sm text-white/50">No record for this member yet.</div> : (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap"><Person p={it.invitee} size={32} /><StatusBadge status={it.status} />{it.adminLocked && <span className="text-[10px] uppercase font-bold text-cyan-300">staff decision</span>}</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded bg-white/5"><div className="text-[10px] uppercase text-white/40">Credited to</div><Person p={it.inviter} size={20} /></div>
                <div className="p-2 rounded bg-white/5"><div className="text-[10px] uppercase text-white/40">Source</div><div className="text-white">{it.sourceText}{it.inviteCode ? ` · ${it.inviteCode}` : ''}</div></div>
                <div className="p-2 rounded bg-white/5"><div className="text-[10px] uppercase text-white/40">Joined</div><div className="text-white">{fmt(it.joinedAt)}{it.preLaunch ? ' (before launch)' : ''}</div></div>
                <div className="p-2 rounded bg-white/5"><div className="text-[10px] uppercase text-white/40">Registered</div><div className="text-white">{fmt(it.registeredAt)}</div></div>
                <div className="p-2 rounded bg-white/5"><div className="text-[10px] uppercase text-white/40">Account age at join</div><div className="text-white">{ageDays(it.accountCreatedAt, it.joinedAt) ?? '—'} days</div></div>
                <div className="p-2 rounded bg-white/5"><div className="text-[10px] uppercase text-white/40">In server</div><div className="text-white">{it.inGuild ? 'Yes' : `No — left ${fmt(it.leftAt, false)}`}</div></div>
              </div>
              <Flags flags={it.flags} />
              {it.decisionNote && <div className="text-xs text-white/60">Staff note: {it.decisionNote}{it.decidedBy ? ` — ${it.decidedBy}` : ''}</div>}
            </div>
            <div className="space-y-2 p-3 rounded-xl border border-white/10">
              <div className="text-[11px] uppercase tracking-wider font-bold text-blue-300/70">Staff actions</div>
              <PersonField value={other} onChange={setOther} placeholder="Credit to…" />
              <div className="grid grid-cols-2 gap-2">
                <select aria-label="What the credit counts toward" value={scope} onChange={(e) => setScope(e.target.value)} className="px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs">
                  <option value="both">Campaign + lifetime</option>
                  <option value="lifetime">Lifetime only</option>
                </select>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Staff note" className="px-2.5 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn tone="good" disabled={busy || !other} onClick={() => run({ action: 'assign', inviterId: other.discordId, scope })}>Credit {other ? other.displayName : '…'}</Btn>
                {it.status === 'pending_review' && it.inviter && <Btn tone="good" disabled={busy} onClick={() => run({ action: 'approve' })}>Approve for {it.inviter.name}</Btn>}
                {it.status !== 'rejected' && <Btn tone="danger" disabled={busy} onClick={() => run({ action: 'reject' })}>Remove / reject</Btn>}
                {['pending_review', 'claimable', 'tracked'].includes(it.status) && <Btn disabled={busy} onClick={() => run({ action: 'no-inviter' })}>No inviter</Btn>}
              </div>
              {msg && <div className={`text-xs ${msg.bad ? 'text-red-200' : 'text-green-200'}`}>{msg.text}</div>}
            </div>
          </>
        )}
        {d && (
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-blue-300/70 mb-2">History</div>
            {events.length === 0 ? <div className="text-xs text-white/40 italic">No history.</div> : (
              <ol className="space-y-2">
                {events.map((e) => (
                  <li key={e.id} className="text-xs border-l-2 border-white/10 pl-3">
                    <div className="text-white/80">{e.summary}</div>
                    <div className="text-white/35">{fmt(e.at)}{e.actor ? ` · ${e.actor}` : ''}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function InvitesAdminPage() {
  const [tab, setTab] = useState('overview')
  const [detail, setDetail] = useState(null)
  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-1">Community</div>
        <h1 className="text-2xl sm:text-3xl font-black text-white">Invites</h1>
        <p className="text-sm text-white/50 mt-1">An invite counts once the member registers and stays in the server. Flagged ones wait here for a decision; your decisions always override the bot.</p>
      </div>
      <div className="flex flex-wrap gap-1.5" data-log-section="Invites · tabs">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${tab === k ? 'bg-cyan-500/20 text-cyan-100 border-cyan-400/50' : 'bg-white/[0.03] text-white/60 border-white/10 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab onOpen={setTab} />}
      {tab === 'queue' && <QueueTab onDetail={setDetail} />}
      {tab === 'all' && <AllTab onDetail={setDetail} />}
      {tab === 'claims' && <ClaimsTab onDetail={setDetail} />}
      {tab === 'adjust' && <AdjustTab />}
      {tab === 'codes' && <CodesTab />}
      {tab === 'campaign' && <CampaignTab />}
      {tab === 'settings' && <SettingsTab />}
      {detail && <DetailDrawer id={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
