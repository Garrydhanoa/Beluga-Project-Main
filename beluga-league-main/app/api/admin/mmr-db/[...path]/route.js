import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { withAudit } from '../../../../../lib/activityLog'
import { getRunStatus, getRunPlayers, getTrnConfig, setTrnConfig, getQueue, getEvents } from '../../../../../lib/mmrDb'

export const dynamic = 'force-dynamic'

// DB-direct mirror of the scraper's read endpoints. The MMR panel polls THESE (not
// the scraper) for status/players/config, so it works — and stays fast — even when
// the standalone scraper service is offline. Only ACTIONS still proxy to the scraper.

export async function GET(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const resolved = await params
  const base = (resolved?.path || [])[0]
  const url = new URL(request.url)
  try {
    if (base === 'status') return NextResponse.json(await getRunStatus())
    if (base === 'players') {
      const limit = Number(url.searchParams.get('limit')) || 2000
      return NextResponse.json(await getRunPlayers(limit))
    }
    if (base === 'config') return NextResponse.json(await getTrnConfig())
    if (base === 'queue') return NextResponse.json(await getQueue())
    if (base === 'events') {
      const limit = Number(url.searchParams.get('limit')) || 40
      return NextResponse.json(await getEvents(limit))
    }
    return NextResponse.json({ error: 'unknown endpoint' }, { status: 404 })
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

// Config writes go straight to trn_config (audited). Same effect as the scraper's
// POST /config — the bot reads these keys from the DB — but works while it's offline.
export async function POST(request, ctx) {
  const audited = withAudit(async (req, c) => {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response
    const resolved = await c.params
    const base = (resolved?.path || [])[0]
    if (base !== 'config') return NextResponse.json({ error: 'unknown endpoint' }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    try {
      return NextResponse.json(await setTrnConfig(body))
    } catch (e) {
      return NextResponse.json({ error: String(e?.message || e) }, { status: e?.status || 500 })
    }
  }, { action: 'mmr.config' })
  return audited(request, ctx)
}
