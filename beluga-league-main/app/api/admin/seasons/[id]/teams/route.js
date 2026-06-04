import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../../lib/leagueSchema'
import { query } from '../../../../../../lib/db'
import {
  addFranchiseToSeason,
  createFranchise,
  getSuggestionsForSeason,
} from '../../../../../../lib/franchiseStore'

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

  const [teamsRes, rosterRes, suggestions] = await Promise.all([
    query(`
      SELECT t.id, t.season_id, t.division, t.name, t.roster_limit, t.is_active,
        t.franchise_id, t.logo_mime, (t.logo_data IS NOT NULL) AS has_logo,
        t.discord_role_id, t.discord_gm_role_id, t.discord_captain_role_id, t.discord_np_role_id,
        f.name AS franchise_name, f.is_active AS franchise_active
      FROM teams t
      LEFT JOIN team_franchises f ON f.id = t.franchise_id
      WHERE t.season_id = $1
      ORDER BY t.division, t.name
    `, [seasonId]),
    query(`
      SELECT rm.team_id, rm.discord_id, rm.discord_username, rm.display_name,
        rm.role, rm.is_active, rm.updated_at
      FROM team_roster_members rm
      WHERE rm.season_id = $1 AND rm.is_active = TRUE
      ORDER BY (rm.role = 'gm') DESC, (rm.role = 'captain') DESC, rm.display_name
    `, [seasonId]),
    getSuggestionsForSeason(seasonId),
  ])

  const rostersByTeamId = new Map()
  for (const r of rosterRes.rows) {
    if (!rostersByTeamId.has(r.team_id)) rostersByTeamId.set(r.team_id, [])
    rostersByTeamId.get(r.team_id).push({
      discordId: r.discord_id,
      discordUsername: r.discord_username,
      displayName: r.display_name || r.discord_username,
      role: r.role,
      updatedAt: r.updated_at,
    })
  }

  const grouped = {}
  for (const row of teamsRes.rows) {
    const team = {
      id: row.id,
      seasonId: row.season_id,
      division: row.division,
      name: row.name,
      rosterLimit: row.roster_limit,
      isActive: row.is_active,
      franchiseId: row.franchise_id,
      franchiseName: row.franchise_name,
      franchiseActive: row.franchise_active,
      logoMime: row.logo_mime,
      hasLogo: !!row.has_logo,
      discordRoleId: row.discord_role_id || null,
      discordGmRoleId: row.discord_gm_role_id || null,
      discordCaptainRoleId: row.discord_captain_role_id || null,
      discordNpRoleId: row.discord_np_role_id || null,
      roster: rostersByTeamId.get(row.id) || [],
    }
    if (!grouped[team.division]) grouped[team.division] = []
    grouped[team.division].push(team)
  }

  return NextResponse.json({ teams: grouped, suggestions })
}

export async function POST(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  let franchiseId = body.franchiseId ? Number(body.franchiseId) : null
  if (!franchiseId) {
    const name = (body.name || '').trim()
    if (!name) return badRequest('Team name required')
    const franchise = await createFranchise({
      name,
      defaultDivision: body.division || null,
    })
    franchiseId = franchise.id
  }

  const division = body.division
  if (!division) return badRequest('Division required')

  try {
    const result = await addFranchiseToSeason({
      franchiseId,
      seasonId,
      division,
      name: body.name,
      rosterLimit: body.rosterLimit,
    })
    return NextResponse.json({ ok: true, teamId: result.teamId })
  } catch (err) {
    return badRequest(err.message || 'Failed to add team')
  }
}
