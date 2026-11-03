import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../../lib/leagueSchema'
import { getEvidenceFile } from '../../../../../../lib/modStore'

export const dynamic = 'force-dynamic'

// Director-only download of a stored evidence file. Served as an attachment so an
// uploaded HTML or SVG file can't run on the site's origin.
async function getHandler(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  const { id } = await params
  const file = await getEvidenceFile(id)
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const name = String(file.filename || `evidence-${id}`).replace(/[^\w.\- ]+/g, '_')
  return new NextResponse(file.bytes, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export const GET = withAudit(getHandler, { action: 'mod-logs.evidence-view' })
