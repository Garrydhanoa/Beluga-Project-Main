import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { getPlayerRecords, upsertPlayerRecord } from '../../../../lib/statsStore'
import { getActiveSeason } from '../../../../lib/leagueStore'

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

  if (!seasonId) return NextResponse.json({ records: [], seasonId: null })

  const division = searchParams.get('division')
  const teamId = searchParams.get('teamId')
  const platformId = searchParams.get('platformId')

  const records = await getPlayerRecords(seasonId, { division, teamId, platformId })
  return NextResponse.json({ seasonId, records })
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const seasonId = Number(body.seasonId)
  const division = String(body.division || '').trim()
  if (!Number.isInteger(seasonId) || !division) return badRequest('seasonId, division required')

  const record = await upsertPlayerRecord({
    seasonId,
    division,
    teamId: body.teamId ? Number(body.teamId) : null,
    playerName: String(body.playerName || '').trim(),
    platform: body.platform || null,
    platformId: body.platformId || null,
    gamesPlayed: Number(body.gamesPlayed) || 0,
    goals: Number(body.goals) || 0,
    assists: Number(body.assists) || 0,
    saves: Number(body.saves) || 0,
    shots: Number(body.shots) || 0,
    score: Number(body.score) || 0,
    manualOverride: body.manualOverride !== false,
  })
  return NextResponse.json({ ok: true, record })
}
