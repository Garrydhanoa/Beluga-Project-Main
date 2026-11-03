'use client'

// Admin → Mod Logs. Everything the moderation commands can do, plus the full record:
// cases, active punishments, appeals, chat filter review and settings.
//
// The bot owns every Discord side effect, so an action here is queued and the page
// follows it until the bot reports back. Cases are permanent: voiding keeps the record.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Avatar from '../../../components/Avatar'

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
const BASE = '/api/admin/mod-logs'
const view = (v, params = {}) => api(`${BASE}?${new URLSearchParams({ view: v, ...params })}`)
const act = (body) => api(BASE, 'POST', body)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Post an action, then wait for the bot to finish it. */
async function runQueued(body, onStatus) {
  const res = await act(body)
  if (!res.ok) return { ok: false, text: res.data?.error || 'That failed.' }
  const id = res.data?.queued
  if (!id) return { ok: true, text: 'Done.' }
  onStatus?.('Waiting for the bot…')
  for (let i = 0; i < 40; i += 1) {
    await sleep(1000)
    const r = await api(`${BASE}/action?id=${id}`)
    const a = r.data?.action
    if (a?.status === 'done') return { ok: true, text: a.result || 'Done.' }
    if (a?.status === 'failed') return { ok: false, text: a.result || 'The bot could not finish this.' }
  }
  return { ok: false, text: 'The bot has not answered yet. It is still queued; check Cases shortly.' }
}

const TABS = [
  ['overview', 'Overview'],
  ['action', 'Take action'],
  ['active', 'Active'],
  ['cases', 'Cases'],
  ['appeals', 'Appeals'],
  ['filter', 'Chat filter'],
  ['alerts', 'Requests & alerts'],
  ['settings', 'Settings'],
]

const KIND_LABEL = {
  note: 'Note', warn: 'Warning', timeout: 'Timeout', untimeout: 'Timeout removed', strike: 'Strike',
  unstrike: 'Strike removed', suspend: 'Suspension', unsuspend: 'Suspension lifted', kick: 'Kick', ban: 'Ban',
  unban: 'Unban', filter: 'Chat filter timeout',
}
const KIND_STYLE = {
  strike: 'bg-red-500/15 text-red-200 border-red-400/30',
  ban: 'bg-red-500/25 text-red-100 border-red-400/40',
  suspend: 'bg-orange-500/15 text-orange-200 border-orange-400/30',
  kick: 'bg-orange-500/15 text-orange-200 border-orange-400/30',
  timeout: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
  filter: 'bg-purple-500/15 text-purple-200 border-purple-400/30',
  warn: 'bg-yellow-500/15 text-yellow-100 border-yellow-400/30',
}
const SOURCE_LABEL = { command: 'Discord', website: 'Admin panel', filter: 'Chat filter', outside: 'Outside the bot', import: 'Old history', system: 'System' }

function fmt(d, withTime = true) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', withTime
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

function caseTitle(c) {
  if (c.kind === 'strike') return `Strike ${c.strikeNumber || '?'}/3`
  return KIND_LABEL[c.kind] || c.kind
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

function Field({ label, hint, children }) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] font-bold text-white/60 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-white/40 mt-1">{hint}</span>}
    </label>
  )
}

const INPUT = 'w-full px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/50'

function Badge({ kind, children }) {
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded border whitespace-nowrap ${KIND_STYLE[kind] || 'bg-white/10 text-white/70 border-white/20'}`}>{children}</span>
}

function Notice({ note }) {
  if (!note) return null
  const tone = note.ok === false ? 'bg-red-500/10 border-red-400/30 text-red-100' : note.ok ? 'bg-green-500/10 border-green-400/30 text-green-100' : 'bg-white/5 border-white/15 text-white/70'
  return <div role="status" className={`text-xs px-3 py-2 rounded-lg border ${tone}`}>{note.text}</div>
}

/** Queued-action runner that keeps its own status line. */
function useRunner(onDone) {
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (body) => {
    setBusy(true)
    setNote({ text: 'Sending…' })
    const res = await runQueued(body, (text) => setNote({ text }))
    setNote(res)
    setBusy(false)
    if (res.ok) onDone?.()
    return res
  }, [onDone])
  return { note, busy, run }
}

function useView(name, params) {
  const key = JSON.stringify(params || {})
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const load = useCallback(async () => {
    const r = await view(name, JSON.parse(key))
    if (r.ok) { setData(r.data); setErr(null) } else setErr(r.data?.error || 'Failed to load')
  }, [name, key])
  useEffect(() => { load() }, [load])
  return { data, err, reload: load }
}

function Loading({ err }) {
  return <div className={`text-sm ${err ? 'text-red-200' : 'text-white/50'}`}>{err || 'Loading…'}</div>
}

/** Search discord_members, including people who left, or take a pasted ID. */
function MemberField({ value, onChange }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  useEffect(() => {
    const term = q.trim()
    if (!term) { setResults([]); return undefined }
    let alive = true
    const t = setTimeout(async () => {
      const r = await api(`/api/admin/discord?kind=user&q=${encodeURIComponent(term)}`)
      if (alive) setResults(Array.isArray(r.data?.results) ? r.data.results : [])
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q])
  if (value) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-black/40 border border-white/10">
        <Avatar src={value.avatarUrl} name={value.displayName} size={22} ring={false} />
        <span className="flex-1 text-sm text-white truncate">{value.displayName}</span>
        {value.inGuild === false && <span className="text-[9px] uppercase font-bold text-red-300/80">left</span>}
        <button type="button" aria-label="Clear selection" onClick={() => onChange(null)} className="text-white/40 hover:text-white text-xs">✕</button>
      </div>
    )
  }
  const pasted = /^\d{15,25}$/.test(q.trim())
  return (
    <div className="relative">
      <input className={INPUT} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name or paste a Discord ID" aria-label="Search for a member" data-log-ignore />
      {(results.length > 0 || pasted) && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg bg-[#0b1626] border border-white/15 shadow-xl">
          {pasted && !results.some((m) => m.id === q.trim()) && (
            <button type="button" className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/10" onClick={() => onChange({ id: q.trim(), displayName: q.trim() })}>Use ID {q.trim()}</button>
          )}
          {results.map((m) => (
            <button key={m.id} type="button" className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/10" onClick={() => onChange(m)}>
              <Avatar src={m.avatarUrl} name={m.displayName} size={22} ring={false} />
              <span className="text-sm text-white truncate flex-1">{m.displayName}</span>
              {m.inGuild === false && <span className="text-[9px] uppercase font-bold text-red-300/80">left</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CaseRow({ c, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(c.id)} aria-label={`Open case ${c.id}`}
      className="w-full text-left p-3 rounded-xl bg-white/[0.02] border border-white/10 hover:bg-white/[0.06] transition">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-mono text-white/40">#{c.id}</span>
        <Badge kind={c.kind}>{caseTitle(c)}</Badge>
        {!c.counts && <Badge>Old history</Badge>}
        {c.status === 'voided' && <Badge>Voided</Badge>}
        {c.status === 'removed' && <Badge>Removed</Badge>}
        {c.details?.needs_reason && <Badge kind="warn">Needs a reason</Badge>}
        <span className="text-sm font-bold text-white truncate">{c.name || c.discordId}</span>
        <span className="ml-auto text-[11px] text-white/40">{fmt(c.createdAt, false)}</span>
      </div>
      <div className="text-xs text-white/60 mt-1 line-clamp-2">{c.reason}</div>
      <div className="text-[11px] text-white/35 mt-0.5">{c.actorName || 'System'} · {SOURCE_LABEL[c.source] || c.source}</div>
    </button>
  )
}

// ── tabs ──────────────────────────────────────────────────────────────────────

function OverviewTab({ onOpenCase, onTab }) {
  const { data, err } = useView('overview')
  if (!data) return <Loading err={err} />
  const c = data.counts || {}
  const tiles = [
    ['Active suspensions', c.suspensions, 'active'], ['Active bans', c.bans, 'active'], ['Active timeouts', c.timeouts, 'active'],
    ['Open filter flags', c.flags, 'filter'], ['Appeals waiting', c.appeals, 'appeals'], ['Ban and kick requests', c.requests, 'alerts'],
    ['Frozen staff', c.freezes, 'alerts'], ['Members with strikes', c.with_strikes, 'cases'], ['Cases on record', c.cases, 'cases'],
  ]
  return (
    <div className="space-y-4" data-log-section="Mod Logs · Overview">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {tiles.map(([label, n, tab]) => (
          <button key={label} type="button" onClick={() => onTab(tab)} className="p-3 rounded-xl bg-white/[0.03] border border-white/10 text-left hover:bg-white/[0.06]">
            <div className="text-2xl font-black text-white">{n ?? 0}</div>
            <div className="text-[11px] text-white/50">{label}</div>
          </button>
        ))}
      </div>
      {c.legacy_bans > 0 && <div className="text-xs text-white/40">{c.legacy_bans} bans from before this system are on record as history.</div>}
      {data.failed?.length > 0 && (
        <Card>
          <div className="text-sm font-bold text-red-200 mb-2">Recent failures</div>
          <ul className="space-y-1">
            {data.failed.map((f) => <li key={f.id} className="text-xs text-white/60">{fmt(f.fulfilled_at)}: {f.action}: {f.result}</li>)}
          </ul>
        </Card>
      )}
      <div>
        <div className="text-sm font-bold text-white mb-2">Latest cases</div>
        <div className="space-y-2">
          {data.recent?.length ? data.recent.map((row) => <CaseRow key={row.id} c={row} onOpen={onOpenCase} />) : <div className="text-sm text-white/40">No cases yet.</div>}
        </div>
      </div>
    </div>
  )
}

const FORM_KINDS = [
  ['note', 'Staff note'], ['warn', 'Warning'], ['timeout', 'Timeout'], ['untimeout', 'Remove timeout'],
  ['strike', 'Strike'], ['unstrike', 'Remove strike'], ['set_strikes', 'Set strike count'],
  ['suspend', 'Suspend'], ['unsuspend', 'Lift suspension'], ['kick', 'Kick'], ['ban', 'Ban'], ['unban', 'Unban'],
]
const NEEDS_RULE = new Set(['warn', 'timeout', 'kick', 'strike', 'suspend', 'ban'])
const DANGEROUS = new Set(['strike', 'kick', 'ban', 'set_strikes'])

function ActionTab({ rules, seed, onDone }) {
  const [member, setMember] = useState(seed || null)
  const [kind, setKind] = useState('warn')
  const [ruleCode, setRuleCode] = useState('')
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState('')
  const [suspension, setSuspension] = useState('')
  const [withBan, setWithBan] = useState(false)
  const [banType, setBanType] = useState('appealable')
  const [banLength, setBanLength] = useState('')
  const [deleteSeconds, setDeleteSeconds] = useState('0')
  const [count, setCount] = useState('0')
  const [silent, setSilent] = useState(false)
  const [person, setPerson] = useState(null)
  const reset = useCallback(() => { setReason(''); onDone?.() }, [onDone])
  const { note, busy, run } = useRunner(reset)

  useEffect(() => {
    if (!member?.id) { setPerson(null); return }
    view('person', { id: member.id }).then((r) => { if (r.ok) setPerson(r.data) })
  }, [member, note])

  // Fill in the rulebook package for the next strike whenever it changes.
  useEffect(() => {
    if (kind !== 'strike' || !person) return
    setDuration(person.package?.timeout || '')
    setSuspension(person.package?.suspension || '')
    setWithBan(!!person.package?.ban)
  }, [kind, person])

  const submit = () => {
    if (DANGEROUS.has(kind) && !window.confirm(`Apply this to ${member?.displayName}?`)) return
    run({
      action: 'run', kind, targetId: member?.id, targetName: member?.displayName, ruleCode, reason, duration, suspension,
      withBan: kind === 'strike' && withBan, banType, banLength, deleteSeconds, count, silent,
    })
  }

  const s = person?.summary
  return (
    <Card className="space-y-3 max-w-2xl" data-log-section="Mod Logs · Take action">
      <Field label="Member"><MemberField value={member} onChange={setMember} /></Field>
      {s && (
        <div className="text-xs text-white/60 p-2.5 rounded-lg bg-black/30 border border-white/10">
          Strikes {s.strikes}/3{s.legacyStrikes ? ` (had ${s.legacyStrikes} under the old system)` : ''} · Warning {s.warned ? 'used' : 'not used'}
          {s.lastChance && <span className="text-red-200"> · Last chance: rule 6.1.4 says any infraction means a ban</span>}
          {s.suspensions.map((x) => <span key={x.id} className="text-orange-200"> · Suspended: {x.text}</span>)}
          {s.ban && <span className="text-red-200"> · Banned</span>}
        </div>
      )}
      <Field label="Action">
        <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Action">
          {FORM_KINDS.map(([k, label]) => <option key={k} value={k} className="bg-[#0b1626]">{label}</option>)}
        </select>
      </Field>
      {kind === 'warn' && s?.warned && <div className="text-xs text-amber-200">They have already used their one warning, so the rulebook points to a strike.</div>}
      {NEEDS_RULE.has(kind) && (
        <Field label="Rule">
          <select className={INPUT} value={ruleCode} onChange={(e) => setRuleCode(e.target.value)} aria-label="Rule">
            <option value="" className="bg-[#0b1626]">Pick a rule</option>
            {rules.map((r) => <option key={r.code} value={r.code} className="bg-[#0b1626]">{r.label}</option>)}
          </select>
        </Field>
      )}
      {kind === 'timeout' && <Field label="How long" hint="For example 10m, 2d or 1w. 28 days at most."><input className={INPUT} value={duration} onChange={(e) => setDuration(e.target.value)} aria-label="Timeout length" /></Field>}
      {kind === 'suspend' && <Field label="How long" hint="For example 1 series, 3 series, 2 weeks, 1 season, indefinite."><input className={INPUT} value={suspension} onChange={(e) => setSuspension(e.target.value)} aria-label="Suspension length" /></Field>}
      {kind === 'set_strikes' && <Field label="Strike count"><input type="number" min="0" max="3" className={INPUT} value={count} onChange={(e) => setCount(e.target.value)} aria-label="Strike count" /></Field>}
      {kind === 'strike' && (
        <div className="space-y-2 p-3 rounded-lg bg-black/20 border border-white/10">
          <div className="text-xs font-bold text-white/70">Package for Strike {person?.nextStrike || 1}/3</div>
          {!withBan && (
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="Timeout (blank for none)"><input className={INPUT} value={duration} onChange={(e) => setDuration(e.target.value)} aria-label="Strike timeout" /></Field>
              <Field label="Suspension (blank for none)"><input className={INPUT} value={suspension} onChange={(e) => setSuspension(e.target.value)} aria-label="Strike suspension" /></Field>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-white/70"><input type="checkbox" checked={withBan} onChange={(e) => setWithBan(e.target.checked)} /> This strike is a ban</label>
        </div>
      )}
      {(kind === 'ban' || (kind === 'strike' && withBan)) && (
        <div className="grid sm:grid-cols-3 gap-2">
          <Field label="Ban type">
            <select className={INPUT} value={banType} onChange={(e) => setBanType(e.target.value)} aria-label="Ban type">
              <option value="appealable" className="bg-[#0b1626]">Appealable</option>
              <option value="temp" className="bg-[#0b1626]">Temp</option>
            </select>
          </Field>
          <Field label={banType === 'temp' ? 'How long' : 'Can appeal after'} hint={banType === 'temp' ? 'For example 30d' : 'Blank means 6 months'}>
            <input className={INPUT} value={banLength} onChange={(e) => setBanLength(e.target.value)} aria-label="Ban length" />
          </Field>
          <Field label="Delete messages">
            <select className={INPUT} value={deleteSeconds} onChange={(e) => setDeleteSeconds(e.target.value)} aria-label="Delete their messages">
              <option value="0" className="bg-[#0b1626]">None</option>
              <option value="3600" className="bg-[#0b1626]">Last hour</option>
              <option value="86400" className="bg-[#0b1626]">Last 24 hours</option>
              <option value="604800" className="bg-[#0b1626]">Last 7 days</option>
            </select>
          </Field>
        </div>
      )}
      <Field label="Reason" hint="Kept on their record permanently."><textarea rows={3} className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" data-log-ignore /></Field>
      {kind !== 'note' && <label className="flex items-center gap-2 text-xs text-white/60"><input type="checkbox" checked={silent} onChange={(e) => setSilent(e.target.checked)} /> Skip the DM to the member</label>}
      <div className="flex items-center gap-2">
        <Btn tone={DANGEROUS.has(kind) ? 'danger' : 'primary'} disabled={busy || !member} onClick={submit}>{busy ? 'Working…' : 'Apply'}</Btn>
      </div>
      <Notice note={note} />
    </Card>
  )
}

function ActiveTab({ onOpenCase, onPerson }) {
  const { data, err, reload } = useView('active')
  const { note, busy, run } = useRunner(reload)
  if (!data) return <Loading err={err} />
  const lift = (kind, id, name) => {
    const reason = window.prompt(`Why are you ending this for ${name}?`)
    if (reason) run({ action: 'run', kind, targetId: id, targetName: name, reason })
  }
  return (
    <div className="space-y-4" data-log-section="Mod Logs · Active">
      <Notice note={note} />
      <Card>
        <div className="text-sm font-bold text-white mb-2">Suspensions ({data.suspensions.length})</div>
        <div className="space-y-2">
          {data.suspensions.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
              <button type="button" className="font-bold text-white hover:underline" onClick={() => onPerson(s.discord_id)}>{s.name || s.discord_id}</button>
              <Badge kind="suspend">{s.text}{s.status === 'queued' ? ' (queued)' : ''}</Badge>
              {s.team_name ? <span className="text-xs text-white/50">{s.team_name}</span> : <span className="text-xs text-amber-200">Unsigned: paused until they sign</span>}
              <span className="flex-1 min-w-[120px] text-xs text-white/50 truncate">{s.reason}</span>
              <Btn onClick={() => onOpenCase(s.case_id)}>Case {s.case_id}</Btn>
              {s.release_state === 'offered' && <Btn tone="danger" disabled={busy} onClick={() => { const reason = window.prompt('Reason for releasing them from their team?'); if (reason) run({ action: 'release', targetId: s.discord_id, targetName: s.name, suspensionId: s.id, reason }) }}>Release</Btn>}
              <Btn tone="good" disabled={busy} onClick={() => lift('unsuspend', s.discord_id, s.name)}>Lift</Btn>
            </div>
          ))}
          {!data.suspensions.length && <div className="text-xs text-white/40">Nobody is suspended.</div>}
        </div>
      </Card>
      <Card>
        <div className="text-sm font-bold text-white mb-2">Bans ({data.bans.length})</div>
        <div className="space-y-2">
          {data.bans.map((b) => (
            <div key={b.case_id} className="flex flex-wrap items-center gap-2 text-sm">
              <button type="button" className="font-bold text-white hover:underline" onClick={() => onPerson(b.discord_id)}>{b.name || b.discord_id}</button>
              <Badge kind="ban">{b.ban_type === 'temp' ? `Until ${fmt(b.unban_at, false)}` : b.ban_type === 'appealable' ? `Appeal from ${fmt(b.appeal_after, false)}` : 'Outside the bot'}</Badge>
              {b.dm_status === 'failed' && <Badge kind="warn">DM failed</Badge>}
              <span className="flex-1 min-w-[120px] text-xs text-white/50 truncate">{b.reason}</span>
              <Btn onClick={() => onOpenCase(b.case_id)}>Case {b.case_id}</Btn>
              <Btn tone="good" disabled={busy} onClick={() => lift('unban', b.discord_id, b.name)}>Unban</Btn>
            </div>
          ))}
          {!data.bans.length && <div className="text-xs text-white/40">No active bans.</div>}
        </div>
      </Card>
      <Card>
        <div className="text-sm font-bold text-white mb-2">Timeouts ({data.timeouts.length})</div>
        <div className="space-y-2">
          {data.timeouts.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
              <button type="button" className="font-bold text-white hover:underline" onClick={() => onPerson(t.discordId)}>{t.name || t.discordId}</button>
              <Badge kind="timeout">Until {fmt(t.expiresAt)}</Badge>
              <span className="flex-1 min-w-[120px] text-xs text-white/50 truncate">{t.reason}</span>
              <Btn onClick={() => onOpenCase(t.id)}>Case {t.id}</Btn>
              <Btn tone="good" disabled={busy} onClick={() => lift('untimeout', t.discordId, t.name)}>Remove</Btn>
            </div>
          ))}
          {!data.timeouts.length && <div className="text-xs text-white/40">No active timeouts.</div>}
        </div>
      </Card>
    </div>
  )
}

function CasesTab({ onOpenCase }) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [kind, setKind] = useState('')
  const [source, setSource] = useState('')
  const [old, setOld] = useState(false)
  const [offset, setOffset] = useState(0)
  useEffect(() => { const t = setTimeout(() => { setTerm(q); setOffset(0) }, 300); return () => clearTimeout(t) }, [q])
  const params = useMemo(() => ({ q: term, kind, source, old: old ? '1' : '0', offset: String(offset), limit: '50' }), [term, kind, source, old, offset])
  const { data, err } = useView('cases', params)
  return (
    <div className="space-y-3" data-log-section="Mod Logs · Cases">
      <div className="flex flex-wrap gap-2">
        <input className={`${INPUT} flex-1 min-w-[200px]`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID, reason, staff or case number" aria-label="Search cases" data-log-ignore />
        <select className={`${INPUT} w-auto`} value={kind} onChange={(e) => { setKind(e.target.value); setOffset(0) }} aria-label="Filter by type">
          <option value="" className="bg-[#0b1626]">All types</option>
          {Object.entries(KIND_LABEL).map(([k, label]) => <option key={k} value={k} className="bg-[#0b1626]">{label}</option>)}
        </select>
        <select className={`${INPUT} w-auto`} value={source} onChange={(e) => { setSource(e.target.value); setOffset(0) }} aria-label="Filter by source">
          <option value="" className="bg-[#0b1626]">All sources</option>
          {Object.entries(SOURCE_LABEL).map(([k, label]) => <option key={k} value={k} className="bg-[#0b1626]">{label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-white/60"><input type="checkbox" checked={old} onChange={(e) => { setOld(e.target.checked); setOffset(0) }} /> Include old history</label>
      </div>
      {!data ? <Loading err={err} /> : (
        <>
          <div className="space-y-2">
            {data.cases.map((c) => <CaseRow key={c.id} c={c} onOpen={onOpenCase} />)}
            {!data.cases.length && <div className="text-sm text-white/40">Nothing matches.</div>}
          </div>
          <div className="flex gap-2">
            <Btn disabled={offset === 0} onClick={() => setOffset(Math.max(offset - 50, 0))}>Newer</Btn>
            <Btn disabled={data.cases.length < 50} onClick={() => setOffset(offset + 50)}>Older</Btn>
          </div>
        </>
      )}
    </div>
  )
}

function AppealsTab({ onOpenCase, onPerson }) {
  const { data, err, reload } = useView('appeals')
  const { note, busy, run } = useRunner(reload)
  if (!data) return <Loading err={err} />
  const decide = (a, verdict) => {
    const text = window.prompt(`Reason for ${verdict === 'approved' ? 'approving' : 'denying'} this appeal?`)
    if (text) run({ action: 'appeal-decide', appealId: a.id, verdict, note: text })
  }
  const STATUS = { voting: 'Voting in #admin-chat', director: 'Waiting on a Director', approved: 'Approved', denied: 'Denied' }
  return (
    <div className="space-y-3" data-log-section="Mod Logs · Appeals">
      <Notice note={note} />
      {data.appeals.map((a) => (
        <Card key={a.id}>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <button type="button" className="font-bold text-white hover:underline" onClick={() => onPerson(a.discord_id)}>{a.discord_name || a.discord_id}</button>
            <Badge kind={a.kind === 'ban' ? 'ban' : 'suspend'}>{a.kind === 'ban' ? 'Ban appeal' : 'Suspension appeal'}</Badge>
            <Badge>{STATUS[a.status] || a.status}</Badge>
            <span className="text-xs text-white/50">✅ {a.yes_votes} · ❌ {a.no_votes}</span>
            <Btn className="ml-auto" onClick={() => onOpenCase(a.case_id)}>Case {a.case_id}</Btn>
          </div>
          <div className="text-xs text-white/50 mb-2">Original reason: {a.case_reason}</div>
          <div className="space-y-2">
            {(Array.isArray(a.answers) ? a.answers : []).map((x) => (
              <div key={x.question}>
                <div className="text-[11px] font-bold text-white/60">{x.question}</div>
                <div className="text-sm text-white/80 whitespace-pre-wrap">{x.answer}</div>
              </div>
            ))}
          </div>
          {a.decision_note && <div className="text-xs text-white/60 mt-2">Decision by {a.decided_by_name}: {a.decision_note}</div>}
          {a.status === 'director' && (
            <div className="flex gap-2 mt-3">
              <Btn tone="good" disabled={busy} onClick={() => decide(a, 'approved')}>Approve</Btn>
              <Btn tone="danger" disabled={busy} onClick={() => decide(a, 'denied')}>Deny</Btn>
            </div>
          )}
        </Card>
      ))}
      {!data.appeals.length && <div className="text-sm text-white/40">No appeals yet.</div>}
    </div>
  )
}

const SETTING_FIELDS = [
  ['filter_slur_timeout_seconds', 'Banned word timeout (seconds)'],
  ['filter_spam_timeout_seconds', 'Spam timeout (seconds)'],
  ['filter_spam_burst_messages', 'Spam: messages in a burst'],
  ['filter_spam_burst_seconds', 'Spam: burst window (seconds)'],
  ['filter_spam_duplicate_messages', 'Spam: repeats of one message'],
  ['filter_spam_duplicate_seconds', 'Spam: repeat window (seconds)'],
  ['filter_ai_claude_model', 'Claude model'],
  ['filter_ai_primary_model', 'First backup model (Groq)'],
  ['filter_ai_fallback_model', 'Second backup model (Groq)'],
  ['filter_ai_confidence', 'AI confidence needed to flag (0 to 1)'],
  ['filter_ai_slur_confidence', 'AI confidence needed to act on a slur (0 to 1)'],
  ['filter_ai_batch_size', 'AI batch size'],
  ['filter_ai_batch_seconds', 'AI batch wait (seconds)'],
  ['filter_ai_daily_tokens', 'Groq daily token budget'],
  ['chat_join_channels', 'Channels the chat AI can join by itself (IDs, comma separated)'],
  ['chat_join_fun_minutes', 'Minutes between unprompted fun replies'],
  ['claude_daily_alert_usd', 'Tell #admin-chat when daily Claude spend passes ($, 0 is off)'],
  ['filter_flag_only_channels', 'Flag-only channels or categories (IDs, comma separated)'],
  ['filter_ai_excluded_channels', 'Channels the AI skips (IDs, comma separated)'],
  ['filter_ignored_channels', 'Channels the filter ignores (IDs, comma separated)'],
  ['filter_exempt_roles', 'Exempt roles (IDs, comma separated)'],
]
const SWITCHES = [
  ['filter_enabled', 'Chat filter on'],
  ['filter_slur_enabled', 'Banned words'],
  ['filter_spam_enabled', 'Spam detection'],
  ['filter_ai_enabled', 'AI check'],
  ['filter_ai_slur_action', 'AI-caught slurs: delete and time out'],
  ['chat_join_enabled', 'Chat AI joins in by itself'],
]

function mask(word) {
  const w = String(word)
  return w.length <= 2 ? `${w[0]}*` : `${w[0]}${'*'.repeat(w.length - 2)}${w[w.length - 1]}`
}

const CLAUDE_STATUS = {
  ok: ['Working', 'bg-green-500/15 text-green-200 border-green-400/30'],
  empty: ['Out of credit', 'bg-red-500/20 text-red-100 border-red-400/40'],
  unknown: ['Not used yet', 'bg-white/10 text-white/70 border-white/20'],
}
const PURPOSE_LABEL = { filter: 'Chat filter', chat: 'Chat AI', join: 'Deciding to join in' }

function dollars(n) {
  return n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`
}

function ClaudeCard({ claude, busy, run }) {
  const [amount, setAmount] = useState('')
  if (!claude) return null
  const [label, style] = CLAUDE_STATUS[claude.state] || CLAUDE_STATUS.unknown
  const left = claude.balance > 0 ? Math.min(100, (claude.remaining / claude.balance) * 100) : 0
  const days = claude.perDay > 0 ? Math.floor(claude.remaining / claude.perDay) : null
  return (
    <Card data-log-section="Mod Logs · Claude balance">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="text-sm font-bold text-white flex-1">Claude balance</div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border whitespace-nowrap ${style}`}>{label}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-bold text-white">{dollars(claude.remaining)}</span>
        <span className="text-xs text-white/50">left of {dollars(claude.balance)}, estimated</span>
      </div>
      <div className="h-1.5 rounded bg-white/10 overflow-hidden mt-2 mb-2">
        <div className={`h-full ${left < 15 ? 'bg-red-400' : 'bg-cyan-400'}`} style={{ width: `${left}%` }} />
      </div>
      <div className="text-xs text-white/60 space-y-0.5">
        <div>Spent {dollars(claude.spent)} since {fmt(claude.setAt)}{claude.setBy ? `, when ${claude.setBy} set it` : ''}, {dollars(claude.today)} of that today.</div>
        {days !== null && <div>At the last 7 days' pace, about {days.toLocaleString('en-US')} days left.</div>}
        {claude.week.map((w) => (
          <div key={w.purpose}>{PURPOSE_LABEL[w.purpose] || w.purpose}, last 7 days: {dollars(w.cost)} over {w.requests.toLocaleString('en-US')} calls</div>
        ))}
        {claude.lastError && <div className="text-red-200">Last problem: {claude.lastError}</div>}
      </div>
      <p className="text-[11px] text-white/40 mt-2">Anthropic has no way to ask for the real balance, so this counts what the bot has used. Anything else using this key isn't counted. After a refill, enter the balance shown in the Claude Console.</p>
      <div className="flex gap-2 mt-2">
        <input className={INPUT} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="New balance in dollars" aria-label="New Claude balance in dollars" />
        <Btn tone="primary" className="whitespace-nowrap" disabled={busy || !amount.trim()} onClick={() => { run({ action: 'claude-balance', amount }); setAmount('') }}>Set balance</Btn>
      </div>
    </Card>
  )
}

function FilterTab() {
  const { data, err, reload } = useView('filter')
  const flags = useView('flags')
  const { note, busy, run } = useRunner(reload)
  const [values, setValues] = useState(null)
  const [newWord, setNewWord] = useState('')
  const [newAllow, setNewAllow] = useState('')
  const [testText, setTestText] = useState('')
  const [showWords, setShowWords] = useState(false)
  useEffect(() => { if (data?.settings) setValues(data.settings) }, [data])
  if (!data || !values) return <Loading err={err} />
  const today = data.usage.filter((u) => String(u.day).slice(0, 10) === new Date().toISOString().slice(0, 10))
  const tokens = today.reduce((sum, u) => sum + (u.tokens || 0), 0)
  const requests = today.reduce((sum, u) => sum + (u.requests || 0), 0)
  const errors = today.reduce((sum, u) => sum + (u.errors || 0), 0)
  return (
    <div className="space-y-4" data-log-section="Mod Logs · Chat filter">
      <Notice note={note} />
      <Card>
        <div className="text-sm font-bold text-white mb-1">Try a message</div>
        <p className="text-xs text-white/50 mb-2">Shows what the word engine and AI would do. Nothing is posted and nobody is flagged.</p>
        <textarea rows={2} className={INPUT} value={testText} onChange={(e) => setTestText(e.target.value)} aria-label="Message to test" data-log-ignore />
        <Btn className="mt-2" tone="primary" disabled={busy || !testText.trim()} onClick={() => run({ action: 'filter-test', text: testText })}>Test</Btn>
      </Card>
      <Card>
        <div className="text-sm font-bold text-white mb-2">Open flags ({flags.data?.flags?.length ?? 0})</div>
        <p className="text-xs text-white/50 mb-2">Staff decide these with the buttons in #automod-log.</p>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {(flags.data?.flags || []).map((f) => (
            <div key={f.id} className="p-2.5 rounded-lg bg-black/20 border border-white/10">
              <div className="flex flex-wrap gap-2 items-center">
                <Badge kind={f.layer === 'slur' ? 'ban' : f.layer === 'spam' ? 'timeout' : 'warn'}>{f.layer === 'ai' ? 'AI' : f.layer === 'slur' ? (f.model ? 'AI slur' : 'Banned word') : 'Spam'}</Badge>
                <span className="text-xs font-bold text-white">{f.author_name || f.author_id}</span>
                <span className="text-[11px] text-white/40">#{f.channel_name || '?'} · {fmt(f.created_at)}</span>
              </div>
              <div className="text-xs text-white/70 mt-1 whitespace-pre-wrap break-words">{f.content}</div>
              {f.verdict?.why && <div className="text-[11px] text-white/45 mt-0.5">AI: {f.verdict.why}</div>}
            </div>
          ))}
          {!flags.data?.flags?.length && <div className="text-xs text-white/40">Nothing waiting.</div>}
        </div>
      </Card>
      <ClaudeCard claude={data.claude} busy={busy} run={run} />
      <Card>
        <div className="text-sm font-bold text-white mb-2">AI check usage today</div>
        <div className="text-xs text-white/60">{requests} calls · {tokens.toLocaleString('en-US')} tokens · {errors} errors</div>
        <p className="text-[11px] text-white/40 mt-1">Groq's free backups stop at {Number(values.filter_ai_daily_tokens).toLocaleString('en-US')} tokens a day. Claude has no daily cap here.</p>
      </Card>
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-sm font-bold text-white flex-1">Banned words ({data.words.length})</div>
          <Btn onClick={() => setShowWords(!showWords)}>{showWords ? 'Hide words' : 'Show words'}</Btn>
        </div>
        <div className="flex gap-2 mb-2">
          <input className={INPUT} value={newWord} onChange={(e) => setNewWord(e.target.value)} placeholder="Add a word" aria-label="New banned word" data-log-ignore />
          <Btn tone="primary" disabled={busy || !newWord.trim()} onClick={() => { run({ action: 'word-add', word: newWord }); setNewWord('') }}>Add</Btn>
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-72 overflow-y-auto">
          {data.words.map((w) => (
            <span key={w.id} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${w.enabled ? 'bg-white/5 border-white/15 text-white/80' : 'bg-black/20 border-white/5 text-white/30 line-through'}`}>
              {showWords ? w.word : mask(w.word)}
              <button type="button" aria-label={`${w.enabled ? 'Turn off' : 'Turn on'} word ${w.id}`} className="text-white/40 hover:text-white" onClick={() => run({ action: 'word-set', id: w.id, enabled: !w.enabled })}>{w.enabled ? '⏸' : '▶'}</button>
              <button type="button" aria-label={`Delete word ${w.id}`} className="text-white/40 hover:text-red-200" onClick={() => window.confirm('Delete this word?') && run({ action: 'word-delete', id: w.id })}>✕</button>
            </span>
          ))}
        </div>
      </Card>
      <Card>
        <div className="text-sm font-bold text-white mb-2">Allowed words and phrases ({data.allow.length})</div>
        <div className="flex gap-2 mb-2">
          <input className={INPUT} value={newAllow} onChange={(e) => setNewAllow(e.target.value)} placeholder="Add a word or phrase" aria-label="New allowed phrase" data-log-ignore />
          <Btn tone="primary" disabled={busy || !newAllow.trim()} onClick={() => { run({ action: 'allow-add', phrase: newAllow }); setNewAllow('') }}>Add</Btn>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {data.allow.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs bg-white/5 border-white/15 text-white/80">
              {a.phrase}
              <button type="button" aria-label={`Remove allowed phrase ${a.id}`} className="text-white/40 hover:text-red-200" onClick={() => run({ action: 'allow-delete', id: a.id })}>✕</button>
            </span>
          ))}
        </div>
      </Card>
      <Card>
        <div className="text-sm font-bold text-white mb-2">Filter settings</div>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 mb-3">
          {SWITCHES.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-white/80">
              <input type="checkbox" checked={values[key] === 'true'} onChange={(e) => setValues({ ...values, [key]: e.target.checked ? 'true' : 'false' })} /> {label}
            </label>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {SETTING_FIELDS.map(([key, label]) => (
            <Field key={key} label={label}><input className={INPUT} value={values[key] ?? ''} onChange={(e) => setValues({ ...values, [key]: e.target.value })} aria-label={label} /></Field>
          ))}
        </div>
        <Btn className="mt-3" tone="primary" disabled={busy} onClick={() => run({ action: 'settings', values })}>Save filter settings</Btn>
      </Card>
    </div>
  )
}

function AlertsTab({ onPerson }) {
  const { data, err, reload } = useView('requests')
  const { note, busy, run } = useRunner(reload)
  if (!data) return <Loading err={err} />
  return (
    <div className="space-y-4" data-log-section="Mod Logs · Requests and alerts">
      <Notice note={note} />
      <Card>
        <div className="text-sm font-bold text-white mb-2">Frozen staff ({data.freezes.length})</div>
        {data.freezes.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-2 text-sm mb-1.5">
            <button type="button" className="font-bold text-white hover:underline" onClick={() => onPerson(f.staff_id)}>{f.staff_name || f.staff_id}</button>
            <span className="flex-1 text-xs text-white/50">{f.reason}</span>
            <Btn tone="good" disabled={busy} onClick={() => run({ action: 'unfreeze', staffId: f.staff_id })}>Restore access</Btn>
          </div>
        ))}
        {!data.freezes.length && <div className="text-xs text-white/40">Nobody is frozen.</div>}
      </Card>
      <Card>
        <div className="text-sm font-bold text-white mb-2">Ban and kick requests</div>
        <p className="text-xs text-white/50 mb-2">Approve or deny these with the buttons in #director-chat.</p>
        {data.requests.map((r) => (
          <div key={r.id} className="text-xs text-white/70 mb-1.5">
            <Badge>{r.status}</Badge> {r.kind === 'kick_request' ? 'Kick' : 'Ban'}: {r.payload?.targetName || r.payload?.targetId}, requested by {r.requested_by_name}: {r.payload?.reason}
          </div>
        ))}
        {!data.requests.length && <div className="text-xs text-white/40">No requests.</div>}
      </Card>
      <Card>
        <div className="text-sm font-bold text-white mb-2">Ban evasion alerts</div>
        {data.evasion.map((e) => (
          <div key={e.id} className="text-xs text-white/70 mb-1.5">
            <button type="button" className="underline" onClick={() => onPerson(e.new_id)}>{e.new_id}</button> shares {e.key} with banned member <button type="button" className="underline" onClick={() => onPerson(e.banned_id)}>{e.banned_id}</button> · {fmt(e.created_at)}
          </div>
        ))}
        {!data.evasion.length && <div className="text-xs text-white/40">No alerts.</div>}
      </Card>
    </div>
  )
}

function SettingsTab() {
  const { data, err, reload } = useView('filter')
  const { note, busy, run } = useRunner(reload)
  const [values, setValues] = useState(null)
  useEffect(() => { if (data?.settings) setValues(data.settings) }, [data])
  if (!data || !values) return <Loading err={err} />
  const fields = [
    ['appeal_after_months', 'Default months before a ban can be appealed'],
    ['appeal_vote_threshold', 'Votes in #admin-chat before a Director decides'],
    ['rogue_action_limit', 'Rogue staff brake: bans or kicks allowed'],
    ['rogue_window_minutes', 'Rogue staff brake: within how many minutes'],
  ]
  return (
    <div className="space-y-4 max-w-2xl" data-log-section="Mod Logs · Settings">
      <Notice note={note} />
      <Card>
        <div className="grid sm:grid-cols-2 gap-3">
          {fields.map(([key, label]) => (
            <Field key={key} label={label}><input className={INPUT} value={values[key] ?? ''} onChange={(e) => setValues({ ...values, [key]: e.target.value })} aria-label={label} /></Field>
          ))}
        </div>
        <Btn className="mt-3" tone="primary" disabled={busy} onClick={() => run({ action: 'settings', values })}>Save</Btn>
      </Card>
      <Card>
        <div className="text-sm font-bold text-white mb-1">Old history</div>
        <p className="text-xs text-white/50 mb-2">Brings in the old #strike-channel and #player-suspensions posts and the current ban list as read-only history. None of it counts, and running it twice is safe.</p>
        <Btn disabled={busy} onClick={() => window.confirm('Import the old history now?') && run({ action: 'import-history' })}>Import old history</Btn>
      </Card>
    </div>
  )
}

function Drawer({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" role="dialog" aria-modal="true" aria-label={title} data-log-section={`Mod Logs · ${title}`}>
      <button type="button" className="flex-1" aria-label="Close" onClick={onClose} />
      <div className="w-full max-w-xl h-full overflow-y-auto bg-[#0b1626] border-l border-white/10 p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="text-lg font-black text-white flex-1 truncate">{title}</div>
          <Btn aria-label="Close" onClick={onClose}>Close</Btn>
        </div>
        {children}
      </div>
    </div>
  )
}

function PersonDrawer({ id, onClose, onOpenCase, onAct }) {
  const { data, err } = useView('person', { id })
  if (!data) return <Drawer title="Member" onClose={onClose}><Loading err={err} /></Drawer>
  const s = data.summary
  return (
    <Drawer title={s.name || id} onClose={onClose}>
      <div className="flex items-center gap-3">
        <Avatar src={s.avatarUrl} name={s.name} size={44} ring={false} />
        <div className="text-xs text-white/60 flex-1">
          <div>Strikes {s.strikes}/3{s.legacyStrikes ? ` (had ${s.legacyStrikes} under the old system)` : ''} · Warning {s.warned ? 'used' : 'not used'}</div>
          {s.lastChance && <div className="text-red-200">Last chance</div>}
          {s.suspensions.map((x) => <div key={x.id} className="text-orange-200">Suspended: {x.text}</div>)}
          {s.ban && <div className="text-red-200">Banned</div>}
          {s.inGuild === false && <div>Not in the server</div>}
        </div>
        <Btn tone="primary" onClick={() => onAct({ id, displayName: s.name || id, avatarUrl: s.avatarUrl })}>Take action</Btn>
      </div>
      <div className="text-sm font-bold text-white">Cases ({data.cases.length})</div>
      <div className="space-y-2">{data.cases.map((c) => <CaseRow key={c.id} c={c} onOpen={onOpenCase} />)}</div>
      <div className="text-sm font-bold text-white">Timeline</div>
      <ul className="space-y-1">
        {data.events.map((e) => <li key={e.id} className="text-xs text-white/60">{fmt(e.created_at)}: {e.summary}</li>)}
        {!data.events.length && <li className="text-xs text-white/40">Nothing yet.</li>}
      </ul>
    </Drawer>
  )
}

function CaseDrawer({ id, onClose, onPerson }) {
  const { data, err, reload } = useView('case', { id })
  const { note, busy, run } = useRunner(reload)
  const [uploading, setUploading] = useState(false)
  if (!data) return <Drawer title={`Case ${id}`} onClose={onClose}><Loading err={err} /></Drawer>
  const c = data.case
  const upload = async (file) => {
    if (!file) return
    setUploading(true)
    const form = new FormData()
    form.set('caseId', String(c.id))
    form.set('file', file)
    await fetch(`${BASE}/evidence`, { method: 'POST', body: form })
    setUploading(false)
    reload()
  }
  const problems = Object.entries(c.steps || {}).map(([, step]) => step?.problem).filter(Boolean)
  return (
    <Drawer title={`Case ${c.id}: ${caseTitle(c)}`} onClose={onClose}>
      <Notice note={note} />
      <div className="text-sm space-y-1.5">
        <div><span className="text-white/50">Member:</span> <button type="button" className="text-white font-bold hover:underline" onClick={() => onPerson(c.discordId)}>{c.name || c.discordId}</button></div>
        <div><span className="text-white/50">Staff:</span> <span className="text-white">{c.actorName || 'System'}</span> <span className="text-white/40">({SOURCE_LABEL[c.source] || c.source})</span></div>
        <div><span className="text-white/50">When:</span> <span className="text-white">{fmt(c.createdAt)}</span></div>
        {c.ruleLabel && <div><span className="text-white/50">Rule:</span> <span className="text-white">{c.ruleLabel}</span></div>}
        <div><span className="text-white/50">Reason:</span> <span className="text-white whitespace-pre-wrap">{c.reason}</span></div>
        {c.expiresAt && <div><span className="text-white/50">Timeout ends:</span> <span className="text-white">{fmt(c.expiresAt)}</span></div>}
        {c.status === 'voided' && <div className="text-red-200">Voided by {c.voidedBy}: {c.voidReason}</div>}
      </div>
      {problems.length > 0 && (
        <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-400/30 text-xs text-amber-100">
          <div className="font-bold mb-1">Not completed</div>
          <ul className="list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {data.suspensions.map((s) => <div key={s.id} className="text-xs text-white/60">Suspension: {s.status}, {s.served}/{s.total ?? '∞'} {s.unit}</div>)}
      {data.ban && <div className="text-xs text-white/60">Ban: {data.ban.ban_type}, {data.ban.status}{data.ban.dm_status ? `, DM ${data.ban.dm_status}` : ''}</div>}
      <div className="text-sm font-bold text-white">Evidence</div>
      <ul className="space-y-1">
        {data.evidence.map((e) => (
          <li key={e.id} className="text-xs text-white/70">
            {e.text ? <span className="whitespace-pre-wrap">{e.text}</span> : <a className="underline" href={`${BASE}/evidence/${e.id}`}>{e.filename || `File ${e.id}`}</a>}
            <span className="text-white/40"> · {e.added_by_name || 'System'}</span>
          </li>
        ))}
        {!data.evidence.length && <li className="text-xs text-white/40">None yet.</li>}
      </ul>
      <label className="inline-block"><span className="sr-only">Add evidence</span><input type="file" disabled={uploading} className="text-xs text-white/60" onChange={(e) => upload(e.target.files?.[0])} /></label>
      <div className="flex flex-wrap gap-2">
        <Btn disabled={busy} onClick={() => { const reason = window.prompt('New reason', c.reason); if (reason) run({ action: 'reason', caseId: c.id, reason }) }}>Edit reason</Btn>
        {c.status !== 'voided' && c.counts && <Btn tone="danger" disabled={busy} onClick={() => { const reason = window.prompt('Why is this being voided? This undoes its effect.'); if (reason) run({ action: 'void', caseId: c.id, reason }) }}>Void case</Btn>}
      </div>
      <div className="text-sm font-bold text-white">History</div>
      <ul className="space-y-1">
        {data.events.map((e) => <li key={e.id} className="text-xs text-white/60">{fmt(e.created_at)}: {e.summary}</li>)}
      </ul>
    </Drawer>
  )
}

export default function ModLogsPage() {
  const [tab, setTab] = useState('overview')
  const [caseId, setCaseId] = useState(null)
  const [personId, setPersonId] = useState(null)
  const [seed, setSeed] = useState(null)
  const [rules, setRules] = useState([])
  useEffect(() => { view('overview').then((r) => { if (r.ok) setRules(r.data?.rules || []) }) }, [])
  const takeAction = (member) => { setSeed(member); setPersonId(null); setTab('action') }
  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-1">Community</div>
        <h1 className="text-2xl sm:text-3xl font-black text-white">Mod Logs</h1>
        <p className="text-sm text-white/50 mt-1">Every warning, strike, suspension, timeout, kick and ban, permanently on record. Actions here run through the same system as the Discord commands.</p>
      </div>
      <div className="flex flex-wrap gap-1.5" data-log-section="Mod Logs · tabs">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${tab === k ? 'bg-cyan-500/20 text-cyan-100 border-cyan-400/50' : 'bg-white/[0.03] text-white/60 border-white/10 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab onOpenCase={setCaseId} onTab={setTab} />}
      {tab === 'action' && <ActionTab key={seed?.id || 'blank'} rules={rules} seed={seed} />}
      {tab === 'active' && <ActiveTab onOpenCase={setCaseId} onPerson={setPersonId} />}
      {tab === 'cases' && <CasesTab onOpenCase={setCaseId} />}
      {tab === 'appeals' && <AppealsTab onOpenCase={setCaseId} onPerson={setPersonId} />}
      {tab === 'filter' && <FilterTab />}
      {tab === 'alerts' && <AlertsTab onPerson={setPersonId} />}
      {tab === 'settings' && <SettingsTab />}
      {personId && <PersonDrawer id={personId} onClose={() => setPersonId(null)} onOpenCase={setCaseId} onAct={takeAction} />}
      {caseId && <CaseDrawer id={caseId} onClose={() => setCaseId(null)} onPerson={setPersonId} />}
    </div>
  )
}
