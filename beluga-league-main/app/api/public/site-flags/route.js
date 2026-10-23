import { NextResponse } from 'next/server'
import { getSiteConfig } from '../../../../lib/siteConfigStore'

export const dynamic = 'force-dynamic'

/**
 * Public feature flags for the nav.
 *
 * The nav is a client component, so it can't read the DB directly. It fetches
 * this and shows/hides the Playoffs link. Deliberately tiny and failure-tolerant:
 * a DB blip hides the optional link rather than breaking the whole site header.
 */
export async function GET() {
  try {
    const playoffs = await getSiteConfig('playoffs')
    return NextResponse.json({ playoffs: Boolean(playoffs?.enabled) })
  } catch {
    return NextResponse.json({ playoffs: false })
  }
}
