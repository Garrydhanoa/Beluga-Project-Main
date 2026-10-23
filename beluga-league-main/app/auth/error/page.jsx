import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { routeAfterAuth, safeLocalPath } from '../../../lib/authRouting'

export const dynamic = 'force-dynamic'

// NextAuth's error page. NextAuth doesn't pass the callback URL here, so read the
// callback-url cookie it set when the sign-in started, and route the same way as
// the sign-in page does.
export default async function AuthErrorRouter({ searchParams }) {
  const sp = (await searchParams) || {}
  const error = typeof sp.error === 'string' ? sp.error : 'Callback'
  const jar = await cookies()
  const raw = jar.get('__Secure-next-auth.callback-url')?.value || jar.get('next-auth.callback-url')?.value || null
  redirect(routeAfterAuth(safeLocalPath(raw), error))
}
