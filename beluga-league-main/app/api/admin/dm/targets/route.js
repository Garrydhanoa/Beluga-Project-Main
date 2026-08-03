import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { getTargetOptions } from '../../../../../lib/dmStore'

export const dynamic = 'force-dynamic'

/** Franchises / teams / divisions / channels for the DM Center pickers. */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const options = await getTargetOptions()
  return NextResponse.json(options)
}
