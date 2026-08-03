'use client'

/**
 * Client-side activity capture for the admin panel.
 *
 * The server audit (lib/activityLog.js) only sees what reaches an API. This fills
 * the gap the operator actually asked for — "every click" — by recording clicks,
 * dropdown changes, form submits, page views and browser crashes, then beaconing
 * them to /api/admin/higgenlogs/track in small batches.
 *
 * Deliberate boundaries:
 *   - NO keystroke logging. Text typed into inputs is never captured; only the
 *     fact that a control was used, and (for dropdowns/checkboxes) what it was
 *     set to. A password or a DM draft never leaves the page from here.
 *   - Nothing is trusted from here: the client sends structured fields and the
 *     server composes the log sentence, so this can't forge entries.
 *   - `data-log-ignore` on any element opts it and its children out.
 *
 * Mounted once, in the dashboard layout, so it covers every admin page.
 */

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const FLUSH_MS = 4000
const FLUSH_AT = 25
const MAX_QUEUE = 200
const ENDPOINT = '/api/admin/higgenlogs/track'

// Friendly page names, mirroring the dashboard nav.
const PAGE_NAMES = {
  '/admin/dashboard': 'Overview',
  '/admin/dashboard/seasons': 'Seasons',
  '/admin/dashboard/teams': 'Teams & Franchises',
  '/admin/dashboard/schedule': 'Schedule',
  '/admin/dashboard/playoffs': 'Playoffs',
  '/admin/dashboard/matches': 'Match Results',
  '/admin/dashboard/players': 'Players',
  '/admin/dashboard/transactions': 'Transactions',
  '/admin/dashboard/rankings': 'Power Rankings',
  '/admin/dashboard/mmr': 'MMR Updater',
  '/admin/dashboard/tracker-linking': 'Tracker Linking',
  '/admin/dashboard/salary': 'Salary',
  '/admin/dashboard/site-content': 'Site Content',
  '/admin/dashboard/ticket-setup': 'Ticket Setup',
  '/admin/dashboard/applications': 'Applications',
  '/admin/dashboard/weeks': 'Week Threads',
  '/admin/dashboard/notification': 'Notification',
  '/admin/dashboard/dm': 'DM Center',
  '/admin/dashboard/tickets': 'Tickets',
  '/admin/dashboard/higgenlogs': 'Audit Log',
}

function pageNameFor(pathname) {
  if (PAGE_NAMES[pathname]) return PAGE_NAMES[pathname]
  const hit = Object.keys(PAGE_NAMES)
    .filter((p) => p !== '/admin/dashboard' && pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0]
  return hit ? PAGE_NAMES[hit] : 'Admin'
}

/** The visible name of a control, preferring what a human would call it. */
function labelFor(el) {
  if (!el) return null
  const aria = el.getAttribute?.('aria-label')
  if (aria) return aria
  const title = el.getAttribute?.('title')
  if (title) return title
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
  if (text) return text.slice(0, 80)
  // Icon-only controls: fall back to whatever identifies them.
  return el.getAttribute?.('name') || el.getAttribute?.('id')
    || el.getAttribute?.('placeholder') || el.tagName?.toLowerCase() || null
}

/** Which kind of control was used, in words the log can print. */
function kindFor(el) {
  const tag = el.tagName?.toLowerCase()
  const role = el.getAttribute?.('role')
  const type = el.getAttribute?.('type')
  if (role === 'tab') return 'tab'
  if (tag === 'a') return 'link'
  if (tag === 'select') return 'select'
  if (tag === 'form') return 'form'
  if (type === 'checkbox') return 'checkbox'
  if (type === 'radio') return 'radio'
  if (tag === 'button' || role === 'button') {
    return el.getAttribute?.('aria-pressed') !== null ? 'toggle' : 'button'
  }
  return tag || 'control'
}

/**
 * Which part of the page this happened in — an explicit `data-log-section`, else
 * the nearest heading above it. Turns "clicked Delete" into "clicked Delete in the
 * Week Threads section", which is the difference between a log and evidence.
 */
function sectionFor(el) {
  const tagged = el.closest?.('[data-log-section]')
  if (tagged) return tagged.getAttribute('data-log-section')

  let node = el
  for (let depth = 0; node && depth < 8; depth += 1) {
    const container = node.closest?.('section, fieldset, form, [data-panel], article')
    if (!container) break
    const heading = container.querySelector?.('h1, h2, h3, h4, legend')
    const text = (heading?.textContent || '').replace(/\s+/g, ' ').trim()
    if (text) return text.slice(0, 100)
    node = container.parentElement
  }

  // No container — walk backwards for the closest preceding heading.
  let prev = el
  for (let hops = 0; prev && hops < 40; hops += 1) {
    prev = prev.previousElementSibling || prev.parentElement
    if (!prev) break
    if (/^H[1-4]$/.test(prev.tagName || '')) {
      const text = (prev.textContent || '').replace(/\s+/g, ' ').trim()
      if (text) return text.slice(0, 100)
    }
  }
  return null
}

export default function ActivityTracker() {
  const pathname = usePathname()
  const queue = useRef([])
  const timer = useRef(null)
  const pathRef = useRef(pathname)
  pathRef.current = pathname

  useEffect(() => {
    const send = (useBeacon = false) => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null }
      if (queue.current.length === 0) return
      const now = Date.now()
      const events = queue.current.splice(0, MAX_QUEUE).map((e) => {
        const { ts, ...rest } = e
        return { ...rest, age: now - ts }
      })
      const body = JSON.stringify({ events })
      try {
        if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
        } else {
          fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
          }).catch(() => {})
        }
      } catch { /* recording must never break the page */ }
    }

    const push = (event) => {
      if (queue.current.length >= MAX_QUEUE) return
      queue.current.push({ ...event, ts: Date.now(), page: pathRef.current, pageName: pageNameFor(pathRef.current) })
      if (queue.current.length >= FLUSH_AT) { send(); return }
      if (!timer.current) timer.current = setTimeout(() => send(), FLUSH_MS)
    }

    const targetFrom = (rawTarget) => {
      const el = rawTarget?.closest?.(
        'button, a, [role="tab"], [role="button"], input[type="checkbox"], input[type="radio"], label, summary'
      )
      if (!el) return null
      if (el.closest('[data-log-ignore]')) return null
      return el
    }

    const onClick = (ev) => {
      try {
        const el = targetFrom(ev.target)
        if (!el) return
        push({
          t: 'click',
          kind: kindFor(el),
          label: labelFor(el),
          section: sectionFor(el),
          href: el.tagName?.toLowerCase() === 'a' ? el.getAttribute('href') : null,
        })
      } catch { /* ignore */ }
    }

    const onChange = (ev) => {
      try {
        const el = ev.target
        if (!el || el.closest?.('[data-log-ignore]')) return
        const tag = el.tagName?.toLowerCase()
        const type = el.getAttribute?.('type')
        // Only controls with a CHOICE. Free-text inputs are never captured —
        // no keystroke logging, so drafts and secrets stay on the page.
        if (tag !== 'select' && type !== 'checkbox' && type !== 'radio') return
        const value = tag === 'select'
          ? (el.selectedOptions?.[0]?.textContent || el.value)
          : (el.checked ? 'on' : 'off')
        push({
          t: 'change',
          kind: kindFor(el),
          label: labelFor(el.closest('label') || el) || el.name || el.id,
          section: sectionFor(el),
          value,
        })
      } catch { /* ignore */ }
    }

    const onSubmit = (ev) => {
      try {
        const el = ev.target
        if (!el || el.closest?.('[data-log-ignore]')) return
        push({ t: 'submit', kind: 'form', label: sectionFor(el) || el.getAttribute?.('name') || 'form', section: sectionFor(el) })
      } catch { /* ignore */ }
    }

    const onError = (ev) => {
      try {
        push({ t: 'client_error', message: ev?.message || String(ev?.error || 'Unknown error'), stack: ev?.error?.stack || null })
        send()
      } catch { /* ignore */ }
    }

    const onRejection = (ev) => {
      try {
        const reason = ev?.reason
        push({
          t: 'client_error',
          message: reason?.message || String(reason || 'Unhandled promise rejection'),
          stack: reason?.stack || null,
        })
        send()
      } catch { /* ignore */ }
    }

    const onHidden = () => { if (document.visibilityState === 'hidden') send(true) }
    const onPageHide = () => send(true)

    document.addEventListener('click', onClick, true)
    document.addEventListener('change', onChange, true)
    document.addEventListener('submit', onSubmit, true)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('change', onChange, true)
      document.removeEventListener('submit', onSubmit, true)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onPageHide)
      send(true)
    }
  }, [])

  // Every navigation is a page view — "who went looking at what, and when".
  useEffect(() => {
    if (!pathname) return
    queue.current.push({
      t: 'page_view', ts: Date.now(), page: pathname, pageName: pageNameFor(pathname),
    })
  }, [pathname])

  return null
}
