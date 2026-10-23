import { redirect } from 'next/navigation'
import { routeAfterAuth, safeLocalPath } from '../../../lib/authRouting'

export const dynamic = 'force-dynamic'

// NextAuth's sign-in page. It never renders: it sends the visitor back to the page
// they started from (applications → /applications, admin → /admin) with the error.
export default async function AuthSignInRouter({ searchParams }) {
  const sp = (await searchParams) || {}
  const error = typeof sp.error === 'string' ? sp.error : null
  const callbackPath = safeLocalPath(typeof sp.callbackUrl === 'string' ? sp.callbackUrl : null)
  redirect(routeAfterAuth(callbackPath, error))
}
