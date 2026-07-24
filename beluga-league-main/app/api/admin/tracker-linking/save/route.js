import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { withAudit } from '../../../../../lib/activityLog'
import { scraperPost } from '../../../../../lib/trackerLinking'

export const dynamic = 'force-dynamic'

// Write a player's MAIN (Registrations!D) and/or ALT (Registrations!E) trackers via the
// scraper (resolved from the discord id), then (unless disabled) re-pull MMR for each of
// the player's SalSheet rows so the corrected tracker takes effect.
// Body: { discordId, main?:[url], alt?:[url], dryRun?:bool, repull?:bool }
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const discordId = String(body.discordId || '').trim()
  if (!discordId) return NextResponse.json({ error: 'discordId required' }, { status: 400 })

  const dryRun = Boolean(body.dryRun)
  const payload = { discord_id: discordId, dry_run: dryRun, confirm: dryRun ? false : true }
  if (Array.isArray(body.main)) payload.main = body.main
  if (Array.isArray(body.alt)) payload.alt = body.alt
  if (payload.main === undefined && payload.alt === undefined) {
    return NextResponse.json({ error: 'main and/or alt (array of urls) required' }, { status: 400 })
  }

  const save = await scraperPost('/tracker-save', payload)
  if (!save.ok) {
    return NextResponse.json({ error: 'save failed', detail: save.data }, { status: save.status || 502 })
  }

  // Auto re-pull MMR for each SalSheet row of this player (default on, skipped on dry-run).
  // Tolerate 409 (a run already in progress) — the sheet write still succeeded.
  const repull = []
  if (!dryRun && body.repull !== false) {
    const salRows = Array.isArray(save.data?.sal_rows) ? save.data.sal_rows : []
    for (const row of salRows) {
      const r = await scraperPost('/update-player', { row_index: row })
      repull.push({ row, ok: r.ok, status: r.status })
    }
  }

  return NextResponse.json({ ok: true, save: save.data, repull })
}

// Sensitive (writes the live Registrations sheet + re-pulls MMR) — audit who did it.
export const POST = withAudit(postHandler, { action: 'tracker.save' })
