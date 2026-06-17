import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { readData, updateSection } from '../../../../lib/adminStore'
import { requireAdmin } from '../../../../lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const data = await readData()

  if (type) {
    return NextResponse.json({ type, data: data[type] ?? null })
  }
  return NextResponse.json(data)
}

async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, data } = body
  if (!type) {
    return NextResponse.json({ error: 'Missing type' }, { status: 400 })
  }

  const updated = await updateSection(type, data)
  return NextResponse.json({ ok: true, type, data: updated })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'data.post' })
