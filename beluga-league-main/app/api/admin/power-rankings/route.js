import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'
import { getActiveSeason } from '../../../../lib/leagueStore'
import { getRankingsForSeason, replaceRankings } from '../../../../lib/powerRankingsStore'
import { recalcPowerRankings } from '../../../../lib/powerRankingsAuto'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  await ensureLeagueSchema()

  const { searchParams } = new URL(request.url)
  let seasonId = searchParams.get('seasonId')
  if (!seasonId || seasonId === 'active') {
    const s = await getActiveSeason()
    seasonId = s?.id || null
  } else {
    seasonId = Number(seasonId)
    if (!Number.isInteger(seasonId)) seasonId = null
  }

  if (!seasonId) return NextResponse.json({ seasonId: null, rankings: null, seasonTeams: [] })

  const rankings = await getRankingsForSeason(seasonId)

  // Teams of this season (for the team picker), grouped by division.
  const teamRes = await query(`
    SELECT t.id, t.name, t.division
    FROM teams t
    LEFT JOIN team_franchises f ON f.id = t.franchise_id
    WHERE t.season_id = $1 AND t.is_active = TRUE AND (f.is_active IS DISTINCT FROM FALSE)
    ORDER BY t.division, t.name
  `, [seasonId])
  const seasonTeams = teamRes.rows.map((r) => ({ id: r.id, name: r.name, division: r.division }))

  return NextResponse.json({ seasonId, rankings, seasonTeams })
}

// POST { action: 'recalc', seasonId? } → regenerate auto rankings (teams+players,
// all divisions) from recent results, with trend vs the previous run. Same formula
// as the bot's /power-rankings + week-close refresh.
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  let body
  try { body = await request.json() } catch { body = {} }
  if (body.action !== 'recalc') return badRequest('Unknown action')

  let seasonId = body.seasonId
  if (!seasonId || seasonId === 'active') {
    const s = await getActiveSeason()
    seasonId = s?.id || null
  } else {
    seasonId = Number(seasonId)
    if (!Number.isInteger(seasonId)) seasonId = null
  }
  if (!seasonId) return badRequest('No season')

  try {
    const counts = await recalcPowerRankings(seasonId)
    const rankings = await getRankingsForSeason(seasonId)
    return NextResponse.json({ ok: true, seasonId, ...counts, rankings })
  } catch (err) {
    return badRequest(err.message || 'recalc failed')
  }
}

async function putHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const seasonId = Number(body.seasonId)
  if (!Number.isInteger(seasonId)) return badRequest('seasonId required')
  const entityType = String(body.entityType || '')
  const division = String(body.division || '')
  if (!Array.isArray(body.entries)) return badRequest('entries array required')

  try {
    const rankings = await replaceRankings({
      seasonId,
      entityType,
      division,
      entries: body.entries,
      updatedByUsername: auth.session?.discordUsername || null,
    })
    return NextResponse.json({ ok: true, rankings })
  } catch (err) {
    return badRequest(err.message || 'failed')
  }
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'power-rankings.post' })
export const PUT = withAudit(putHandler, { action: 'power-rankings.put' })
