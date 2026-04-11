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
  // Configuration specific to Vercel builds
  ...(process.env.VERCEL ? {
    async headers() {
      return [
        {
          source: '/api/(.*)',
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=3600, s-maxage=7200', // Cache for 1 hour client-side, 2 hours server-side
            },
          ],
        },
      ]
    },
  } : {}),
  // Configuration specific to Cloudflare builds
  ...(process.env.CLOUDFLARE_DEPLOY === 'true' ? { 
    output: 'export',
    // Skip API routes for static export
    skipMiddlewareUrlNormalize: true,
    skipTrailingSlashRedirect: true,
  } : {}),
}

module.exports = nextConfig
