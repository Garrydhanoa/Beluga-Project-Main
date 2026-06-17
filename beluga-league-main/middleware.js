import { NextResponse } from 'next/server'

// Host-based redirect: send the legacy domain(s) to the official one.
//
// The site moved to https://belugaleague.com but the old Railway domain is still
// a custom domain on this same service. When a request arrives on a legacy host
// we 308-redirect it (preserving path + query) to the new domain. Any other host
// (belugaleague.com, www, localhost, preview URLs) passes straight through — so
// this never blocks normal serving; it only rewrites the legacy entry point.
//
// The new domain is the canonical target; the legacy hosts are configurable via
// the LEGACY_REDIRECT_HOSTS env (comma-separated) without a code change, falling
// back to the known old Railway hostname.
const NEW_ORIGIN = (process.env.NEW_SITE_ORIGIN || 'https://belugaleague.com').replace(/\/$/, '')

const LEGACY_HOSTS = (process.env.LEGACY_REDIRECT_HOSTS || 'beluga-league-website-production.up.railway.app')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)

export function middleware(request) {
  // Host header carries the requested domain (strip any :port for matching).
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0]
  if (!host || !LEGACY_HOSTS.includes(host)) {
    return NextResponse.next()
  }

  // Never redirect the canonical host onto itself (guards against misconfig).
  const target = new URL(NEW_ORIGIN)
  if (host === target.host.toLowerCase()) {
    return NextResponse.next()
  }

  // Preserve the path + query so deep links survive the move.
  const url = request.nextUrl
  target.pathname = url.pathname
  target.search = url.search
  return NextResponse.redirect(target, 308)
}

export const config = {
  // Run on real page/asset requests but skip Next internals and — critically —
  // the NextAuth routes, so OAuth callbacks are never redirected mid-flow.
  matcher: ['/((?!_next/static|_next/image|api/auth|favicon.ico).*)'],
}
