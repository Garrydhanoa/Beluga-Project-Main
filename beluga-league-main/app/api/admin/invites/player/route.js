import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { getPlayerInviteSummary } from '../../../../../lib/inviteStore'

export const dynamic = 'force-dynamic'

// "Invited by X · Invited N" line in the admin Players panel. A sub-fetch of a
// panel whose own read is already logged, so it is in READ_NOISE.
async function handler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  try {
    return NextResponse.json(await getPlayerInviteSummary(id))
  } catch (err) {
    console.error('[admin/invites/player] failed', err)
    return NextResponse.json({ error: 'Failed to load invite summary' }, { status: 500 })
  }
}

export const GET = withAudit(handler, { action: 'invites.player' })
