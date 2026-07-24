'use client'

import { usePathname } from 'next/navigation'
import SiteBackground from './SiteBackground'
import { SeasonProvider } from './SeasonContext'

export function LayoutShell({ children, navigation, footer, scrollToTop, notificationBar }) {
  const pathname = usePathname()
  const isAdmin = pathname?.startsWith('/admin')

  if (isAdmin) {
    return <>{children}</>
  }

  return (
    <SeasonProvider>
      <SiteBackground />
      {notificationBar}
      {navigation}
      <main className="relative">{children}</main>
      {footer}
      {scrollToTop}
    </SeasonProvider>
  )
}
