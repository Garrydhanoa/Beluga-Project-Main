// Moderation data for the admin Mod Logs tab and the public appeal form.
//
// The bot owns every Discord side effect (Beluga Bot/src/moderation). Anything here
// that has to touch Discord or the SalSheet is queued in `mod_actions`; only staff
// notes on settings and word lists are written directly. RULES, DEFAULT_SETTINGS and
// the parsers are MIRRORED from Beluga Bot/src/moderation/modConfig.js + modParse.js.

import { query } from './db'

export class ModError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export const RULES = [
  { code: 'coc1', label: 'Code of Conduct 1: Harassment' },
  { code: 'coc2', label: 'Code of Conduct 2: Threats' },
  { code: 'coc3', label: 'Code of Conduct 3: Sharing personal information' },
  { code: 'coc4', label: 'Code of Conduct 4: Hate speech' },
  { code: 'coc5', label: 'Code of Conduct 5: Sexual content' },
  { code: 'coc6', label: 'Code of Conduct 6: Self-harm content' },
  { code: 'coc7', label: 'Code of Conduct 7: Bending the conduct rules' },
  { code: 'rb2.1', label: 'Rulebook 2.1: Account withholding' },
  { code: 'rb2.3', label: 'Rulebook 2.3: Hiding a sal-out' },
  { code: 'rb5.4', label: 'Rulebook 5.4: Cheating or in-game etiquette' },
  { code: 'rb6.1.2', label: 'Rulebook 6.1.2: Server breach or tampering' },
  { code: 'rb6.2', label: 'Rulebook 6.2: Smurfing' },
  { code: 'rb6.3', label: 'Rulebook 6.3: Account sharing' },
  { code: 'rb6.4', label: 'Rulebook 6.4: Fraud' },
  { code: 'rb6.5', label: 'Rulebook 6.5: False reporting' },
  { code: 'rb6.1', label: 'Rulebook 6.1: Board discretion' },
  { code: 'spam', label: 'Spam or channel misuse' },
]

const LEADERSHIP_CATEGORY = '1203051640555438171'
const TICKET_CATEGORY = '1156814621865427022'
const DIRECTOR_CHAT = '1473156680568016906'
const ADMIN_CHAT = '1299015210702737429'
const AUTOMOD_LOG = '1419152838961004564'

export const DEFAULT_SETTINGS = {
  appeal_after_months: '6',
  appeal_vote_threshold: '5',
  rogue_action_limit: '5',
  rogue_window_minutes: '10',
  filter_enabled: 'true',
  filter_slur_enabled: 'true',
  filter_spam_enabled: 'true',
  filter_ai_enabled: 'false',
  filter_ai_slur_action: 'true',
  filter_ai_slur_confidence: '0.9',
  filter_slur_timeout_seconds: '300',
  chat_join_enabled: 'true',
  chat_join_channels: '1156814622070935640',
  chat_join_fun_minutes: '5',
  claude_daily_alert_usd: '0.25',
  filter_spam_timeout_seconds: '600',
  filter_spam_burst_messages: '7',
  filter_spam_burst_seconds: '6',
  filter_spam_duplicate_messages: '4',
  filter_spam_duplicate_seconds: '30',
  filter_ai_claude_model: 'claude-haiku-5-5',
  filter_ai_primary_model: 'qwen/qwen3.8-27b',
  filter_ai_fallback_model: 'openai/gpt-oss-120b',
  filter_ai_confidence: '0.8',
  filter_ai_batch_size: '8',
  filter_ai_batch_seconds: '5',
  filter_ai_daily_tokens: '380000',
  filter_ai_excluded_channels: `${DIRECTOR_CHAT},${ADMIN_CHAT},${TICKET_CATEGORY}`,
  filter_flag_only_channels: `${LEADERSHIP_CATEGORY},${TICKET_CATEGORY}`,
  filter_ignored_channels: AUTOMOD_LOG,
  filter_exempt_roles: '',
}

const STRIKE_PACKAGE = {
  1: { timeout: '2d', suspension: '1 series', ban: false },
  2: { timeout: '1w', suspension: '3 series', ban: false },
  3: { timeout: '', suspension: '', ban: true },
}

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, y: 31536000 }

function unitKey(word) {
  const w = String(word || '').toLowerCase()
  if (w.startsWith('mo')) return 'mo'
  for (const k of ['y', 'w', 'd', 'h', 's', 'm']) if (w.startsWith(k)) return k
  return null
}

export function parseDuration(text) {
  const raw = String(text || '').trim().toLowerCase()
  if (!raw) return null
  let total = 0
  let matched = ''
  const re = /(\d+(?:\.\d+)?)\s*(years?|y|months?|mo|weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    total += parseFloat(m[1]) * UNIT_SECONDS[unitKey(m[2])]
    matched += m[0]
  }
  if (!total) return null
  if (raw.replace(/\s+/g, '').length !== matched.replace(/\s+/g, '').length) return null
  return Math.round(total)
}

export function parseSuspensionLength(text) {
  const raw = String(text || '').trim().toLowerCase()
  if (!raw) return null
  if (/^(indefinite|indefinitely|permanent|until further notice)$/.test(raw)) return { unit: 'indefinite', total: null }
  const m = raw.match(/^(\d+)\s*(series|games?|seasons?|weeks?|w|days?|d)$/)
  if (!m) return null
  const total = parseInt(m[1], 10)
  if (!total) return null
  if (m[2] === 'series' || m[2].startsWith('game')) return { unit: 'series', total }
  if (m[2].startsWith('season')) return { unit: 'seasons', total }
  if (m[2].startsWith('w')) return { unit: 'weeks', total }
  return { unit: 'days', total }
}

export function suspensionText(s) {
  if (s.unit === 'series') {
    const left = Math.max((s.total || 0) - (s.served || 0), 0)
    return `${left} series left`
  }
  if (s.unit === 'indefinite') return 'indefinite'
  return `${s.total} ${s.unit}`
}

// ── queue ─────────────────────────────────────────────────────────────────────

async function enqueue(action, payload, actor) {
  const { rows } = await query(
    `INSERT INTO mod_actions (action, payload, requested_by_discord_id, requested_by_username)
     VALUES ($1, $2::jsonb, $3, $4) RETURNING id`,
    [action, JSON.stringify(payload || {}), actor?.discordId || null, actor?.name || null]
  )
  await query('NOTIFY mod_actions').catch(() => {})
  return { queued: rows[0].id }
}

export async function getAction(id) {
  const { rows } = await query(
    `SELECT id, action, status, result, requested_at, fulfilled_at FROM mod_actions WHERE id = $1`,
    [parseInt(id, 10) || 0]
  )
  return rows[0] || null
}

// ── reads ─────────────────────────────────────────────────────────────────────

const WITH_MEMBER = `
  LEFT JOIN discord_members m ON m.discord_id = c.discord_id`

function caseRow(r) {
  return {
    id: r.id,
    discordId: r.discord_id,
    name: r.member_name || r.target_name || null,
    avatarUrl: r.avatar_url || null,
    kind: r.kind,
    status: r.status,
    ruleLabel: r.rule_label,
    reason: r.reason,
    actorName: r.actor_name,
    source: r.source,
    counts: r.counts,
    strikeNumber: r.strike_number,
    durationSeconds: r.duration_seconds,
    expiresAt: r.expires_at,
    details: r.details || {},
    steps: r.steps || {},
    voidReason: r.void_reason,
    voidedBy: r.voided_by_name,
    createdAt: r.created_at,
  }
}

const CASE_SELECT = `SELECT c.*, COALESCE(m.display_name, m.username) AS member_name, m.avatar_url
  FROM mod_cases c ${WITH_MEMBER}`

export async function getOverview() {
  const [counts, recent, failed] = await Promise.all([
    query(`SELECT
      (SELECT COUNT(*)::int FROM mod_suspensions WHERE status IN ('active','queued')) AS suspensions,
      (SELECT COUNT(*)::int FROM mod_bans WHERE status = 'active' AND ban_type <> 'legacy') AS bans,
      (SELECT COUNT(*)::int FROM mod_bans WHERE status = 'active' AND ban_type = 'legacy') AS legacy_bans,
      (SELECT COUNT(*)::int FROM mod_cases WHERE kind IN ('timeout','filter') AND status = 'active') AS timeouts,
      (SELECT COUNT(*)::int FROM mod_requests WHERE status = 'pending') AS requests,
      (SELECT COUNT(*)::int FROM mod_flags WHERE status = 'open') AS flags,
      (SELECT COUNT(*)::int FROM mod_appeals WHERE status IN ('voting','director')) AS appeals,
      (SELECT COUNT(*)::int FROM mod_staff_freezes WHERE unfrozen_at IS NULL) AS freezes,
      (SELECT COUNT(*)::int FROM mod_member_state WHERE strikes > 0) AS with_strikes,
      (SELECT COUNT(*)::int FROM mod_cases WHERE counts = TRUE) AS cases`),
    query(`${CASE_SELECT} ORDER BY c.created_at DESC, c.id DESC LIMIT 12`),
    query(`SELECT id, action, result, fulfilled_at FROM mod_actions WHERE status = 'failed' ORDER BY id DESC LIMIT 5`),
  ])
  return { counts: counts.rows[0], recent: recent.rows.map(caseRow), failed: failed.rows }
}

export async function listCases({ q = '', kind = '', source = '', includeOld = false, limit = 50, offset = 0 }) {
  const where = []
  const params = []
  const term = String(q).trim()
  if (term) {
    params.push(`%${term}%`, term)
    const a = params.length - 1
    const b = params.length
    where.push(`(c.discord_id = $${b} OR c.target_name ILIKE $${a} OR m.display_name ILIKE $${a} OR m.username ILIKE $${a} OR c.reason ILIKE $${a} OR c.actor_name ILIKE $${a} OR c.id::text = $${b})`)
  }
  if (kind) { params.push(kind); where.push(`c.kind = $${params.length}`) }
  if (source) { params.push(source); where.push(`c.source = $${params.length}`) }
  if (!includeOld) where.push('c.counts = TRUE')
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  params.push(Math.min(parseInt(limit, 10) || 50, 200), parseInt(offset, 10) || 0)
  const { rows } = await query(
    `${CASE_SELECT} ${clause} ORDER BY c.created_at DESC, c.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { cases: rows.map(caseRow) }
}

async function memberSummary(discordId) {
  const id = String(discordId)
  const [state, suspensions, bans, member] = await Promise.all([
    query('SELECT * FROM mod_member_state WHERE discord_id = $1', [id]),
    query(`SELECT * FROM mod_suspensions WHERE discord_id = $1 AND status IN ('active','queued') ORDER BY id`, [id]),
    query(`SELECT * FROM mod_bans WHERE discord_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`, [id]),
    query('SELECT display_name, username, avatar_url, is_in_guild FROM discord_members WHERE discord_id = $1', [id]),
  ])
  const s = state.rows[0] || {}
  const m = member.rows[0] || {}
  return {
    discordId: id,
    name: m.display_name || m.username || null,
    avatarUrl: m.avatar_url || null,
    inGuild: m.is_in_guild ?? null,
    strikes: s.strikes || 0,
    warned: !!s.warned_at,
    lastChance: !!s.last_chance,
    legacyStrikes: s.legacy_strikes || 0,
    suspensions: suspensions.rows.map((r) => ({ ...r, text: suspensionText(r) })),
    ban: bans.rows[0] || null,
  }
}

export async function getPerson(discordId) {
  const id = String(discordId || '').trim()
  if (!/^\d{5,25}$/.test(id)) throw new ModError('That is not a Discord ID.')
  const [summary, cases, events, flags] = await Promise.all([
    memberSummary(id),
    query(`${CASE_SELECT} WHERE c.discord_id = $1 ORDER BY c.created_at DESC, c.id DESC LIMIT 200`, [id]),
    query('SELECT id, kind, summary, actor_name, created_at FROM mod_events WHERE discord_id = $1 ORDER BY id DESC LIMIT 100', [id]),
    query('SELECT id, layer, matched, status, channel_name, created_at FROM mod_flags WHERE author_id = $1 ORDER BY id DESC LIMIT 50', [id]),
  ])
  const next = summary.strikes + 1
  const pkg = STRIKE_PACKAGE[Math.min(next, 3)]
  return {
    summary, cases: cases.rows.map(caseRow), events: events.rows, flags: flags.rows,
    nextStrike: next,
    package: summary.lastChance ? { timeout: '', suspension: '', ban: true } : pkg,
  }
}

export async function getCaseDetail(id) {
  const { rows } = await query(`${CASE_SELECT} WHERE c.id = $1`, [parseInt(id, 10) || 0])
  if (!rows[0]) throw new ModError('No such case.', 404)
  const [evidence, events, suspension, ban] = await Promise.all([
    query('SELECT id, kind, filename, mime, size_bytes, text, added_by_name, created_at FROM mod_evidence WHERE case_id = $1 ORDER BY id', [rows[0].id]),
    query('SELECT id, kind, summary, actor_name, created_at FROM mod_events WHERE case_id = $1 ORDER BY id DESC', [rows[0].id]),
    query('SELECT * FROM mod_suspensions WHERE case_id = $1 ORDER BY id', [rows[0].id]),
    query('SELECT * FROM mod_bans WHERE case_id = $1', [rows[0].id]),
  ])
  return { case: caseRow(rows[0]), evidence: evidence.rows, events: events.rows, suspensions: suspension.rows, ban: ban.rows[0] || null }
}

export async function listActive() {
  const [suspensions, bans, timeouts] = await Promise.all([
    query(`SELECT s.*, c.reason, c.kind, COALESCE(m.display_name, m.username, c.target_name) AS name, m.avatar_url
             FROM mod_suspensions s JOIN mod_cases c ON c.id = s.case_id
             LEFT JOIN discord_members m ON m.discord_id = s.discord_id
            WHERE s.status IN ('active','queued') ORDER BY s.id DESC`),
    query(`SELECT b.*, c.reason, COALESCE(m.display_name, m.username, c.target_name) AS name, m.avatar_url
             FROM mod_bans b JOIN mod_cases c ON c.id = b.case_id
             LEFT JOIN discord_members m ON m.discord_id = b.discord_id
            WHERE b.status = 'active' AND b.ban_type <> 'legacy' ORDER BY b.created_at DESC`),
    query(`${CASE_SELECT} WHERE c.kind IN ('timeout','filter') AND c.status = 'active' ORDER BY c.expires_at`),
  ])
  return {
    suspensions: suspensions.rows.map((r) => ({ ...r, text: suspensionText(r) })),
    bans: bans.rows,
    timeouts: timeouts.rows.map(caseRow),
  }
}

export async function listAppeals() {
  const { rows } = await query(
    `SELECT a.*, c.reason AS case_reason, c.kind AS case_kind,
            (SELECT COUNT(*)::int FROM mod_appeal_votes v WHERE v.appeal_id = a.id AND v.vote = 'yes') AS yes_votes,
            (SELECT COUNT(*)::int FROM mod_appeal_votes v WHERE v.appeal_id = a.id AND v.vote = 'no') AS no_votes
       FROM mod_appeals a JOIN mod_cases c ON c.id = a.case_id
      ORDER BY CASE a.status WHEN 'director' THEN 0 WHEN 'voting' THEN 1 ELSE 2 END, a.id DESC LIMIT 100`
  )
  return { appeals: rows }
}

export async function listFlags(status = 'open') {
  const { rows } = await query(
    `SELECT id, layer, channel_id, channel_name, author_id, author_name, content, matched, verdict, model, case_id, status, reviewed_by_name, created_at
       FROM mod_flags WHERE ($1 = 'all' OR status = $1) ORDER BY id DESC LIMIT 100`,
    [status]
  )
  return { flags: rows }
}

export async function listRequests() {
  const [requests, freezes, evasion] = await Promise.all([
    query(`SELECT * FROM mod_requests WHERE kind IN ('ban_request', 'kick_request') ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC LIMIT 50`),
    query('SELECT * FROM mod_staff_freezes WHERE unfrozen_at IS NULL ORDER BY id DESC'),
    query(`SELECT * FROM mod_evasion_alerts ORDER BY id DESC LIMIT 50`),
  ])
  return { requests: requests.rows, freezes: freezes.rows, evasion: evasion.rows }
}

export async function getSettings() {
  const { rows } = await query('SELECT key, value FROM mod_settings')
  const out = { ...DEFAULT_SETTINGS }
  for (const r of rows) if (r.value !== null && r.value !== '' && r.key in DEFAULT_SETTINGS) out[r.key] = r.value
  return out
}

export async function getFilterData() {
  const [settings, words, allow, usage, flags, claude] = await Promise.all([
    getSettings(),
    query(`SELECT id, word, tier, source, enabled FROM mod_words ORDER BY word`),
    query('SELECT id, phrase, added_by, created_at FROM mod_allowlist ORDER BY phrase'),
    query(`SELECT day, model, requests, tokens, errors FROM mod_ai_usage WHERE day >= CURRENT_DATE - 6 ORDER BY day DESC, model`),
    query(`SELECT layer, status, COUNT(*)::int AS n FROM mod_flags WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY layer, status`),
    getClaudeAccount(),
  ])
  return { settings, words: words.rows, allow: allow.rows, usage: usage.rows, flagStats: flags.rows, claude }
}

// Anthropic has no endpoint for remaining credit, so this is what staff last entered
// minus the cost the bot worked out from each response. See ai/claudeClient.js.
async function getClaudeAccount() {
  const [account, week] = await Promise.all([
    query('SELECT balance_usd, spent_usd, balance_set_at, balance_set_by, state, empty_since, last_error, day_key, day_spent_usd FROM mod_claude_account WHERE id = 1'),
    query(`SELECT purpose, COUNT(DISTINCT day)::int AS days, COALESCE(SUM(requests), 0)::int AS requests,
                  COALESCE(SUM(cost_usd), 0)::float AS cost
             FROM mod_claude_usage WHERE day >= CURRENT_DATE - 6 GROUP BY purpose`),
  ])
  const row = account.rows[0]
  if (!row) return null
  const balance = Number(row.balance_usd)
  const spent = Number(row.spent_usd)
  const weekCost = week.rows.reduce((sum, r) => sum + r.cost, 0)
  const weekDays = Math.max(1, ...week.rows.map((r) => r.days))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  return {
    balance,
    spent,
    remaining: Math.max(0, balance - spent),
    setAt: row.balance_set_at,
    setBy: row.balance_set_by,
    state: row.state,
    emptySince: row.empty_since,
    lastError: row.last_error,
    perDay: weekCost / weekDays,
    today: row.day_key === today ? Number(row.day_spent_usd) : 0,
    week: week.rows,
  }
}

export async function setClaudeBalance({ amount, actor }) {
  const value = Number(amount)
  if (!Number.isFinite(value) || value < 0 || value > 100000) throw new ModError('Enter the balance in dollars, like 5 or 12.50.')
  await query(
    `UPDATE mod_claude_account SET balance_usd = $1, spent_usd = 0, balance_set_at = NOW(), balance_set_by = $2 WHERE id = 1`,
    [value, actor?.name || null]
  )
  return { ok: true }
}

export async function getEvidenceFile(id) {
  const { rows } = await query('SELECT filename, mime, bytes FROM mod_evidence WHERE id = $1 AND bytes IS NOT NULL', [parseInt(id, 10) || 0])
  return rows[0] || null
}

export async function addEvidence({ caseId, filename, mime, bytes, text, actor }) {
  const c = await query('SELECT id, discord_id FROM mod_cases WHERE id = $1', [parseInt(caseId, 10) || 0])
  if (!c.rows[0]) throw new ModError('No such case.', 404)
  await query(
    `INSERT INTO mod_evidence (case_id, kind, filename, mime, size_bytes, bytes, text, added_by_id, added_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [c.rows[0].id, bytes ? 'file' : 'text', filename || null, mime || null, bytes?.length || null, bytes || null, text || null, actor?.discordId || null, actor?.name || null]
  )
  await query(
    `INSERT INTO mod_events (discord_id, case_id, kind, summary, actor_id, actor_name) VALUES ($1, $2, 'evidence', $3, $4, $5)`,
    [c.rows[0].discord_id, c.rows[0].id, `${actor?.name || 'Staff'} added evidence to case ${c.rows[0].id}.`, actor?.discordId || null, actor?.name || null]
  )
  return { ok: true }
}

// ── actions ───────────────────────────────────────────────────────────────────

const NEEDS_RULE = new Set(['warn', 'timeout', 'kick', 'strike', 'suspend', 'ban'])

function requireText(value, what) {
  const text = String(value || '').trim()
  if (text.length < 3) throw new ModError(`${what} is required.`)
  return text.slice(0, 1000)
}

function base(b, action, actor) {
  const targetId = String(b.targetId || '').trim()
  if (!/^\d{5,25}$/.test(targetId)) throw new ModError('Pick a member first.')
  if (targetId === String(actor?.discordId || '')) throw new ModError('You cannot action yourself.')
  const reason = requireText(b.reason, 'A reason')
  if (NEEDS_RULE.has(action) && !RULES.some((r) => r.code === b.ruleCode)) throw new ModError('Pick a rule.')
  return { targetId, targetName: b.targetName || null, ruleCode: b.ruleCode || null, reason, silent: !!b.silent }
}

function banDetails(b) {
  const type = b.banType === 'temp' ? 'temp' : 'appealable'
  const seconds = b.banLength ? parseDuration(b.banLength) : null
  if (b.banLength && !seconds) throw new ModError('I could not read the ban length. Try 30d or 6mo.')
  if (type === 'temp' && !seconds) throw new ModError('A temp ban needs a length, for example 30d.')
  const at = (s) => new Date(Date.now() + s * 1000).toISOString()
  const defaultAppeal = () => {
    const d = new Date()
    d.setMonth(d.getMonth() + 6)
    return d.toISOString()
  }
  return {
    type,
    unbanAt: type === 'temp' ? at(seconds) : null,
    appealAfter: type === 'appealable' ? (seconds ? at(seconds) : defaultAppeal()) : null,
    deleteSeconds: parseInt(b.deleteSeconds, 10) || 0,
  }
}

const ACTION_BUILDERS = {
  note: (b, a) => base(b, 'note', a),
  warn: (b, a) => base(b, 'warn', a),
  timeout(b, a) {
    const seconds = parseDuration(b.duration)
    if (!seconds) throw new ModError('I could not read the length. Try 10m, 2d or 1w.')
    if (seconds > 28 * 86400) throw new ModError('Discord limits a timeout to 28 days.')
    return { ...base(b, 'timeout', a), seconds }
  },
  untimeout: (b, a) => base(b, 'untimeout', a),
  kick: (b, a) => base(b, 'kick', a),
  strike(b, a) {
    const payload = base(b, 'strike', a)
    if (b.withBan) return { ...payload, pkg: { timeoutSeconds: 0, suspension: null, ban: banDetails(b) } }
    const timeoutSeconds = b.duration ? parseDuration(b.duration) : 0
    if (b.duration && !timeoutSeconds) throw new ModError('I could not read the timeout.')
    const suspension = b.suspension ? parseSuspensionLength(b.suspension) : null
    if (b.suspension && !suspension) throw new ModError('I could not read the suspension. Try 3 series.')
    return { ...payload, pkg: { timeoutSeconds, suspension, ban: null } }
  },
  unstrike: (b, a) => base(b, 'unstrike', a),
  set_strikes(b, a) {
    const count = parseInt(b.count, 10)
    if (!Number.isFinite(count) || count < 0 || count > 3) throw new ModError('The count must be 0 to 3.')
    return { ...base(b, 'set_strikes', a), count }
  },
  suspend(b, a) {
    const length = parseSuspensionLength(b.suspension)
    if (!length) throw new ModError('I could not read the length. Try 1 series, 2 weeks or indefinite.')
    return { ...base(b, 'suspend', a), length }
  },
  unsuspend: (b, a) => base(b, 'unsuspend', a),
  ban: (b, a) => ({ ...base(b, 'ban', a), ban: banDetails(b) }),
  unban: (b, a) => base(b, 'unban', a),
}

export async function runAction(body, actor) {
  const build = ACTION_BUILDERS[body.kind]
  if (!build) throw new ModError('Unknown action.')
  return enqueue(body.kind, build(body, actor), actor)
}

export async function voidCase({ caseId, reason, actor }) {
  return enqueue('void', { caseId: parseInt(caseId, 10), reason: requireText(reason, 'A reason') }, actor)
}

export async function changeReason({ caseId, reason, actor }) {
  return enqueue('reason', { caseId: parseInt(caseId, 10), reason: requireText(reason, 'A reason') }, actor)
}

export async function releasePlayer({ targetId, targetName, suspensionId, reason, actor }) {
  return enqueue('release', { targetId, targetName, suspensionId: suspensionId || null, reason: requireText(reason, 'A reason') }, actor)
}

export async function unfreezeStaff({ staffId, actor }) {
  return enqueue('lift_freeze', { staffId: String(staffId) }, actor)
}

export async function importHistory({ actor }) {
  return enqueue('history_import', {}, actor)
}

export async function testFilter({ text, actor }) {
  return enqueue('filter_test', { text: String(text || '').slice(0, 1500) }, actor)
}

export async function decideAppeal({ appealId, verdict, note, actor }) {
  const { rows } = await query('SELECT status FROM mod_appeals WHERE id = $1', [parseInt(appealId, 10) || 0])
  if (!rows[0]) throw new ModError('No such appeal.', 404)
  if (rows[0].status !== 'director') throw new ModError('This appeal is not waiting on a Director.')
  return enqueue('appeal_decide', {
    appealId: parseInt(appealId, 10), verdict: verdict === 'approved' ? 'approved' : 'denied', note: requireText(note, 'A reason'),
  }, actor)
}

export async function saveSettings({ values, actor }) {
  for (const [key, value] of Object.entries(values || {})) {
    if (!(key in DEFAULT_SETTINGS)) continue
    await query(
      `INSERT INTO mod_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, String(value ?? '')]
    )
  }
  return enqueue('filter_reload', {}, actor)
}

export async function addWord({ word, tier, actor }) {
  const clean = String(word || '').trim().toLowerCase()
  if (!clean) throw new ModError('Type a word.')
  await query(
    `INSERT INTO mod_words (word, tier, source, added_by) VALUES ($1, $2, 'staff', $3)
     ON CONFLICT (word) DO UPDATE SET tier = $2, enabled = TRUE`,
    [clean.slice(0, 80), tier === 'watch' ? 'watch' : 'slur', actor?.name || null]
  )
  return enqueue('filter_reload', {}, actor)
}

export async function setWord({ id, enabled, actor }) {
  await query('UPDATE mod_words SET enabled = $2 WHERE id = $1', [parseInt(id, 10) || 0, !!enabled])
  return enqueue('filter_reload', {}, actor)
}

export async function deleteWord({ id, actor }) {
  await query('DELETE FROM mod_words WHERE id = $1', [parseInt(id, 10) || 0])
  return enqueue('filter_reload', {}, actor)
}

export async function addAllowed({ phrase, actor }) {
  const clean = String(phrase || '').trim().toLowerCase()
  if (!clean) throw new ModError('Type a word or phrase.')
  await query(
    `INSERT INTO mod_allowlist (phrase, added_by) VALUES ($1, $2) ON CONFLICT (phrase) DO NOTHING`,
    [clean.slice(0, 100), actor?.name || null]
  )
  return enqueue('filter_reload', {}, actor)
}

export async function deleteAllowed({ id, actor }) {
  await query('DELETE FROM mod_allowlist WHERE id = $1', [parseInt(id, 10) || 0])
  return enqueue('filter_reload', {}, actor)
}

// ── public: suspended badges ──────────────────────────────────────────────────

/** Map<discordId, text>. Suspensions are public already, in #player-suspensions. */
export async function getSuspensionBadges(ids) {
  const list = [...new Set((ids || []).map(String).filter(Boolean))]
  const out = new Map()
  if (!list.length) return out
  try {
    const { rows } = await query(
      `SELECT discord_id, unit, total, served FROM mod_suspensions
        WHERE status IN ('active','queued') AND discord_id = ANY($1::text[]) ORDER BY id DESC`,
      [list]
    )
    for (const r of rows) out.set(r.discord_id, `Suspended: ${suspensionText(r)}`)
  } catch {
    // The table may not exist yet on a fresh database; a badge is never worth failing a page.
  }
  return out
}

// ── public: appeals ───────────────────────────────────────────────────────────

export const APPEAL_QUESTIONS = [
  { key: 'what', label: 'In your own words, what happened?', required: true },
  { key: 'why', label: 'Why should this be lifted?', required: true },
  { key: 'change', label: 'What will you do differently?', required: true },
  { key: 'other', label: 'Anything else staff should know?', required: false },
]

/** Only ever returns the signed-in person's own cases. */
export async function getAppealState(discordId) {
  const id = String(discordId)
  const [bans, suspensions, appeals] = await Promise.all([
    query(
      `SELECT b.case_id, b.ban_type, b.unban_at, b.appeal_after, b.status, b.invite_url, c.reason, c.rule_label, c.created_at
         FROM mod_bans b JOIN mod_cases c ON c.id = b.case_id
        WHERE b.discord_id = $1 AND b.ban_type IN ('temp','appealable') ORDER BY b.created_at DESC`,
      [id]
    ),
    query(
      `SELECT s.case_id, s.unit, s.total, s.served, s.status, c.reason, c.rule_label, c.created_at
         FROM mod_suspensions s JOIN mod_cases c ON c.id = s.case_id
        WHERE s.discord_id = $1 AND s.status IN ('active','queued') ORDER BY s.id DESC`,
      [id]
    ),
    query(
      `SELECT case_id, kind, status, decision_note, decided_at, created_at FROM mod_appeals WHERE discord_id = $1 ORDER BY id DESC`,
      [id]
    ),
  ])
  const byCase = new Map(appeals.rows.map((a) => [a.case_id, a]))
  const now = Date.now()
  const items = []
  for (const b of bans.rows) {
    const appeal = byCase.get(b.case_id) || null
    if (b.status !== 'active' && !appeal) continue
    const opensAt = b.appeal_after ? new Date(b.appeal_after) : null
    items.push({
      caseId: b.case_id,
      kind: 'ban',
      banType: b.ban_type,
      reason: b.reason,
      ruleLabel: b.rule_label,
      unbanAt: b.unban_at,
      opensAt,
      inviteUrl: appeal?.status === 'approved' || (b.ban_type === 'temp' && b.status === 'active') ? b.invite_url : null,
      appeal,
      canAppeal: b.status === 'active' && b.ban_type === 'appealable' && !appeal && !!opensAt && opensAt.getTime() <= now,
    })
  }
  for (const s of suspensions.rows) {
    const appeal = byCase.get(s.case_id) || null
    items.push({
      caseId: s.case_id,
      kind: 'suspension',
      reason: s.reason,
      ruleLabel: s.rule_label,
      lengthText: suspensionText(s),
      appeal,
      canAppeal: !appeal,
    })
  }
  return { items, questions: APPEAL_QUESTIONS }
}

export async function submitAppeal({ discordId, name, caseId, answers }) {
  const state = await getAppealState(discordId)
  const item = state.items.find((i) => i.caseId === parseInt(caseId, 10))
  if (!item) throw new ModError('There is nothing to appeal on that case.', 404)
  if (!item.canAppeal) {
    throw new ModError(item.appeal ? 'This has already been appealed. Appeals can only be made once.' : 'This cannot be appealed yet.', 403)
  }
  const cleaned = []
  for (const q of APPEAL_QUESTIONS) {
    const value = String(answers?.[q.key] || '').trim().slice(0, 1500)
    if (q.required && value.length < 3) throw new ModError(`"${q.label}" is required.`)
    if (value) cleaned.push({ question: q.label, answer: value })
  }
  const { rows } = await query(
    `INSERT INTO mod_appeals (case_id, discord_id, discord_name, kind, answers)
     VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (case_id) DO NOTHING RETURNING id`,
    [item.caseId, String(discordId), name || null, item.kind, JSON.stringify(cleaned)]
  )
  if (!rows[0]) throw new ModError('This has already been appealed.', 403)
  await query(
    `INSERT INTO mod_events (discord_id, case_id, kind, summary, actor_id, actor_name) VALUES ($1, $2, 'appeal', $3, $1, $4)`,
    [String(discordId), item.caseId, `${name || 'They'} appealed case ${item.caseId}.`, name || null]
  )
  await enqueue('appeal_post', {}, { discordId: String(discordId), name })
  return { ok: true }
}

/** The light check behind the Applications page card. */
export async function hasAppealItems(discordId) {
  try {
    const { rows } = await query(
      `SELECT 1 FROM mod_bans WHERE discord_id = $1 AND ban_type IN ('temp','appealable') AND status = 'active'
       UNION ALL SELECT 1 FROM mod_suspensions WHERE discord_id = $1 AND status IN ('active','queued')
       UNION ALL SELECT 1 FROM mod_appeals WHERE discord_id = $1 LIMIT 1`,
      [String(discordId)]
    )
    return rows.length > 0
  } catch {
    return false
  }
}
