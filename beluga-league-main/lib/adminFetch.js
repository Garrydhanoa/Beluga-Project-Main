/**
 * Wrapper around `fetch` that disables Next.js's data cache and the browser's
 * HTTP cache. Use this for every admin client call so changes show up
 * instantly instead of being served stale.
 *
 *   import { adminFetch } from '../../../../lib/adminFetch'
 *   const r = await adminFetch('/api/admin/seasons')
 */
export function adminFetch(input, init = {}) {
  const headers = new Headers(init.headers || {})
  // Belt-and-suspenders: defeat both Next.js fetch caching and browser HTTP cache.
  if (!headers.has('cache-control')) {
    headers.set('cache-control', 'no-cache, no-store, must-revalidate')
  }
  if (!headers.has('pragma')) {
    headers.set('pragma', 'no-cache')
  }
  return fetch(input, {
    cache: 'no-store',
    ...init,
    headers,
  })
}
