import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { getTeamRecords, upsertTeamRecord } from '../../../../lib/statsStore'
import { getActiveSeason } from '../../../../lib/leagueStore'
import { query } from '../../../../lib/db'

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
    const active = await getActiveSeason()
    seasonId = active?.id || null
  } else {
    seasonId = Number(seasonId)
    if (!Number.isInteger(seasonId)) seasonId = null
  }

  if (!seasonId) return NextResponse.json({ records: [], teamsByDivision: {}, seasonId: null })

  const division = searchParams.get('division')
  const records = await getTeamRecords(seasonId, { division })

  // Also return all teams for the season so admin can add a record for a team that has none yet.
  const teamsRes = await query(
    `SELECT id, division, name FROM teams WHERE season_id = $1 AND is_active = TRUE ORDER BY division, name`,
    [seasonId]
  )
  const teamsByDivision = {}
  for (const t of teamsRes.rows) {
    if (!teamsByDivision[t.division]) teamsByDivision[t.division] = []
    teamsByDivision[t.division].push({ id: t.id, name: t.name })
  }

  return NextResponse.json({ seasonId, records, teamsByDivision })
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const seasonId = Number(body.seasonId)
  const division = String(body.division || '').trim()
  const teamId = Number(body.teamId)
  if (!Number.isInteger(seasonId) || !division || !Number.isInteger(teamId)) {
    return badRequest('seasonId, division, teamId required')
  }

  const record = await upsertTeamRecord({
    seasonId,
    division,
    teamId,
    wins: Number(body.wins) || 0,
    losses: Number(body.losses) || 0,
    gameWins: Number(body.gameWins) || 0,
    gameLosses: Number(body.gameLosses) || 0,
    goalsFor: Number(body.goalsFor) || 0,
    goalsAgainst: Number(body.goalsAgainst) || 0,
    manualOverride: body.manualOverride !== false, // default TRUE for admin edits
  })
  return NextResponse.json({ ok: true, record })
}
