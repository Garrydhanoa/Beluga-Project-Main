import crypto from 'crypto'
import { query } from './db'
import { ensureLeagueSchema } from './leagueSchema'
import { buildRow, writeMany } from './activityLog'
import { isSuperAdminId } from './adminIds'

/**
 * Website login security: IP bans, strikes, the session registry, device
 * identification and Salary Crew alerts.
 *
 *   - STRIKES: every failed login (wrong admin password, a non-director on the
 *     admin path, a forged/tampered callback, any failed Discord login) is a
 *     strike against the IP. 3 strikes inside 30 minutes = the IP is banned until
 *     a super admin lifts it on the higgenlogs page.
 *   - OUTAGE GUARD: a server-side failure that hits 3+ different IPs inside 10
 *     minutes is the SITE's problem, not an attack. Its strikes are voided, any
 *     ban they caused is lifted, and Salary Crew is told the login is broken.
 *   - SESSIONS: every sign-in gets a row in web_sessions. JWTs are stateless, so
 *     this registry is what makes "log this person out" and "log everyone out"
 *     possible, and what powers the live "who is online" view.
 *   - SUPER ADMINS (ADMIN_DISCORD_IDS): never banned, never logged out, never
 *     idle-expired. After their first Discord login their device carries a signed
 *     marker cookie, so a ban on their IP can't lock them out of the panel.
 *
 * Everything identifying goes to higgen_logs (super-admin-only). The Discord
 * alert only names the person — no IP, no location.
 */

export const DEVICE_COOKIE = 'beluga_did'
export const GATE_COOKIE = 'beluga_gate'
export const SUPER_ADMIN_COOKIE = 'beluga_sa'

export const STRIKE_LIMIT = 3
export const STRIKE_WINDOW_MIN = 30
const OUTAGE_WINDOW_MS = 10 * 60 * 1000
const OUTAGE_DISTINCT_IPS = 3
export const GATE_TTL_MS = 15 * 60 * 1000
export const IDLE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000
export const ONLINE_WINDOW_MS = 2 * 60 * 1000

const ALERT_CHANNEL_ID = process.env.SECURITY_ALERT_CHANNEL_ID || '1473156680568016906'
const SALARY_CREW_ROLE_ID = process.env.SALARY_CREW_ROLE_ID || '1195275384120418354'

export const BAN_MESSAGE =
  'You’ve been blocked after too many failed login attempts. Contact a director so they can review it and unblock you.'

// ── signing ───────────────────────────────────────────────────────────────────

function secret() {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || ''
}

function hmac(value) {
  return crypto.createHmac('sha256', secret()).update(String(value)).digest('base64url')
}

/** `payload.signature` for a JSON payload. */
export function signPayload(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${body}.${hmac(body)}`
}

/** Verify + decode a signPayload() value; null if missing, tampered or unsigned. */
export function readSignedPayload(raw) {
  if (!raw || typeof raw !== 'string' || !secret()) return null
  const dot = raw.lastIndexOf('.')
  if (dot < 1) return null
  const body = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  const want = hmac(body)
  const a = Buffer.from(sig)
  const b = Buffer.from(want)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return null }
}

export function newDeviceId() {
  return crypto.randomBytes(18).toString('base64url')
}

export function cookieOptions(maxAgeSeconds) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

// ── who / where / what device ────────────────────────────────────────────────

/** Real client IP. Cloudflare → Railway, so cf-connecting-ip wins (CF overwrites it). */
export function ipFromHeaders(h) {
  const get = (k) => (typeof h?.get === 'function' ? h.get(k) : null)
  const cf = get('cf-connecting-ip')
  if (cf) return cf.trim()
  const xff = (get('x-forwarded-for') || '').split(',')[0].trim()
  return xff || (get('x-real-ip') || '').trim() || 'unknown'
}

export function parseUserAgent(ua) {
  const s = String(ua || '')
  if (!s) return { browser: 'Unknown browser', os: 'Unknown OS', deviceType: 'unknown' }
  const pick = (re) => { const m = s.match(re); return m ? m[1] : null }
  let browser = 'Unknown browser'
  if (/Edg\//.test(s)) browser = `Edge ${pick(/Edg\/(\d+)/) || ''}`
  else if (/OPR\/|Opera/.test(s)) browser = `Opera ${pick(/OPR\/(\d+)/) || ''}`
  else if (/SamsungBrowser/.test(s)) browser = `Samsung Internet ${pick(/SamsungBrowser\/(\d+)/) || ''}`
  else if (/Firefox\//.test(s)) browser = `Firefox ${pick(/Firefox\/(\d+)/) || ''}`
  else if (/Chrome\//.test(s)) browser = `Chrome ${pick(/Chrome\/(\d+)/) || ''}`
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = `Safari ${pick(/Version\/(\d+)/) || ''}`
  else if (/curl|python|node|axios|go-http|java|wget|httpclient/i.test(s)) browser = `Script/tool (${s.slice(0, 40)})`

  let os = 'Unknown OS'
  if (/Windows NT 10/.test(s)) os = 'Windows 10/11'
  else if (/Windows NT/.test(s)) os = 'Windows'
  else if (/iPhone|iPad|iPod/.test(s)) os = `iOS ${(pick(/OS (\d+[_.]\d+)/) || '').replace('_', '.')}`
  else if (/Android/.test(s)) os = `Android ${pick(/Android (\d+(?:\.\d+)?)/) || ''}`
  else if (/Mac OS X/.test(s)) os = 'macOS'
  else if (/CrOS/.test(s)) os = 'ChromeOS'
  else if (/Linux/.test(s)) os = 'Linux'

  const deviceType = /iPad|Tablet/.test(s) ? 'tablet' : /Mobi|iPhone|Android/.test(s) ? 'phone' : 'desktop'
  return { browser: browser.trim(), os: os.trim(), deviceType }
}

export function clientInfoFromHeaders(h) {
  const get = (k) => (typeof h?.get === 'function' ? h.get(k) : null)
  const userAgent = get('user-agent') || ''
  return {
    ip: ipFromHeaders(h),
    country: (get('cf-ipcountry') || '').trim() || null,
    userAgent,
    language: (get('accept-language') || '').split(',')[0] || null,
    ...parseUserAgent(userAgent),
  }
}

function isPrivateIp(ip) {
  return !ip || ip === 'unknown' || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(ip)
}

const geoCache = new Map() // ip -> { at, data }

/**
 * Approximate location + provider for an IP (ipinfo.io). ONLY called for login
 * events — never for ordinary visitors. Best-effort: 2.5s timeout, cached a day,
 * null on any failure.
 */
export async function lookupIp(ip) {
  if (isPrivateIp(ip)) return null
  const hit = geoCache.get(ip)
  if (hit && Date.now() - hit.at < 24 * 60 * 60 * 1000) return hit.data
  try {
    const token = process.env.IPINFO_TOKEN ? `?token=${encodeURIComponent(process.env.IPINFO_TOKEN)}` : ''
    const res = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json${token}`, {
      signal: AbortSignal.timeout(2500),
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const j = await res.json()
    const data = {
      city: j.city || null, region: j.region || null, country: j.country || null,
      org: j.org || null, postal: j.postal || null, timezone: j.timezone || null,
      hostname: j.hostname || null, loc: j.loc || null,
    }
    geoCache.set(ip, { at: Date.now(), data })
    if (geoCache.size > 2000) geoCache.delete(geoCache.keys().next().value)
    return data
  } catch {
    return null
  }
}

export function describeGeo(geo, cfCountry) {
  if (!geo) return cfCountry ? `Country ${cfCountry}` : null
  return [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || cfCountry || null
}

// ── device fingerprint ───────────────────────────────────────────────────────

const FP_KEYS = ['tz', 'lang', 'langs', 'platform', 'screen', 'dpr', 'colorDepth', 'cores', 'memory', 'touch', 'vendor']

/** Keep only the known, small, non-sensitive fingerprint fields. */
export function cleanFingerprint(fp) {
  if (!fp || typeof fp !== 'object') return null
  const out = {}
  for (const k of FP_KEYS) {
    const v = fp[k]
    if (v === undefined || v === null) continue
    out[k] = typeof v === 'number' ? v : String(v).slice(0, 120)
  }
  return Object.keys(out).length ? out : null
}

export function fingerprintHash(fp) {
  if (!fp) return null
  const stable = FP_KEYS.map((k) => `${k}=${fp[k] ?? ''}`).join('|')
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16)
}

export function describeFingerprint(fp) {
  if (!fp) return null
  return [fp.tz, fp.langs || fp.lang, fp.screen && `screen ${fp.screen}${fp.dpr ? ` @${fp.dpr}x` : ''}`,
    fp.cores && `${fp.cores} cores`, fp.memory && `${fp.memory} GB RAM`, fp.platform]
    .filter(Boolean).join(' · ')
}

export async function upsertDevice({ deviceId, fingerprint = null, ip = null, discordId = null }) {
  if (!deviceId) return
  try {
    await ensureLeagueSchema()
    const fp = cleanFingerprint(fingerprint)
    await query(
      `INSERT INTO security_devices (device_id, fp_hash, fingerprint, last_ip, discord_ids)
       VALUES ($1, $2, $3::jsonb, $4, CASE WHEN $5::text IS NULL THEN '{}'::text[] ELSE ARRAY[$5::text] END)
       ON CONFLICT (device_id) DO UPDATE SET
         fp_hash = COALESCE(EXCLUDED.fp_hash, security_devices.fp_hash),
         fingerprint = COALESCE(EXCLUDED.fingerprint, security_devices.fingerprint),
         last_ip = COALESCE(EXCLUDED.last_ip, security_devices.last_ip),
         last_seen = NOW(),
         discord_ids = CASE
           WHEN $5::text IS NULL OR $5::text = ANY(security_devices.discord_ids) THEN security_devices.discord_ids
           ELSE array_append(security_devices.discord_ids, $5::text) END`,
      [deviceId, fp ? fingerprintHash(fp) : null, fp ? JSON.stringify(fp) : null, ip, discordId ? String(discordId) : null]
    )
  } catch { /* identification is best-effort */ }
}

export async function getDevice(deviceId) {
  if (!deviceId) return null
  try {
    const r = await query(`SELECT * FROM security_devices WHERE device_id = $1`, [deviceId])
    return r.rows[0] || null
  } catch { return null }
}

/** Other Discord accounts this browser/device has signed in as (multi-account tell). */
export async function otherAccountsOnDevice(device, discordId) {
  const ids = (device?.discord_ids || []).filter((id) => id !== String(discordId))
  if (!ids.length) return []
  try {
    const r = await query(
      `SELECT discord_id, COALESCE(display_name, username) AS name FROM discord_members WHERE discord_id = ANY($1)`,
      [ids]
    )
    const names = new Map(r.rows.map((x) => [String(x.discord_id), x.name]))
    return ids.map((id) => `${names.get(id) || 'unknown'} (${id})`)
  } catch {
    return ids
  }
}

// ── super-admin device marker ────────────────────────────────────────────────

export function superAdminCookieValue(discordId, deviceId) {
  return signPayload({ d: String(discordId), v: String(deviceId || ''), t: Date.now() })
}

/** True when this browser carries a valid marker for a current ADMIN_DISCORD_IDS member. */
export function hasSuperAdminMarker(cookieGet) {
  try {
    const p = readSignedPayload(cookieGet(SUPER_ADMIN_COOKIE))
    if (!p || !isSuperAdminId(p.d)) return false
    const did = cookieGet(DEVICE_COOKIE)
    return !p.v || !did || p.v === did
  } catch {
    return false
  }
}

// ── bans ──────────────────────────────────────────────────────────────────────

const banCache = new Map() // ip -> { at, ban }
const BAN_CACHE_MS = 10 * 1000

export async function getActiveBan(ip) {
  if (!ip || ip === 'unknown') return null
  const hit = banCache.get(ip)
  if (hit && Date.now() - hit.at < BAN_CACHE_MS) return hit.ban
  try {
    await ensureLeagueSchema()
    const r = await query(
      `SELECT * FROM ip_bans WHERE ip = $1 AND lifted_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY id DESC LIMIT 1`,
      [ip]
    )
    const ban = r.rows[0] || null
    banCache.set(ip, { at: Date.now(), ban })
    return ban
  } catch {
    return null // fail OPEN on a DB blip: a database hiccup must not lock everyone out
  }
}

/**
 * Is this request blocked? Super admins (by session or by device marker) never are.
 * @param {{ ip: string, discordId?: string|null, cookieGet?: (name:string)=>string|undefined }} who
 */
export async function isAccessBlocked({ ip, discordId = null, cookieGet = null }) {
  if (discordId && isSuperAdminId(discordId)) return null
  if (cookieGet && hasSuperAdminMarker(cookieGet)) return null
  return getActiveBan(ip)
}

export async function banIp({ ip, reason, by, auto = false, discordId = null, discordName = null, strikeCount = 0 }) {
  await ensureLeagueSchema()
  const existing = await getActiveBan(ip)
  if (existing) return existing
  const r = await query(
    `INSERT INTO ip_bans (ip, reason, auto, created_by, last_discord_id, last_discord_name, strike_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [ip, reason || null, !!auto, by || null, discordId, discordName, strikeCount]
  )
  banCache.delete(ip)
  return r.rows[0]
}

export async function liftBan({ id, by, reason = null }) {
  await ensureLeagueSchema()
  const r = await query(
    `UPDATE ip_bans SET lifted_at = NOW(), lifted_by = $2, lift_reason = $3
     WHERE id = $1 AND lifted_at IS NULL RETURNING *`,
    [id, by || null, reason]
  )
  if (r.rows[0]) banCache.delete(r.rows[0].ip)
  return r.rows[0] || null
}

// ── strikes ──────────────────────────────────────────────────────────────────

export const STRIKE_WORDS = {
  gate_password: 'wrong admin password',
  admin_denied: 'admin login without access',
  oauth_tampered: 'forged or tampered login',
  login_failed: 'failed Discord login',
}

/**
 * Record one failed attempt and ban the IP on the 3rd inside the window.
 * Returns { strikeId, count, ban } (ban only when this strike tipped it over).
 */
export async function recordStrike({
  ip, kind, path = null, discordId = null, discordName = null, deviceId = null,
  errorSig = null, detail = null, bypass = false,
}) {
  if (bypass || !ip || ip === 'unknown' || (discordId && isSuperAdminId(discordId))) {
    return { strikeId: null, count: 0, ban: null }
  }
  try {
    await ensureLeagueSchema()
    const ins = await query(
      `INSERT INTO security_strikes (ip, kind, path, discord_id, discord_name, device_id, error_sig, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [ip, kind, path, discordId, discordName, deviceId, errorSig, detail ? String(detail).slice(0, 500) : null]
    )
    const strikeId = ins.rows[0]?.id || null
    const c = await query(
      `SELECT COUNT(*)::int AS n,
              (ARRAY_AGG(discord_id ORDER BY at DESC) FILTER (WHERE discord_id IS NOT NULL))[1] AS last_id,
              (ARRAY_AGG(discord_name ORDER BY at DESC) FILTER (WHERE discord_name IS NOT NULL))[1] AS last_name
         FROM security_strikes
        WHERE ip = $1 AND voided_at IS NULL AND at > NOW() - make_interval(mins => $2::int)`,
      [ip, String(STRIKE_WINDOW_MIN)]
    )
    const count = c.rows[0]?.n || 0
    if (count < STRIKE_LIMIT) return { strikeId, count, ban: null }
    if (await getActiveBan(ip)) return { strikeId, count, ban: null }

    const lastId = discordId || c.rows[0]?.last_id || null
    const lastName = discordName || c.rows[0]?.last_name || null
    const ban = await banIp({
      ip, auto: true, by: 'automatic', strikeCount: count, discordId: lastId, discordName: lastName,
      reason: `${count} failed login attempts within ${STRIKE_WINDOW_MIN} minutes (latest: ${STRIKE_WORDS[kind] || kind})`,
    })
    await logSecurityEvent({
      eventType: 'ip_ban', outcome: 'denied', action: 'security.auto-ban',
      actor: { name: lastName || 'An unknown visitor', discordId: lastId },
      summary: `The website automatically blocked an IP after ${count} failed login attempts in ${STRIKE_WINDOW_MIN} minutes${lastName ? ` (last seen as ${lastName})` : ''}.`,
      details: [
        ['Blocked until', 'A super admin lifts it on the higgenlogs page'],
        ['Latest attempt', STRIKE_WORDS[kind] || kind],
        ['Last Discord account seen', lastId ? `${lastName || 'unknown'} (${lastId})` : 'Never finished a Discord login'],
      ],
      ip,
    })
    await sendSecurityAlert(`ban:${ip}`,
      `An IP was blocked after ${count} failed login attempts${lastId ? ` — last seen as <@${lastId}>` : ''}. Review or unblock it in higgenlogs.`)
    return { strikeId, count, ban }
  } catch {
    return { strikeId: null, count: 0, ban: null }
  }
}

/** Attach the Discord identity learned after OAuth to an earlier anonymous strike. */
export async function attachIdentityToStrike(strikeId, discordId, discordName) {
  if (!strikeId) return
  try {
    await query(
      `UPDATE security_strikes SET discord_id = $2, discord_name = $3 WHERE id = $1 AND discord_id IS NULL`,
      [strikeId, discordId, discordName]
    )
    await query(
      `UPDATE ip_bans SET last_discord_id = $2, last_discord_name = $3
        WHERE lifted_at IS NULL AND ip = (SELECT ip FROM security_strikes WHERE id = $1)`,
      [strikeId, discordId, discordName]
    )
  } catch { /* best-effort */ }
}

// ── outage guard ─────────────────────────────────────────────────────────────

const outageSeen = new Map() // sig -> Map(ip -> ts)
const outageAnnounced = new Map() // sig -> ts

/**
 * Note a server-side login failure. Returns true when the same failure has now hit
 * 3+ different IPs inside 10 minutes — i.e. the site is broken, not under attack.
 * The first time that trips (per signature per hour) the strikes it caused are
 * voided, auto-bans they produced are lifted, and Salary Crew is alerted.
 */
export async function noteServerSideFailure(sig, ip, humanError) {
  const now = Date.now()
  const seen = outageSeen.get(sig) || new Map()
  seen.set(ip, now)
  for (const [k, ts] of seen) if (now - ts > OUTAGE_WINDOW_MS) seen.delete(k)
  outageSeen.set(sig, seen)
  if (seen.size < OUTAGE_DISTINCT_IPS) return false

  const last = outageAnnounced.get(sig) || 0
  if (now - last > 60 * 60 * 1000) {
    outageAnnounced.set(sig, now)
    await voidOutageStrikes(sig)
    await reportLoginSystemFailure(sig, humanError, `${seen.size} different visitors in the last 10 minutes`)
  }
  return true
}

async function voidOutageStrikes(sig) {
  try {
    const voided = await query(
      `UPDATE security_strikes SET voided_at = NOW()
        WHERE error_sig = $1 AND voided_at IS NULL AND at > NOW() - INTERVAL '30 minutes'
        RETURNING ip`,
      [sig]
    )
    const ips = [...new Set(voided.rows.map((r) => r.ip))]
    for (const ip of ips) {
      const ban = await getActiveBan(ip)
      if (!ban?.auto) continue
      const c = await query(
        `SELECT COUNT(*)::int AS n FROM security_strikes
          WHERE ip = $1 AND voided_at IS NULL AND at > NOW() - make_interval(mins => $2::int)`,
        [ip, String(STRIKE_WINDOW_MIN)]
      )
      if ((c.rows[0]?.n || 0) < STRIKE_LIMIT) {
        await liftBan({ id: ban.id, by: 'automatic', reason: 'The login failures that caused it were a website outage, not the visitor' })
      }
    }
  } catch { /* best-effort */ }
}

const systemAlerted = new Map() // sig -> ts

/** Discord login is broken for everyone (config error or an outage). */
export async function reportLoginSystemFailure(sig, humanError, scope = null) {
  const now = Date.now()
  const last = systemAlerted.get(sig) || 0
  await logSecurityEvent({
    stream: 'error', eventType: 'login_system', outcome: 'failed', action: 'security.login-broken',
    summary: `Discord login on the website is failing${scope ? ` for ${scope}` : ''}: ${humanError}`,
    details: [['What failed', humanError], ...(scope ? [['How widespread', scope]] : [])],
  })
  if (now - last < 60 * 60 * 1000) return
  systemAlerted.set(sig, now)
  await sendSecurityAlert(`system:${sig}`,
    `Website Discord login is failing${scope ? ` (${scope})` : ''}: \`${String(humanError).slice(0, 180)}\`. Details are in higgenlogs.`, { force: true })
}

// ── session registry ─────────────────────────────────────────────────────────

const sessionCache = new Map() // sid -> { at, row }
const SESSION_CACHE_MS = 15 * 1000
const lastTouch = new Map() // sid -> ts

export async function createSession(row) {
  try {
    await ensureLeagueSchema()
    await query(
      `INSERT INTO web_sessions (sid, discord_id, username, display_name, avatar_url, email,
         login_intent, gate_passed, is_director, is_super_admin, access_granted,
         ip, country, city, region, isp, user_agent, browser, os, device_type,
         device_id, fp_hash, guilds, identity, last_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24::jsonb,$25)
       ON CONFLICT (sid) DO NOTHING`,
      [
        row.sid, String(row.discordId), row.username || null, row.displayName || null, row.avatarUrl || null, row.email || null,
        row.loginIntent || null, !!row.gatePassed, !!row.isDirector, !!row.isSuperAdmin, !!row.accessGranted,
        row.ip || null, row.country || null, row.city || null, row.region || null, row.isp || null,
        row.userAgent || null, row.browser || null, row.os || null, row.deviceType || null,
        row.deviceId || null, row.fpHash || null,
        JSON.stringify(row.guilds || []), JSON.stringify(row.identity || {}), row.lastPath || null,
      ]
    )
  } catch { /* registry is best-effort; the JWT still works */ }
}

export async function getSessionState(sid) {
  if (!sid) return null
  const hit = sessionCache.get(sid)
  if (hit && Date.now() - hit.at < SESSION_CACHE_MS) return hit.row
  try {
    const r = await query(
      `SELECT sid, discord_id, is_super_admin, revoked_at, last_seen_at FROM web_sessions WHERE sid = $1`,
      [sid]
    )
    const row = r.rows[0] || null
    sessionCache.set(sid, { at: Date.now(), row })
    if (sessionCache.size > 5000) sessionCache.delete(sessionCache.keys().next().value)
    return row
  } catch {
    return hit?.row ?? undefined // undefined = unknown (DB blip) → caller must not revoke
  }
}

/** Re-create a minimal registry row for a valid token whose sign-in write was lost. */
export async function restoreSessionRow(token) {
  try {
    await query(
      `INSERT INTO web_sessions (sid, discord_id, username, login_intent, gate_passed, is_director, is_super_admin, access_granted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (sid) DO NOTHING`,
      [token.sid, String(token.discordUserId || ''), token.discordUsername || null, token.loginIntent || null,
        !!token.gatePassed, !!token.isDirector, isSuperAdminId(token.discordUserId),
        token.loginIntent === 'admin' ? !!(token.isDirector && token.gatePassed) : true]
    )
    sessionCache.delete(token.sid)
    return await getSessionState(token.sid)
  } catch {
    return undefined
  }
}

/** Heartbeat: bump last_seen (and where they are) at most every 20s per session. */
export async function touchSession(sid, { path = null, ip = null } = {}) {
  if (!sid) return
  const now = Date.now()
  if (now - (lastTouch.get(sid) || 0) < 20 * 1000) return
  lastTouch.set(sid, now)
  try {
    await query(
      `UPDATE web_sessions SET last_seen_at = NOW(),
              last_path = COALESCE($2, last_path), ip = COALESCE($3, ip)
        WHERE sid = $1 AND revoked_at IS NULL`,
      [sid, path ? String(path).slice(0, 300) : null, ip]
    )
    const hit = sessionCache.get(sid)
    if (hit?.row) hit.row.last_seen_at = new Date()
  } catch { /* best-effort */ }
}

export async function revokeSession(sid, by, reason) {
  const r = await query(
    `UPDATE web_sessions SET revoked_at = NOW(), revoked_by = $2, revoke_reason = $3
      WHERE sid = $1 AND revoked_at IS NULL AND is_super_admin = FALSE RETURNING sid, discord_id, username`,
    [sid, by || null, reason || null]
  )
  sessionCache.delete(sid)
  return r.rows[0] || null
}

export async function revokeSessionsForUser(discordId, by, reason) {
  if (isSuperAdminId(discordId)) return []
  const r = await query(
    `UPDATE web_sessions SET revoked_at = NOW(), revoked_by = $2, revoke_reason = $3
      WHERE discord_id = $1 AND revoked_at IS NULL AND is_super_admin = FALSE RETURNING sid`,
    [String(discordId), by || null, reason || null]
  )
  for (const row of r.rows) sessionCache.delete(row.sid)
  return r.rows
}

export async function revokeAllSessions(by, reason) {
  const r = await query(
    `UPDATE web_sessions SET revoked_at = NOW(), revoked_by = $1, revoke_reason = $2
      WHERE revoked_at IS NULL AND is_super_admin = FALSE RETURNING sid`,
    [by || null, reason || null]
  )
  sessionCache.clear()
  return r.rows
}

// ── alerts ───────────────────────────────────────────────────────────────────

const alertSent = new Map() // key -> ts
const ALERT_DEDUPE_MS = 30 * 60 * 1000

/**
 * Post a short alert to the director channel, pinging Salary Crew. Only names the
 * person — every identifying detail stays in higgenlogs. Deduped per key.
 */
export async function sendSecurityAlert(key, content, { force = false } = {}) {
  const now = Date.now()
  if (!force && now - (alertSent.get(key) || 0) < ALERT_DEDUPE_MS) return false
  alertSent.set(key, now)
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) return false
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${ALERT_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `<@&${SALARY_CREW_ROLE_ID}> ${content}`,
        allowed_mentions: { roles: [SALARY_CREW_ROLE_ID], users: [] },
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`Discord answered HTTP ${res.status}`)
    return true
  } catch (err) {
    await logSecurityEvent({
      stream: 'error', eventType: 'server_error', outcome: 'failed', action: 'security.alert',
      summary: `The website could not post a security alert to Discord: ${err.message}`,
      details: [['Alert', content]], error: err,
    })
    return false
  }
}

// ── audit ────────────────────────────────────────────────────────────────────

export async function logSecurityEvent({
  stream = 'interaction', eventType, outcome, action, actor = null, summary, details = [],
  ip = null, userAgent = null, location = 'Website login', target = null, error = null,
}) {
  try {
    await writeMany([buildRow({
      stream, eventType, outcome, action, summary, details, ip, userAgent, location, target, error,
      actor: actor ? { name: actor.name || 'unknown', tag: actor.tag || null, discordId: actor.discordId || null } : null,
    })])
  } catch { /* logging never breaks a login */ }
}

/** Split a long list into several readable detail rows (each value ≤ ~450 chars). */
export function chunkedPairs(label, items) {
  const out = []
  let cur = []
  let len = 0
  let from = 1
  items.forEach((item, i) => {
    const s = String(item)
    if (len + s.length + 2 > 450 && cur.length) {
      out.push([`${label} ${from}–${i}`, cur.join(', ')])
      cur = []; len = 0; from = i + 1
    }
    cur.push(s); len += s.length + 2
  })
  if (cur.length) out.push([out.length ? `${label} ${from}–${items.length}` : label, cur.join(', ')])
  return out
}

// ── housekeeping ─────────────────────────────────────────────────────────────

let lastPrune = 0

/** Keep the security tables bounded (hourly at most). Bans are never pruned. */
export async function pruneSecurityTables() {
  const now = Date.now()
  if (now - lastPrune < 60 * 60 * 1000) return
  lastPrune = now
  try {
    await query(`DELETE FROM security_strikes WHERE at < NOW() - INTERVAL '90 days'`)
    await query(`DELETE FROM web_sessions WHERE last_seen_at < NOW() - INTERVAL '90 days' AND is_super_admin = FALSE`)
  } catch { /* best-effort */ }
}
