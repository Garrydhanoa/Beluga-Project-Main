'use client'

import { useEffect, useState } from 'react'
import { signOut, useSession } from 'next-auth/react'

const ERROR_REASONS = {
  RateLimit: {
    title: 'Discord rate limit hit',
    body: 'Discord temporarily blocked our role check. Wait 5–60 minutes and try again. If the bot is restart-looping, fixing that helps too.',
  },
  AccessDenied: {
    title: 'Access denied',
    body: 'You do not have the Director role in the league Discord. Ask an existing director to grant the role.',
  },
  OAuthCallback: {
    title: 'Discord OAuth failed',
    body: 'Discord rejected the login attempt. Common causes: rate limit, expired token, or revoked Discord authorization.',
  },
  default: {
    title: 'Access denied',
    body: 'You do not have the Director role required to access the admin panel.',
  },
}

export default function AccessDenied() {
  const { data: session, status } = useSession()
  const [errorReason, setErrorReason] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    if (err) setErrorReason(err)
  }, [])

  const reasonKey = errorReason && ERROR_REASONS[errorReason] ? errorReason : 'default'
  const reason = ERROR_REASONS[reasonKey]
  const lastChecked = session?.rolesCheckedAt ? new Date(session.rolesCheckedAt).toLocaleString() : null

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-lg px-6">
        <div className="bg-gray-900/80 backdrop-blur-xl border border-red-500/20 rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-red-500/10 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-white mb-2">{reason.title}</h1>
          <p className="text-gray-400 mb-4 text-sm">{reason.body}</p>

          {status === 'authenticated' && session?.discordUsername && (
            <div className="text-xs text-gray-500 mb-4 bg-black/30 rounded p-3 text-left">
              <div>Signed in as: <span className="text-gray-300">{session.discordUsername}</span></div>
              {session.discordUserId && (
                <div className="font-mono mt-1 break-all">Discord ID: {session.discordUserId}</div>
              )}
              {lastChecked && (
                <div className="mt-1">Role last checked: {lastChecked}</div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white rounded-lg text-sm transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => signOut({ callbackUrl: '/admin' })}
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
