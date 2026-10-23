import { requireAdmin } from '../../../../../../lib/adminAuth'
import { query } from '../../../../../../lib/db'

export const dynamic = 'force-dynamic'

// Serves a saved transcript image (the bot copies image attachments into
// transcript_files because Discord's own links expire). Admin-only.
export async function GET(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) return new Response('Not found', { status: 404 })

  const r = await query(`SELECT name, content_type, data FROM transcript_files WHERE id = $1`, [n]).catch(() => ({ rows: [] }))
  const f = r.rows[0]
  if (!f) return new Response('Not found', { status: 404 })

  const type = String(f.content_type || '').startsWith('image/') ? f.content_type : 'application/octet-stream'
  return new Response(f.data, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `inline; filename="${String(f.name || 'image').replace(/["\\\r\n]/g, '')}"`,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
