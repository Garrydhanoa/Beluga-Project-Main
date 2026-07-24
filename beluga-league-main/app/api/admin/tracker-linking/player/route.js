import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { assemblePlayer } from '../../../../../lib/trackerLinking'

export const dynamic = 'force-dynamic'

// Single-player editor data: the player's SalSheet rows (main/alt trackers) +
// their Ballchasing accounts, name history, and computed suggestions.
export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const discordId = new URL(request.url).searchParams.get('discordId') || ''
  if (!discordId) return NextResponse.json({ error: 'discordId required' }, { status: 400 })
  try {
    const data = await assemblePlayer(discordId)
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: `player lookup failed: ${e?.message || e}` }, { status: 502 })
  }
}
