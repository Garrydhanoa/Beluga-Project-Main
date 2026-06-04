import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { setTeamLogo } from '../../../../../lib/leagueStore'
import { setFranchiseLogo } from '../../../../../lib/franchiseStore'
import { query } from '../../../../../lib/db'

export const dynamic = 'force-dynamic'

const MAX_LOGO_BYTES = 2 * 1024 * 1024

export async function POST(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const formData = await request.formData()
  const teamId = Number(formData.get('teamId'))
  const file = formData.get('file')
  const propagate = formData.get('propagate') !== 'false' // default ON

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

  // Save on the per-season team row.
  const team = await setTeamLogo(teamId, { mime, data: buffer })

  // Cross-cut: also save on the franchise (the global identity) so the logo
  // shows up automatically on past/future-season teams of the same franchise,
  // schedule pages, public-site, etc. — without having to re-upload per team.
  let franchiseId = null
  if (propagate) {
    const r = await query('SELECT franchise_id FROM teams WHERE id = $1', [teamId])
    franchiseId = r.rows[0]?.franchise_id || null
    if (franchiseId) {
      await setFranchiseLogo(franchiseId, { mime, data: buffer })
      // Also push the new logo to every other per-season team that shares the franchise
      // but doesn't have its own logo yet. (Existing team logos are NOT overwritten —
      // admin can override per-season if they want, by uploading on that team card.)
      await query(
        `UPDATE teams
         SET logo_mime = $1, logo_data = $2, updated_at = CURRENT_TIMESTAMP
         WHERE franchise_id = $3 AND id <> $4 AND logo_data IS NULL`,
        [mime, buffer, franchiseId, teamId]
      )
    }
  }

  return NextResponse.json({ ok: true, team, franchiseId, propagated: !!franchiseId })
}
