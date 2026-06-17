import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { listTransactions, logTransaction, TRANSACTION_TYPES } from '../../../../lib/transactionStore'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  await ensureLeagueSchema()

  const { searchParams } = new URL(request.url)
  const discordId = searchParams.get('discordId')
  const teamId = searchParams.get('teamId') ? Number(searchParams.get('teamId')) : null
  const franchiseId = searchParams.get('franchiseId') ? Number(searchParams.get('franchiseId')) : null
  const seasonId = searchParams.get('seasonId') ? Number(searchParams.get('seasonId')) : null
  const limit = Number(searchParams.get('limit')) || 200

  const transactions = await listTransactions({
    discordId,
    teamId: Number.isInteger(teamId) ? teamId : null,
    franchiseId: Number.isInteger(franchiseId) ? franchiseId : null,
    seasonId: Number.isInteger(seasonId) ? seasonId : null,
    limit,
  })
  return NextResponse.json({ transactions, types: Object.values(TRANSACTION_TYPES) })
}

async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  if (!body.discordId) return badRequest('discordId required')
  if (!body.type) return badRequest('type required')

  const tx = await logTransaction({
    seasonId: body.seasonId ? Number(body.seasonId) : null,
    discordId: String(body.discordId),
    discordUsername: body.discordUsername || null,
    displayName: body.displayName || null,
    teamId: body.teamId ? Number(body.teamId) : null,
    pairedTeamId: body.pairedTeamId ? Number(body.pairedTeamId) : null,
    type: String(body.type),
    details: body.details || {},
    performedByDiscordId: body.performedByDiscordId || (auth.session?.discordUserId || null),
    performedByUsername: body.performedByUsername || (auth.session?.discordUsername || null),
    source: body.source || 'admin-panel',
  })
  return NextResponse.json({ ok: true, transaction: tx })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'transactions.post' })
