import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { searchMembers, getRoles } from '../../../../lib/discordMembers'

export const dynamic = 'force-dynamic'

/**
 * Admin lookup over the bot-mirrored Discord directory. Powers the ticket
 * creation autocomplete:
 *   - ?kind=user&q=foo  → matching members ("do you mean this user?")
 *   - ?kind=role[&q=]   → the server's roles (optionally filtered)
 */
export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  await ensureLeagueSchema()

  const { searchParams } = new URL(request.url)
  const kind = (searchParams.get('kind') || 'user').toLowerCase()
  const q = searchParams.get('q') || ''

  if (kind === 'role') {
    let roles = await getRoles()
    const term = q.trim().toLowerCase()
    if (term) roles = roles.filter((r) => (r.name || '').toLowerCase().includes(term))
    return NextResponse.json({ kind: 'role', results: roles.slice(0, 50) })
  }

  const members = await searchMembers(q, 12)
  return NextResponse.json({ kind: 'user', results: members })
}
