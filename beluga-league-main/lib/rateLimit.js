// Lightweight in-memory rate limiter. The website runs as a single Railway instance,
// so a process-local fixed-window counter is sufficient (no Redis needed). Used to
// throttle brute-force / abuse on auth and write endpoints. If we ever scale to
// multiple instances, swap the Map for a shared store.

const buckets = new Map() // key -> { count, resetAt }
let lastSweep = 0

function sweep(now) {
  // Bound memory: drop expired buckets at most once per 60s.
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k)
  }
}

/**
 * Fixed-window rate limit.
 * @returns {{ ok: boolean, remaining: number, retryAfter: number, resetAt: number }}
 */
export function rateLimit(key, { limit = 10, windowMs = 60_000 } = {}) {
  const now = Date.now()
  sweep(now)
  let b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs }
    buckets.set(key, b)
  }
  b.count += 1
  const ok = b.count <= limit
  return {
    ok,
    remaining: Math.max(0, limit - b.count),
    retryAfter: Math.ceil((b.resetAt - now) / 1000),
    resetAt: b.resetAt,
  }
}

/**
 * Best-effort client IP. The site sits behind Cloudflare -> Railway, so
 * `cf-connecting-ip` is the real client IP (set by Cloudflare, not spoofable by the
 * client since CF overwrites it). Fall back to the first x-forwarded-for hop.
 */
export function getClientIp(request) {
  const h = request.headers
  const cf = h.get('cf-connecting-ip')
  if (cf) return cf.trim()
  const xff = h.get('x-forwarded-for') || ''
  const first = xff.split(',')[0].trim()
  return first || h.get('x-real-ip') || 'unknown'
}
