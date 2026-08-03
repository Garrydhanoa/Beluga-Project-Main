import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { listJobs } from '../../../../../lib/dmStore'

export const dynamic = 'force-dynamic'

/** Recent DM blasts for the history table. */
export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(request.url)
  const jobs = await listJobs(Number(searchParams.get('limit')) || 25)
  return NextResponse.json({ jobs })
}
