import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { rateLimit, getClientIp } from '../../../../lib/rateLimit'
import {
  BAN_MESSAGE, DEVICE_COOKIE, GATE_COOKIE, GATE_TTL_MS, cookieOptions, clientInfoFromHeaders,
  hasSuperAdminMarker, isAccessBlocked, logSecurityEvent, newDeviceId, recordStrike, signPayload,
  upsertDevice,
} from '../../../../lib/security'

export const dynamic = 'force-dynamic'

// Constant-time string compare that never short-circuits on length. Hash both sides so
// timingSafeEqual gets equal-length buffers and the comparison leaks neither length nor
// content timing.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

/**
 * Admin password gate. Operator rule: whatever is typed, the visitor is sent on to
 * Discord login — that's how we learn WHO tried. The result is carried in a signed,
 * httpOnly, single-use cookie that the sign-in callback checks; access needs this
 * gate to have passed AND the director role. (Before, the gate was enforced only in
 * the browser, so a director could skip it by going straight to Discord.)
 * A wrong password is a strike against the IP (3 in 30 minutes = blocked).
 */
export async function POST(request) {
  const ip = getClientIp(request)
  const cookieGet = (name) => request.cookies.get(name)?.value
  const ban = await isAccessBlocked({ ip, cookieGet })
  if (ban) {
    return NextResponse.json({ success: false, banned: true, error: BAN_MESSAGE }, { status: 403 })
  }

  // Throttle brute force on top of the strike system: 5 attempts / 5 min per IP.
  const rl = rateLimit(`gate-login:${ip}`, { limit: 5, windowMs: 5 * 60_000 })
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  let email = ''
  let password = ''
  let fingerprint = null
  try {
    const body = await request.json()
    email = body?.email ?? ''
    password = body?.password ?? ''
    fingerprint = body?.fp ?? null
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 })
  }

  const validEmail = process.env.ADMIN_EMAIL
  const validPassword = process.env.ADMIN_PASSWORD

  // If the gate isn't configured, deny (fail closed) rather than accept anything.
  if (!validEmail || !validPassword) {
    return NextResponse.json({ success: false, error: 'Gate not configured' }, { status: 503 })
  }

  // Evaluate both comparisons regardless so the response time doesn't reveal which field
  // was wrong.
  const emailOk = safeEqual(email, validEmail)
  const passOk = safeEqual(password, validPassword)
  const ok = emailOk && passOk

  let deviceId = cookieGet(DEVICE_COOKIE)
  const newDevice = !deviceId
  if (newDevice) deviceId = newDeviceId()
  await upsertDevice({ deviceId, fingerprint, ip })

  let strikeId = null
  let banned = false
  if (!ok) {
    const info = clientInfoFromHeaders(request.headers)
    const strike = await recordStrike({
      ip, kind: 'gate_password', path: '/admin', deviceId, bypass: hasSuperAdminMarker(cookieGet),
    })
    strikeId = strike.strikeId
    banned = !!strike.ban
    // Never the typed email or password — only that it was wrong (operator rule).
    await logSecurityEvent({
      eventType: 'gate_failed', outcome: 'denied', action: 'security.gate-failed',
      actor: { name: 'An unidentified visitor' }, ip, userAgent: info.userAgent, location: 'Admin login',
      summary: `Someone entered the wrong admin password${banned ? ' and their IP is now blocked' : ''}. They’re being sent to Discord login so we can see who it was.`,
      details: [
        ['Strikes from this IP (30 min)', `${strike.count} of 3`],
        ['Device', `${info.browser} on ${info.os} (${info.deviceType})`],
        ['Device ID', deviceId],
      ],
    })
  }

  if (banned) {
    return NextResponse.json({ success: false, banned: true, error: BAN_MESSAGE }, { status: 403 })
  }

  // Same answer either way — the browser can't tell a right password from a wrong one.
  const res = NextResponse.json({ success: true })
  res.cookies.set(GATE_COOKIE, signPayload({ ok, at: Date.now(), did: deviceId, strike: strikeId }),
    cookieOptions(Math.round(GATE_TTL_MS / 1000)))
  if (newDevice) res.cookies.set(DEVICE_COOKIE, deviceId, cookieOptions(365 * 24 * 3600))
  return res
}
