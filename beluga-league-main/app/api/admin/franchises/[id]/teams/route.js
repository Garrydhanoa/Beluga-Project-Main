import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { getActiveSeason } from '../../../../../../lib/leagueStore'
import {
  addFranchiseToSeason,
  getFranchise,
  getFranchiseSeasonTeams,
  listOrphanTeams,
  linkTeamToFranchise,
  unlinkTeamFromFranchise,
} from '../../../../../../lib/franchiseStore'

// Per-franchise, per-division team management for the ACTIVE season. Lets a franchise
// gain a team in a division it doesn't yet have (new team OR claim an orphaned/untaken
// team), and free one. Logo/color/roles link from the franchise automatically. This is
// what makes divisions grow/shrink after the new-season team copy.
export const dynamic = 'force-dynamic'

const DIVISIONS = ['Majors', 'AAA', 'AA']

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const fid = Number(id)
  if (!Number.isInteger(fid)) return badRequest('Invalid id')

  const franchise = await getFranchise(fid)
  if (!franchise) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const season = await getActiveSeason()
  if (!season) {
    return NextResponse.json({ activeSeason: null, teams: [], availableDivisions: DIVISIONS, orphans: [] })
  }

  const [teams, orphans] = await Promise.all([
    getFranchiseSeasonTeams(fid, season.id),
    listOrphanTeams(season.id),
  ])
  const taken = new Set(teams.map((t) => t.division))

  return NextResponse.json({
    activeSeason: { id: season.id, seasonNumber: season.seasonNumber },
    teams,
    orphans,
    availableDivisions: DIVISIONS.filter((d) => !taken.has(d)),
  })
}

async function postHandler(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const fid = Number(id)
  if (!Number.isInteger(fid)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const season = await getActiveSeason()
  if (!season) return badRequest('No active season')

  try {
    if (body.action === 'unlink') {
      if (!body.teamId) return badRequest('teamId required')
      const r = await unlinkTeamFromFranchise(Number(body.teamId))
      return NextResponse.json({ ok: true, ...r })
    }
    if (body.action === 'link') {
      if (!body.teamId) return badRequest('teamId required')
      const r = await linkTeamToFranchise(Number(body.teamId), fid)
      return NextResponse.json({ ok: true, ...r })
    }
    // default: create a NEW team in a division for this franchise (inherits logo).
    const division = body.division
    if (!division || !DIVISIONS.includes(division)) return badRequest('Valid division required')
    const r = await addFranchiseToSeason({
      franchiseId: fid,
      seasonId: season.id,
      division,
      name: body.name,
      rosterLimit: body.rosterLimit,
    })
    return NextResponse.json({ ok: true, teamId: r.teamId })
  } catch (err) {
    return badRequest(err.message || 'Failed')
  }
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'franchises.teams.post' })
