import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { getClientIp } from '../../../../lib/rateLimit'
import { logSecurityEvent, touchSession } from '../../../../lib/security'

export const dynamic = 'force-dynamic'

const announced = new Map() // sid -> last path logged

/**
 * Signed-in pages (admin panel + Applications) ping this every ~30s with where the
 * person is. It powers the live "who's online / what are they looking at" view on
 * the higgenlogs page. Applicants' page changes are also written to higgenlogs
 * (admin clicks are already recorded by the ActivityTracker).
 */
export async function POST(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }).catch(() => null)
  if (!token?.sid) return NextResponse.json({ ok: false, signedIn: false })

  let path = null
  try { path = String((await request.json())?.path || '').slice(0, 300) || null } catch { /* empty */ }
  const ip = getClientIp(request)
  await touchSession(token.sid, { path, ip })

  if (path && token.loginIntent !== 'admin' && announced.get(token.sid) !== path) {
    announced.set(token.sid, path)
    if (announced.size > 5000) announced.delete(announced.keys().next().value)
    await logSecurityEvent({
      eventType: 'page_view', outcome: 'success', action: 'security.page-view',
      actor: { name: token.discordUsername || 'A signed-in visitor', discordId: token.discordUserId },
      ip, userAgent: request.headers.get('user-agent'), location: path,
      summary: `${token.discordUsername || 'A signed-in visitor'} is viewing ${path}.`,
    })
  }
  return NextResponse.json({ ok: true })
}
