import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { getSiteConfig, setSiteConfig } from '../../../../../lib/siteConfigStore'
import { DM_DEFAULT_KEY, DM_DEFAULT_FALLBACK, DM_MAX_LEN } from '../../../../../lib/dmStore'

export const dynamic = 'force-dynamic'

/** The editable default header prepended to every DM (per-send opt-out). */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const cfg = await getSiteConfig(DM_DEFAULT_KEY)
  const text = typeof cfg?.text === 'string' ? cfg.text : DM_DEFAULT_FALLBACK
  return NextResponse.json({ text })
}

async function putHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Half the budget, so a long default can never crowd out the actual message.
  const text = String(body.text ?? '').slice(0, Math.floor(DM_MAX_LEN / 2))
  await setSiteConfig(DM_DEFAULT_KEY, { text })
  return NextResponse.json({ ok: true, text })
}

export const PUT = withAudit(putHandler, { action: 'dm.default.put' })
