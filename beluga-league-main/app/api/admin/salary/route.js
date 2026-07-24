import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { listSalaryBoard } from '../../../../lib/salaryAdmin'

export const dynamic = 'force-dynamic'

// The Salary panel board: locked players + each one's locked (O) vs auto-calc (N) with
// a should-move-up flag. Read-only (no audit needed for GET).
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  try {
    const data = await listSalaryBoard()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e), board: [], counts: {} }, { status: 502 })
  }
}
