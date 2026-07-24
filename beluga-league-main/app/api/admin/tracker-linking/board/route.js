import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { assembleBoard } from '../../../../../lib/trackerLinking'

export const dynamic = 'force-dynamic'

// The global "needs attention" board: players with a tracker suggestion (renamed /
// new account) first, then players with an invalid 404 tracker but no suggestion yet.
export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const force = new URL(request.url).searchParams.get('force') === '1'
  try {
    const board = await assembleBoard(force)
    return NextResponse.json(board)
  } catch (e) {
    return NextResponse.json({ error: `board failed: ${e?.message || e}`, players: [], rateLimited: false }, { status: 502 })
  }
}
