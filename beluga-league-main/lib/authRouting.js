// Where a visitor goes after NextAuth bounces them to its sign-in / error page.
// The rule: back through the door they came in by. Applicants must NEVER land on
// the admin login (they used to, because both pages pointed at /admin).

const MESSAGES = {
  OAuthCallback: 'Discord sign-in didn’t complete. Please try again.',
  OAuthSignin: 'Couldn’t start the Discord sign-in. Please try again.',
  Callback: 'Discord sign-in didn’t complete. Please try again.',
  AccessDenied: 'Sign-in was cancelled.',
  Configuration: 'Sign-in is temporarily unavailable. Staff have been notified.',
  SessionRequired: 'Please sign in to continue.',
}

export function authErrorMessage(code) {
  if (!code) return null
  return MESSAGES[code] || 'Discord sign-in didn’t complete. Please try again.'
}

/** Only same-site paths; anything else (another host, javascript:, junk) → null. */
export function safeLocalPath(raw) {
  if (!raw || typeof raw !== 'string') return null
  try {
    const base = process.env.NEXTAUTH_URL || 'http://localhost'
    const u = new URL(raw, base)
    const baseHost = new URL(base).host
    if (u.host !== baseHost && !raw.startsWith('/')) return null
    if (!u.pathname.startsWith('/')) return null
    return u.pathname
  } catch {
    return null
  }
}

/** The destination URL (path + query) for a bounced visitor. */
export function routeAfterAuth(callbackPath, errorCode) {
  const path = callbackPath || '/'
  const q = errorCode ? `error=${encodeURIComponent(errorCode)}` : ''
  if (path.startsWith('/admin')) return q ? `/admin?${q}` : '/admin'
  if (path.startsWith('/applications')) return q ? `/applications?${q}` : '/applications'
  return q ? `/?authError=${encodeURIComponent(errorCode)}` : path
}
