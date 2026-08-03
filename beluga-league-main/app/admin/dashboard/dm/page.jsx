'use client'

import { useEffect, useState } from 'react'
import { cx } from './dmUi'
import InboxTab from './InboxTab'
import ComposeTab from './ComposeTab'

/**
 * DM Center — the bot's direct-message hub.
 *
 *   Inbox   — live two-way conversations; read what members send the bot and
 *             reply straight from the thread.
 *   Compose — the mass-send: one message to any slice of the server.
 */
export default function DmCenterPage() {
  const [tab, setTab] = useState('inbox')
  const [unread, setUnread] = useState(0)

  // Keep the badge fresh while the Compose tab is showing too.
  useEffect(() => {
    if (tab === 'inbox') return undefined
    const load = () => fetch('/api/admin/dm/unread', { cache: 'no-store' })
      .then((r) => r.json()).then((j) => setUnread(j.unread || 0)).catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [tab])

  const TABS = [
    { id: 'inbox', label: 'Inbox', badge: unread },
    { id: 'compose', label: 'Compose', badge: 0 },
  ]

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">Discord</div>
        <h1 className="text-3xl font-black text-white mb-2">DM Center</h1>
        <p className="text-blue-100/60 text-sm">
          Read and reply to the bot&apos;s direct messages, or send one message to a whole slice of the
          server. Your text is delivered exactly as typed — Discord formatting, channel tags and emoji
          all pass through untouched.
        </p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              'relative px-4 py-2.5 text-sm font-bold transition border-b-2 -mb-px flex items-center gap-2',
              tab === t.id
                ? 'border-blue-400 text-white'
                : 'border-transparent text-white/50 hover:text-white/80'
            )}
          >
            {t.label}
            {t.badge > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'inbox' ? <InboxTab onUnreadChange={setUnread} /> : <ComposeTab />}
    </div>
  )
}
