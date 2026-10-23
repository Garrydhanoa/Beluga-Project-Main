'use client'

import { signOut } from 'next-auth/react'

// Shown after a Discord login on the admin path that didn't earn access. It
// deliberately does NOT say why (wrong password vs. not a director) — that would
// tell someone guessing the password whether they got it right.
export default function AccessDenied() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-lg px-6">
        <div className="bg-gray-900/80 backdrop-blur-xl border border-red-500/20 rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-red-500/10 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-white mb-2">Access denied</h1>
          <p className="text-gray-400 mb-6 text-sm">
            This sign-in did not grant access to the admin panel and has been recorded.
            If you are league staff, check the admin credentials and try again, or contact a director.
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => signOut({ callbackUrl: '/admin' })}
              className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white rounded-lg text-sm transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="flex-1 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-200 rounded-lg text-sm transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
