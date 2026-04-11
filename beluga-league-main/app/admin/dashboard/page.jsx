'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function AdminDashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/admin')
    } else if (status === 'authenticated' && !session?.isDirector) {
      router.push('/admin/denied')
    }
  }, [status, session, router])

  if (status === 'loading') {
    return (
      <div className="text-center">
        <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 mt-4">Verifying access...</p>
      </div>
    )
  }

  if (!session?.isDirector) {
    return null
  }

  return (
    <div className="w-full max-w-4xl px-6">
      <div className="bg-gray-900/80 backdrop-blur-xl border border-blue-500/20 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
            <p className="text-blue-400 text-sm mt-1">
              Welcome, {session.discordUsername || session.user?.name}
            </p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/admin' })}
            className="px-4 py-2 bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-400 rounded-lg transition-colors text-sm"
          >
            Sign Out
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-1">Standings</h3>
            <p className="text-gray-400 text-sm">Manage team standings</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-1">Rosters</h3>
            <p className="text-gray-400 text-sm">Manage team rosters</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-1">Players</h3>
            <p className="text-gray-400 text-sm">Manage player directory</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-1">Power Rankings</h3>
            <p className="text-gray-400 text-sm">Update weekly rankings</p>
          </div>
        </div>

        <p className="text-gray-600 text-xs text-center mt-8">
          More features coming soon
        </p>
      </div>
    </div>
  )
}
