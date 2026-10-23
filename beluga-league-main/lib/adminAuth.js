import { getServerSession } from 'next-auth'
import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { authOptions, isSuperAdminId } from './authOptions'
import { BAN_MESSAGE, ipFromHeaders, isAccessBlocked } from './security'

/** Is the current request's IP blocked? (Super admins never are.) */
async function blockedForRequest(discordId) {
  try {
    const h = await headers()
    const c = await cookies()
    return await isAccessBlocked({ ip: ipFromHeaders(h), discordId, cookieGet: (n) => c.get(n)?.value })
  } catch {
    return null
  }
}

/**
 * Admin access = director role AND the admin password passed on this login AND the
 * session not revoked AND the IP not blocked. (session.adminAccess folds the first
 * three; see lib/authOptions.js.)
 */
export async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session || !session.adminAccess) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  if (await blockedForRequest(session.discordUserId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: BAN_MESSAGE, banned: true }, { status: 403 }),
    }
  }
  return { ok: true, session }
}

/**
 * Stricter gate for the hidden audit log (/admin/dashboard/higgenlogs).
 *
 * Being a director is deliberately NOT enough: the audit log exists to catch
 * whoever might sabotage the league, and directors are in scope for that. Access
 * is limited to the Discord IDs in ADMIN_DISCORD_IDS — the league's existing
 * privileged-access allowlist — and it fails CLOSED when that var is unset. The
 * normal admin login (password gate) is still required.
 *
 * Answers 404 rather than 401 so the page stays deniable: someone probing the URL
 * learns nothing about whether it exists.
 */
export async function requireSuperAdmin() {
  const session = await getServerSession(authOptions)
  if (!session || !session.adminAccess || !isSuperAdminId(session.discordUserId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    }
  }
  return { ok: true, session }
}
