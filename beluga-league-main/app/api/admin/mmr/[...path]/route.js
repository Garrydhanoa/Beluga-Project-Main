import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'

export const dynamic = 'force-dynamic'

// Base URL of the standalone TRN scraper service (Railway). Server-side only.
const SCRAPER_URL = (process.env.TRN_SCRAPER_URL || 'https://rl-scraper-production.up.railway.app').replace(/\/$/, '')

// Only these scraper paths are reachable through the admin proxy.
const ALLOWED = new Set([
  'health', 'status', 'players', 'run', 'resume', 'stop',
  'update-player', 'search', 'sheet-index', 'rotate-ip', 'config', 'diag',
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

  const init = { method, headers: { 'Content-Type': 'application/json' } }
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
    return NextResponse.json({ error: 'scraper unreachable', detail: String(e?.message || e) }, { status: 502 })
  }
}

export async function GET(request, { params }) {
  return proxy(request, params, 'GET')
}

export async function POST(request, { params }) {
  return proxy(request, params, 'POST')
}
