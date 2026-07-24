import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { getActiveSeason, getSeasonByNumber } from '../../../../../lib/leagueStore'
import { createSeasonActionRequest, getOpenSeasonActionRequest } from '../../../../../lib/seasonActionsStore'

// Start-New-Season request (behind the 5-step confirm on the admin panel). Does NOT
// execute anything — it queues a director-approval request. The bot posts the embed,
// collects 3 Director ✅, then archives the old season + creates/activates the new one
// (teams copied w/ logos+roles, empty rosters, no schedule).
export const dynamic = 'force-dynamic'

function bad(msg, code = 400) {
  return NextResponse.json({ error: msg }, { status: code })
}

async function handler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return bad('Invalid JSON') }

  const newSeasonNumber = Number(body.newSeasonNumber)
  if (!Number.isInteger(newSeasonNumber) || newSeasonNumber <= 0) return bad('Valid new season number required')

  const clash = await getSeasonByNumber(newSeasonNumber)
  if (clash) return bad(`Season ${newSeasonNumber} already exists`)

  const open = await getOpenSeasonActionRequest()
  if (open) return bad('A season action is already pending director approval. Resolve it first.', 409)

  const active = await getActiveSeason()

  const req = await createSeasonActionRequest({
    action: 'reset',
    seasonId: active ? active.id : null,
    payload: {
      newSeasonNumber,
      newName: (body.newName || '').trim() || null,
      startDate: body.startDate || null,
      carryTeams: body.carryTeams !== false,
      copyConfig: body.copyConfig !== false,
      oldSeasonNumber: active ? active.seasonNumber : null,
    },
    initiatedByDiscordId: auth.session.discordUserId,
    initiatedByUsername: auth.session.discordUsername,
    verifyString: body.verifyString || null,
  })

  return NextResponse.json({ ok: true, requestId: req.id })
}

export const POST = withAudit(handler, { action: 'seasons.request-reset' })
