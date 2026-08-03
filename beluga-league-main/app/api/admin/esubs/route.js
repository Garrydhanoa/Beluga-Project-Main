import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import {
  DEFAULT_ESUB_LIMIT,
  getActiveSeasonId,
  getEsubLimit,
  listEsubUsage,
  resetSeasonEsubs,
  setEsubLimit,
  setEsubUsed,
} from '../../../../lib/esubStore'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

/** GET /api/admin/esubs?seasonId= — usage per team + the season's allowance. */
export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const raw = searchParams.get('seasonId')
  const seasonId = raw ? Number(raw) : await getActiveSeasonId()
  if (!Number.isInteger(seasonId)) {
    return NextResponse.json({ seasonId: null, limit: DEFAULT_ESUB_LIMIT, teams: [] })
  }

  const [limit, teams] = await Promise.all([getEsubLimit(seasonId), listEsubUsage(seasonId)])
  // Keys listed explicitly — spreading a totals object over a list response has
  // silently replaced the array with a count here before.
  return NextResponse.json({ seasonId, limit, teams })
}

/**
 * POST /api/admin/esubs
 *   { seasonId, teamId, used }  → set one team's count
 *   { seasonId, limit }         → set the season's allowance
 *   { seasonId, action:'reset' }→ zero every team's count for the season
 */
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const seasonId = body.seasonId ? Number(body.seasonId) : await getActiveSeasonId()
  if (!Number.isInteger(seasonId)) return badRequest('No season')

  const actor = auth.session?.discordUsername || null

  if (body.action === 'reset') {
    const rows = await resetSeasonEsubs(seasonId, actor)
    const [limit, teams] = await Promise.all([getEsubLimit(seasonId), listEsubUsage(seasonId)])
    return NextResponse.json({ ok: true, reset: rows, seasonId, limit, teams })
  }

  if (body.limit !== undefined) {
    const n = Number(body.limit)
    if (!Number.isFinite(n) || n < 0 || n > 99) return badRequest('limit must be 0-99')
    await setEsubLimit(seasonId, n)
  }

  if (body.teamId !== undefined) {
    const teamId = Number(body.teamId)
    const used = Number(body.used)
    if (!Number.isInteger(teamId)) return badRequest('teamId must be a number')
    if (!Number.isFinite(used) || used < 0 || used > 99) return badRequest('used must be 0-99')
    try {
      await setEsubUsed(seasonId, teamId, used, actor)
    } catch (err) {
      return badRequest(err.message)
    }
  }

  const [limit, teams] = await Promise.all([getEsubLimit(seasonId), listEsubUsage(seasonId)])
  return NextResponse.json({ ok: true, seasonId, limit, teams })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'esubs.post' })
