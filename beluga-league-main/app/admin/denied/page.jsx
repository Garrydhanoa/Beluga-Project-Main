'use client'

import { signOut } from 'next-auth/react'

export default function AccessDenied() {
  return (
    <div className="w-full max-w-md px-6">
      <div className="bg-gray-900/80 backdrop-blur-xl border border-red-500/20 rounded-2xl p-8 shadow-2xl text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-red-500/10 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
        <p className="text-gray-400 mb-6">
          You do not have the <span className="text-red-400 font-medium">Director</span> role required to access the admin panel.
        </p>

        <button
          onClick={() => signOut({ callbackUrl: '/admin' })}
          className="px-6 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white rounded-lg transition-colors"
        >
          Go Back
        </button>
      </div>
    </div>
  )
}
