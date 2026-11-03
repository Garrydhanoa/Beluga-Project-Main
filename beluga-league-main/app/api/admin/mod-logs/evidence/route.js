import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { ModError, addEvidence } from '../../../../../lib/modStore'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 8 * 1024 * 1024

// Attach a file or a written note to a case. Bytes are kept in Postgres because
// Discord's own links expire. multipart/form-data: caseId, file and/or text.
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  const form = await request.formData()
  const file = form.get('file')
  const text = String(form.get('text') || '').trim().slice(0, 4000)
  const actor = { name: auth.session.discordUsername || 'admin', discordId: auth.session.discordUserId || null }
  try {
    if (file && typeof file.arrayBuffer === 'function' && file.size > 0) {
      const bytes = Buffer.from(await file.arrayBuffer())
      if (bytes.byteLength > MAX_BYTES) return NextResponse.json({ error: 'That file is over 8MB.' }, { status: 400 })
      await addEvidence({ caseId: form.get('caseId'), filename: file.name, mime: file.type || 'application/octet-stream', bytes, actor })
    }
    if (text) await addEvidence({ caseId: form.get('caseId'), text, actor })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ModError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[admin/mod-logs/evidence] failed', err)
    return NextResponse.json({ error: 'The evidence was not saved.' }, { status: 500 })
  }
}

export const POST = withAudit(postHandler, { action: 'mod-logs.evidence-add' })
