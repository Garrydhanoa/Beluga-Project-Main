import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { getUnreadTotal } from '../../../../../lib/dmInboxStore'

export const dynamic = 'force-dynamic'

/** Tiny endpoint for the sidebar badge — polled from every admin page. */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const totals = await getUnreadTotal()
  return NextResponse.json(totals)
}
