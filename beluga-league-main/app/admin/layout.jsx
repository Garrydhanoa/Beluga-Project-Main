'use client'

import { SessionProvider } from 'next-auth/react'

export default function AdminLayout({ children }) {
  return (
    <SessionProvider>
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-blue-950 to-gray-950">
        {children}
      </div>
    </SessionProvider>
  )
}
