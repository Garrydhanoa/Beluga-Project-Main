import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import {
  findSalRowByDiscord, writeSalaryO, deleteLock, enqueueSalaryAnnounce,
} from '../../../../../lib/salaryAdmin'

export const dynamic = 'force-dynamic'

// Remove a player's manual salary lock and sync col O back to the auto-calc N (mirrors
// /update-sal): the salary-lock system resumes auto-updating them. Body: { discordId }.
// Sensitive — audited.
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const discordId = String(body.discordId || '').trim()
  if (!discordId) return NextResponse.json({ error: 'discordId required' }, { status: 400 })

  const row = await findSalRowByDiscord(discordId)
  if (!row || !row.rowIndex) {
    return NextResponse.json({ error: 'Player not found in the SalSheet' }, { status: 404 })
  }

  const had = await deleteLock(discordId)
  if (!had) {
    return NextResponse.json({ error: 'Player does not have a manual salary lock' }, { status: 400 })
  }

  // Sync O back to the auto-calc N so it reflects the current computed salary.
  const newVal = row.calc != null ? row.calc : ''
  await writeSalaryO(row.rowIndex, newVal)

  const oldStr = row.lockedRaw || ''
  const msg = (oldStr && String(newVal) !== '' && oldStr !== String(newVal))
    ? `{mention} has been synced back from **${oldStr}** to **${newVal}** (automatic updates resumed)`
    : `{mention}'s salary lock removed${newVal !== '' ? ` at **${newVal}**` : ''} (automatic updates resumed)`
  await enqueueSalaryAnnounce(discordId, msg)

  return NextResponse.json({
    ok: true, discordId, rowIndex: row.rowIndex, name: row.name,
    oldLocked: oldStr || null, newO: newVal === '' ? null : newVal, unlocked: true,
  })
}

export const POST = withAudit(postHandler, { action: 'salary.unlock' })
