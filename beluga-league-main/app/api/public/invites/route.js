import { NextResponse } from 'next/server'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { getPublicInvites, getInvitePreview } from '../../../../lib/inviteStore'

export const dynamic = 'force-dynamic'

// Public invite leaderboards. ?preview=1 → the homepage top-5 strip.
// Counts only — never who invited whom.
export async function GET(request) {
  await ensureLeagueSchema()
  try {
    const preview = new URL(request.url).searchParams.get('preview')
    return NextResponse.json(preview ? await getInvitePreview(5) : await getPublicInvites())
  } catch (err) {
    console.error('[public/invites] failed', err)
    return NextResponse.json({ error: 'Invite leaderboard unavailable' }, { status: 500 })
  }
}
