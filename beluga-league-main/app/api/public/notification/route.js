import { NextResponse } from 'next/server'
import { getSiteConfig } from '../../../../lib/siteConfigStore'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const notification = await getSiteConfig('notification')
    return NextResponse.json({ notification })
  } catch {
    return NextResponse.json({ notification: { enabled: false, message: '', href: '/players' } })
  }
}
