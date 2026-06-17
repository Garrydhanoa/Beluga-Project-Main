import { query } from './db'
import { getServerSession } from 'next-auth'
import { authOptions } from './authOptions'

/**
 * Unified audit/activity logging for the website, written into `site_logs`
 * (source='website'). Surfaced on the hidden /admin/dashboard/higgenlogs page.
 *
 * Best-effort and NON-throwing: logging must never break the action it records.
 *
 * `kind`:
 *   - 'activity' — an admin WRITE action succeeded (who did what, to what)
 *   - 'error'    — an admin route threw / failed
 *   - 'login'    — an admin signed in (mirrors site_logins)
 */
function actorFrom(auth) {
  // Accepts a requireAdmin() result, a session, or a plain {name, discordId}.
  const s = auth?.session || auth || {}
  return {
    name: s.discordUsername || s.name || s.user?.name || 'admin',
    discordId: s.discordUserId || s.discordId || null,
  }
}

/**
 * Log a successful admin WRITE action.
 * @param {object} opts
 * @param {object} opts.auth     requireAdmin() result OR session OR {name,discordId}
 * @param {string} opts.action   short verb-phrase, e.g. 'quote.add', 'player.remap'
 * @param {string} [opts.target] what was acted on, e.g. a name/id
 * @param {string|object} [opts.detail] extra context (object is JSON-stringified)
 * @param {string} [opts.division]
 */
export async function logActivity({ auth, action, target = null, detail = null, division = null } = {}) {
  try {
    const a = actorFrom(auth)
    const detailStr = detail == null ? null
      : (typeof detail === 'string' ? detail : JSON.stringify(detail))
    await query(
      `INSERT INTO site_logs (source, level, kind, summary, detail, division, actor_name, actor_discord_id, action, target)
       VALUES ('website', 'info', 'activity', $1, $2, $3, $4, $5, $6, $7)`,
      [
        String(`${a.name} — ${action}${target ? ` (${target})` : ''}`).slice(0, 500),
        detailStr ? detailStr.slice(0, 4000) : null,
        division || null,
        a.name || null,
        a.discordId || null,
        String(action || '').slice(0, 120) || null,
        target ? String(target).slice(0, 300) : null,
      ]
    )
  } catch { /* logging must never break the request */ }
}

/**
 * Log a website error (a thrown admin route, a failed write).
 */
export async function logWebsiteError({ auth = null, action = null, error = null, summary = null, target = null } = {}) {
  try {
    const a = actorFrom(auth)
    const raw = error ? (error.stack || error.message || String(error)) : null
    await query(
      `INSERT INTO site_logs (source, level, kind, summary, detail, actor_name, actor_discord_id, action, target)
       VALUES ('website', 'error', 'error', $1, $2, $3, $4, $5, $6)`,
      [
        String(summary || `Website error${action ? ` in ${action}` : ''}`).slice(0, 500),
        raw ? raw.slice(0, 4000) : null,
        a.name || null,
        a.discordId || null,
        action ? String(action).slice(0, 120) : null,
        target ? String(target).slice(0, 300) : null,
      ]
    )
  } catch { /* never throw */ }
}

// Methods that mutate state — only these are audited (GET/HEAD reads are noise).
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/**
 * Wrap an admin route handler so EVERY write (POST/PATCH/PUT/DELETE) is recorded
 * to site_logs with the actor, method, path, status, and a redacted body summary —
 * and any thrown error is logged + re-surfaced. Reads (GET) pass straight through.
 *
 * Usage in a route file:
 *   export const POST = withAudit(async (request, ctx) => { ... }, { action: 'team.update' })
 *
 * The wrapper clones the request before reading the body so the handler can still
 * read it. Never lets logging break the response.
 */
export function withAudit(handler, { action = null } = {}) {
  return async function audited(request, ctx) {
    const method = request?.method || 'GET'
    if (!WRITE_METHODS.has(method)) return handler(request, ctx)

    let actor = { name: 'admin', discordId: null }
    try {
      const session = await getServerSession(authOptions)
      if (session) actor = actorFrom(session)
    } catch { /* unauth or session unavailable — handler will 401 anyway */ }

    let path = ''
    try { path = new URL(request.url).pathname } catch { /* ignore */ }

    // Best-effort redacted body snapshot (clone so the handler can still read it).
    let bodySummary = null
    try {
      const clone = request.clone()
      const text = await clone.text()
      if (text) bodySummary = redactBody(text)
    } catch { /* body may be empty or already consumed */ }

    let response
    try {
      response = await handler(request, ctx)
    } catch (err) {
      await logWebsiteError({ auth: actor, action: action || `${method} ${path}`, error: err, target: path })
      throw err
    }

    // Log the outcome (status + body summary). Treat <400 as activity, else error.
    try {
      const status = response?.status ?? 0
      const ok = status > 0 && status < 400
      const summary = `${actor.name} — ${action || `${method} ${path}`}${ok ? '' : ` [${status}]`}`
      await query(
        `INSERT INTO site_logs (source, level, kind, summary, detail, actor_name, actor_discord_id, action, target)
         VALUES ('website', $1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          ok ? 'info' : 'warn',
          ok ? 'activity' : 'error',
          String(summary).slice(0, 500),
          [`${method} ${path}`, bodySummary ? `body: ${bodySummary}` : null].filter(Boolean).join('\n').slice(0, 4000) || null,
          actor.name || null,
          actor.discordId || null,
          String(action || `${method} ${path}`).slice(0, 120),
          String(path).slice(0, 300),
        ]
      )
    } catch { /* logging must never break the response */ }

    return response
  }
}

// Redact obvious secrets and truncate; keep it readable for the audit detail.
function redactBody(text) {
  let s = String(text)
  // mask long base64 blobs (e.g. logo uploads) so the log stays small
  s = s.replace(/"(logo_?data|data|image|bytes|base64)"\s*:\s*"[^"]{40,}"/gi, '"$1":"<…redacted…>"')
  s = s.replace(/("(?:password|secret|token|access_token)"\s*:\s*")[^"]*(")/gi, '$1<redacted>$2')
  return s.length > 600 ? `${s.slice(0, 600)}…` : s
}
