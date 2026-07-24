// Content-Security-Policy. Moderate profile: strong anti-clickjacking / anti-injection
// directives (frame-ancestors, object-src, base-uri, form-action) with script/style/img
// kept permissive enough not to break Next.js hydration, Discord/Google avatars & logos,
// or the rulebook's client-side fetch of a published Google Doc. Tighten script-src to a
// nonce later if we move to middleware-based CSP.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https:",
  "media-src 'self' https: data:",
  "frame-src 'self' https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ')

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't advertise the framework/version.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
  images: {
    unoptimized: true,
    domains: [],
  },
  // Reduce terminal spam
  onDemandEntries: {
    // Keep pages in memory longer to reduce rebuilds
    maxInactiveAge: 60 * 60 * 1000, // 1 hour
  },
  // Only show high priority logs in terminal
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
  // NOTE: a blanket `Cache-Control: public, max-age=3600` on /api/(.*) used to
  // live here. It overrode every route's own cache headers, so browsers served
  // hour-old API data — admin edits and logo uploads looked broken. Routes set
  // their own Cache-Control now; don't reintroduce a global one.
  // Configuration specific to Cloudflare builds
  ...(process.env.CLOUDFLARE_DEPLOY === 'true' ? { 
    output: 'export',
    // Skip API routes for static export
    skipMiddlewareUrlNormalize: true,
    skipTrailingSlashRedirect: true,
  } : {}),
}

module.exports = nextConfig
