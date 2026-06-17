import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { setTeamLogo } from '../../../../../lib/leagueStore'
import { setFranchiseLogo } from '../../../../../lib/franchiseStore'
import { query } from '../../../../../lib/db'

export const dynamic = 'force-dynamic'

const MAX_LOGO_BYTES = 2 * 1024 * 1024

async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const formData = await request.formData()
  const teamId = Number(formData.get('teamId'))
  const file = formData.get('file')

  if (!Number.isInteger(teamId)) {
    return NextResponse.json({ error: 'Invalid teamId' }, { status: 400 })
  }

  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: 'Logo file is too large (max 2MB)' }, { status: 400 })
  }

  const buffer = Buffer.from(arrayBuffer)
  const mime = file.type || 'application/octet-stream'

  // The FRANCHISE logo is the single source of truth (one logo per franchise,
  // served everywhere via the franchise fallback in /api/teams/logo). Uploading
  // on any team card updates the franchise and CLEARS stale per-team overrides —
  // stale overrides were why a team could show another/old logo and re-uploads
  // "didn't fix" it.
  const r = await query('SELECT franchise_id FROM teams WHERE id = $1', [teamId])
  const franchiseId = r.rows[0]?.franchise_id || null

  let team = null
  if (franchiseId) {
    await setFranchiseLogo(franchiseId, { mime, data: buffer })
    await query(
      `UPDATE teams SET logo_data = NULL, logo_mime = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE franchise_id = $1 AND logo_data IS NOT NULL`,
      [franchiseId]
    )
  } else {
    // Team without a franchise: store on the team row itself.
    team = await setTeamLogo(teamId, { mime, data: buffer })
  }

  return NextResponse.json({ ok: true, team, franchiseId, propagated: !!franchiseId })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'teams.logo.post' })
