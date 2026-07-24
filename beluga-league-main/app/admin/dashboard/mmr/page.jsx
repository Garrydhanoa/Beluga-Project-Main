'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Avatar from '../../../components/Avatar'

const API = '/api/admin/mmr'        // proxy → scraper (ACTIONS + sheet-backed reads)
const DB_API = '/api/admin/mmr-db'  // DB-direct (status/players/config — works offline)

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
// status/players/config — so the panel populates even when the scraper is offline.
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
      <div className="flex items-center justify-between gap-2 mb-2">
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
        <div className="flex items-center gap-1.5 shrink-0">
          {p.source === 'register' && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-200 border border-indigo-400/30" title="Queued by the /register command">from register command</span>}
          {p.any_invalid && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-200 border border-yellow-400/30" title="A tracker returned 404 (not found) — player notified to open a ticket">404 TRACKER</span>}
          {ping404 && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30" title="Player pinged to open a ticket">pinged ticket</span>}
          {anyBlocked && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-200 border border-purple-400/30" title="A tracker was blocked by Cloudflare (valid, not invalid) — will retry next run">BLOCKED</span>}
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

      <div className="grid grid-cols-4 gap-1.5 mb-2">
        <Cat label="2s peak" cell={cells.peak_2s} source={best.peak_2s?.source} />
        <Cat label="3s peak" cell={cells.peak_3s} source={best.peak_3s?.source} />
        <Cat label="2s cur" cell={cells.cur_2s} source={best.cur_2s?.source} />
        <Cat label="3s cur" cell={cells.cur_3s} source={best.cur_3s?.source} />
      </div>

      {/* win rating (col Z): summed lifetime wins across all trackers; held when not all pulled */}
      {cells.win_rating && (
        <div className="grid grid-cols-4 gap-1.5 mb-2">
          <Cat label="win rating" cell={cells.win_rating} />
        </div>
      )}

      {/* per-account breakdown (main + alts only — column Y is not used) */}
      <div className="flex flex-wrap gap-1 mb-1">
        {accts.map((a, i) => {
          const st = acctState(a.status)
          const cls = st.ok
            ? 'bg-white/5 border-white/10 text-white/60'
            : st.soft
              ? 'bg-purple-500/10 border-purple-400/30 text-purple-300'  // blocked = valid, soft
              : 'bg-red-500/10 border-red-400/30 text-red-300'           // 404 / error
          return (
            <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`} title={`${a.url}\n${a.status}${a.detail ? ' — ' + a.detail : ''}`}>
              {a.label}:{a.platform}/{String(a.identifier).slice(0, 14)} · {st.label}
            </span>
          )
        })}
      </div>

      {/* eligibility detail + staff report / player ping */}
      {(ch.main_games_2s != null) && (
        <div className="text-[11px] text-white/50">main games — 2s: {ch.main_games_2s}, 3s: {ch.main_games_3s} (need 25 each)</div>
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

// A small ON/OFF switch for a bot automation toggle (DB-backed).
function BotToggle({ label, hint, on, saving, value, onToggle }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10">
      <div className="min-w-0">
        <div className="text-xs font-bold text-white truncate">{label}</div>
        <div className="text-[10px] text-white/40 truncate">{hint} · DB value: <span className="font-mono text-white/60">{value || '—'}</span></div>
      </div>
      <button
        onClick={() => onToggle(!on)}
        disabled={saving}
        title={on ? 'Click to turn OFF' : 'Click to turn ON'}
        className={`relative w-12 h-6 rounded-full border transition-colors shrink-0 disabled:opacity-50 ${on ? 'bg-green-500/40 border-green-400/60' : 'bg-white/10 border-white/20'}`}
      >
        <span className={`absolute top-0.5 ${on ? 'left-6' : 'left-0.5'} w-5 h-5 rounded-full transition-all ${on ? 'bg-green-200' : 'bg-white/60'}`} />
      </button>
    </div>
  )
}

export default function MmrUpdaterPage() {
  const [snap, setSnap] = useState(null)
  const [players, setPlayers] = useState([])
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [offline, setOffline] = useState(false) // scraper service unreachable/timed out
  const [config, setConfig] = useState({ player_ping_channel_id: '', staff_review_channel_id: '', tracker_404_channel_id: '', write_armed: '', auto_sal_lock_enabled: '', auto_roling_naming_enabled: '' })
  const [toggleSaving, setToggleSaving] = useState('') // '' | 'sal' | 'role' (which is mid-save)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [armStep, setArmStep] = useState(0)
  const [saveState, setSaveState] = useState('') // '' | 'saving' | 'saved' | 'error'

  // discord_id → member identity (avatar + names), fetched from the website's own
  // directory. Used to render Done-list cards AND join search results by discord_id.
  const [memberMap, setMemberMap] = useState({})
  // Set of discord_ids that are present in the SalSheet (from the scraper).
  const [sheetSet, setSheetSet] = useState(new Set())
  const [sheetRow, setSheetRow] = useState({}) // discord_id → row_index

  const timer = useRef(null)
  const searchTimer = useRef(null)
  const editingChannels = useRef(false) // don't let the 1s refresh stomp typing
  const inflight = useRef(false)        // skip overlapping polls (e.g. when scraper hangs)

  const refresh = useCallback(async () => {
    if (inflight.current) return        // don't stack requests if the last poll is still pending
    inflight.current = true
    try {
      // Read live state straight from the SHARED DB (the scraper persists trn_run /
      // trn_players / trn_config there). This works even when the scraper is offline
      // and stops the per-second scraper flood that was choking its event loop.
      const [s, p] = await Promise.all([dbCall('status'), dbCall('players?limit=2000')])
      if (s.ok) setSnap(s.data)
      if (p.ok && Array.isArray(p.data)) {
        // Don't blank out an already-populated list on a transient empty read (the
        // idle "everything resets then comes back" flicker). Only accept an EMPTY
        // payload once we've genuinely never loaded, so the first paint can settle;
        // after that, an empty result is ignored unless it stays empty (a real reset
        // re-fills within a tick anyway). Non-empty payloads always apply.
        setPlayers(prev => {
          if (p.data.length > 0) return p.data
          if (prev.length === 0) return p.data        // still empty — fine
          return prev                                  // keep what we have; ignore blip
        })
        setLoadedOnce(true)
      }
      // Keep config in sync, but never overwrite inputs the operator is editing.
      if (!editingChannels.current) {
        const r = await dbCall('config')
        if (r.ok && r.data && typeof r.data === 'object') setConfig(r.data)
      }
    } finally {
      inflight.current = false
    }
  }, [])

  // Cheap, low-frequency scraper liveness probe — drives the "offline" banner and
  // disables the live ACTION buttons (Start/Stop/single pulls) that genuinely need
  // the scraper. Reads keep working from the DB regardless.
  const pingScraper = useCallback(async () => {
    const h = await call('health')
    setOffline(!h.ok)
  }, [])

  // Build a discord_id → member map from the website's own player directory.
  const loadMembers = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/players', { cache: 'no-store' })
      const d = await r.json()
      const map = {}
      for (const pl of d.players || []) map[String(pl.discordId)] = pl
      setMemberMap(map)
    } catch { /* directory optional — cards fall back to sheet name */ }
  }, [])

  // SalSheet membership index (by discord_id) from the scraper.
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
    // Live update every second (the operator's hard requirement) — now DB-direct.
    refresh()
    loadMembers()
    loadSheetIndex()
    pingScraper()
    timer.current = setInterval(refresh, 1000)
    // Probe the scraper for liveness at a low rate (cheap /health, drives the banner).
    const ping = setInterval(pingScraper, 12000)
    // Refresh the heavier directory + sheet index less often.
    const slow = setInterval(() => { loadMembers(); loadSheetIndex() }, 60000)
    return () => { clearInterval(timer.current); clearInterval(ping); clearInterval(slow) }
  }, [refresh, loadMembers, loadSheetIndex, pingScraper])

  const action = async (path, method = 'POST', body) => {
    setBusy(true)
    await call(path, method, body)
    await refresh()
    setBusy(false)
  }

  // Search the website's OWN directory (avatars + discord names), then join each
  // result to the SalSheet by discord_id to decide "in the sheet" vs "not".
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
    // Re-read to confirm it actually landed in the DB (the operator's "won't save" bug).
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

  // Bot automation toggles (Auto Sal Lock / Auto Roling+Naming). These live in
  // trn_config; the bot reads them from the DB. We write "2" for ON (so the
  // operator can verify the bot is reading the value from the DB, not "ON") and
  // "0" for OFF. Any of 1/2/on/yes/true reads as enabled on the bot side.
  const toggleBot = async (key, nextOn) => {
    setToggleSaving(key)
    setConfig(c => ({ ...c, [key]: nextOn ? '2' : '0' })) // optimistic
    await dbCall('config', 'POST', { [key]: nextOn ? '2' : '0' })
    const r = await dbCall('config'); if (r.ok && r.data && typeof r.data === 'object') setConfig(r.data)
    setToggleSaving('')
  }

  const c = snap?.counters || {}
  const cur = snap?.current || {}
  const cp = snap?.checkpoint || {}
  const running = snap?.status === 'running' || snap?.status === 'stopping'
  const singleActive = !!snap?.single_active
  // Action buttons also disable when the scraper is offline (they need it to run);
  // reads keep working from the DB.
  const busyAny = busy || running || singleActive || offline
  const armed = config.write_armed === '1'
  const pct = c.total ? Math.round((c.completed / c.total) * 100) : 0

  // Players whose last run had a Cloudflare-blocked tracker — surface them so the
  // operator can re-pull them as a group (separate from the bulk checkpoint).
  const blocked = players.filter((p) => (p.accounts || []).some((a) => a.status === 'CLOUDFLARE_BLOCKED'))
  const blockedRows = blocked.map((p) => p.row_index)

  // Mirror the bot's truthiness so the toggle UI shows the same ON/OFF the bot sees.
  const toggleOn = (v) => ['1', '2', 'on', 'yes', 'true'].includes(String(v ?? '').trim().toLowerCase())
  const salLockOn = toggleOn(config.auto_sal_lock_enabled)
  const roleSyncOn = toggleOn(config.auto_roling_naming_enabled)

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">MMR Updater</h1>
          <p className="text-sm text-white/50">Pull peak/current 2s &amp; 3s MMR from Tracker Network · {armed ? <span className="text-red-300 font-bold">LIVE WRITES ARMED</span> : 'dry-run (no sheet writes)'}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusPill status={snap?.status} />
          {/* Bot automation toggles — DB-backed (the bot reads trn_config, not the
              SalSheet CONTROL PANEL tab anymore). */}
          <div className="w-72 space-y-2">
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
          <span className="font-bold">⚠ Scraper offline — showing saved pulls &amp; configuration from the database.</span>{' '}
          You can still review the last run and edit configuration here. Live actions (Start / Stop / Resume / single
          pulls / player search) need the scraper online — restart the <span className="font-mono">rl-scraper</span> service on Railway.
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button disabled={busyAny} onClick={() => action('run')} className="px-4 py-2 rounded-lg bg-green-500/20 text-green-200 border border-green-400/40 font-bold text-sm disabled:opacity-40 hover:bg-green-500/30">▶ Start (reset checkpoint)</button>
        <button disabled={busy || !running || offline} onClick={() => action('stop')} className="px-4 py-2 rounded-lg bg-yellow-500/20 text-yellow-200 border border-yellow-400/40 font-bold text-sm disabled:opacity-40 hover:bg-yellow-500/30">⏸ Stop (keep checkpoint)</button>
        <button disabled={busyAny || !cp.has_checkpoint} onClick={() => action('resume')} className="px-4 py-2 rounded-lg bg-blue-500/20 text-blue-200 border border-blue-400/40 font-bold text-sm disabled:opacity-40 hover:bg-blue-500/30">⏵ Resume from checkpoint</button>
        <button disabled={busy || offline} onClick={() => action('rotate-ip')} className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-200 border border-purple-400/40 font-bold text-sm disabled:opacity-40 hover:bg-purple-500/30">⟳ Reset IP (redeploy)</button>
      </div>

      {/* Progress + current */}
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-white/60">Progress</span>
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
            <span className="text-white/40">rate {snap?.rate_per_s || 0}/s</span>
            {snap?.eta_s ? <span className="text-white/40">ETA {Math.round(snap.eta_s / 60)}m</span> : null}
          </div>
          {(c.skipped_left || c.skipped_no_id || c.skipped_no_tracker) ? (
            <div className="text-[11px] text-white/35 mt-1" title="Players NOT pulled this bulk run">
              skipped: {c.skipped_left || 0} left server · {c.skipped_no_id || 0} no Discord ID · {c.skipped_no_tracker || 0} no tracker
            </div>
          ) : null}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-white/60 text-sm mb-1 flex items-center gap-2">
            Currently
            {singleActive && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-400/40">updating player(s)</span>}
          </div>
          <div className="font-bold text-white truncate">{cur.name || (running || singleActive ? '…' : 'idle')}</div>
          <div className="text-xs text-cyan-300/70 truncate">{cur.step || ''} {cur.label ? `· ${cur.label}` : ''}</div>
          <div className="text-[11px] text-white/40 truncate">{cur.tracker || ''}</div>
          {cp.has_checkpoint && <div className="text-[11px] text-orange-300/70 mt-1">checkpoint: {cp.done} done · {cp.status} (single updates don&apos;t reset it)</div>}
        </div>
      </div>

      {/* Blocked-last-run group — re-pull the Cloudflare-blocked players as a batch */}
      {blocked.length > 0 && (
        <div className="rounded-xl border border-purple-400/30 bg-purple-500/[0.06] p-4 mb-4">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="text-sm font-bold text-purple-100">
              Blocked last run ({blocked.length})
              <span className="font-normal text-white/40"> · Cloudflare-blocked trackers — re-pull to retry</span>
            </div>
            <button disabled={busyAny} onClick={() => action('update-players', 'POST', { rows: blockedRows })}
                    className="px-3 py-1.5 rounded-lg bg-purple-500/25 text-purple-100 border border-purple-400/50 text-xs font-bold disabled:opacity-40 hover:bg-purple-500/35">⟳ Re-pull all blocked</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {blocked.map((p) => {
              const m = memberMap[String(p.discord_id)]
              const nm = m?.displayName || p.name || `Row ${p.row_index}`
              return (
                <button key={p.row_index} disabled={busyAny} onClick={() => action('update-player', 'POST', { row_index: p.row_index })}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40"
                        title={`Re-pull row ${p.row_index}`}>
                  <Avatar src={m?.avatarUrl} name={nm} size={18} ring={false} />
                  <span className="truncate max-w-[120px]">{nm}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Single-player search — directory-backed (avatar + discord name), joined to SalSheet by discord_id */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
        <div className="text-sm font-bold text-white mb-2">Update one player</div>
        <input value={search} onChange={e => doSearch(e.target.value)} placeholder="Search by Discord name or ID…"
               className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm placeholder-white/30 focus:outline-none focus:border-cyan-400/50" />
        {searching && <div className="mt-2 text-[11px] text-white/40">Searching…</div>}
        {results.length > 0 && (
          <div className="mt-2 space-y-1 max-h-72 overflow-y-auto">
            {results.map(r => {
              const inSheet = sheetSet.has(String(r.discordId))
              const rowIndex = sheetRow[String(r.discordId)]
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
                    <button disabled={busyAny} onClick={() => action('update-player', 'POST', { row_index: rowIndex })}
                            className="px-3 py-1 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 text-xs font-bold disabled:opacity-40 shrink-0">Pull (row {rowIndex})</button>
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

      {/* Config: channels + gated write */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-6">
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
            <span className="text-white/50">Register queue —</span>
            <span className="text-indigo-300/70">{snap.register_queue.pending} pending</span>
            <span className="text-green-300/70">{snap.register_queue.processed} done</span>
            {snap.register_queue.failed ? <span className="text-red-300/70">{snap.register_queue.failed} failed</span> : null}
            <span className="text-white/30">(auto-runs when idle)</span>
          </div>
        ) : null}
      </div>

      {/* Player results (most-recently-updated first; done rows stay) */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-white">Players ({players.length})</h2>
        {snap?.message && <span className="text-xs text-white/40">{snap.message}</span>}
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
