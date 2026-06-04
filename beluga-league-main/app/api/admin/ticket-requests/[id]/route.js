import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { query } from '../../../../../lib/db'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function DELETE(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const rid = Number(id)
  if (!Number.isInteger(rid)) return badRequest('Invalid id')

  await ensureLeagueSchema()
  await query(`DELETE FROM ticket_requests WHERE id = $1`, [rid])
  return NextResponse.json({ ok: true })
}
