'use client'

import { usePathname } from 'next/navigation'
import SiteBackground from './SiteBackground'

export function LayoutShell({ children, navigation, footer, scrollToTop, notificationBar }) {
  const pathname = usePathname()
  const isAdmin = pathname?.startsWith('/admin')

  if (isAdmin) {
    return <>{children}</>
  }

  return (
    <>
      <SiteBackground />
      {notificationBar}
      {navigation}
      <main className="relative">{children}</main>
      {footer}
      {scrollToTop}
    </>
  )
}
