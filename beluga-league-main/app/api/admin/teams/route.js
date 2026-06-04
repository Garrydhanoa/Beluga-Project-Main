import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import {
  getSeasons,
  getActiveSeason,
  createSeason,
  startSeason,
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
} from '../../../../lib/leagueStore'

export const dynamic = 'force-dynamic'

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const seasonIdParam = searchParams.get('seasonId')

  const seasons = await getSeasons()
  const activeSeason = await getActiveSeason()

  let seasonId = seasonIdParam ? Number(seasonIdParam) : activeSeason?.id
  if (!seasonId && seasons.length > 0) {
    seasonId = seasons[0].id
  }

  const teams = seasonId ? await getTeams(seasonId) : []

  return NextResponse.json({
    seasons,
    activeSeasonId: activeSeason?.id || null,
    seasonId: seasonId || null,
    teams,
  })
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON')
  }

  const { action } = body || {}
  if (!action) return badRequest('Missing action')

  if (action === 'createSeason') {
    const seasonNumber = Number(body.seasonNumber)
    if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) {
      return badRequest('Invalid seasonNumber')
    }

    const created = await createSeason(seasonNumber, body.name || null)
    return NextResponse.json({ ok: true, season: created })
  }

  if (action === 'startSeason') {
    const seasonId = Number(body.seasonId)
    if (!Number.isInteger(seasonId)) {
      return badRequest('Invalid seasonId')
    }

    const updated = await startSeason(seasonId)
    return NextResponse.json({ ok: true, season: updated })
  }

  if (action === 'createTeam') {
    const seasonId = Number(body.seasonId)
    const division = (body.division || '').trim()
    const name = (body.name || '').trim()
    const rosterLimit = Number(body.rosterLimit)

    if (!Number.isInteger(seasonId)) return badRequest('Invalid seasonId')
    if (!division) return badRequest('Division is required')
    if (!name) return badRequest('Team name is required')
    if (!Number.isInteger(rosterLimit) || rosterLimit <= 0) {
      return badRequest('Invalid rosterLimit')
    }

    const team = await createTeam({ seasonId, division, name, rosterLimit })
    return NextResponse.json({ ok: true, team })
  }

  if (action === 'updateTeam') {
    const teamId = Number(body.teamId)
    if (!Number.isInteger(teamId)) return badRequest('Invalid teamId')

    const patch = {}
    if (body.name !== undefined) patch.name = String(body.name).trim()
    if (body.division !== undefined) patch.division = String(body.division).trim()
    if (body.rosterLimit !== undefined) patch.rosterLimit = Number(body.rosterLimit)
    if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive)

    if (patch.name === '') return badRequest('Team name is required')
    if (patch.division === '') return badRequest('Division is required')
    if (patch.rosterLimit !== undefined && (!Number.isInteger(patch.rosterLimit) || patch.rosterLimit <= 0)) {
      return badRequest('Invalid rosterLimit')
    }

    const team = await updateTeam(teamId, patch)
    return NextResponse.json({ ok: true, team })
  }

  if (action === 'deleteTeam') {
    const teamId = Number(body.teamId)
    if (!Number.isInteger(teamId)) return badRequest('Invalid teamId')

    const team = await deleteTeam(teamId)
    return NextResponse.json({ ok: true, team })
  }

  return badRequest('Unknown action')
}
