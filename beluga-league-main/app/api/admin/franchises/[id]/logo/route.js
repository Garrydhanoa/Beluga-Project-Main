import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../../lib/leagueSchema'
import { setFranchiseLogo, getFranchiseLogo } from '../../../../../../lib/franchiseStore'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(_request, { params }) {
  const { id } = await params
  const fid = Number(id)
  if (!Number.isInteger(fid)) return badRequest('Invalid id')

  await ensureLeagueSchema()
  const logo = await getFranchiseLogo(fid)
  if (!logo || !logo.data) return new NextResponse(null, { status: 404 })
  return new NextResponse(logo.data, {
    status: 200,
    headers: {
      'Content-Type': logo.mime || 'image/png',
      'Cache-Control': 'public, max-age=300',
    },
  })
}

export async function POST(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const fid = Number(id)
  if (!Number.isInteger(fid)) return badRequest('Invalid id')

  const formData = await request.formData()
  const file = formData.get('file')
  if (!file || typeof file === 'string') return badRequest('No file uploaded')
  if (file.size > MAX_BYTES) return badRequest('Logo must be under 2 MB')

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  await ensureLeagueSchema()
  await setFranchiseLogo(fid, { mime: file.type || 'image/png', data: buffer })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const fid = Number(id)
  if (!Number.isInteger(fid)) return badRequest('Invalid id')

  await ensureLeagueSchema()
  await setFranchiseLogo(fid, { mime: null, data: null })
  return NextResponse.json({ ok: true })
}
