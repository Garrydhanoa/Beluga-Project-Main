import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { DM_AI_MODES, listPersonas, setPersona } from '../../../../../lib/dmInboxStore'

export const dynamic = 'force-dynamic'

/**
 * The bot's per-person AI personality.
 *
 * A persona applies EVERYWHERE — server channels as well as DMs — and is set on
 * a discord id directly, so staff can mark someone unhinged without ever having
 * DMed them. GET lists only the people on a non-default persona, which is the
 * question staff actually have: "who is the bot currently roasting?"
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const personas = await listPersonas()
  return NextResponse.json({ personas, modes: DM_AI_MODES })
}

async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const discordId = String(body.discordId || '').trim()
  if (!/^\d{16,20}$/.test(discordId)) {
    return NextResponse.json({ error: 'A valid Discord ID is required' }, { status: 400 })
  }
  if (!DM_AI_MODES.includes(String(body.mode))) {
    return NextResponse.json({ error: 'Unknown AI mode' }, { status: 400 })
  }

  const mode = await setPersona(discordId, body.mode, {
    discordUserId: auth.session?.discordUserId,
    discordUsername: auth.session?.discordUsername,
  })
  return NextResponse.json({ ok: true, discordId, mode })
}

// Audited: switching someone to roast mode is worth a trail in /higgenlogs.
export const POST = withAudit(postHandler, { action: 'dm.persona-set' })
