import { AsyncLocalStorage } from 'node:async_hooks'

// Per-request scratchpad for the NextAuth route. next-auth's logger and callbacks
// don't receive the request or the response, so the route wrapper opens a context
// here and they drop what they learn into it: error messages (for classifying a
// failed login) and cookies to set on the way out (device marker, gate reset).

const storage = new AsyncLocalStorage()

export function runWithAuthContext(fn) {
  return storage.run({ errors: [], cookies: [], signIn: null }, fn)
}

export function getAuthContext() {
  return storage.getStore() || null
}

export function pushAuthError(code, detail) {
  const ctx = storage.getStore()
  if (!ctx) return
  let message = ''
  try {
    if (detail instanceof Error) message = detail.message
    else if (detail?.error instanceof Error) message = detail.error.message
    else if (typeof detail?.message === 'string') message = detail.message
    else if (typeof detail === 'string') message = detail
  } catch { /* ignore */ }
  ctx.errors.push({ code: String(code || ''), message: String(message || '') })
}

/** Queue a Set-Cookie for the auth response (applied by the route wrapper). */
export function queueAuthCookie(name, value, options = {}) {
  const ctx = storage.getStore()
  if (!ctx) return false
  ctx.cookies.push({ name, value, options })
  return true
}
