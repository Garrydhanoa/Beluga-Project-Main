import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../lib/authOptions'
import { rateLimit, getClientIp } from '../../../../lib/rateLimit'
import {
  BAN_MESSAGE, DEVICE_COOKIE, cookieOptions, isAccessBlocked, newDeviceId, upsertDevice,
} from '../../../../lib/security'

export const dynamic = 'force-dynamic'

/**
 * Called by the login pages (admin + applications) on load:
 *   - gives the browser a first-party device id if it has none,
 *   - stores the light device fingerprint against that id,
 *   - says whether this IP is blocked (so the page shows the ban notice instead of a
 *     login button).
 * Public, cheap, rate-limited.
 */
export async function POST(request) {
  const ip = getClientIp(request)
  const rl = rateLimit(`sec-status:${ip}`, { limit: 30, windowMs: 60_000 })
  if (!rl.ok) return NextResponse.json({ banned: false }, { status: 429 })

  let fingerprint = null
  try { fingerprint = (await request.json())?.fp ?? null } catch { /* no body */ }

  const cookieGet = (name) => request.cookies.get(name)?.value
  let deviceId = cookieGet(DEVICE_COOKIE)
  const newDevice = !deviceId
  if (newDevice) deviceId = newDeviceId()

  const session = await getServerSession(authOptions).catch(() => null)
  await upsertDevice({ deviceId, fingerprint, ip, discordId: session?.discordUserId || null })
  const ban = await isAccessBlocked({ ip, discordId: session?.discordUserId || null, cookieGet })

  const res = NextResponse.json({ banned: !!ban, message: ban ? BAN_MESSAGE : null })
  if (newDevice) res.cookies.set(DEVICE_COOKIE, deviceId, cookieOptions(365 * 24 * 3600))
  return res
}
