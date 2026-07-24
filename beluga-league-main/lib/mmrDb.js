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
]

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
export async function getRunStatus() {
  const run = await loadRun()
  const runId = run?.run_id || null
  const [done, outbox, regq, cfgArmed] = await Promise.all([
    doneCount(runId),
    counts('trn_outbox'),
    counts('trn_register_queue'),
    getConfigValue('write_armed'),
  ])

  const status = run?.status || 'idle'
  const hasCheckpoint = ['stopped', 'running', 'stopping'].includes(status) && done > 0

  return {
    status,
    run_id: runId,
    mode: run?.mode || null,
    counters: run?.counters || {},
    current: run?.current || {},
    message: run?.message || null,
    // single_active drives the "updating player(s)" pill; DB-approximated.
    single_active: run?.mode === 'single' && ['running', 'stopping'].includes(status),
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
    // rate_per_s / eta_s are in-memory only on the scraper; absent here (panel tolerates it).
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
  return out
}

/**
 * Mirror of the scraper's POST /config. The bot/scraper read these keys from
 * trn_config at run time, so writing them here (same DB) is equivalent — and works
 * with the scraper offline. write_armed keeps the 2-step gate (needs confirm:true).
 */
export async function setTrnConfig(body = {}) {
  for (const k of CONFIG_KEYS) {
    if (!(k in body)) continue
    if (k === 'write_armed') {
      const armed = Boolean(body.write_armed) && Boolean(body.confirm)
      await query(
        `INSERT INTO trn_config (key, value) VALUES ('write_armed', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [armed ? '1' : '0'],
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
