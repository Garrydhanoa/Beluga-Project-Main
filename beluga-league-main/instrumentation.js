/**
 * Global server-error capture for the audit log.
 *
 * Next's `onRequestError` hook fires for EVERY unhandled server-side error — API
 * routes, server components, page renders, public pages as well as admin ones —
 * so the higgenlogs "Errors" tab gets complete coverage without wrapping a hundred
 * files by hand. `withAudit` still logs route errors with the actor and the request
 * body attached; this is the safety net that catches everything else.
 *
 * Guarded on the Node runtime: the edge runtime can't open a Postgres connection,
 * and importing `pg` there would break the build.
 */

export async function register() {
  // Nothing to bootstrap — the hook below is the whole point of this file.
}

export async function onRequestError(error, request, context) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { logWebsiteError } = await import('./lib/activityLog')

    const method = request?.method || 'GET'
    const path = request?.path || ''
    // routePath is the pattern (/players/[name]); path is what was actually asked for.
    const pattern = context?.routePath || path
    const kind = context?.routeType === 'route' ? 'API route' : 'page'
    const isAdmin = path.startsWith('/admin') || path.startsWith('/api/admin')

    await logWebsiteError({
      action: `${method} ${pattern}`,
      error,
      eventType: 'server_error',
      target: path,
      location: isAdmin ? 'the admin panel' : 'the public site',
      summary: `The website crashed while serving the ${kind} ${method} ${path}: ${error?.message || error}`,
      details: [
        ['What broke', `${kind} ${pattern}`],
        ['Request', `${method} ${path}`],
        ['Rendered by', context?.renderSource || context?.routerKind || 'unknown'],
        ['Part of site', isAdmin ? 'Admin panel' : 'Public site'],
      ],
      ip: request?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null,
      userAgent: request?.headers?.['user-agent'] || null,
    })
  } catch {
    // Never let the error reporter throw inside the error path.
  }
}
