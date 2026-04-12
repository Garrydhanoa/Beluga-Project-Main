"use client"

import { useState, useEffect, useRef } from 'react'
import DOMPurify from 'dompurify'
import { motion } from 'framer-motion'

const PUBLISHED_DOC_URL =
  'https://docs.google.com/document/d/e/2PACX-1vTBi5BDycuXzBnOgE3oCZxxw9cHmkgcXdDqo3Norz-7HslR7JzYh3GTCMASTMT4zz_OukqF1Qo78OPb/pub'

function FadeIn({ children, delay = 0, y = 20, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export default function RulebookPage() {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [toc, setToc] = useState([])
  const [activeSection, setActiveSection] = useState('')
  const [mobileTocOpen, setMobileTocOpen] = useState(false)

  const contentRef = useRef(null)
  const tocRef = useRef(null)

  // ---- Fetch the published Google Doc ----
  useEffect(() => {
    let cancelled = false

    async function fetchDoc() {
      try {
        setLoading(true)
        setError(false)
        const response = await fetch(PUBLISHED_DOC_URL)
        const html = await response.text()

        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')

        // Prefer the main content container used by Google Docs
        const contentDiv = doc.querySelector('.doc-content')
        let extracted = ''
        if (contentDiv) {
          extracted = contentDiv.innerHTML
        } else {
          // Fallback: grab whatever looks like the contents body
          const match = doc.body.innerHTML.match(
            /<div[^>]*id=['"]contents['"][^>]*>([\s\S]*?)<\/div>/i
          )
          if (match && match[1]) extracted = match[1]
        }

        if (!extracted) throw new Error('Empty content')
        const clean = DOMPurify.sanitize(extracted)
        if (!cancelled) setContent(clean)
      } catch (err) {
        console.error('Error fetching rulebook:', err)
        if (!cancelled) {
          setError(true)
          setContent('')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchDoc()
    return () => { cancelled = true }
  }, [])

  // ---- Extract headings, build TOC, watch scroll ----
  useEffect(() => {
    if (!content || !contentRef.current) return

    const headings = contentRef.current.querySelectorAll('h1, h2, h3')
    const items = []
    headings.forEach((heading, i) => {
      const id = `section-${i}`
      heading.id = id
      const level = parseInt(heading.tagName.substring(1), 10)
      items.push({
        id,
        text: heading.textContent || `Section ${i + 1}`,
        level,
      })
    })
    setToc(items)

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) {
          const mostVisible = visible.reduce((prev, curr) =>
            prev.intersectionRatio > curr.intersectionRatio ? prev : curr
          )
          setActiveSection(mostVisible.target.id)
        }
      },
      { rootMargin: '-100px 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
    )
    headings.forEach((h) => observer.observe(h))
    return () => observer.disconnect()
  }, [content])

  // Auto-scroll the TOC sidebar so the active link stays visible
  useEffect(() => {
    if (!tocRef.current || !activeSection) return
    const active = tocRef.current.querySelector(`[data-section="${activeSection}"]`)
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [activeSection])

  function scrollToSection(id) {
    const el = document.getElementById(id)
    if (!el) return
    const offset = el.getBoundingClientRect().top + window.scrollY - 100
    window.scrollTo({ top: offset, behavior: 'smooth' })
    setActiveSection(id)
    el.classList.add('flash-highlight')
    setTimeout(() => el.classList.remove('flash-highlight'), 1000)
    setMobileTocOpen(false)
  }

  return (
    <div className="relative text-white overflow-hidden">
      {/* ============ HERO ============ */}
      <section className="container mx-auto px-4 pt-16 pb-10">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 backdrop-blur-sm mb-6">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-xs text-blue-200 font-medium tracking-[0.2em] uppercase">
                Official · Season 9
              </span>
            </div>
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight mb-4 leading-[0.95]">
              <span className="block text-white">League</span>
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-200 via-blue-300 to-blue-500 drop-shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                Rulebook
              </span>
            </h1>
            <p className="text-base md:text-lg text-blue-100/70 max-w-xl mx-auto">
              Everything you need to know about competing in the Beluga League. Rules, formats, penalties, and more.
            </p>
          </div>
        </FadeIn>
      </section>

      {/* ============ CONTENT + TOC ============ */}
      <section className="container mx-auto px-4 pb-24 max-w-6xl">
        {/* Mobile TOC toggle */}
        {toc.length > 0 && (
          <button
            className="lg:hidden w-full mb-4 py-3 px-4 bg-white/[0.03] hover:bg-blue-500/10 border border-white/10 hover:border-blue-400/40 rounded-xl flex items-center justify-between transition-colors"
            onClick={() => setMobileTocOpen(!mobileTocOpen)}
          >
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-blue-200">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              Table of Contents
              <span className="text-[10px] font-bold text-blue-300/60">({toc.length})</span>
            </span>
            <svg
              className={`w-4 h-4 text-blue-300 transform transition-transform ${mobileTocOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="w-12 h-12 rounded-full border-2 border-blue-500/30 border-t-blue-400 animate-spin mb-4" />
            <p className="text-sm text-blue-200/60 tracking-wider">Loading rulebook…</p>
          </div>
        ) : error ? (
          <div className="text-center py-20 max-w-xl mx-auto">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-500/10 border border-blue-400/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold mb-2">Unable to load the rulebook</h2>
            <p className="text-sm text-blue-200/60 mb-6">
              Something went wrong fetching the document. You can view it directly on Google Docs instead.
            </p>
            <a
              href={PUBLISHED_DOC_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-blue-500 hover:bg-blue-400 text-white font-bold text-sm shadow-[0_0_25px_rgba(59,130,246,0.4)] transition"
            >
              Open Rulebook
              <span>↗</span>
            </a>
          </div>
        ) : (
          <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-8">
            {/* ---- TOC sidebar (desktop) ---- */}
            {toc.length > 0 && (
              <aside className="hidden lg:block">
                <div
                  ref={tocRef}
                  className="sticky top-6 max-h-[calc(100vh-60px)] overflow-y-auto toc-container rounded-2xl bg-white/[0.03] border border-white/10 p-5"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">
                      Contents
                    </span>
                    <div className="flex-1 h-px bg-gradient-to-r from-blue-400/30 to-transparent" />
                  </div>
                  <TocList toc={toc} activeSection={activeSection} onClick={scrollToSection} />
                </div>
              </aside>
            )}

            {/* ---- TOC sidebar (mobile, slide-down) ---- */}
            {toc.length > 0 && mobileTocOpen && (
              <div className="lg:hidden mb-4 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/10 p-5 shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">
                    Contents
                  </span>
                  <button
                    onClick={() => setMobileTocOpen(false)}
                    className="text-blue-300/60 hover:text-blue-200 p-1"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
                <div className="max-h-[50vh] overflow-y-auto toc-container">
                  <TocList toc={toc} activeSection={activeSection} onClick={scrollToSection} />
                </div>
              </div>
            )}

            {/* ---- Content ---- */}
            <div>
              <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-8 md:p-12">
                <div
                  ref={contentRef}
                  className="rulebook-content text-blue-100/85 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: content }}
                />
              </div>

              {/* View on Docs link at the end */}
              <div className="mt-6 flex justify-center">
                <a
                  href={PUBLISHED_DOC_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 hover:border-blue-400/50 text-white/70 hover:text-blue-200 text-sm font-semibold transition"
                >
                  View Source Document
                  <span>↗</span>
                </a>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ============ CONTENT STYLING ============ */}
      <style jsx global>{`
        /* TOC scrollbar */
        .toc-container::-webkit-scrollbar {
          width: 4px;
        }
        .toc-container::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 10px;
        }
        .toc-container::-webkit-scrollbar-thumb {
          background: rgba(96, 165, 250, 0.35);
          border-radius: 10px;
        }
        .toc-container::-webkit-scrollbar-thumb:hover {
          background: rgba(96, 165, 250, 0.6);
        }

        /* Flash highlight on section jump */
        @keyframes flash-highlight {
          0% { background-color: rgba(96, 165, 250, 0); }
          30% { background-color: rgba(96, 165, 250, 0.18); }
          100% { background-color: rgba(96, 165, 250, 0); }
        }
        .flash-highlight {
          animation: flash-highlight 1.5s ease-out;
          border-radius: 6px;
        }

        /* Rulebook content typography — blue-only, clean, editorial */
        .rulebook-content {
          font-size: 15px;
        }
        .rulebook-content h1,
        .rulebook-content h2,
        .rulebook-content h3 {
          scroll-margin-top: 120px;
          font-weight: 900;
          letter-spacing: -0.015em;
          color: #ffffff;
        }
        .rulebook-content h1 {
          font-size: 2rem;
          margin-top: 3rem;
          margin-bottom: 1.25rem;
          padding-bottom: 0.5rem;
          background-image: linear-gradient(90deg, #bfdbfe, #60a5fa, #3b82f6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          border-bottom: 1px solid rgba(96, 165, 250, 0.2);
        }
        .rulebook-content h1:first-child {
          margin-top: 0;
        }
        .rulebook-content h2 {
          font-size: 1.4rem;
          margin-top: 2rem;
          margin-bottom: 0.75rem;
          color: #bfdbfe;
        }
        .rulebook-content h3 {
          font-size: 1.125rem;
          margin-top: 1.5rem;
          margin-bottom: 0.5rem;
          color: #93c5fd;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .rulebook-content p {
          margin-bottom: 1rem;
          color: rgba(219, 234, 254, 0.85);
        }
        .rulebook-content ul,
        .rulebook-content ol {
          margin-bottom: 1rem;
          padding-left: 1.5rem;
        }
        .rulebook-content li {
          margin-bottom: 0.35rem;
          color: rgba(219, 234, 254, 0.85);
        }
        .rulebook-content ul li::marker {
          color: #60a5fa;
        }
        .rulebook-content ol li::marker {
          color: #60a5fa;
          font-weight: 700;
        }
        .rulebook-content a {
          color: #60a5fa;
          text-decoration: underline;
          text-decoration-color: rgba(96, 165, 250, 0.4);
          text-underline-offset: 3px;
          transition: color 0.2s;
        }
        .rulebook-content a:hover {
          color: #93c5fd;
          text-decoration-color: rgba(147, 197, 253, 0.8);
        }
        .rulebook-content strong {
          color: #ffffff;
          font-weight: 700;
        }
        .rulebook-content em {
          color: #bfdbfe;
        }
        .rulebook-content hr {
          margin: 2rem 0;
          border: none;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(96, 165, 250, 0.3), transparent);
        }
        .rulebook-content blockquote {
          margin: 1.25rem 0;
          padding: 0.75rem 1rem;
          border-left: 3px solid #60a5fa;
          background: rgba(59, 130, 246, 0.05);
          color: rgba(219, 234, 254, 0.9);
          border-radius: 0 8px 8px 0;
        }
        .rulebook-content table {
          width: 100%;
          margin: 1.25rem 0;
          border-collapse: collapse;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          overflow: hidden;
        }
        .rulebook-content th {
          background: rgba(59, 130, 246, 0.1);
          color: #bfdbfe;
          font-weight: 700;
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.1em;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(96, 165, 250, 0.2);
          text-align: left;
        }
        .rulebook-content td {
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          color: rgba(219, 234, 254, 0.85);
        }
        .rulebook-content tr:hover td {
          background: rgba(59, 130, 246, 0.04);
        }
        .rulebook-content code {
          padding: 2px 6px;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(96, 165, 250, 0.25);
          border-radius: 4px;
          font-family: ui-monospace, monospace;
          font-size: 0.875em;
          color: #93c5fd;
        }
      `}</style>
    </div>
  )
}

// ====================================================================
// TOC list (shared between desktop + mobile)
// ====================================================================

function TocList({ toc, activeSection, onClick }) {
  return (
    <nav className="space-y-0.5">
      {toc.map((item) => {
        const active = activeSection === item.id
        return (
          <button
            key={item.id}
            data-section={item.id}
            onClick={() => onClick(item.id)}
            className={`group relative w-full text-left py-2 px-3 rounded-lg text-xs transition-all ${
              item.level === 1 ? 'font-bold' : item.level === 2 ? 'pl-6 font-medium' : 'pl-9 font-normal'
            } ${
              active
                ? 'bg-blue-500/15 border border-blue-400/40 text-blue-100'
                : 'border border-transparent text-blue-200/60 hover:text-blue-200 hover:bg-white/5'
            }`}
          >
            {/* Level indicators */}
            {item.level === 2 && (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-blue-400/60" />
            )}
            {item.level === 3 && (
              <span className="absolute left-5 top-1/2 -translate-y-1/2 w-0.5 h-0.5 rounded-full bg-blue-400/50" />
            )}
            <span className="block truncate">{item.text}</span>
          </button>
        )
      })}
    </nav>
  )
}
