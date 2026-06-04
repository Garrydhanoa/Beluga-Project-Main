import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { query } from '../../../../../lib/db'

export const dynamic = 'force-dynamic'

function badRequest(msg, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

export async function PATCH(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const matchId = Number(id)
  if (!Number.isInteger(matchId)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  await ensureLeagueSchema()

  const fields = []
  const values = []
  let i = 1

  if (body.division !== undefined) { fields.push(`division = $${i++}`); values.push(String(body.division)) }
  if (body.week !== undefined) {
    const w = Number(body.week)
    if (!Number.isInteger(w) || w < 1) return badRequest('Invalid week')
    fields.push(`week = $${i++}`); values.push(w)
  }
  if (body.homeTeamId !== undefined) {
    const v = Number(body.homeTeamId)
    if (!Number.isInteger(v)) return badRequest('Invalid homeTeamId')
    fields.push(`home_team_id = $${i++}`); values.push(v)
  }
  if (body.awayTeamId !== undefined) {
    const v = Number(body.awayTeamId)
    if (!Number.isInteger(v)) return badRequest('Invalid awayTeamId')
    fields.push(`away_team_id = $${i++}`); values.push(v)
  }
  if (body.isPublished !== undefined) {
    const pub = Boolean(body.isPublished)
    fields.push(`is_published = $${i++}`); values.push(pub)
    fields.push(`status = $${i++}`); values.push(pub ? 'published' : 'draft')
  }

  if (!fields.length) return badRequest('No fields to update')

  values.push(matchId)
  await query(
    `UPDATE schedule_matches SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${i}`,
    values
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const matchId = Number(id)
  if (!Number.isInteger(matchId)) return badRequest('Invalid id')

  await ensureLeagueSchema()
  await query('DELETE FROM schedule_matches WHERE id = $1', [matchId])
  return NextResponse.json({ ok: true })
}
