import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { getSeasonById } from '../../../../../lib/leagueStore'
import { createSeasonActionRequest, getOpenSeasonActionRequest } from '../../../../../lib/seasonActionsStore'

// Delete-Season request (behind the same 5-step confirm). Queues a director-approval
// request; the bot executes the destructive delete only after 3 Director ✅.
export const dynamic = 'force-dynamic'

function bad(msg, code = 400) {
  return NextResponse.json({ error: msg }, { status: code })
}

async function handler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return bad('Invalid JSON') }

  const seasonId = Number(body.seasonId)
  if (!Number.isInteger(seasonId)) return bad('seasonId required')

  const season = await getSeasonById(seasonId)
  if (!season) return bad('Season not found', 404)

  const open = await getOpenSeasonActionRequest()
  if (open) return bad('A season action is already pending director approval. Resolve it first.', 409)

  const req = await createSeasonActionRequest({
    action: 'delete',
    seasonId,
    payload: { seasonNumber: season.seasonNumber, name: season.name, status: season.status },
    initiatedByDiscordId: auth.session.discordUserId,
    initiatedByUsername: auth.session.discordUsername,
    verifyString: body.verifyString || null,
  })

  return NextResponse.json({ ok: true, requestId: req.id })
}

export const POST = withAudit(handler, { action: 'seasons.request-delete' })
