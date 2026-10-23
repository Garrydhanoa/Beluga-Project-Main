import { requireAdmin } from '../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { logActivity, logWebsiteError } from '../../../../../lib/activityLog'
import { loadTranscript, renderTranscriptHtml } from '../../../../../lib/transcriptExport'

export const dynamic = 'force-dynamic'

/**
 * GET ?type=ticket|thread&id=<channel or thread id>
 * Downloads a self-contained HTML transcript (images + avatars embedded).
 * Logged to higgenlogs with exactly which transcript was taken.
 */
export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const url = new URL(request.url)
  const type = url.searchParams.get('type')
  const id = url.searchParams.get('id')
  if (!['ticket', 'thread'].includes(type) || !id) {
    return Response.json({ error: 'type (ticket|thread) and id are required' }, { status: 400 })
  }

  try {
    const t = await loadTranscript(type, id)
    if (!t) return Response.json({ error: 'No transcript found' }, { status: 404 })
    const html = await renderTranscriptHtml(t, { exportedBy: auth.session.discordUsername || 'staff' })
    const slug = t.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || type
    const date = new Date().toISOString().slice(0, 10)

    await logActivity({
      auth, action: 'transcripts.export', target: t.title,
      detail: { type: type === 'ticket' ? 'Ticket' : 'Match thread', messages: t.messages.length, id },
    })

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="transcript-${slug}-${date}.html"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    await logWebsiteError({ auth, action: 'transcripts.export', error: err, target: `${type} ${id}`, location: 'Transcripts' })
    return Response.json({ error: 'Could not build the transcript' }, { status: 500 })
  }
}
