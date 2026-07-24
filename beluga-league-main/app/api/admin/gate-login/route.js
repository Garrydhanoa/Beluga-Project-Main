import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { rateLimit, getClientIp } from '../../../../lib/rateLimit'

export const dynamic = 'force-dynamic'

// Constant-time string compare that never short-circuits on length. Hash both sides so
// timingSafeEqual gets equal-length buffers and the comparison leaks neither length nor
// content timing.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

export async function POST(request) {
  // Throttle brute force: 5 attempts / 5 min per IP. This is a shared-password gate in
  // front of the real Discord-Director check, so a slow lockout is plenty.
  const ip = getClientIp(request)
  const rl = rateLimit(`gate-login:${ip}`, { limit: 5, windowMs: 5 * 60_000 })
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  let email = ''
  let password = ''
  try {
    const body = await request.json()
    email = body?.email ?? ''
    password = body?.password ?? ''
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

  if (emailOk && passOk) {
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 })
}
