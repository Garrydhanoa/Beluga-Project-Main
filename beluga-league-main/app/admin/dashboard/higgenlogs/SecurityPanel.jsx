'use client'

/**
 * higgenlogs → Security (super admins only).
 *   - Online now / recent sessions: who is signed in (admin panel AND Applications),
 *     where from, on what device, what they're looking at — live (5s refresh).
 *     Expand a person to see their latest activity. Log out one session, one person
 *     everywhere, or everyone (super admins are never logged out).
 *   - Blocked IPs: automatic (3 failed logins in 30 min) and manual blocks; unblock,
 *     or block an IP by hand.
 *   - Recent failed attempts: the strikes behind those blocks.
 * Every identifying detail lives here and in the log entries — never in Discord.
 */

import { useCallback, useEffect, useState } from 'react'

function ago(value) {
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.round((Date.now() - then) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`
  return `${Math.floor(secs / 86400)} d ago`
}

function when(value) {
  try {
    return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return String(value) }
}

const INTENT = { admin: 'Admin panel', applications: 'Applications', site: 'Website' }

function Pill({ tone = 'slate', children }) {
  const tones = {
    green: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30',
    red: 'bg-red-500/15 text-red-200 border-red-400/30',
    amber: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
    blue: 'bg-blue-500/15 text-blue-200 border-blue-400/30',
    violet: 'bg-violet-500/15 text-violet-200 border-violet-400/30',
    slate: 'bg-white/5 text-white/60 border-white/15',
  }
  return <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide ${tones[tone]}`}>{children}</span>
}

function SessionRow({ s, onRevoke, onRevokeUser, busy }) {
  const [open, setOpen] = useState(false)
  const [activity, setActivity] = useState(null)

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    const load = () => fetch(`/api/admin/security?activity=${encodeURIComponent(s.discord_id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setActivity(Array.isArray(j.activity) ? j.activity : []) })
      .catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [open, s.discord_id])

  const place = [s.city, s.region, s.country].filter(Boolean).join(', ')
  return (
    <div className={open ? 'bg-white/[0.03]' : ''}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-3 flex-1 min-w-0 text-left" aria-label={`Show ${s.display_name || s.username}'s session`}>
          <span className="relative shrink-0">
            {s.avatar_url
              ? <img src={s.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
              : <span className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/60">{(s.username || '?')[0]}</span>}
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-950 ${s.online ? 'bg-emerald-400' : s.revoked_at ? 'bg-red-400' : 'bg-white/25'}`} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[13px] font-bold text-white truncate">{s.display_name || s.username}</span>
              <span className="text-[11px] text-white/40">@{s.username}</span>
              <Pill tone={s.login_intent === 'admin' ? 'blue' : 'slate'}>{INTENT[s.login_intent] || 'Website'}</Pill>
              {s.is_super_admin && <Pill tone="violet">Super admin</Pill>}
              {s.login_intent === 'admin' && !s.access_granted && <Pill tone="red">Denied</Pill>}
              {s.revoked_at && <Pill tone="red">Logged out</Pill>}
            </span>
            <span className="block text-[10px] text-white/40 truncate">
              {s.online ? 'Online' : `Last seen ${ago(s.last_seen_at)}`}
              {s.last_path ? ` · on ${s.last_path}` : ''}
              {place ? ` · ${place}` : ''}
              {` · ${s.browser || 'browser'} on ${s.os || 'unknown OS'}`}
            </span>
          </span>
        </button>
        {!s.is_super_admin && !s.revoked_at && (
          <button
            onClick={() => onRevoke(s)}
            disabled={busy}
            className="shrink-0 px-2.5 py-1 text-[11px] font-bold text-red-200 bg-red-500/10 hover:bg-red-500/20 border border-red-400/30 rounded-lg disabled:opacity-40"
            aria-label={`Log out ${s.username} from this session`}
          >
            Log out
          </button>
        )}
      </div>

      {open && (
        <div className="px-4 sm:px-5 pb-4 pt-1 border-t border-white/5 grid gap-4 lg:grid-cols-2">
          <div className="text-[12px] text-white/80 space-y-1">
            <div><span className="text-white/40">Discord:</span> {s.username} ({s.discord_id}){s.email ? ` · ${s.email}` : ''}</div>
            <div><span className="text-white/40">Signed in:</span> {when(s.created_at)} ({ago(s.created_at)}) via {INTENT[s.login_intent] || 'the website'}{s.login_intent === 'admin' ? ` · password ${s.gate_passed ? 'passed' : 'not passed'} · ${s.is_director ? 'director' : 'not a director'}` : ''}</div>
            <div><span className="text-white/40">Network:</span> {s.ip || '—'}{place ? ` · ${place}` : ''}{s.isp ? ` · ${s.isp}` : ''}</div>
            <div><span className="text-white/40">Device:</span> {s.browser} on {s.os} ({s.device_type}) · device {s.device_id || '—'}{s.fp_hash ? ` · fingerprint ${s.fp_hash}` : ''}</div>
            <div><span className="text-white/40">Discord servers shared:</span> {s.guild_count || 0} (full list in their sign-in entry)</div>
            {s.revoked_at && <div className="text-red-200/80">Logged out {when(s.revoked_at)} by {s.revoked_by || 'system'} — {s.revoke_reason}</div>}
            {!s.is_super_admin && (
              <button
                onClick={() => onRevokeUser(s)}
                disabled={busy}
                className="mt-2 px-2.5 py-1 text-[11px] font-bold text-red-200 bg-red-500/10 hover:bg-red-500/20 border border-red-400/30 rounded-lg disabled:opacity-40"
                aria-label={`Log ${s.username} out of every session`}
              >
                Log this person out everywhere
              </button>
            )}
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-300/50 mb-1">Live activity</div>
            {activity === null ? (
              <div className="text-[11px] text-white/40">Loading…</div>
            ) : activity.length === 0 ? (
              <div className="text-[11px] text-white/40">No recorded activity yet.</div>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-auto pr-1">
                {activity.map((a) => (
                  <li key={a.id} className="text-[11px] text-white/75 leading-snug">
                    <span className="text-white/35">{ago(a.occurred_at)} · </span>{a.summary}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SecurityPanel() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [banIpInput, setBanIpInput] = useState('')
  const [banReason, setBanReason] = useState('')
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/security', { cache: 'no-store' })
      if (!r.ok) throw new Error('failed')
      const j = await r.json()
      setData({
        sessions: Array.isArray(j.sessions) ? j.sessions : [],
        bans: Array.isArray(j.bans) ? j.bans : [],
        strikes: Array.isArray(j.strikes) ? j.strikes : [],
      })
    } catch {
      setData((d) => d || { sessions: [], bans: [], strikes: [] })
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  async function act(body, confirmText) {
    if (confirmText && !confirm(confirmText)) return
    setBusy(true)
    try {
      const r = await fetch('/api/admin/security', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({}))
      setNotice(r.ok ? 'Done.' : (j.error || 'That didn’t work.'))
      await load()
    } catch {
      setNotice('That didn’t work.')
    }
    setBusy(false)
    setTimeout(() => setNotice(''), 5000)
  }

  if (!data) return <div className="py-16 text-center text-white/40 text-sm">Loading…</div>

  const online = data.sessions.filter((s) => s.online)
  const recent = data.sessions.filter((s) => !s.online)
  const shownRecent = showAll ? recent : recent.slice(0, 25)
  const activeBans = data.bans.filter((b) => !b.lifted_at)
  const pastBans = data.bans.filter((b) => b.lifted_at)

  return (
    <div className="space-y-6">
      {notice && <div className="text-xs text-blue-200">{notice}</div>}

      {/* Sessions */}
      <section data-log-section="Security · sessions">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h2 className="text-lg font-black text-white">Signed in</h2>
          <span className="text-xs text-emerald-300">{online.length} online now</span>
          <div className="flex-1" />
          <button
            onClick={() => act({ action: 'revoke-all' }, 'Log EVERYONE out of the website (admin panel and Applications)? Super admins stay signed in.')}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-bold text-red-200 bg-red-500/10 hover:bg-red-500/20 border border-red-400/30 rounded-lg disabled:opacity-40"
          >
            Log out everyone
          </button>
        </div>
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden divide-y divide-white/5">
          {online.length === 0 && recent.length === 0 && (
            <div className="px-4 py-8 text-center text-white/40 text-sm">No sign-ins in the last 7 days.</div>
          )}
          {[...online, ...shownRecent].map((s) => (
            <SessionRow
              key={s.sid}
              s={s}
              busy={busy}
              onRevoke={(x) => act({ action: 'revoke', sid: x.sid }, `Log ${x.username} out of this session?`)}
              onRevokeUser={(x) => act({ action: 'revoke-user', discordId: x.discord_id }, `Log ${x.username} out of EVERY session?`)}
            />
          ))}
        </div>
        {recent.length > 25 && (
          <button onClick={() => setShowAll(!showAll)} className="mt-2 text-xs text-white/50 hover:text-white">
            {showAll ? 'Show fewer' : `Show all ${recent.length} recent sessions`}
          </button>
        )}
      </section>

      {/* Bans */}
      <section data-log-section="Security · blocked IPs">
        <h2 className="text-lg font-black text-white mb-2">Blocked IPs</h2>
        <div className="mb-3 p-3 rounded-xl bg-white/[0.03] border border-white/10 flex gap-2 flex-wrap">
          <input
            value={banIpInput}
            onChange={(e) => setBanIpInput(e.target.value)}
            placeholder="IP address to block"
            aria-label="IP address to block"
            className="flex-1 min-w-[160px] px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm"
          />
          <input
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            placeholder="Reason (optional)"
            aria-label="Reason for the block"
            className="flex-[2] min-w-[160px] px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm"
          />
          <button
            onClick={async () => { await act({ action: 'ban', ip: banIpInput.trim(), reason: banReason }, `Block ${banIpInput.trim()} from logins, the admin panel and Applications?`); setBanIpInput(''); setBanReason('') }}
            disabled={busy || !banIpInput.trim()}
            className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg disabled:opacity-40"
          >
            Block IP
          </button>
        </div>
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden divide-y divide-white/5">
          {activeBans.length === 0 && <div className="px-4 py-6 text-center text-white/40 text-sm">No IPs are blocked.</div>}
          {activeBans.map((b) => (
            <div key={b.id} className="px-4 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[13px] text-white">{b.ip}</span>
                  <Pill tone={b.auto ? 'amber' : 'red'}>{b.auto ? 'Automatic' : 'Manual'}</Pill>
                </div>
                <div className="text-[11px] text-white/50">
                  {b.reason} · {when(b.created_at)} by {b.created_by || 'system'}
                  {b.last_discord_id ? ` · last seen as ${b.last_discord_name || 'unknown'} (${b.last_discord_id})` : ' · never finished a Discord login'}
                </div>
              </div>
              <button
                onClick={() => act({ action: 'unban', id: b.id }, `Unblock ${b.ip}?`)}
                disabled={busy}
                className="shrink-0 px-2.5 py-1 text-[11px] font-bold text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 rounded-lg disabled:opacity-40"
                aria-label={`Unblock ${b.ip}`}
              >
                Unblock
              </button>
            </div>
          ))}
        </div>
        {pastBans.length > 0 && (
          <details className="mt-2">
            <summary className="text-xs text-white/45 cursor-pointer hover:text-white/70">Lifted in the last 30 days ({pastBans.length})</summary>
            <ul className="mt-2 space-y-1">
              {pastBans.map((b) => (
                <li key={b.id} className="text-[11px] text-white/50">
                  <span className="font-mono text-white/70">{b.ip}</span> · blocked {when(b.created_at)} · lifted {when(b.lifted_at)} by {b.lifted_by || 'system'}{b.lift_reason ? ` — ${b.lift_reason}` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Strikes */}
      <section data-log-section="Security · failed attempts">
        <h2 className="text-lg font-black text-white mb-2">Failed login attempts <span className="text-xs font-normal text-white/40">(last 7 days · 3 within 30 minutes blocks the IP)</span></h2>
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden divide-y divide-white/5">
          {data.strikes.length === 0 && <div className="px-4 py-6 text-center text-white/40 text-sm">No failed attempts.</div>}
          {data.strikes.map((s) => (
            <div key={s.id} className={`px-4 py-2 text-[12px] ${s.voided_at ? 'opacity-50' : ''}`}>
              <span className="text-white/40">{when(s.at)} · </span>
              <span className="font-mono text-white/80">{s.ip}</span>
              <span className="text-white/70"> — {s.kindLabel}</span>
              {s.discord_id ? <span className="text-white/60"> · {s.discord_name || 'unknown'} ({s.discord_id})</span> : null}
              {s.detail ? <span className="text-white/40"> · {s.detail}</span> : null}
              {s.voided_at ? <span className="text-white/40"> · not counted (website outage / unblocked)</span> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
