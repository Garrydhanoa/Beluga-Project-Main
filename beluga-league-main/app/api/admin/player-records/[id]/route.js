import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { query } from '../../../../../lib/db'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function PATCH(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const recordId = Number(id)
  if (!Number.isInteger(recordId)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  await ensureLeagueSchema()

  const fields = []
  const values = []
  let i = 1
  const intCols = {
    gamesPlayed: 'games_played', goals: 'goals', assists: 'assists',
    saves: 'saves', shots: 'shots', score: 'score',
  }
  for (const [key, col] of Object.entries(intCols)) {
    if (body[key] !== undefined) {
      const v = Number(body[key])
      if (!Number.isInteger(v) || v < 0) return badRequest(`Invalid ${key}`)
      fields.push(`${col} = $${i++}`); values.push(v)
    }
  }
  if (body.playerName !== undefined) { fields.push(`player_name = $${i++}`); values.push(String(body.playerName).trim()) }
  if (body.teamId !== undefined) { fields.push(`team_id = $${i++}`); values.push(body.teamId === null ? null : Number(body.teamId)) }

  if (body.manualOverride === false) {
    fields.push(`manual_override = $${i++}`); values.push(false)
  } else {
    fields.push(`manual_override = $${i++}`); values.push(true)
  }
  if (!fields.length) return badRequest('No fields to update')

  values.push(recordId)
  await query(
    `UPDATE player_records SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${i}`,
    values
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const recordId = Number(id)
  if (!Number.isInteger(recordId)) return badRequest('Invalid id')

  await ensureLeagueSchema()
  await query('DELETE FROM player_records WHERE id = $1', [recordId])
  return NextResponse.json({ ok: true })
}
