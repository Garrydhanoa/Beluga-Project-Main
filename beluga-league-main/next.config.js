/** @type {import('next').NextConfig} */
const nextConfig = {
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
