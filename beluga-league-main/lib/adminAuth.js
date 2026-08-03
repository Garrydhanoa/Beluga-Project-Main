import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions, isSuperAdminId } from './authOptions'

export async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session || !session.isDirector) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
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
 * privileged-access allowlist — and it fails CLOSED when that var is unset.
 *
 * Answers 404 rather than 401 so the page stays deniable: someone probing the URL
 * learns nothing about whether it exists.
 */
export async function requireSuperAdmin() {
  const session = await getServerSession(authOptions)
  if (!session || !isSuperAdminId(session.discordUserId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    }
  }
  return { ok: true, session }
}
