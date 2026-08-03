import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { resolveRecipients, normalizeTargets, hasAnyTarget } from '../../../../../lib/dmStore'

export const dynamic = 'force-dynamic'

/**
 * Dry run — resolve a target selection to a deduplicated recipient list so the
 * admin can see exactly who would get the DM before anything is sent. Sends
 * nothing and writes nothing.
 */
export async function POST(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const targets = normalizeTargets(body.targets)
  if (!hasAnyTarget(targets)) {
    return NextResponse.json({ count: 0, recipients: [], warnings: ['No recipients selected.'] })
  }

  const { recipients, season, warnings } = await resolveRecipients(targets)
  const deliverable = recipients.filter((r) => r.inGuild)

  return NextResponse.json({
    count: deliverable.length,
    totalMatched: recipients.length,
    recipients: deliverable.slice(0, 500),
    truncated: deliverable.length > 500,
    season: season ? { id: season.id, number: season.season_number } : null,
    warnings,
  })
}
