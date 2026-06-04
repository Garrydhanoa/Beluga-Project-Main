import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import {
  getActiveSeason,
  getPlayoffMatchups,
  replacePlayoffBrackets,
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
    return NextResponse.json({ seasonId: null, brackets: [] })
  }

  const brackets = await getPlayoffMatchups(season.id)
  return NextResponse.json({ seasonId: season.id, brackets })
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

  const { brackets } = body || {}
  if (!Array.isArray(brackets)) {
    return badRequest('brackets must be an array')
  }

  await replacePlayoffBrackets(season.id, brackets, { published: true })
  return NextResponse.json({ ok: true })
}
