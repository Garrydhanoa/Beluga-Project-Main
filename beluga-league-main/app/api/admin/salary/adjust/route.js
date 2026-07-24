import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../lib/adminAuth'
import {
  findSalRowByDiscord, writeSalaryO, upsertLock,
  enqueueSalaryAnnounce, salaryChangeMessage,
} from '../../../../../lib/salaryAdmin'

export const dynamic = 'force-dynamic'

// Adjust + LOCK a player's salary (mirrors /salary-adjustment): write SalSheet col O,
// upsert the manual_salaries lock (so the auto-lock skips them), and announce via the
// bot. Body: { discordId, salary }. Sensitive — audited (who did what).
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const discordId = String(body.discordId || '').trim()
  const salary = Number(body.salary)
  if (!discordId) return NextResponse.json({ error: 'discordId required' }, { status: 400 })
  if (!Number.isFinite(salary) || salary < 0) {
    return NextResponse.json({ error: 'salary must be a number ≥ 0' }, { status: 400 })
  }

  const row = await findSalRowByDiscord(discordId)
  if (!row || !row.rowIndex) {
    return NextResponse.json({ error: 'Player not found in the SalSheet (are they registered?)' }, { status: 404 })
  }

  // Write the locked salary (col O), then record the lock.
  await writeSalaryO(row.rowIndex, salary)
  await upsertLock(discordId, row.name, salary, auth.session.discordUserId, auth.session.discordUsername)

  // Announce (skip the noisy "no change" case).
  const change = salaryChangeMessage(row.lockedRaw, salary)
  if (change.direction !== 'same') await enqueueSalaryAnnounce(discordId, change.message)

  return NextResponse.json({
    ok: true, discordId, rowIndex: row.rowIndex, name: row.name,
    oldLocked: row.lockedRaw || null, newLocked: salary, direction: change.direction, locked: true,
  })
}

export const POST = withAudit(postHandler, { action: 'salary.adjust' })
