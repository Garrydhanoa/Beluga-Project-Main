'use client'

import { usePathname } from 'next/navigation'

export function LayoutShell({ children, navigation, footer, scrollToTop, notificationBar }) {
  const pathname = usePathname()
  const isAdmin = pathname?.startsWith('/admin')

  if (isAdmin) {
    return <>{children}</>
  }

  return (
    <>
      {notificationBar}
      {navigation}
      <main className="relative">{children}</main>
      {footer}
      {scrollToTop}
    </>
  )
}
