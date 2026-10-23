import crypto from 'crypto'
import { cookies, headers } from 'next/headers'
import { NextRequest } from 'next/server'
import { query } from './db'
import { isSuperAdminId } from './adminIds'
import { getAuthContext, queueAuthCookie } from './authRequestContext'
import {
  DEVICE_COOKIE, GATE_COOKIE, SUPER_ADMIN_COOKIE, GATE_TTL_MS, STRIKE_WORDS,
  attachIdentityToStrike, chunkedPairs, clientInfoFromHeaders, cookieOptions, createSession,
  describeFingerprint, describeGeo, getDevice, hasSuperAdminMarker, logSecurityEvent, lookupIp,
  newDeviceId, noteServerSideFailure, otherAccountsOnDevice, readSignedPayload, recordStrike,
  reportLoginSystemFailure, sendSecurityAlert, superAdminCookieValue, upsertDevice, pruneSecurityTables,
} from './security'

/**
 * What happens around a Discord login, on top of NextAuth:
 *   - onSignIn():          runs inside the jwt callback on a successful OAuth exchange.
 *                          Decides admin access (gate + director), opens the session
 *                          registry row, records who the person is, strikes/alerts on
 *                          a denied admin attempt.
 *   - handleAuthFailure(): runs in the route wrapper when the OAuth round-trip FAILED.
 *                          Classifies the failure, strikes the IP (or not, for a
 *                          site-side fault), and alerts when login is broken.
 *   - normalizeIssuer():   keeps login working if Discord tweaks its `iss` spelling.
 */

const DISCORD_ISSUER = 'https://discord.com'
const SESSION_COOKIE_NAMES = ['__Secure-next-auth.callback-url', 'next-auth.callback-url']

// ── iss normalisation ────────────────────────────────────────────────────────

/**
 * Discord now appends `iss` (RFC 9207) to the OAuth redirect. openid-client rejects
 * the callback unless it EXACTLY equals the configured issuer. If Discord ever sends
 * a harmless variant (trailing slash, www., another discord.com host) we rewrite it
 * to the canonical value so login keeps working. Anything that is NOT a discord.com
 * host is left alone, so a genuinely foreign issuer still fails the check.
 */
export function normalizeIssuer(req) {
  try {
    const url = new URL(req.url)
    const iss = url.searchParams.get('iss')
    if (!iss || iss === DISCORD_ISSUER) return req
    let host = ''
    try { host = new URL(iss).hostname.toLowerCase() } catch { return req }
    if (host !== 'discord.com' && !host.endsWith('.discord.com')) return req
    url.searchParams.set('iss', DISCORD_ISSUER)
    return new NextRequest(url, { method: req.method, headers: req.headers })
  } catch {
    return req
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function snowflakeDate(id) {
  try {
    const ms = Number(BigInt(String(id)) >> 22n) + 1420070400000
    return new Date(ms)
  } catch { return null }
}

function fmtDate(d) {
  if (!d) return null
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.valueOf())) return null
  return dt.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET'
}

function intentFromPath(path) {
  const p = String(path || '')
  if (p.startsWith('/admin')) return 'admin'
  if (p.startsWith('/applications')) return 'applications'
  return 'site'
}

function pathFromCallbackUrl(raw) {
  if (!raw) return null
  try { return new URL(raw, process.env.NEXTAUTH_URL || 'http://localhost').pathname } catch { return null }
}

const INTENT_WORDS = { admin: 'the admin panel', applications: 'Applications', site: 'the website' }

async function discordGet(path, accessToken) {
  try {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function roleNames(roleIds) {
  if (!roleIds?.length) return []
  try {
    const r = await query(`SELECT role_id, name FROM discord_roles WHERE role_id = ANY($1)`, [roleIds.map(String)])
    const m = new Map(r.rows.map((x) => [String(x.role_id), x.name]))
    return roleIds.map((id) => m.get(String(id)) || id)
  } catch { return roleIds }
}

const NITRO = { 0: 'None', 1: 'Nitro Classic', 2: 'Nitro', 3: 'Nitro Basic' }

// ── successful OAuth exchange ────────────────────────────────────────────────

/**
 * Called from the jwt callback when `account` is present. Mutates `token`:
 *   gatePassed, loginIntent, sid, superAdmin.
 * `member` = the guild-member object from refreshDiscordRoles (or null).
 */
export async function onSignIn(token, { account, profile, member }) {
  const discordId = String(token.discordUserId || account?.providerAccountId || '')
  let h, c
  try { h = await headers(); c = await cookies() } catch { return } // not in a request (shouldn't happen)
  const cookieGet = (name) => c.get(name)?.value
  const info = clientInfoFromHeaders(h)
  const callbackPath = pathFromCallbackUrl(SESSION_COOKIE_NAMES.map(cookieGet).find(Boolean))
  const intent = intentFromPath(callbackPath)

  let deviceId = cookieGet(DEVICE_COOKIE)
  if (!deviceId) {
    deviceId = newDeviceId()
    queueAuthCookie(DEVICE_COOKIE, deviceId, cookieOptions(365 * 24 * 3600))
  }

  const superAdmin = isSuperAdminId(discordId)
  const gate = readSignedPayload(cookieGet(GATE_COOKIE))
  const gateFresh = !!gate && Date.now() - Number(gate.at || 0) < GATE_TTL_MS
  const gateState = intent !== 'admin' ? 'n/a' : !gate || !gateFresh ? 'skipped' : gate.ok ? 'passed' : 'failed'

  token.loginIntent = intent
  token.gatePassed = gateState === 'passed'
  token.superAdmin = superAdmin
  token.sid = crypto.randomUUID()
  if (gate) queueAuthCookie(GATE_COOKIE, '', cookieOptions(0)) // a gate pass is single-use

  const adminAccess = !!(token.isDirector && token.gatePassed)
  let denialReason = null
  if (intent === 'admin' && !adminAccess) {
    denialReason = gateState === 'failed' ? 'wrong admin password'
      : gateState === 'skipped' ? 'skipped the admin password page'
        : 'not a director'
  }

  const username = profile?.username || token.discordUsername || 'unknown'
  const displayName = profile?.global_name || member?.nick || username
  const avatarUrl = profile?.avatar
    ? `https://cdn.discordapp.com/avatars/${discordId}/${profile.avatar}.png?size=128`
    : null

  // Everything we can learn, in parallel and each best-effort.
  const [guilds, geo, device] = await Promise.all([
    account?.access_token ? discordGet('/users/@me/guilds', account.access_token) : null,
    lookupIp(info.ip),
    getDevice(deviceId),
  ])
  await upsertDevice({ deviceId, ip: info.ip, discordId })
  const others = await otherAccountsOnDevice(device, discordId)
  const leagueRoles = await roleNames(member?.roles || [])
  const guildList = Array.isArray(guilds) ? guilds : []
  const guildNames = guildList.map((g) => `${g.name}${g.owner ? ' (owner)' : ''}`)

  if (superAdmin) {
    queueAuthCookie(SUPER_ADMIN_COOKIE, superAdminCookieValue(discordId, deviceId), cookieOptions(400 * 24 * 3600))
  }

  await createSession({
    sid: token.sid, discordId, username, displayName, avatarUrl, email: profile?.email || null,
    loginIntent: intent, gatePassed: token.gatePassed, isDirector: !!token.isDirector,
    isSuperAdmin: superAdmin, accessGranted: intent === 'admin' ? adminAccess : true,
    ip: info.ip, country: geo?.country || info.country, city: geo?.city, region: geo?.region, isp: geo?.org,
    userAgent: info.userAgent, browser: info.browser, os: info.os, deviceType: info.deviceType,
    deviceId, fpHash: device?.fp_hash || null, lastPath: callbackPath,
    guilds: guildList.map((g) => ({ id: g.id, name: g.name, owner: !!g.owner })),
    identity: {
      email: profile?.email || null, verified: profile?.verified ?? null, mfa: profile?.mfa_enabled ?? null,
      locale: profile?.locale || null, premium: profile?.premium_type ?? null,
      created: snowflakeDate(discordId), nick: member?.nick || null, joinedAt: member?.joined_at || null,
      roles: leagueRoles, inServer: !!member,
    },
  })

  const actor = { name: displayName, tag: username, discordId }
  const details = [
    ['Discord account', `${username} (${discordId})`],
    ['Display name', displayName],
    ['Discord email', profile?.email ? `${profile.email}${profile.verified ? ' (verified)' : ' (unverified)'}` : 'Not shared'],
    ['Account created', fmtDate(snowflakeDate(discordId)) || 'unknown'],
    ['Two-factor auth', profile?.mfa_enabled == null ? 'unknown' : profile.mfa_enabled ? 'On' : 'Off'],
    ['Nitro', NITRO[profile?.premium_type] || 'unknown'],
    ['Discord language', profile?.locale || 'unknown'],
    ['In the league server', member ? `Yes — ${member.nick ? `nickname “${member.nick}”, ` : ''}joined ${fmtDate(member.joined_at) || 'unknown'}` : 'No'],
    ['League roles', leagueRoles.length ? leagueRoles.join(', ') : 'None'],
    ['Director', token.isDirector ? 'Yes' : 'No'],
    ['Signing in to', INTENT_WORDS[intent]],
    ...(intent === 'admin' ? [['Admin password page', { passed: 'Passed', failed: 'Wrong password', skipped: 'Skipped / not used' }[gateState]]] : []),
    ['Result', denialReason ? `Denied — ${denialReason}` : 'Signed in'],
    ['Network location', describeGeo(geo, info.country) || 'unknown'],
    ['Internet provider', geo?.org || 'unknown'],
    ...(geo?.hostname ? [['IP hostname', geo.hostname]] : []),
    ['Device', `${info.browser} on ${info.os} (${info.deviceType})`],
    ['Browser language', info.language || 'unknown'],
    ['Device ID', deviceId],
    ['Device fingerprint', device?.fp_hash ? `${device.fp_hash} — ${describeFingerprint(device.fingerprint) || ''}` : 'Not captured'],
    ['Device first seen', fmtDate(device?.first_seen) || 'Just now'],
    ['Other accounts on this device', others.length ? others.join(', ') : 'None'],
    ...(guildNames.length ? chunkedPairs(`Discord servers (${guildNames.length})`, guildNames) : [['Discord servers', 'Not shared']]),
  ]

  await logSecurityEvent({
    eventType: 'login', outcome: denialReason ? 'denied' : 'success', action: denialReason ? 'security.login-denied' : 'security.login',
    actor, ip: info.ip, userAgent: info.userAgent,
    summary: denialReason
      ? `${displayName} (${username}) tried to sign in to the admin panel and was denied — ${denialReason}.`
      : `${displayName} (${username}) signed in to ${INTENT_WORDS[intent]}${superAdmin ? ' as a super admin' : ''}.`,
    details,
  })

  if (denialReason) {
    const bypass = superAdmin || hasSuperAdminMarker(cookieGet)
    if (gateState === 'failed' && gate?.strike) {
      // The wrong password already counted as a strike — just put a name on it.
      await attachIdentityToStrike(gate.strike, discordId, username)
    } else {
      await recordStrike({
        ip: info.ip, kind: 'admin_denied', path: callbackPath, discordId, discordName: username,
        deviceId, detail: denialReason, bypass,
      })
    }
    await sendSecurityAlert(`denied:${discordId}`,
      `Admin panel login denied for <@${discordId}> (${username}) — ${denialReason}. Full details are in higgenlogs.`)
  }

  const ctx = getAuthContext()
  if (ctx) ctx.signIn = { discordId, intent, denied: !!denialReason }
  pruneSecurityTables().catch(() => {})
}

// ── failed OAuth round-trip ──────────────────────────────────────────────────

const TAMPER = /state|pkce|code_verifier|checks\.|iss mismatch|unexpected iss|issuer mismatch|nonce/i
const CONFIG = /must be configured|invalid_client|client_secret|unauthorized_client|redirect_uri|configuration|NEXTAUTH_SECRET|no_secret/i

function errorSignature(message) {
  return crypto.createHash('sha1').update(String(message || '').replace(/\d+/g, '#').slice(0, 200)).digest('hex').slice(0, 12)
}

/**
 * The OAuth round-trip failed (NextAuth redirected to its error page). Work out
 * why, strike the IP when it's the visitor's doing, and alert when it's ours.
 * @param {Request} req   the auth request (callback or signin)
 * @param {string} errorCode  NextAuth's error code from the redirect (OAuthCallback, Callback, …)
 */
export async function handleAuthFailure(req, errorCode) {
  const ctx = getAuthContext()
  const messages = (ctx?.errors || []).map((e) => e.message).filter(Boolean)
  const url = new URL(req.url)
  const providerError = url.searchParams.get('error')
  const issParam = url.searchParams.get('iss')
  const cookieGet = (name) => req.cookies?.get?.(name)?.value
  const info = clientInfoFromHeaders(req.headers)
  const callbackPath = pathFromCallbackUrl(SESSION_COOKIE_NAMES.map(cookieGet).find(Boolean))
  const intent = intentFromPath(callbackPath)
  const deviceId = cookieGet(DEVICE_COOKIE) || null
  const bypass = hasSuperAdminMarker(cookieGet)
  const raw = messages[0] || providerError || errorCode || 'unknown error'

  let kind
  let human
  if (providerError === 'access_denied') {
    kind = 'login_failed'; human = 'pressed Cancel on the Discord screen'
  } else if (TAMPER.test(raw) || (issParam && !/^https:\/\/([a-z0-9-]+\.)*discord\.com\/?$/i.test(issParam))) {
    // First clause only — the rest is the expected/received nonce, which is noise.
    kind = 'oauth_tampered'; human = `the login callback failed its security checks (${String(raw).split(',')[0]})`
  } else if (CONFIG.test(raw) || errorCode === 'Configuration') {
    kind = 'system'; human = raw
  } else {
    kind = 'login_failed'; human = raw
  }

  const sig = errorSignature(raw)
  let outage = false
  if (kind === 'system') {
    await reportLoginSystemFailure(sig, raw)
  } else if (kind === 'login_failed' && providerError !== 'access_denied') {
    outage = await noteServerSideFailure(sig, info.ip, raw)
  }
  if (outage) kind = 'system'

  const geo = await lookupIp(info.ip)
  let strike = { count: 0, ban: null }
  if (kind !== 'system') {
    strike = await recordStrike({
      ip: info.ip, kind, path: callbackPath, deviceId, errorSig: sig, detail: human, bypass,
    })
  }
  await upsertDevice({ deviceId, ip: info.ip })
  const device = await getDevice(deviceId)

  await logSecurityEvent({
    stream: 'error', eventType: 'login_failed', outcome: 'failed', action: 'security.login-failed',
    actor: { name: 'An unidentified visitor' }, ip: info.ip, userAgent: info.userAgent,
    summary: `A Discord login to ${INTENT_WORDS[intent]} failed — ${human}.`,
    details: [
      ['Signing in to', INTENT_WORDS[intent]],
      ['Why it failed', human],
      ['Error code', errorCode || 'none'],
      ['Counted as a strike', kind === 'system' ? 'No — this was a website-side problem' : bypass ? 'No — super-admin device' : `Yes (${strike.count} of 3 in 30 minutes${strike.ban ? ' — IP now blocked' : ''})`],
      ['Strike type', kind === 'system' ? 'none' : STRIKE_WORDS[kind] || kind],
      ['Network location', describeGeo(geo, info.country) || 'unknown'],
      ['Internet provider', geo?.org || 'unknown'],
      ['Device', `${info.browser} on ${info.os} (${info.deviceType})`],
      ['Device ID', deviceId || 'none (no cookie)'],
      ['Device fingerprint', device?.fp_hash ? `${device.fp_hash} — ${describeFingerprint(device.fingerprint) || ''}` : 'Not captured'],
      ['Accounts seen on this device', device?.discord_ids?.length ? device.discord_ids.join(', ') : 'None'],
    ],
    error: messages[0] ? new Error(messages[0]) : null,
  })
}
