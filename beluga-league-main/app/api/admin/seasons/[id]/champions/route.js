import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { listChampions, setChampion, clearChampion } from '../../../../../../lib/championStore'
import { query } from '../../../../../../lib/db'
import { ensureLeagueSchema } from '../../../../../../lib/leagueSchema'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  await ensureLeagueSchema()
  const champions = await listChampions({ seasonId, includeFuture: true })

  // Also return the teams available in this season (for the picker)
  const teamsRes = await query(`
    SELECT id, name, division, is_active
    FROM teams
    WHERE season_id = $1
    ORDER BY division, name
  `, [seasonId])

  return NextResponse.json({
    champions,
    teams: teamsRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      division: r.division,
      isActive: r.is_active,
    })),
  })
}

export async function PUT(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const division = (body.division || '').trim()
  if (!division) return badRequest('division required')

  if (body.clear) {
    await clearChampion(seasonId, division)
    return NextResponse.json({ ok: true, cleared: true })
  }

  const teamId = body.teamId != null ? Number(body.teamId) : null
  if (teamId != null && !Number.isInteger(teamId)) return badRequest('Invalid teamId')

  const champion = await setChampion({
    seasonId,
    division,
    teamId,
    gmDiscordId: body.gmDiscordId || null,
    gmDisplayName: body.gmDisplayName || null,
    notes: body.notes || null,
  })
  return NextResponse.json({ ok: true, champion })
}
