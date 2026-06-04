import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { getTransaction, deleteTransaction } from '../../../../../lib/transactionStore'
import { query } from '../../../../../lib/db'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const txId = Number(id)
  if (!Number.isInteger(txId)) return badRequest('Invalid id')

  await ensureLeagueSchema()
  const tx = await getTransaction(txId)
  if (!tx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ transaction: tx })
}

export async function PATCH(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const txId = Number(id)
  if (!Number.isInteger(txId)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  await ensureLeagueSchema()

  const fields = []
  const values = []
  let i = 1
  if (body.type !== undefined) { fields.push(`type = $${i++}`); values.push(String(body.type)) }
  if (body.teamId !== undefined) { fields.push(`team_id = $${i++}`); values.push(body.teamId === null ? null : Number(body.teamId)) }
  if (body.pairedTeamId !== undefined) { fields.push(`paired_team_id = $${i++}`); values.push(body.pairedTeamId === null ? null : Number(body.pairedTeamId)) }
  if (body.seasonId !== undefined) { fields.push(`season_id = $${i++}`); values.push(body.seasonId === null ? null : Number(body.seasonId)) }
  if (body.details !== undefined) { fields.push(`details = $${i++}::jsonb`); values.push(JSON.stringify(body.details || {})) }

  if (!fields.length) return badRequest('No fields to update')

  values.push(txId)
  await query(`UPDATE transactions SET ${fields.join(', ')} WHERE id = $${i}`, values)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const txId = Number(id)
  if (!Number.isInteger(txId)) return badRequest('Invalid id')

  await ensureLeagueSchema()
  await deleteTransaction(txId)
  return NextResponse.json({ ok: true })
}
