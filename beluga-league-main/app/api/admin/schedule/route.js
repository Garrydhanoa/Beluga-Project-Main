import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import {
  getActiveSeason,
  getScheduleMatches,
  replaceScheduleMatches,
} from '../../../../lib/leagueStore'

export const dynamic = 'force-dynamic'

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const season = await getActiveSeason()
  if (!season) {
    return NextResponse.json({ seasonId: null, schedule: [], scheduleDraft: [] })
  }

  const published = await getScheduleMatches(season.id, { publishedOnly: true })
  const all = await getScheduleMatches(season.id, { publishedOnly: false })
  const draft = all.filter((row) => !row.isPublished)

  return NextResponse.json({
    seasonId: season.id,
    schedule: published,
    scheduleDraft: draft,
  })
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const season = await getActiveSeason()
  if (!season) {
    return badRequest('No active season found')
  }

  const { mode, schedule } = body || {}
  if (!['draft', 'publish'].includes(mode)) {
    return badRequest('mode must be draft or publish')
  }

  if (!Array.isArray(schedule)) {
    return badRequest('schedule must be an array')
  }

  if (mode === 'draft') {
    await replaceScheduleMatches(season.id, schedule, { published: false })
  }

  if (mode === 'publish') {
    await replaceScheduleMatches(season.id, schedule, { published: true })
    await replaceScheduleMatches(season.id, [], { published: false })
  }

  return NextResponse.json({ ok: true })
}
