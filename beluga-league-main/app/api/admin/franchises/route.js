import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { listFranchises, createFranchise } from '../../../../lib/franchiseStore'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const activeOnly = searchParams.get('activeOnly') === 'true'
  const franchises = await listFranchises({ activeOnly })
  return NextResponse.json({ franchises })
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const name = (body.name || '').trim()
  if (!name) return badRequest('Name required')

  try {
    const franchise = await createFranchise({
      name,
      defaultDivision: body.defaultDivision || null,
    })
    return NextResponse.json({ ok: true, franchise })
  } catch (err) {
    return badRequest(err.message || 'Failed to create franchise')
  }
}
