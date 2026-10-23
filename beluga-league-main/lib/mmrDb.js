// DB-direct reads/writes of the scraper's trn_* tables.
//
// The scraper and the website share ONE Postgres. Historically the MMR Updater tab
// proxied /status, /players and /config THROUGH the scraper every second — which
// (a) made the panel go blank whenever the scraper was offline, and (b) hammered the
// scraper's single event loop with heavy queries, making it slow/unresponsive.
//
// These helpers read the SAME data the scraper persists, straight from Postgres, so
// the panel shows past pulls + live-ish progress + configuration even when the
// scraper is down, and the scraper is no longer polled once per second. Only the
// ACTIONS (start/stop/resume/single pulls/rotate-ip) and sheet-backed reads
// (search, sheet-index, tracker board) still require the scraper to be online.
//
// Mirrors trn-scraper/app/db.py + the /status, /players, /config response shapes so
// the existing panel code consumes it unchanged.

import { query } from './db'

// Keep in lockstep with CONFIG_KEYS in trn-scraper/app/main.py.
export const CONFIG_KEYS = [
  'player_ping_channel_id',
  'staff_review_channel_id',
  'write_armed',
  'tracker_404_channel_id',
  'auto_sal_lock_enabled',
  'auto_roling_naming_enabled',
  // Proxy list (newline-separated URLs, credentials inside) — NEVER returned raw;
  // reads expose only proxies_masked/proxies_count. Hourly blocked re-pull switch.
  'proxies',
  'auto_retry_blocked_enabled',
  // Lifetime-wins eligibility rule (trn-scraper/app/winsrule.py): on/off + the
  // minimum lifetime wins (main account) for each division.
  'wins_rule_enabled',
  'wins_min_aa',
  'wins_min_aaa',
  'wins_min_majors',
]

const WINS_MIN_KEYS = ['wins_min_aa', 'wins_min_aaa', 'wins_min_majors']

/** Refuse a lifetime-wins setting that could make the check do the wrong thing. */
function validateWinsSettings(body, current) {
  for (const k of WINS_MIN_KEYS) {
    if (!(k in body)) continue
    const v = String(body[k] ?? '').trim().replace(/,/g, '')
    if (v !== '' && !/^\d{1,6}$/.test(v)) {
      const err = new Error('Minimum wins must be a whole number (0 – 999,999).')
      err.status = 400
      throw err
    }
    body[k] = v
  }
  if ('wins_rule_enabled' in body) body.wins_rule_enabled = String(body.wins_rule_enabled) === '1' ? '1' : '0'
  const enabled = (body.wins_rule_enabled ?? current.wins_rule_enabled) === '1'
  if (enabled) {
    const missing = WINS_MIN_KEYS.filter((k) => !(Number(body[k] ?? current[k]) > 0))
    if (missing.length) {
      const err = new Error('Set and save a minimum for AA, AAA and Majors before turning the lifetime-wins check on.')
      err.status = 400
      throw err
    }
  }
}

// Mirror of the scraper's parse_proxy_list + mask_proxy: host:port only, no creds.
function parseProxyList(raw) {
  if (!raw) return []
  const out = []
  for (const chunk of String(raw).replace(/,/g, '\n').split('\n')) {
    let s = chunk.trim()
    if (!s || s.startsWith('#')) continue
    if (!s.includes('://')) s = 'http://' + s
    if (!out.includes(s)) out.push(s)
  }
  return out
}
function maskProxy(p) {
  try {
    const u = new URL(p)
    return u.port ? `${u.hostname}:${u.port}` : u.hostname
  } catch { return 'proxy' }
}

const BLOCKED_RETRY_INTERVAL_S = 60 * 60

async function loadRun() {
  const r = await query(
    `SELECT run_id, mode, status, counters, current, message, started_at
     FROM trn_run WHERE id = 1`,
  ).catch(() => ({ rows: [] }))
  const row = r.rows[0]
  if (!row) return null
  return {
    run_id: row.run_id,
    mode: row.mode,
    status: row.status,
    counters: row.counters || {},
    current: row.current || {},
    message: row.message,
    started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
  }
}

async function doneCount(runId) {
  if (!runId) return 0
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM trn_players WHERE run_id = $1 AND done = TRUE`,
    [runId],
  ).catch(() => ({ rows: [{ n: 0 }] }))
  return r.rows[0]?.n || 0
}

async function counts(table) {
  const r = await query(
    `SELECT COUNT(*) FILTER (WHERE NOT ${table === 'trn_register_queue' ? 'processed' : 'sent'})::int AS pending,
            COUNT(*) FILTER (WHERE ${table === 'trn_register_queue' ? 'processed' : 'sent'})::int AS done,
            COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS failed
     FROM ${table}`,
  ).catch(() => ({ rows: [{ pending: 0, done: 0, failed: 0 }] }))
  return r.rows[0] || { pending: 0, done: 0, failed: 0 }
}

/**
 * Mirror of the scraper's GET /status, assembled straight from Postgres. The live
 * "currently pulling X" line comes from trn_run.current (persisted per player), so
 * during a run it updates every few seconds instead of every 1s in-memory tick —
 * an acceptable trade for not melting the scraper.
 */
// The scraper mirrors its in-memory state into trn_live on every transition (job,
// player, tracker, attempt n/max, backoff, block/cooldown, identity, pool). It is
// considered LIVE when the row was touched recently; a stale row means the scraper
// is idle/offline and the panel falls back to the persisted bulk-run "current".
const LIVE_FRESH_MS = 20000

async function loadLive() {
  const r = await query(`SELECT data, updated_at FROM trn_live WHERE id = 1`).catch(() => ({ rows: [] }))
  const row = r.rows[0]
  if (!row) return null
  const updatedAt = row.updated_at ? new Date(row.updated_at) : null
  const ageMs = updatedAt ? Date.now() - updatedAt.getTime() : Infinity
  const data = row.data || {}
  // wait_until is an epoch (seconds) — derive the countdown here so the client has it.
  const cur = { ...(data.current || {}) }
  if (cur.wait_until) cur.wait_left_s = Math.max(0, Math.round(cur.wait_until * 1000 - Date.now()) / 1000)
  return {
    ...data,
    current: cur,
    updated_at: updatedAt ? updatedAt.toISOString() : null,
    age_s: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
    fresh: ageMs < LIVE_FRESH_MS,
    active: Boolean(data.active) && ageMs < LIVE_FRESH_MS,
  }
}

function jobRow(r) {
  return {
    id: r.id, kind: r.kind, rows: r.rows || [], source: r.source || '',
    requested_by: r.requested_by || '', priority: r.priority, status: r.status,
    resume: Boolean(r.resume), progress: r.progress || {}, message: r.message, error: r.error,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    started_at: r.started_at ? new Date(r.started_at).toISOString() : null,
    finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  }
}

const JOB_COLS = `id, kind, rows, source, requested_by, priority, status, resume, progress,
                  message, error, created_at, started_at, finished_at`

async function blockedCount(runId) {
  if (!runId) return 0
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM trn_players
     WHERE run_id = $1 AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(accounts) a WHERE a->>'status' = 'CLOUDFLARE_BLOCKED')`,
    [runId],
  ).catch(() => ({ rows: [{ n: 0 }] }))
  return r.rows[0]?.n || 0
}

/** Mirror of the scraper's GET /queue: running job, queued jobs (in run order),
 *  recent finished jobs, the hourly auto-retry timer and IP-rotation info. */
export async function getQueue() {
  const [running, queued, recent, run, cfg] = await Promise.all([
    query(`SELECT ${JOB_COLS} FROM trn_jobs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`).catch(() => ({ rows: [] })),
    query(`SELECT ${JOB_COLS} FROM trn_jobs WHERE status = 'queued' ORDER BY priority ASC, id ASC`).catch(() => ({ rows: [] })),
    query(`SELECT ${JOB_COLS} FROM trn_jobs WHERE status IN ('done','stopped','failed','cancelled')
           ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 15`).catch(() => ({ rows: [] })),
    loadRun(),
    query(`SELECT key, value FROM trn_config WHERE key IN
           ('auto_retry_blocked_enabled','auto_retry_blocked_last_at','last_ip_rotation_at')`).catch(() => ({ rows: [] })),
  ])
  const map = {}
  for (const row of cfg.rows) map[row.key] = row.value
  const enabled = (map.auto_retry_blocked_enabled ?? '1') !== '0'
  const lastAt = Number(map.auto_retry_blocked_last_at || 0) || 0
  const blocked = await blockedCount(run?.run_id)
  const nextAt = lastAt ? lastAt + BLOCKED_RETRY_INTERVAL_S : Date.now() / 1000
  const lastRot = Number(map.last_ip_rotation_at || 0) || 0
  return {
    running: running.rows[0] ? jobRow(running.rows[0]) : null,
    queued: queued.rows.map(jobRow),
    recent: recent.rows.map(jobRow),
    auto_retry: {
      enabled, interval_s: BLOCKED_RETRY_INTERVAL_S,
      last_at: lastAt || null, next_at: enabled ? nextAt : null, blocked,
    },
    rotation: { last_at: lastRot || null },
  }
}

/** Mirror of the scraper's GET /events — the plain-English activity tail. */
export async function getEvents(limit = 40) {
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 200)
  const r = await query(
    `SELECT id, at, level, kind, message FROM trn_events ORDER BY id DESC LIMIT $1`, [lim],
  ).catch(() => ({ rows: [] }))
  return r.rows.map((e) => ({
    id: e.id, at: e.at ? new Date(e.at).toISOString() : null,
    level: e.level, kind: e.kind, message: e.message,
  }))
}

export async function getRunStatus() {
  const run = await loadRun()
  const runId = run?.run_id || null
  const [done, outbox, regq, cfgArmed, live] = await Promise.all([
    doneCount(runId),
    counts('trn_outbox'),
    query(`SELECT COUNT(*) FILTER (WHERE status IN ('queued','running'))::int AS pending,
                  COUNT(*) FILTER (WHERE status = 'done')::int AS done,
                  COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
           FROM trn_jobs WHERE kind = 'register'`).then((r) => r.rows[0] || {}).catch(() => ({})),
    getConfigValue('write_armed'),
    loadLive(),
  ])

  const status = run?.status || 'idle'
  const hasCheckpoint = ['stopped', 'running', 'stopping'].includes(status) && done > 0
  const liveActive = Boolean(live?.active)

  return {
    status,
    run_id: runId,
    mode: run?.mode || null,
    counters: run?.counters || {},
    // "Currently" = the LIVE job's current line whenever a job is active (any kind:
    // bulk, single, register, blocked re-pull), else the bulk run's last-known line.
    current: liveActive ? (live.current || {}) : (run?.current || {}),
    live,
    message: run?.message || null,
    // single_active drives the "updating player(s)" pill.
    single_active: liveActive && live?.mode === 'single',
    active: liveActive,
    checkpoint: {
      has_checkpoint: hasCheckpoint,
      run_id: runId,
      status,
      done,
      counters: run?.counters || {},
    },
    outbox: { pending: outbox.pending || 0, sent: outbox.done || 0, failed: outbox.failed || 0 },
    register_queue: { pending: regq.pending || 0, processed: regq.done || 0, failed: regq.failed || 0 },
    write_armed: cfgArmed === '1',
    rate_per_s: liveActive ? live.rate_per_s : undefined,
    eta_s: liveActive && live?.mode === 'bulk' ? live.eta_s : undefined,
    source: 'db',
  }
}

/** Mirror of the scraper's GET /players — the active run's player rows. */
export async function getRunPlayers(limit = 2000) {
  const run = await loadRun()
  const runId = run?.run_id || null
  if (!runId) return []
  const lim = Math.min(Math.max(Number(limit) || 2000, 1), 5000)
  const r = await query(
    `SELECT discord_id, row_index, name, league, status, done, any_invalid,
            accounts, best, changes, applied, source, updated_at
     FROM trn_players WHERE run_id = $1 ORDER BY updated_at DESC LIMIT $2`,
    [runId, lim],
  ).catch(() => ({ rows: [] }))
  return r.rows.map((p) => ({
    discord_id: p.discord_id,
    row_index: p.row_index,
    name: p.name,
    league: p.league,
    status: p.status,
    done: p.done,
    any_invalid: p.any_invalid,
    accounts: p.accounts || [],
    best: p.best || {},
    changes: p.changes || {},
    applied: p.applied || {},
    source: p.source || '',
    updated_at: p.updated_at ? new Date(p.updated_at).toISOString() : null,
  }))
}

async function getConfigValue(key) {
  const r = await query(`SELECT value FROM trn_config WHERE key = $1`, [key]).catch(() => ({ rows: [] }))
  return r.rows[0]?.value ?? ''
}

/** Mirror of the scraper's GET /config — the panel's known keys, blank if unset. */
export async function getTrnConfig() {
  const r = await query(`SELECT key, value FROM trn_config`).catch(() => ({ rows: [] }))
  const map = {}
  for (const row of r.rows) map[row.key] = row.value
  const out = {}
  for (const k of CONFIG_KEYS) out[k] = map[k] ?? ''
  // Proxy credentials never leave the server: expose host:port + count only.
  const proxies = parseProxyList(map.proxies)
  out.proxies = ''
  out.proxies_masked = proxies.map(maskProxy)
  out.proxies_count = proxies.length
  return out
}

/**
 * Mirror of the scraper's POST /config. The bot/scraper read these keys from
 * trn_config at run time, so writing them here (same DB) is equivalent — and works
 * with the scraper offline. write_armed keeps the 2-step gate (needs confirm:true).
 */
export async function setTrnConfig(body = {}) {
  if (WINS_MIN_KEYS.some((k) => k in body) || 'wins_rule_enabled' in body) {
    validateWinsSettings(body, await getTrnConfig())
  }
  for (const k of CONFIG_KEYS) {
    if (!(k in body)) continue
    if (k === 'write_armed') {
      const armed = Boolean(body.write_armed) && Boolean(body.confirm)
      await query(
        `INSERT INTO trn_config (key, value) VALUES ('write_armed', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [armed ? '1' : '0'],
      )
    } else if (k === 'proxies') {
      // Whole-list replace; '' clears. Normalised the same way the scraper does.
      await query(
        `INSERT INTO trn_config (key, value) VALUES ('proxies', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [parseProxyList(body.proxies).join('\n')],
      )
    } else {
      await query(
        `INSERT INTO trn_config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [k, String(body[k] ?? '').trim()],
      )
    }
  }
  return getTrnConfig()
}
