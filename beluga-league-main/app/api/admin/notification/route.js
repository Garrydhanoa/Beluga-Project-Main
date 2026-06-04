import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { getSiteConfig, setSiteConfig } from '../../../../lib/siteConfigStore'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const notification = await getSiteConfig('notification')
  return NextResponse.json({ notification })
}

export async function PUT(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const value = {
    enabled: Boolean(body.enabled),
    message: String(body.message || '').slice(0, 500),
    href: String(body.href || '/players').slice(0, 300),
  }
  const saved = await setSiteConfig('notification', value)
  return NextResponse.json({ ok: true, notification: saved })
}
