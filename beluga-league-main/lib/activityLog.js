import { query } from './db'
import { getServerSession } from 'next-auth'
import { authOptions } from './authOptions'

/**
 * The website's half of the audit trail, written into `higgen_logs`
 * (source='website') and surfaced on the hidden /admin/dashboard/higgenlogs page.
 *
 * Two rules, same as the bot's src/utils/higgenLog.js:
 *
 *  1. READABILITY. `summary` is a finished English sentence; `details` is an
 *     ORDERED list of [label, value] pairs (an array, not an object — Postgres
 *     jsonb does not preserve object key order). The page never shows raw JSON.
 *
 *  2. IT MUST NEVER BREAK THE REQUEST. Every write is wrapped; a logging failure
 *     is silently dropped rather than 500-ing an admin action.
 *
 * `stream`:
 *   - 'interaction' — someone did something (a click, a page view, an API call)
 *   - 'error'       — something failed
 */

const MAX_SUMMARY = 800
const MAX_VALUE = 500

function clip(v, n = MAX_VALUE) {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** `team_name` / `teamName` → `Team name` */
export function humanizeKey(key) {
  const spaced = String(key || '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  if (!spaced) return 'Value'
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function actorFrom(auth) {
  // Accepts a requireAdmin() result, a session, or a plain {name, discordId}.
  const s = auth?.session || auth || {}
  return {
    name: s.discordUsername || s.name || s.user?.name || 'admin',
    tag: s.discordUsername || null,
    discordId: s.discordUserId || s.discordId || null,
  }
}

/**
 * The plain-English verb phrase for an action slug. Anything not listed falls back
 * to a de-slugified phrase, so a new action still reads as prose rather than as a
 * key nobody outside the codebase understands.
 */
const PHRASES = {
  'team.update': 'updated a team',
  'team.delete': 'deleted a team',
  'teams.create': 'created a team',
  'teams.logo': 'changed a team logo',
  'franchise.update': 'updated a franchise',
  'franchise.delete': 'deleted a franchise',
  'franchise.logo': 'changed a franchise logo',
  'franchise.teams': 'changed which teams belong to a franchise',
  'seasons.create': 'created a season',
  'seasons.update': 'updated a season',
  'seasons.config': 'changed a season’s configuration',
  'seasons.champions': 'set a season’s champions',
  'seasons.teams': 'changed a season’s teams',
  'seasons.bulk-teams': 'bulk-changed a season’s teams',
  'seasons.schedule': 'changed a season’s schedule',
  'seasons.schedule.generate': 'generated a season schedule',
  'seasons.request-delete': 'requested that a season be DELETED',
  'seasons.request-reset': 'requested that a season be RESET',
  'schedule.update': 'changed the schedule',
  'schedule-match.update': 'edited a scheduled match',
  'transactions.create': 'recorded a transaction',
  'transactions.update': 'edited a transaction',
  'transactions.delete': 'deleted a transaction',
  'salary.unlock': 'unlocked a salary',
  'salary.adjust': 'adjusted a salary',
  'stats-series.patch': 'edited a reported series',
  'stats-series.delete': 'DELETED a reported series',
  'stats-tools.post': 'used the player identity tools',
  'power-rankings.update': 'changed the power rankings',
  // The request body pairs spell out which week and whether it was a single-week
  // recalc or a full backfill, so the phrase stays short.
  'power-rankings.post': 'recalculated the power rankings',
  'power-rankings.put': 'reordered the power rankings by hand',
  'playoffs.update': 'changed the playoff bracket',
  'week-threads.update': 'changed a week thread',
  'week-threads.action': 'queued a week-thread action for the bot',
  'dm.send': 'sent a mass DM',
  'dm.reply': 'replied to a member’s DM',
  'dm.personas': 'changed a member’s AI persona',
  'dm.default': 'changed the default DM settings',
  'tickets.post': 'acted on a ticket',
  'tickets.close': 'closed a ticket',
  'ticket-config.update': 'changed the ticket configuration',
  'site-content.update': 'edited site content',
  'notification.update': 'changed the site notification',
  'applications.update': 'acted on an application',
  'esubs.update': 'changed emergency subs',
  'mmr.run': 'started an MMR update run',
  'mmr.stop': 'stopped the MMR updater',
  'mmr.config': 'changed the MMR updater configuration',
  'mmr.update-player': 'updated one player’s MMR',
  'mmr.update-players': 'updated several players’ MMR',
  'mmr.rotate-ip': 'rotated the scraper IP',
  'tracker.save': 'linked or changed a tracker account',
  'tracker.bc-lookup': 'looked up a Ballchasing account',
  'rosters.update': 'changed a roster',
  'players.update': 'edited a player',
  'transcripts.update': 'acted on a thread transcript',
}

export function phraseFor(action, method = 'POST') {
  if (!action) return 'made a change'
  if (PHRASES[action]) return PHRASES[action]
  // `foo.bar-baz` → "used foo bar baz"; a bare path keeps its method.
  if (action.startsWith('GET ') || action.startsWith('POST ') || action.includes('/')) {
    const verb = method === 'DELETE' ? 'deleted via' : method === 'GET' ? 'opened' : 'called'
    return `${verb} ${action}`
  }
  return `did “${action.replace(/[._-]+/g, ' ')}”`
}

// ── the write path ────────────────────────────────────────────────────────────

const COLUMNS = [
  'occurred_at', 'source', 'stream', 'event_type', 'actor_name', 'actor_tag', 'actor_id',
  'action', 'target', 'location', 'outcome', 'duration_ms', 'division', 'summary', 'details',
  'error_message', 'error_stack', 'ip', 'user_agent',
]

/** Insert one row. Never throws. */
async function write(row) {
  try {
    const values = COLUMNS.map((c) => (row[c] === undefined ? null : row[c]))
    await query(
      `INSERT INTO higgen_logs (${COLUMNS.join(',')})
       VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(',')})`,
      values
    )
  } catch { /* logging must never break the request */ }
}

/** Insert many rows in one statement (used by the click-tracker beacon). */
export async function writeMany(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0
  try {
    const params = []
    const tuples = rows.map((row) => {
      const slots = COLUMNS.map((c) => {
        params.push(row[c] === undefined ? null : row[c])
        return `$${params.length}`
      })
      return `(${slots.join(',')})`
    })
    await query(`INSERT INTO higgen_logs (${COLUMNS.join(',')}) VALUES ${tuples.join(',')}`, params)
    return rows.length
  } catch {
    return 0
  }
}

export function buildRow({
  stream, eventType = null, actor = null, action = null, target = null, location = null,
  outcome = null, durationMs = null, division = null, summary, details = null,
  error = null, ip = null, userAgent = null, occurredAt = null,
}) {
  return {
    // Batched client events carry their own time so a 4-second flush delay doesn't
    // reorder the record; everything else stamps now.
    occurred_at: occurredAt instanceof Date && !Number.isNaN(occurredAt.valueOf()) ? occurredAt : new Date(),
    source: 'website',
    stream,
    event_type: clip(eventType, 40),
    actor_name: clip(actor?.name, 120),
    actor_tag: clip(actor?.tag, 120),
    actor_id: clip(actor?.discordId || actor?.id, 40),
    action: clip(action, 160),
    target: clip(target, 400),
    location: clip(location, 200),
    outcome: clip(outcome, 30),
    duration_ms: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
    division: clip(division, 40),
    summary: clip(summary, MAX_SUMMARY) || 'Unlabelled event',
    details: details && details.length ? JSON.stringify(details) : null,
    error_message: error ? clip(error.message || String(error), 600) : null,
    error_stack: error ? clip(error.stack || String(error), 6000) : null,
    ip: clip(ip, 60),
    user_agent: clip(userAgent, 300),
  }
}

// ── public helpers ────────────────────────────────────────────────────────────

/**
 * Log a deliberate admin action. Kept for direct call sites; `withAudit` below is
 * the usual entry point.
 */
export async function logActivity({ auth, action, target = null, detail = null, division = null } = {}) {
  const a = actorFrom(auth)
  const details = detail ? pairsFrom(detail) : []
  await write(buildRow({
    stream: 'interaction',
    eventType: 'api_write',
    actor: a,
    action,
    target,
    division,
    outcome: 'success',
    summary: `${a.name} ${phraseFor(action)}${target ? ` — ${target}` : ''}.`,
    details,
  }))
}

/** Log a website error. */
export async function logWebsiteError({
  auth = null, action = null, error = null, summary = null, target = null,
  location = null, details = null, eventType = 'crash', ip = null, userAgent = null,
} = {}) {
  const a = actorFrom(auth)
  const reason = error ? (error.message || String(error)) : 'an unspecified problem'
  await write(buildRow({
    stream: 'error',
    eventType,
    actor: a,
    action,
    target,
    location,
    outcome: 'failed',
    summary: summary || `${a.name === 'admin' ? 'The website' : a.name} hit an error${action ? ` while ${phraseFor(action)}` : ''}: ${reason}`,
    details: details || [],
    error,
    ip,
    userAgent,
  }))
}

/**
 * Turn a request body (or any object) into ordered, readable [label, value] pairs.
 * Secrets are masked and long base64 blobs collapsed, so an audit entry stays
 * legible and never becomes an exfiltration route.
 */
export function pairsFrom(input, prefix = '') {
  const out = []
  if (input === null || input === undefined) return out
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return pairsFrom(JSON.parse(trimmed), prefix) } catch { /* not JSON */ }
    }
    return [[prefix || 'Body', clip(redactValue(prefix, trimmed))]]
  }
  if (Array.isArray(input)) {
    if (input.length === 0) return [[prefix || 'Items', '(none)']]
    // Short scalar arrays read better on one line than as N rows.
    if (input.every((v) => typeof v !== 'object' || v === null)) {
      return [[prefix || 'Items', clip(input.join(', '))]]
    }
    input.slice(0, 10).forEach((v, i) => out.push(...pairsFrom(v, `${prefix || 'Item'} ${i + 1}`)))
    if (input.length > 10) out.push([`${prefix || 'Items'}`, `…and ${input.length - 10} more`])
    return out
  }
  if (typeof input === 'object') {
    for (const [k, v] of Object.entries(input)) {
      const label = prefix ? `${prefix} › ${humanizeKey(k)}` : humanizeKey(k)
      if (v === null || v === undefined || v === '') { out.push([label, '(empty)']); continue }
      if (typeof v === 'object') { out.push(...pairsFrom(v, label)); continue }
      out.push([label, clip(redactValue(k, v))])
    }
    return out
  }
  return [[prefix || 'Value', clip(String(input))]]
}

const SECRET_KEY = /password|secret|token|access_?token|api_?key|authorization/i
const BLOB_KEY = /^(logo_?data|data|image|bytes|base64|file)$/i

function redactValue(key, value) {
  const k = String(key || '')
  if (SECRET_KEY.test(k)) return '<redacted>'
  const s = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
  if (BLOB_KEY.test(k) && s.length > 40) return `<${s.length} bytes of file data>`
  if (s.length > 400 && /^[A-Za-z0-9+/=]+$/.test(s)) return `<${s.length} bytes of encoded data>`
  return s
}

// ── route wrapper ─────────────────────────────────────────────────────────────

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/**
 * Paths that a page POLLS. Auditing these would bury the log under thousands of
 * identical "opened the DM inbox" rows every hour without recording anything a
 * person actually chose to do. Reads of everything else ARE audited, because
 * "who went looking at the salary data at 3am" is exactly the kind of thing the
 * operator wants on record.
 */
const READ_NOISE = [
  '/api/admin/dm/unread',
  '/api/admin/dm/inbox',
  '/api/admin/dm/jobs',
  '/api/admin/higgenlogs',
  '/api/admin/schema-status',
]

function isNoisyRead(path) {
  return READ_NOISE.some((p) => path.startsWith(p))
}

/**
 * Wrap an admin route handler so EVERY call is recorded with the actor, method,
 * path, status, timing, and a readable breakdown of the request body — and any
 * thrown error is logged and re-surfaced.
 *
 *   export const POST = withAudit(async (request, ctx) => { … }, { action: 'team.update' })
 *
 * Reads are recorded too (minus the pollers above), so the log shows what someone
 * looked at, not just what they changed. The request is cloned before its body is
 * read so the handler can still consume it.
 */
export function withAudit(handler, { action = null } = {}) {
  return async function audited(request, ctx) {
    const method = request?.method || 'GET'
    const isWrite = WRITE_METHODS.has(method)

    let path = ''
    try { path = new URL(request.url).pathname } catch { /* ignore */ }
    if (!isWrite && isNoisyRead(path)) return handler(request, ctx)

    let actor = { name: 'admin', tag: null, discordId: null }
    try {
      const session = await getServerSession(authOptions)
      if (session) actor = actorFrom(session)
    } catch { /* unauth or session unavailable — the handler will 401 anyway */ }

    const ip = request?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim() || null
    const userAgent = request?.headers?.get?.('user-agent') || null

    // Best-effort readable body snapshot (cloned so the handler can still read it).
    let bodyPairs = []
    if (isWrite) {
      try {
        const text = await request.clone().text()
        if (text) bodyPairs = pairsFrom(text)
      } catch { /* body may be empty or already consumed */ }
    }

    const startedAt = Date.now()
    let response
    try {
      response = await handler(request, ctx)
    } catch (err) {
      await logWebsiteError({
        auth: actor,
        action: action || `${method} ${path}`,
        error: err,
        target: path,
        eventType: 'route_error',
        location: path,
        details: bodyPairs,
        ip,
        userAgent,
      })
      throw err
    }

    try {
      const status = response?.status ?? 0
      const ok = status > 0 && status < 400
      const durationMs = Date.now() - startedAt
      const phrase = isWrite ? phraseFor(action, method) : `opened ${describePath(path)}`
      // Result / timing / IP have their own columns and are printed in the page's
      // header block — listing them here again would just be noise.
      const details = [
        ['Request', `${method} ${path}${ok ? '' : ` → HTTP ${status}`}`],
        ...bodyPairs,
      ]

      await write(buildRow({
        stream: ok ? 'interaction' : 'error',
        eventType: isWrite ? 'api_write' : 'api_read',
        actor,
        action: action || `${method} ${path}`,
        target: path,
        location: describePath(path),
        outcome: ok ? 'success' : 'failed',
        durationMs,
        summary: `${actor.name} ${phrase}${ok ? '' : ` — it FAILED with HTTP ${status}`}.`,
        details,
        ip,
        userAgent,
      }))
    } catch { /* logging must never break the response */ }

    return response
  }
}

/** `/api/admin/seasons/3/teams` → "the seasons area" — a place, not a URL. */
export function describePath(path) {
  const m = String(path || '').match(/^\/api\/admin\/([^/?]+)/)
  if (!m) return String(path || '').slice(0, 120)
  return `the ${humanizeKey(m[1]).toLowerCase()} area of the admin panel`
}
