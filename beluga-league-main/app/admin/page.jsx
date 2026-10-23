'use client'

import { useState } from 'react'
import { useEffect } from 'react'
import { signIn, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { checkSecurityStatus, collectFingerprint } from '../../lib/clientSecurity'
import { authErrorMessage } from '../../lib/authRouting'

export default function AdminGateLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ban, setBan] = useState(null)
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    const authError = new URLSearchParams(window.location.search).get('error')
    if (authError) setError(authErrorMessage(authError))
    checkSecurityStatus().then((s) => { if (s.banned) setBan(s.message) })
  }, [])

  // Already signed in with admin access → straight to the dashboard. Anyone else
  // (an applicant session, a previous denied attempt) just sees the gate.
  useEffect(() => {
    if (status === 'authenticated' && session?.adminAccess) router.replace('/admin/dashboard')
  }, [status, session, router])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/admin/gate-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fp: collectFingerprint() }),
      })
      const data = await res.json().catch(() => ({}))

      if (data.banned) {
        setBan(data.error)
        setLoading(false)
        return
      }
      if (data.success) {
        // Continue to Discord. Whether the password was right is decided on the
        // server after Discord login — the page can't tell.
        const callbackUrl = `${window.location.origin}/admin/dashboard`
        await signIn('discord', { callbackUrl, redirect: true })
      } else {
        setError(data.error || 'Something went wrong. Please try again.')
        setLoading(false)
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  if (ban) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-md px-6">
          <div className="bg-gray-900/80 backdrop-blur-xl border border-red-500/30 rounded-2xl p-8 shadow-2xl text-center">
            <h1 className="text-2xl font-bold text-white mb-3">Access blocked</h1>
            <p className="text-gray-300 text-sm leading-relaxed">{ban}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md px-6">
      <div className="bg-gray-900/80 backdrop-blur-xl border border-blue-500/20 rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Beluga League</h1>
          <p className="text-blue-400 text-sm">Admin Panel Access</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              placeholder="Enter admin email"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              placeholder="Enter password"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Continuing to Discord…' : 'Continue'}
          </button>
        </form>

        <p className="text-center text-gray-600 text-xs mt-6">
          Authorized personnel only · sign-ins are recorded
        </p>
      </div>
      </div>
    </div>
  )
}
