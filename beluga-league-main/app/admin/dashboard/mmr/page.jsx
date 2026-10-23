'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Avatar from '../../../components/Avatar'
import WinsRulePanel from './WinsRulePanel'

const API = '/api/admin/mmr'        // proxy → scraper (ACTIONS + sheet-backed reads)
const DB_API = '/api/admin/mmr-db'  // DB-direct (status/players/config/queue/events — works offline)

async function call(path, method = 'GET', body) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) } }
  catch { return { ok: res.ok, status: res.status, data: text } }
}

// Same shape as call(), but hits the website's DB-direct mirror of the scraper's
// read endpoints — so the panel populates even when the scraper is offline.
async function dbCall(path, method = 'GET', body) {
  const res = await fetch(`${DB_API}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) } }
  catch { return { ok: res.ok, status: res.status, data: text } }
}

function StatusPill({ status }) {
  const map = {
    running: 'bg-green-500/20 text-green-300 border-green-400/40',
    stopping: 'bg-yellow-500/20 text-yellow-200 border-yellow-400/40',
    stopped: 'bg-orange-500/20 text-orange-200 border-orange-400/40',
    done: 'bg-blue-500/20 text-blue-200 border-blue-400/40',
    error: 'bg-red-500/20 text-red-200 border-red-400/40',
    idle: 'bg-white/10 text-white/60 border-white/20',
  }
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${map[status] || map.idle}`}>
      {(status || 'idle').toUpperCase()}
    </span>
  )
}

// Pull a short account label out of a tracker URL for the source chip.
function sourceLabel(url) {
  if (!url) return null
  try {
    const parts = String(url).split('/').filter(Boolean)
    const i = parts.findIndex((p) => p === 'profile')
    if (i >= 0 && parts[i + 2]) return decodeURIComponent(parts[i + 2])
    return decodeURIComponent(parts.slice(-2, -1)[0] || parts.slice(-1)[0] || '')
  } catch { return null }
}

function Cat({ label, cell, source }) {
  const changed = cell && cell.changed
  const src = sourceLabel(source)
  return (
    <div className={`px-2 py-1 rounded ${changed ? 'bg-cyan-500/15 border border-cyan-400/30' : 'bg-white/5'}`}>
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="text-sm font-bold text-white">
        {cell ? (changed ? <span><span className="text-white/40 line-through mr-1">{cell.old || '—'}</span>{cell.new}</span> : (cell.new || '—')) : '—'}
      </div>
      {src && <div className="text-[10px] text-cyan-300/70 truncate" title={source}>from {src}</div>}
    </div>
  )
}

// Messages from the scraper carry a {mention} token (the bot swaps in the real
// Discord mention when posting); show the player's name in the panel preview.
function withMention(text, name) {
  return String(text || '').replace(/\{mention\}/g, `@${name}`)
}

// Friendly per-account status: OK / 404 (not found) / BLOCKED / ERROR.
function acctState(status) {
  if (status === 'OK') return { ok: true, label: 'OK' }
  if (status === 'NO_DATA') return { ok: false, label: '404' }
  if (status === 'CLOUDFLARE_BLOCKED') return { ok: false, label: 'BLOCKED', soft: true }
  return { ok: false, label: 'ERROR' }
}

const KIND_LABEL = {
  bulk: 'Bulk run', single: 'Single pull', register: 'Register pull',
  group: 'Group re-pull', blocked_retry: 'Blocked re-pull',
}
const KIND_CLS = {
  bulk: 'bg-green-500/20 text-green-200 border-green-400/40',
  single: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40',
  register: 'bg-indigo-500/20 text-indigo-200 border-indigo-400/40',
  group: 'bg-purple-500/20 text-purple-200 border-purple-400/40',
  blocked_retry: 'bg-amber-500/20 text-amber-200 border-amber-400/40',
}
function KindChip({ kind }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${KIND_CLS[kind] || 'bg-white/10 text-white/60 border-white/20'}`}>
      {KIND_LABEL[kind] || kind}
    </span>
  )
}

function fmtSecs(s) {
  s = Math.max(0, Math.round(Number(s) || 0))
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${s}s`
}
function fmtAgo(iso) {
  if (!iso) return ''
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString() } catch { return '' }
}

function PlayerCard({ p, member }) {
  const ch = p.changes || {}
  const cells = ch.cells || {}
  const best = p.best || {}
  const flip = ch.eligibility_flip
  const ap = p.applied || {}
  const name = member?.displayName || p.name || `Row ${p.row_index}`
  const accts = p.accounts || []
  const anyBlocked = accts.some(a => a.status === 'CLOUDFLARE_BLOCKED')
  const ping404 = (ap.queued || []).includes('tracker_404')
  return (
    <div className={`rounded-xl border p-3 ${p.any_invalid ? 'border-yellow-400/40 bg-yellow-500/5' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar src={member?.avatarUrl} name={name} size={32} ring={false} className="flex-shrink-0" />
          <div className="min-w-0">
            <div className="font-bold text-white truncate">{name}</div>
            <div className="text-[11px] text-white/40 truncate">
              row {p.row_index} · {p.league || '—'}
              {member?.discordUsername ? ` · @${member.discordUsername}` : ''}
              {p.updated_at ? ` · ${new Date(p.updated_at).toLocaleTimeString()}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {p.source === 'register' && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-200 border border-indigo-400/30" title="Queued by the /register command">from register command</span>}
          {p.source === 'rejoin' && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-200 border border-indigo-400/30" title="Queued because the member rejoined the server">rejoin</span>}
          {p.source === 'auto-hourly' && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30" title="Re-pulled by the hourly blocked retry">hourly retry</span>}
          {p.any_invalid && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-200 border border-yellow-400/30" title="A tracker returned 404 (not found) — player notified to open a ticket">404 TRACKER</span>}
          {ping404 && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30" title="Player pinged to open a ticket">pinged ticket</span>}
          {anyBlocked && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-200 border border-purple-400/30" title="A tracker was blocked by Cloudflare (valid, not invalid) — retried automatically every hour">BLOCKED</span>}
          {ch.mmr_withheld && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-500/20 text-orange-200 border border-orange-400/30" title="Not all trackers were pulled this run — MMR was held (only allowed to go up, never down)">MMR HELD</span>}
          {ch.insufficient && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-500/20 text-orange-200 border border-orange-400/30">INSUFFICIENT</span>}
          {flip === 'to_eligible' && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-500/20 text-green-200 border border-green-400/30">→ ELIGIBLE</span>}
          {(flip === 'to_ineligible' || flip === 'to_ineligible_new') && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-200 border border-red-400/30">→ INELIGIBLE{flip === 'to_ineligible' ? ' (staff)' : ''}</span>}
          {ch.eligible_now === true && !flip && <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-white/60">eligible</span>}
          {ch.eligible_now === false && !flip && <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-white/60">ineligible</span>}
          {ap.armed && !ap.error && (ap.written > 0 || (ap.queued || []).length > 0) && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/25 text-emerald-200 border border-emerald-400/40"
                  title={(ap.ranges || []).join(', ')}>
              WROTE {ap.written}{(ap.queued || []).length ? ` · pinged` : ''}
            </span>
          )}
          {ap.armed && ap.error && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/25 text-red-200 border border-red-400/40" title={ap.error}>WRITE FAILED</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
        <Cat label="2s peak" cell={cells.peak_2s} source={best.peak_2s?.source} />
        <Cat label="3s peak" cell={cells.peak_3s} source={best.peak_3s?.source} />
        <Cat label="2s cur" cell={cells.cur_2s} source={best.cur_2s?.source} />
        <Cat label="3s cur" cell={cells.cur_3s} source={best.cur_3s?.source} />
      </div>

      {cells.win_rating && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
          <Cat label="win rating" cell={cells.win_rating} />
        </div>
      )}

      <div className="flex flex-wrap gap-1 mb-1">
        {accts.map((a, i) => {
          const st = acctState(a.status)
          const cls = st.ok
            ? 'bg-white/5 border-white/10 text-white/60'
            : st.soft
              ? 'bg-purple-500/10 border-purple-400/30 text-purple-300'
              : 'bg-red-500/10 border-red-400/30 text-red-300'
          return (
            <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`} title={`${a.url}\n${a.status}${a.detail ? ' — ' + a.detail : ''}${a.via ? '\nvia ' + a.via : ''}`}>
              {a.label}:{a.platform}/{String(a.identifier).slice(0, 14)} · {st.label}
            </span>
          )
        })}
      </div>

      {(ch.main_games_2s != null) && (
        <div className="text-[11px] text-white/50">main games — 2s: {ch.main_games_2s}, 3s: {ch.main_games_3s} (need 25 each)</div>
      )}
      {ch.wins && (
        ch.wins.fallback ? (
          <div className="text-[11px] text-amber-200/80">lifetime wins not checked — {ch.wins.fallback} (decided on games)</div>
        ) : (
          <div className={`text-[11px] ${ch.wins.ok ? 'text-white/50' : 'text-red-300/90'}`}>
            main lifetime wins {Number(ch.wins.wins).toLocaleString()} — {ch.wins.division}{ch.wins.source === 'N' ? ' (projected from column N)' : ''} minimum {Number(ch.wins.min).toLocaleString()}
            {ch.wins.ok ? ' ✓' : ` · needs ${Number(ch.wins.need).toLocaleString()} more`}
          </div>
        )
      )}
      {ch.wins_notice && (
        <div className="mt-1.5 text-[11px] text-amber-200/90 bg-amber-500/10 border border-amber-400/20 rounded p-2">
          WINS PING{(ap.queued || []).includes('wins_ping') ? ' (posted ✓)' : ' (only sent the first time)'}: {withMention(ch.wins_notice, name)}
        </div>
      )}
      {ch.staff_report && (
        <div className="mt-1.5 text-[11px] text-red-200/90 bg-red-500/10 border border-red-400/20 rounded p-2 whitespace-pre-wrap">
          STAFF REVIEW{(ap.queued || []).includes('staff_report') ? ' (posted ✓)' : ''}: {withMention(ch.staff_report, name)}
        </div>
      )}
      {ch.ping && (
        <div className="mt-1.5 text-[11px] text-green-200/90 bg-green-500/10 border border-green-400/20 rounded p-2">
          PLAYER PING{(ap.queued || []).includes('player_ping') ? ' (posted ✓)' : ''}: {withMention(ch.ping, name)}
        </div>
      )}
    </div>
  )
}

// A small ON/OFF switch for a DB-backed toggle.
function BotToggle({ label, hint, on, saving, value, onToggle, ariaLabel }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10">
      <div className="min-w-0">
        <div className="text-xs font-bold text-white truncate">{label}</div>
        <div className="text-[10px] text-white/40 truncate">{hint}{value !== undefined ? <> · DB value: <span className="font-mono text-white/60">{value || '—'}</span></> : null}</div>
      </div>
      <button
        onClick={() => onToggle(!on)}
        disabled={saving}
        aria-label={ariaLabel || label}
        title={on ? 'Click to turn OFF' : 'Click to turn ON'}
        className={`relative p-0 w-12 h-6 rounded-full border transition-colors shrink-0 disabled:opacity-50 ${on ? 'bg-green-500/40 border-green-400/60' : 'bg-white/10 border-white/20'}`}
      >
        <span className={`absolute top-0.5 ${on ? 'left-6' : 'left-0.5'} w-5 h-5 rounded-full transition-all ${on ? 'bg-green-200' : 'bg-white/60'}`} />
      </button>
    </div>
  )
}

// ── LIVE "Currently" panel ────────────────────────────────────────────────────
// Renders the scraper's live state for ANY job kind (bulk, single, register,
// blocked re-pull): who it is pulling, which tracker (n of m), the step, and when
// blocked — a retry bar (attempt n/max), the block kind + HTTP code, the backoff
// countdown, and the identity/egress in use. Falls back to the last-known bulk
// line when nothing is active.
function LiveNow({ snap, memberMap, tick }) {
  const live = snap?.live
  const active = Boolean(snap?.active)
  const cur = snap?.current || {}
  const job = live?.job || {}
  const pool = live?.pool || {}
  const member = cur.discord_id ? memberMap[String(cur.discord_id)] : null
  const name = member?.displayName || cur.name
  const waitLeft = cur.wait_until ? Math.max(0, cur.wait_until - tick / 1000) : 0
  const blocked = Boolean(cur.block_kind)
  const step = cur.step || ''
  const stepLabel = {
    reading_sheet: 'reading the SalSheet', warming_up: 'warming up a fresh browser identity',
    fetching: 'fetching tracker', retrying: 'blocked — waiting to retry', parsing: 'computing changes',
    writing: 'applying / recording', cooldown: 'cooling down (all egress blocked)',
    rotating_ip: 'rotating the host IP', paused: 'paused for a more urgent job', done: 'done',
  }[step] || step
  const attempts = cur.max_attempts || 0
  const barCls = step === 'cooldown' ? 'bg-orange-400' : blocked ? 'bg-red-400' : 'bg-cyan-400'
  const c = live?.counters || {}
  const total = c.total || 0

  return (
    <div className={`rounded-xl border p-4 ${active ? (blocked || step === 'cooldown' ? 'border-red-400/40 bg-red-500/[0.05]' : 'border-cyan-400/30 bg-cyan-500/[0.04]') : 'border-white/10 bg-white/[0.03]'}`} data-log-section="mmr-live">
      <div className="text-white/60 text-sm mb-1 flex items-center gap-2 flex-wrap">
        Currently
        {active && <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" /></span>}
        {active && job.kind && <KindChip kind={job.kind} />}
        {active && job.source && job.source !== 'manual' && <span className="text-[10px] text-white/40">from {job.source}</span>}
        {active && job.id && <span className="text-[10px] text-white/30">job #{job.id}</span>}
        {!active && live?.updated_at && <span className="text-[10px] text-white/30">scraper idle · last seen {fmtAgo(live.updated_at)}</span>}
      </div>

      {active ? (
        <>
          <div className="flex items-center gap-2 min-w-0">
            {member && <Avatar src={member.avatarUrl} name={name} size={28} ring={false} className="flex-shrink-0" />}
            <div className="min-w-0">
              <div className="font-bold text-white truncate">{name || '…'}{cur.row_index ? <span className="text-white/40 font-normal text-xs"> · row {cur.row_index}</span> : null}</div>
              <div className="text-xs text-cyan-300/80 truncate">
                {stepLabel}
                {cur.label ? ` · ${cur.label}` : ''}
                {cur.tracker_count ? ` · tracker ${cur.tracker_index}/${cur.tracker_count}` : ''}
                {total > 1 ? ` · player ${c.completed + 1 > total ? total : c.completed + 1}/${total}` : ''}
              </div>
              <div className="text-[11px] text-white/40 truncate">{cur.tracker || ''}</div>
            </div>
          </div>

          {/* retry / cooldown bar */}
          {(attempts > 0 && (blocked || step === 'retrying' || step === 'cooldown')) && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className={blocked ? 'text-red-200' : 'text-white/60'}>
                  {step === 'cooldown' ? 'cooldown' : `attempt ${Math.min(cur.attempt || 0, attempts)} of ${attempts}`}
                  {cur.block_kind ? ` · ${cur.block_kind} block${cur.http ? ` (HTTP ${cur.http})` : ''}` : ''}
                </span>
                {waitLeft > 0 && <span className="text-white/60 font-mono">{step === 'cooldown' ? 'resumes in' : 'next try in'} {fmtSecs(waitLeft)}</span>}
              </div>
              <div className="flex gap-1">
                {Array.from({ length: Math.max(attempts, 1) }).map((_, i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded ${i < (cur.attempt || 0) ? barCls : 'bg-white/10'}`} />
                ))}
              </div>
            </div>
          )}
          {cur.note && <div className={`mt-1.5 text-[11px] ${blocked || step === 'cooldown' ? 'text-red-200/80' : 'text-white/50'}`}>{cur.note}</div>}

          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
            {cur.identity && <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/60" title="Browser fingerprint @ egress in use">identity {cur.identity}</span>}
            {(pool.endpoints || []).map((e) => (
              <span key={e.label} className={`px-1.5 py-0.5 rounded border ${e.cooling ? 'bg-red-500/10 border-red-400/30 text-red-200' : 'bg-green-500/10 border-green-400/30 text-green-200'}`}
                    title={`${e.ok} ok · ${e.blocked} blocked · ${e.consecutive_blocks} in a row`}>
                {e.direct ? 'host IP' : e.label}: {e.cooling ? `cooling ${fmtSecs(e.cooling_left_s)}` : 'healthy'} · {e.ok}✓ {e.blocked}⛔
              </span>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="font-bold text-white truncate">idle</div>
          <div className="text-xs text-white/40 truncate">last: {cur.name || '—'}{cur.step ? ` · ${cur.step}` : ''}</div>
          {(pool.endpoints || []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
              {pool.endpoints.map((e) => (
                <span key={e.label} className={`px-1.5 py-0.5 rounded border ${e.cooling ? 'bg-red-500/10 border-red-400/30 text-red-200' : 'bg-white/5 border-white/10 text-white/50'}`}>
                  {e.direct ? 'host IP' : e.label}: {e.cooling ? `cooling ${fmtSecs(e.cooling_left_s)}` : 'ok'} · {e.ok}✓ {e.blocked}⛔
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Queue panel ───────────────────────────────────────────────────────────────
function jobTitle(j) {
  const n = (j.rows || []).length
  const base = KIND_LABEL[j.kind] || j.kind
  if (j.kind === 'bulk') return j.resume ? 'Bulk run (resume from checkpoint)' : 'Bulk run (fresh start)'
  return `${base} · ${n} player${n === 1 ? '' : 's'}`
}

function QueuePanel({ queue, memberMap, players, onCancel, onStop, onRetryBlocked, onToggleAuto, autoSaving, busy, offline, tick }) {
  const running = queue?.running
  const queued = queue?.queued || []
  const recent = queue?.recent || []
  const auto = queue?.auto_retry || {}
  const rot = queue?.rotation || {}
  const nextIn = auto.next_at ? Math.max(0, auto.next_at - tick / 1000) : null
  const byRow = {}
  for (const p of players) byRow[p.row_index] = p
  const rowNames = (rows) => (rows || []).slice(0, 6).map((r) => {
    const p = byRow[r]
    const m = p?.discord_id ? memberMap[String(p.discord_id)] : null
    return m?.displayName || p?.name || `row ${r}`
  })

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4" data-log-section="mmr-queue">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="text-sm font-bold text-white">Queue <span className="font-normal text-white/40">· one job runs at a time; small jobs jump ahead of a bulk run</span></div>
        <div className="flex items-center gap-2 flex-wrap">
          <button disabled={busy || offline || !auto.blocked} onClick={onRetryBlocked} aria-label="Re-pull all blocked players now"
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-100 border border-amber-400/40 text-xs font-bold disabled:opacity-40 hover:bg-amber-500/30">
            ⟳ Re-pull blocked now ({auto.blocked || 0})
          </button>
        </div>
      </div>

      {/* hourly auto-retry */}
      <div className="grid sm:grid-cols-2 gap-2 mb-3">
        <BotToggle
          label="Auto re-pull blocked players every hour"
          hint={auto.enabled
            ? (auto.blocked ? `${auto.blocked} blocked · next run in ${fmtSecs(nextIn)}` : 'nobody blocked · nothing to do')
            : 'off — blocked players wait for a manual re-pull'}
          on={Boolean(auto.enabled)}
          saving={autoSaving}
          onToggle={onToggleAuto}
          ariaLabel="Toggle hourly automatic re-pull of blocked players"
        />
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10">
          <div className="min-w-0">
            <div className="text-xs font-bold text-white">Smart IP rotation</div>
            <div className="text-[10px] text-white/40 break-words">
              blocked → new fingerprint → other egress → cooldown → new host IP
              {rot.last_at ? ` · last rotated ${fmtAgo(new Date(rot.last_at * 1000).toISOString())}` : ' · never rotated'}
            </div>
          </div>
        </div>
      </div>

      {/* running */}
      <div className="mb-2">
        <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">Running</div>
        {running ? (
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-green-500/[0.07] border border-green-400/30 flex-wrap">
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              <KindChip kind={running.kind} />
              <span className="text-sm text-white font-semibold">{jobTitle(running)}</span>
              {running.progress?.total ? <span className="text-xs text-white/50">{running.progress.completed || 0}/{running.progress.total}</span> : null}
              {running.source && running.source !== 'manual' && <span className="text-[10px] text-white/40">from {running.source}</span>}
              <span className="text-[10px] text-white/30">#{running.id} · started {fmtAgo(running.started_at)}</span>
              {running.kind !== 'bulk' && (running.rows || []).length ? <span className="text-[11px] text-white/50 truncate max-w-full">{rowNames(running.rows).join(', ')}{running.rows.length > 6 ? ` +${running.rows.length - 6}` : ''}</span> : null}
            </div>
            <button disabled={busy || offline} onClick={onStop} aria-label="Stop the running job"
                    className="px-3 py-1 rounded-lg bg-yellow-500/20 text-yellow-200 border border-yellow-400/40 text-xs font-bold disabled:opacity-40">⏸ Stop</button>
          </div>
        ) : (
          <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/10 text-xs text-white/40">nothing running</div>
        )}
      </div>

      {/* queued */}
      <div className="mb-2">
        <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">Up next ({queued.length})</div>
        {queued.length === 0 ? (
          <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/10 text-xs text-white/40">queue is empty — the next click starts immediately</div>
        ) : (
          <div className="space-y-1">
            {queued.map((j, i) => (
              <div key={j.id} className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border flex-wrap ${i === 0 ? 'bg-cyan-500/[0.06] border-cyan-400/30' : 'bg-white/[0.02] border-white/10'}`}>
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono text-white/40 w-5">{i + 1}.</span>
                  <KindChip kind={j.kind} />
                  <span className="text-sm text-white">{jobTitle(j)}</span>
                  {j.resume && j.kind !== 'bulk' && <span className="text-[10px] text-white/40">(resuming)</span>}
                  {j.source && j.source !== 'manual' && <span className="text-[10px] text-white/40">from {j.source}</span>}
                  {j.message && <span className="text-[10px] text-orange-200/70">{j.message}</span>}
                  <span className="text-[10px] text-white/30">#{j.id} · added {fmtAgo(j.created_at)}</span>
                  {j.kind !== 'bulk' && (j.rows || []).length ? <span className="text-[11px] text-white/50 truncate max-w-full">{rowNames(j.rows).join(', ')}{j.rows.length > 6 ? ` +${j.rows.length - 6}` : ''}</span> : null}
                </div>
                <button disabled={busy || offline} onClick={() => onCancel(j.id)} aria-label={`Cancel queued job ${j.id}`}
                        className="px-2 py-1 rounded bg-white/5 text-white/60 border border-white/10 text-[11px] hover:bg-red-500/20 hover:text-red-200 disabled:opacity-40">cancel</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* recent */}
      {recent.length > 0 && (
        <details className="mt-2">
          <summary className="text-[11px] uppercase tracking-wider text-white/40 cursor-pointer">Recently finished ({recent.length})</summary>
          <div className="mt-1 space-y-1">
            {recent.map((j) => {
              const cnt = j.progress?.counters
              return (
                <div key={j.id} className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white/[0.02] border border-white/5 text-[11px] flex-wrap">
                  <KindChip kind={j.kind} />
                  <span className="text-white/70">{jobTitle(j)}</span>
                  <span className={`font-bold ${j.status === 'done' ? 'text-green-300/80' : j.status === 'failed' ? 'text-red-300' : 'text-orange-200/80'}`}>{j.status}</span>
                  {cnt ? <span className="text-white/40">{cnt.ok} ok · {cnt.no_data} no-data · {cnt.blocked} blocked</span> : null}
                  {j.error && <span className="text-red-300/80 truncate max-w-[40ch]" title={j.error}>{j.error}</span>}
                  <span className="text-white/30">#{j.id} · {fmtAgo(j.finished_at)}</span>
                </div>
              )
            })}
          </div>
        </details>
      )}
    </div>
  )
}

// ── Proxies box ───────────────────────────────────────────────────────────────
function ProxiesPanel({ config, onSave, onClear, onTest, testing, testResults, offline }) {
  const [text, setText] = useState('')
  const count = config.proxies_count || 0
  const masked = config.proxies_masked || []
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4" data-log-section="mmr-proxies">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="text-sm font-bold text-white">Proxies <span className="font-normal text-white/40">· optional residential egress; the scraper works without them</span></div>
        <div className="flex items-center gap-2">
          <button disabled={offline || testing} onClick={() => onTest(text)} aria-label="Test proxies"
                  className="px-3 py-1.5 rounded-lg bg-white/5 text-white/80 border border-white/20 text-xs font-bold disabled:opacity-40">{testing ? 'testing…' : 'Test'}</button>
          <button disabled={!text.trim()} onClick={() => { onSave(text); setText('') }} aria-label="Save proxy list"
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 text-xs font-bold disabled:opacity-40">Save (replace list)</button>
          {count > 0 && <button onClick={onClear} aria-label="Clear proxy list"
                  className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-200 border border-red-400/30 text-xs font-bold">Clear</button>}
        </div>
      </div>
      <div className="text-[11px] text-white/50 mb-2">
        {count ? <>Configured: <span className="text-white/80 font-mono">{masked.join(', ')}</span> <span className="text-white/30">({count}, credentials hidden)</span></> : 'No proxies configured — using the host IP only.'}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} data-log-ignore
                placeholder={"One proxy per line, e.g.\nhttp://user:pass@host:port\nsocks5://user:pass@host:port\n(paste to REPLACE the whole list; leave empty to keep it)"}
                className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-xs font-mono placeholder-white/25 focus:outline-none focus:border-cyan-400/50" />
      {testResults && (
        <div className="mt-2 space-y-1">
          {(testResults.results || []).map((r, i) => (
            <div key={i} className={`flex items-center gap-2 text-[11px] px-2 py-1 rounded border ${r.ok ? 'bg-green-500/10 border-green-400/30 text-green-200' : 'bg-red-500/10 border-red-400/30 text-red-200'}`}>
              <span className="font-mono">{r.direct ? 'host IP' : r.egress}</span>
              <span className="font-bold">{r.ok ? 'OK' : r.status}</span>
              {r.http ? <span>HTTP {r.http}</span> : null}
              <span className="text-white/40">{r.latency_ms} ms</span>
              {r.identity && <span className="text-white/40">{r.identity}</span>}
              {r.detail && !r.ok && <span className="text-white/60 truncate">{r.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ActivityFeed({ events }) {
  if (!events?.length) return null
  return (
    <details className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4" data-log-section="mmr-activity" open>
      <summary className="text-sm font-bold text-white cursor-pointer">Activity <span className="font-normal text-white/40">· what the scraper did and why</span></summary>
      <div className="mt-2 max-h-56 overflow-y-auto space-y-0.5">
        {events.map((e) => (
          <div key={e.id} className="flex gap-2 text-[11px]">
            <span className="text-white/30 font-mono shrink-0">{fmtTime(e.at)}</span>
            <span className={`shrink-0 w-12 ${e.level === 'error' ? 'text-red-300' : e.level === 'warn' ? 'text-amber-200' : 'text-white/40'}`}>{e.kind || e.level}</span>
            <span className={e.level === 'error' ? 'text-red-200' : e.level === 'warn' ? 'text-amber-100/90' : 'text-white/70'}>{e.message}</span>
          </div>
        ))}
      </div>
    </details>
  )
}

export default function MmrUpdaterPage() {
  const [snap, setSnap] = useState(null)
  const [players, setPlayers] = useState([])
  const [queue, setQueue] = useState(null)
  const [events, setEvents] = useState([])
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [offline, setOffline] = useState(false) // scraper service unreachable/timed out
  const [config, setConfig] = useState({ player_ping_channel_id: '', staff_review_channel_id: '', tracker_404_channel_id: '', write_armed: '', auto_sal_lock_enabled: '', auto_roling_naming_enabled: '', auto_retry_blocked_enabled: '', proxies_masked: [], proxies_count: 0 })
  const [toggleSaving, setToggleSaving] = useState('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [armStep, setArmStep] = useState(0)
  const [saveState, setSaveState] = useState('')
  const [toast, setToast] = useState(null) // {text, bad}
  const [proxyTesting, setProxyTesting] = useState(false)
  const [proxyResults, setProxyResults] = useState(null)
  const [tick, setTick] = useState(Date.now()) // drives countdowns between polls

  const [memberMap, setMemberMap] = useState({})
  const [sheetSet, setSheetSet] = useState(new Set())
  const [sheetRow, setSheetRow] = useState({})

  const timer = useRef(null)
  const searchTimer = useRef(null)
  const editingChannels = useRef(false)
  const inflight = useRef(false)
  const toastTimer = useRef(null)

  const showToast = useCallback((text, bad = false) => {
    setToast({ text, bad })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  const refresh = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const [s, p, q] = await Promise.all([dbCall('status'), dbCall('players?limit=2000'), dbCall('queue')])
      if (s.ok) setSnap(s.data)
      if (q.ok && q.data && typeof q.data === 'object') setQueue(q.data)
      if (p.ok && Array.isArray(p.data)) {
        setPlayers(prev => {
          if (p.data.length > 0) return p.data
          if (prev.length === 0) return p.data
          return prev
        })
        setLoadedOnce(true)
      }
      if (!editingChannels.current) {
        const r = await dbCall('config')
        if (r.ok && r.data && typeof r.data === 'object') setConfig(r.data)
      }
      setTick(Date.now())
    } finally {
      inflight.current = false
    }
  }, [])

  const loadEvents = useCallback(async () => {
    const r = await dbCall('events?limit=40')
    if (r.ok && Array.isArray(r.data)) setEvents(r.data)
  }, [])

  const pingScraper = useCallback(async () => {
    const h = await call('health')
    setOffline(!h.ok)
  }, [])

  const loadMembers = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/players', { cache: 'no-store' })
      const d = await r.json()
      const map = {}
      for (const pl of d.players || []) map[String(pl.discordId)] = pl
      setMemberMap(map)
    } catch { /* directory optional — cards fall back to sheet name */ }
  }, [])

  const loadSheetIndex = useCallback(async () => {
    const r = await call('sheet-index')
    if (r.ok && Array.isArray(r.data)) {
      const set = new Set()
      const rowMap = {}
      for (const e of r.data) {
        if (!e.discord_id) continue
        set.add(String(e.discord_id))
        rowMap[String(e.discord_id)] = e.row_index
      }
      setSheetSet(set)
      setSheetRow(rowMap)
    }
  }, [])

  useEffect(() => {
    refresh()
    loadEvents()
    loadMembers()
    loadSheetIndex()
    pingScraper()
    timer.current = setInterval(refresh, 1000)
    const ev = setInterval(loadEvents, 5000)
    const ping = setInterval(pingScraper, 12000)
    const slow = setInterval(() => { loadMembers(); loadSheetIndex() }, 60000)
    const t = setInterval(() => setTick(Date.now()), 500)
    return () => { clearInterval(timer.current); clearInterval(ev); clearInterval(ping); clearInterval(slow); clearInterval(t) }
  }, [refresh, loadEvents, loadMembers, loadSheetIndex, pingScraper])

  // Every action ENQUEUES (never "already running"); surface the queue answer.
  const action = async (path, method = 'POST', body, label) => {
    setBusy(true)
    try {
      const r = await call(path, method, body)
      const d = r.data && typeof r.data === 'object' ? r.data : {}
      if (!r.ok) showToast(d.error || `${label || path} failed (${r.status})`, true)
      else if (d.queued) showToast(`${label || 'Job'}: ${d.message || 'added to the queue'}${d.will_start === 'now' ? ' — starting now' : ''}`)
      else if (d.stopping) showToast('Stopping the running job…')
      else if (d.rotated) showToast('Redeploy requested — the scraper comes back on a new IP in ~1–2 min')
      else if (d.rotated === false) showToast(`Reset IP not done: ${d.reason}`, true)
      else if (d.cancelled) showToast(`Cancelled job #${d.id}`)
      else if (d.message) showToast(d.message)
      await refresh()
      loadEvents()
    } finally { setBusy(false) }
  }

  const doSearch = (q) => {
    setSearch(q)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (q.trim().length < 2) { setResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await fetch(`/api/admin/players?search=${encodeURIComponent(q.trim())}`, { cache: 'no-store' })
        const d = await r.json()
        setResults((d.players || []).slice(0, 15))
      } catch { setResults([]) } finally { setSearching(false) }
    }, 250)
  }

  const saveChannels = async () => {
    setSaveState('saving')
    const res = await dbCall('config', 'POST', {
      player_ping_channel_id: config.player_ping_channel_id || '',
      staff_review_channel_id: config.staff_review_channel_id || '',
      tracker_404_channel_id: config.tracker_404_channel_id || '',
    })
    const r = await dbCall('config')
    editingChannels.current = false
    if (r.ok && r.data && typeof r.data === 'object') {
      setConfig(r.data)
      const ok = res.ok &&
        String(r.data.player_ping_channel_id || '') === String(config.player_ping_channel_id || '') &&
        String(r.data.staff_review_channel_id || '') === String(config.staff_review_channel_id || '')
      setSaveState(ok ? 'saved' : 'error')
    } else {
      setSaveState('error')
    }
    setTimeout(() => setSaveState(''), 2500)
  }

  const armWrite = async () => {
    if (armStep === 0) { setArmStep(1); return }
    await dbCall('config', 'POST', { write_armed: true, confirm: true })
    const r = await dbCall('config'); if (r.ok) setConfig(r.data)
    setArmStep(0)
  }
  const disarmWrite = async () => {
    await dbCall('config', 'POST', { write_armed: false })
    const r = await dbCall('config'); if (r.ok) setConfig(r.data)
    setArmStep(0)
  }

  const toggleBot = async (key, nextOn) => {
    setToggleSaving(key)
    setConfig(c => ({ ...c, [key]: nextOn ? '2' : '0' }))
    await dbCall('config', 'POST', { [key]: nextOn ? '2' : '0' })
    const r = await dbCall('config'); if (r.ok && r.data && typeof r.data === 'object') setConfig(r.data)
    setToggleSaving('')
  }
  const toggleAutoRetry = async (nextOn) => {
    setToggleSaving('auto_retry_blocked_enabled')
    await dbCall('config', 'POST', { auto_retry_blocked_enabled: nextOn ? '1' : '0' })
    await refresh()
    setToggleSaving('')
    showToast(nextOn ? 'Hourly blocked re-pull ON' : 'Hourly blocked re-pull OFF')
  }

  // Proxy list: saved via the scraper (so its pool reloads instantly) with the DB
  // route as a fallback when the scraper is offline. Never echoed back.
  const saveProxies = async (text) => {
    const r = offline ? await dbCall('config', 'POST', { proxies: text }) : await call('config', 'POST', { proxies: text })
    if (r.ok) { showToast(`Proxy list saved (${r.data?.proxies_count ?? '?'} proxies)`); setProxyResults(null) }
    else showToast('Saving proxies failed', true)
    await refresh()
  }
  const clearProxies = async () => {
    const r = offline ? await dbCall('config', 'POST', { proxies: '' }) : await call('config', 'POST', { proxies: '' })
    showToast(r.ok ? 'Proxy list cleared — host IP only' : 'Clearing proxies failed', !r.ok)
    setProxyResults(null)
    await refresh()
  }
  const testProxies = async (text) => {
    setProxyTesting(true)
    setProxyResults(null)
    try {
      const r = await call('proxies/test', 'POST', text.trim() ? { proxies: text } : {})
      if (r.ok && r.data && typeof r.data === 'object') setProxyResults(r.data)
      else showToast('Proxy test failed', true)
    } finally { setProxyTesting(false) }
  }

  const c = snap?.counters || {}
  const cp = snap?.checkpoint || {}
  const active = Boolean(snap?.active)
  const armed = config.write_armed === '1'
  const pct = c.total ? Math.round((c.completed / c.total) * 100) : 0

  const blocked = players.filter((p) => (p.accounts || []).some((a) => a.status === 'CLOUDFLARE_BLOCKED'))
  const queuedRows = new Set()
  for (const j of queue?.queued || []) for (const r of j.rows || []) queuedRows.add(r)
  const runningRows = new Set(queue?.running?.rows || [])

  const toggleOn = (v) => ['1', '2', 'on', 'yes', 'true'].includes(String(v ?? '').trim().toLowerCase())
  const salLockOn = toggleOn(config.auto_sal_lock_enabled)
  const roleSyncOn = toggleOn(config.auto_roling_naming_enabled)

  const rowState = (row) => runningRows.has(row) ? 'running' : queuedRows.has(row) ? 'queued' : null

  return (
    <div className="max-w-6xl">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg border text-sm shadow-lg ${toast.bad ? 'bg-red-900/90 border-red-400/50 text-red-100' : 'bg-cyan-900/90 border-cyan-400/50 text-cyan-50'}`} role="status">{toast.text}</div>
      )}

      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">MMR Updater</h1>
          <p className="text-sm text-white/50">Pull peak/current 2s &amp; 3s MMR from Tracker Network · {armed ? <span className="text-red-300 font-bold">LIVE WRITES ARMED</span> : 'dry-run (no sheet writes)'}</p>
        </div>
        <div className="flex flex-col items-start lg:items-end gap-2 w-full lg:w-auto">
          <div className="flex items-center gap-2">
            {active && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-500/20 text-green-200 border border-green-400/40">WORKING</span>}
            <StatusPill status={snap?.status} />
          </div>
          <div className="w-full lg:w-72 space-y-2">
            <BotToggle
              label="Auto Sal Lock Updates"
              hint="locks col O & posts salary changes"
              on={salLockOn}
              saving={toggleSaving === 'auto_sal_lock_enabled'}
              value={config.auto_sal_lock_enabled}
              onToggle={(next) => toggleBot('auto_sal_lock_enabled', next)}
            />
            <BotToggle
              label="Auto Roling and Naming System"
              hint="syncs roles & nicknames from the sheet"
              on={roleSyncOn}
              saving={toggleSaving === 'auto_roling_naming_enabled'}
              value={config.auto_roling_naming_enabled}
              onToggle={(next) => toggleBot('auto_roling_naming_enabled', next)}
            />
          </div>
        </div>
      </div>

      {offline && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-amber-400/40 bg-amber-500/10 text-sm text-amber-100">
          <span className="font-bold">⚠ Scraper offline — showing saved pulls, queue &amp; configuration from the database.</span>{' '}
          Queue actions (Start / Stop / pulls / Reset IP) need the scraper online — restart the <span className="font-mono">rl-scraper</span> service on Railway.
          {' '}Queued jobs are kept and run when it comes back.
        </div>
      )}

      {/* Controls — everything queues; nothing is ignored because something else is running */}
      <div className="flex flex-wrap gap-2 mb-4" data-log-section="mmr-controls">
        <button disabled={busy || offline} onClick={() => action('run', 'POST', undefined, 'Bulk run')} className="px-4 py-2 rounded-lg bg-green-500/20 text-green-200 border border-green-400/40 font-bold text-sm disabled:opacity-40 hover:bg-green-500/30">▶ Start (reset checkpoint)</button>
        <button disabled={busy || !active || offline} onClick={() => action('stop', 'POST', undefined, 'Stop')} className="px-4 py-2 rounded-lg bg-yellow-500/20 text-yellow-200 border border-yellow-400/40 font-bold text-sm disabled:opacity-40 hover:bg-yellow-500/30">⏸ Stop current job</button>
        <button disabled={busy || offline || !cp.has_checkpoint} onClick={() => action('resume', 'POST', undefined, 'Resume')} className="px-4 py-2 rounded-lg bg-blue-500/20 text-blue-200 border border-blue-400/40 font-bold text-sm disabled:opacity-40 hover:bg-blue-500/30">⏵ Resume from checkpoint</button>
        <button disabled={busy || offline} onClick={() => action('rotate-ip', 'POST', undefined, 'Reset IP')} className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-200 border border-purple-400/40 font-bold text-sm disabled:opacity-40 hover:bg-purple-500/30">⟳ Reset IP (redeploy)</button>
      </div>

      {/* Progress + LIVE current */}
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-white/60">Bulk run progress</span>
            <span className="font-bold text-white">{c.completed || 0} / {c.total || 0} ({pct}%)</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-cyan-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-3 mt-2 text-xs">
            <span className="text-green-300/80">✓ {c.ok || 0} ok</span>
            <span className="text-yellow-300/70">⚠ {c.no_data || 0} no-data</span>
            <span className="text-red-300/70">⛔ {c.blocked || 0} blocked</span>
            <span className="text-red-300/70">✖ {c.error || 0} error</span>
            {snap?.rate_per_s ? <span className="text-white/40">rate {snap.rate_per_s}/s</span> : null}
            {snap?.eta_s ? <span className="text-white/40">ETA {Math.round(snap.eta_s / 60)}m</span> : null}
          </div>
          {(c.skipped_left || c.skipped_no_id || c.skipped_no_tracker) ? (
            <div className="text-[11px] text-white/35 mt-1" title="Players NOT pulled this bulk run">
              skipped: {c.skipped_left || 0} left server · {c.skipped_no_id || 0} no Discord ID · {c.skipped_no_tracker || 0} no tracker
            </div>
          ) : null}
          {cp.has_checkpoint && <div className="text-[11px] text-orange-300/70 mt-1">checkpoint: {cp.done} done · {cp.status} (single updates don&apos;t reset it)</div>}
          {snap?.message && <div className="text-[11px] text-white/40 mt-1">{snap.message}</div>}
        </div>
        <LiveNow snap={snap} memberMap={memberMap} tick={tick} />
      </div>

      <QueuePanel
        queue={queue} memberMap={memberMap} players={players} tick={tick}
        busy={busy} offline={offline}
        onCancel={(id) => action('queue/cancel', 'POST', { id }, 'Cancel')}
        onStop={() => action('stop', 'POST', undefined, 'Stop')}
        onRetryBlocked={() => action('retry-blocked', 'POST', undefined, 'Blocked re-pull')}
        onToggleAuto={toggleAutoRetry}
        autoSaving={toggleSaving === 'auto_retry_blocked_enabled'}
      />

      {/* Blocked-last-run group */}
      {blocked.length > 0 && (
        <div className="rounded-xl border border-purple-400/30 bg-purple-500/[0.06] p-4 mb-4" data-log-section="mmr-blocked">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="text-sm font-bold text-purple-100">
              Blocked last pull ({blocked.length})
              <span className="font-normal text-white/40"> · Cloudflare-blocked trackers — retried every hour automatically; click to re-pull now</span>
            </div>
            <button disabled={busy || offline} onClick={() => action('update-players', 'POST', { rows: blocked.map((p) => p.row_index) }, 'Group re-pull')}
                    className="px-3 py-1.5 rounded-lg bg-purple-500/25 text-purple-100 border border-purple-400/50 text-xs font-bold disabled:opacity-40 hover:bg-purple-500/35">⟳ Re-pull all blocked</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {blocked.map((p) => {
              const m = memberMap[String(p.discord_id)]
              const nm = m?.displayName || p.name || `Row ${p.row_index}`
              const st = rowState(p.row_index)
              return (
                <button key={p.row_index} disabled={busy || offline} onClick={() => action('update-player', 'POST', { row_index: p.row_index }, `Pull ${nm}`)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs text-white/80 hover:bg-white/10 disabled:opacity-40 ${st ? 'bg-cyan-500/10 border-cyan-400/30' : 'bg-white/5 border-white/10'}`}
                        title={`Re-pull row ${p.row_index}${st ? ` (${st})` : ''}`}>
                  <Avatar src={m?.avatarUrl} name={nm} size={18} ring={false} />
                  <span className="truncate max-w-[120px]">{nm}</span>
                  {st && <span className="text-[9px] text-cyan-200/80 uppercase">{st}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Single-player search */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4" data-log-section="mmr-single">
        <div className="text-sm font-bold text-white mb-2">Update one player <span className="font-normal text-white/40">· queues a single pull (jumps ahead of a bulk run)</span></div>
        <input value={search} onChange={e => doSearch(e.target.value)} placeholder="Search by Discord name or ID…" data-log-ignore
               className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm placeholder-white/30 focus:outline-none focus:border-cyan-400/50" />
        {searching && <div className="mt-2 text-[11px] text-white/40">Searching…</div>}
        {results.length > 0 && (
          <div className="mt-2 space-y-1 max-h-72 overflow-y-auto">
            {results.map(r => {
              const inSheet = sheetSet.has(String(r.discordId))
              const rowIndex = sheetRow[String(r.discordId)]
              const st = inSheet ? rowState(rowIndex) : null
              return (
                <div key={r.discordId} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar src={r.avatarUrl} name={r.displayName} size={28} ring={false} className="flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{r.displayName}</div>
                      <div className="text-[11px] text-white/40 truncate font-mono">{r.discordId}{r.discordUsername ? ` · @${r.discordUsername}` : ''}</div>
                    </div>
                  </div>
                  {inSheet ? (
                    <button disabled={busy || offline} onClick={() => action('update-player', 'POST', { row_index: rowIndex }, `Pull ${r.displayName}`)}
                            className="px-3 py-1 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 text-xs font-bold disabled:opacity-40 shrink-0">
                      {st === 'running' ? 'Pulling now…' : st === 'queued' ? 'Queued · pull again' : `Pull (row ${rowIndex})`}
                    </button>
                  ) : (
                    <span className="px-2 py-1 rounded bg-white/5 text-white/40 border border-white/10 text-[11px] font-semibold shrink-0">not in the SalSheet</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {search.trim().length >= 2 && !searching && results.length === 0 && (
          <div className="mt-2 text-[11px] text-white/40">No matching Discord users.</div>
        )}
      </div>

      <ProxiesPanel config={config} onSave={saveProxies} onClear={clearProxies} onTest={testProxies}
                    testing={proxyTesting} testResults={proxyResults} offline={offline} />

      <ActivityFeed events={events} />

      <WinsRulePanel
        config={config}
        offline={offline}
        onChanged={async () => { const r = await dbCall('config'); if (r.ok && r.data && typeof r.data === 'object') setConfig(r.data) }}
      />

      {/* Config: channels + gated write */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-6" data-log-section="mmr-config">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold text-white">Configuration</div>
          <div className="flex items-center gap-2">
            {saveState === 'saving' && <span className="text-[11px] text-white/40">saving…</span>}
            {saveState === 'saved' && <span className="text-[11px] text-green-300">saved ✓</span>}
            {saveState === 'error' && <span className="text-[11px] text-red-300">save failed</span>}
            <button onClick={saveChannels} disabled={saveState === 'saving'}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 disabled:opacity-40">Save channels</button>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="text-[11px] text-white/50">Player ping channel ID (eligible notices)</span>
            <input value={config.player_ping_channel_id || ''}
                   onFocus={() => { editingChannels.current = true }}
                   onChange={e => setConfig({ ...config, player_ping_channel_id: e.target.value })}
                   placeholder="channel id"
                   className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm" />
          </label>
          <label className="block">
            <span className="text-[11px] text-white/50">Staff review channel ID (ineligible reports)</span>
            <input value={config.staff_review_channel_id || ''}
                   onFocus={() => { editingChannels.current = true }}
                   onChange={e => setConfig({ ...config, staff_review_channel_id: e.target.value })}
                   placeholder="channel id"
                   className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm" />
          </label>
          <label className="block">
            <span className="text-[11px] text-white/50">Tracker-404 ping channel ID (broken tracker → open a ticket)</span>
            <input value={config.tracker_404_channel_id || ''}
                   onFocus={() => { editingChannels.current = true }}
                   onChange={e => setConfig({ ...config, tracker_404_channel_id: e.target.value })}
                   placeholder="channel id (defaults to the ticket channel)"
                   className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm" />
          </label>
        </div>
        <div className="flex items-center gap-3 pt-2 border-t border-white/10">
          <span className={`text-xs font-bold ${armed ? 'text-red-300' : 'text-white/50'}`}>Sheet writes: {armed ? 'ARMED (LIVE)' : 'OFF (dry-run)'}</span>
          {!armed ? (
            <button onClick={armWrite} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${armStep === 1 ? 'bg-red-500/30 text-red-100 border-red-400/60 animate-pulse' : 'bg-white/5 text-white/70 border-white/20'}`}>
              {armStep === 1 ? 'Click again to CONFIRM live writes' : 'Arm live writes…'}
            </button>
          ) : (
            <button onClick={disarmWrite} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/10 text-white/70 border border-white/20">Disarm (back to dry-run)</button>
          )}
          {armStep === 1 && <button onClick={() => setArmStep(0)} className="text-xs text-white/40">cancel</button>}
        </div>
        <p className="text-[11px] text-white/40 mt-2">When ARMED, each player&apos;s changed cells are written to the SalSheet live as they&apos;re pulled, and pings/staff reports are queued for the bot to post (only if a channel ID is set). Disarmed = pure dry-run (writes nothing). Arming requires two clicks.</p>
        {snap?.outbox && (snap.outbox.pending || snap.outbox.sent || snap.outbox.failed) ? (
          <div className="mt-2 flex gap-3 text-[11px]">
            <span className="text-white/50">Discord messages —</span>
            <span className="text-yellow-300/70">{snap.outbox.pending} queued</span>
            <span className="text-green-300/70">{snap.outbox.sent} posted</span>
            {snap.outbox.failed ? <span className="text-red-300/70">{snap.outbox.failed} failed</span> : null}
            <span className="text-white/30">(bot posts within ~15s)</span>
          </div>
        ) : null}
        {snap?.register_queue && (snap.register_queue.pending || snap.register_queue.processed || snap.register_queue.failed) ? (
          <div className="mt-1 flex gap-3 text-[11px]">
            <span className="text-white/50">Register / rejoin pulls —</span>
            <span className="text-indigo-300/70">{snap.register_queue.pending} pending</span>
            <span className="text-green-300/70">{snap.register_queue.processed} done</span>
            {snap.register_queue.failed ? <span className="text-red-300/70">{snap.register_queue.failed} failed</span> : null}
            <span className="text-white/30">(queued by the bot, run in priority order)</span>
          </div>
        ) : null}
      </div>

      {/* Player results (most-recently-updated first; done rows stay) */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-white">Players ({players.length})</h2>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {players.map(p => <PlayerCard key={p.row_index} p={p} member={memberMap[String(p.discord_id)]} />)}
        {players.length === 0 && (
          <div className="text-white/40 text-sm py-8 text-center col-span-2">
            {loadedOnce ? 'No players in the last run.' : 'Loading…'}
          </div>
        )}
      </div>
    </div>
  )
}
