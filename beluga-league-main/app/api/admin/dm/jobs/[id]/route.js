import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { getJob } from '../../../../../../lib/dmStore'

export const dynamic = 'force-dynamic'

/** Live status + per-recipient breakdown for one job. Polled while sending. */
export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  // Next 16: params is a Promise — destructuring it synchronously yields undefined.
  const { id } = await params
  const result = await getJob(id)
  if (!result) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  return NextResponse.json(result)
}
