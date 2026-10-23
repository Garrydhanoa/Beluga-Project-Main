import NextAuth from 'next-auth'
import { authOptions } from '../../../../lib/authOptions'
import { getAuthContext, runWithAuthContext } from '../../../../lib/authRequestContext'
import { handleAuthFailure, normalizeIssuer } from '../../../../lib/loginSecurity'

const nextAuth = NextAuth(authOptions)

/**
 * NextAuth, wrapped so that:
 *   1. a harmless variant of Discord's `iss` value can't break login again,
 *   2. a FAILED login round-trip is classified, struck and logged (NextAuth only
 *      redirects to its error page and logs to stdout on its own),
 *   3. cookies the security layer decided on (device marker, single-use gate reset)
 *      are set on the response.
 * Only the `signin` and `callback` actions are inspected for failures — the
 * follow-up hop through /api/auth/error would otherwise count the same failure twice.
 */
async function handler(req, ctx) {
  const request = normalizeIssuer(req)
  return runWithAuthContext(async () => {
    const response = await nextAuth(request, ctx)

    try {
      const params = await ctx?.params
      const action = Array.isArray(params?.nextauth) ? params.nextauth[0] : null
      if (action === 'callback' || action === 'signin') {
        const location = response.headers.get('location') || ''
        if (location) {
          const target = new URL(location, request.url)
          const code = target.searchParams.get('error')
          const isErrorHop = target.pathname.endsWith('/api/auth/error')
            || target.pathname === '/auth/error' || target.pathname === '/auth/signin'
          if (code && isErrorHop) await handleAuthFailure(request, code)
        }
      }
    } catch (err) {
      console.warn('[auth] failure classification failed:', err.message)
    }

    const store = getAuthContext()
    for (const c of store?.cookies || []) {
      response.headers.append('Set-Cookie', serializeCookie(c.name, c.value, c.options))
    }
    return response
  })
}

function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${opts.path || '/'}`)
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`)
  if (opts.httpOnly) parts.push('HttpOnly')
  if (opts.secure) parts.push('Secure')
  parts.push(`SameSite=${opts.sameSite ? opts.sameSite[0].toUpperCase() + opts.sameSite.slice(1) : 'Lax'}`)
  return parts.join('; ')
}

export { handler as GET, handler as POST }
