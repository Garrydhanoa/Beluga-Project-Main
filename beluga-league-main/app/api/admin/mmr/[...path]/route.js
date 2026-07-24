import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { withAudit } from '../../../../../lib/activityLog'

export const dynamic = 'force-dynamic'

// Base URL of the standalone TRN scraper service (Railway). Server-side only.
const SCRAPER_URL = (process.env.TRN_SCRAPER_URL || 'https://rl-scraper-production.up.railway.app').replace(/\/$/, '')
// Shared secret so the scraper rejects calls that don't come from us (set on both
// services to enable). Empty = not sent (scraper stays open until both sides have it).
const SCRAPER_TOKEN = process.env.TRN_SCRAPER_TOKEN || ''

// Only these scraper paths are reachable through the admin proxy.
const ALLOWED = new Set([
  'health', 'status', 'players', 'run', 'resume', 'stop',
  'update-player', 'update-players', 'search', 'sheet-index', 'rotate-ip', 'config', 'diag',
])

async function proxy(request, params, method) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  // Next 15+/16: params is a Promise and must be awaited.
  const resolved = await params
  const segs = resolved?.path || []
  const base = segs[0]
  if (!ALLOWED.has(base)) {
    return NextResponse.json({ error: 'unknown endpoint' }, { status: 404 })
  }

  const url = new URL(request.url)
  const target = `${SCRAPER_URL}/${segs.join('/')}${url.search || ''}`

  // Bound every scraper call so a dead/hung scraper service returns a fast 502
  // instead of hanging this request (and the admin page) indefinitely. Without
  // this, an unresponsive scraper makes the MMR page sit on "Loading…" forever.
  const init = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(SCRAPER_TOKEN ? { 'X-Auth-Token': SCRAPER_TOKEN } : {}),
    },
    signal: AbortSignal.timeout(12000),
  }
  if (method === 'POST') {
    const body = await request.text().catch(() => '')
    if (body) init.body = body
  }

  try {
    const res = await fetch(target, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
    })
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    return NextResponse.json(
      { error: timedOut ? 'scraper timeout' : 'scraper unreachable', detail: String(e?.message || e) },
      { status: 502 },
    )
  }
}

export async function GET(request, { params }) {
  return proxy(request, params, 'GET')
}

// Audit every MMR write (start/stop/resume/update-player/update-players/config/
// rotate-ip) — sensitive operations the operator wants traceable to who did them.
// The action is derived from the subpath so higgenlogs entries read e.g. 'mmr.run'.
export async function POST(request, ctx) {
  const resolved = await ctx.params
  const sub = (resolved?.path || [])[0] || 'unknown'
  const audited = withAudit((req, c) => proxy(req, c.params, 'POST'), { action: `mmr.${sub}` })
  return audited(request, ctx)
}
