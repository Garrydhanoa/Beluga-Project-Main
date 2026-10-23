"use client"

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ImageWithFallback from './ImageWithFallback';
import { SOCIALS } from '../../lib/socials';

const NAV_SOCIALS = SOCIALS.filter((s) => s.label !== 'Discord'); // Twitch + YouTube

const NAV_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Schedules', href: '/schedules' },
  { label: 'Standings', href: '/standings' },
  { label: 'Power Rankings', href: '/power-rankings' },
  { label: 'Leaderboards', href: '/leaderboards' },
  { label: 'Seasons', href: '/seasons' },
  { label: 'Players', href: '/players' },
  { label: 'Applications', href: '/applications' },
  { label: 'Rulebook', href: '/rulebook' },
];

// Playoffs only appears when staff switch it on (admin → Playoffs → Public
// website). Inserted next to Schedules rather than appended, so the postseason
// sits with the rest of the fixtures.
const PLAYOFFS_LINK = { label: 'Playoffs', href: '/playoffs' };
const PLAYOFFS_AFTER = '/schedules';

export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [showPlayoffs, setShowPlayoffs] = useState(false);
  const pathname = usePathname();

  // This is a client component, so the flag can't be read from the DB directly.
  // Same pattern as NotificationBar: fetch, and stay hidden on any failure.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/public/site-flags', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setShowPlayoffs(Boolean(d?.playoffs)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const navLinks = showPlayoffs
    ? NAV_LINKS.flatMap((l) => (l.href === PLAYOFFS_AFTER ? [l, PLAYOFFS_LINK] : [l]))
    : NAV_LINKS;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      const target = e.target;
      if (mobileMenuOpen && !target.closest('.mobile-nav-container') && !target.closest('.mobile-menu-btn')) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [mobileMenuOpen]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const isActive = (path) => pathname === path;

  return (
    <nav
      className={`sticky top-0 z-50 w-full transition-all duration-300 ${
        scrolled
          ? 'bg-black/80 backdrop-blur-xl border-b border-blue-500/20 shadow-[0_4px_30px_rgba(0,0,0,0.5)]'
          : 'bg-black/20 backdrop-blur-md border-b border-white/5'
      }`}
    >
      {/* Top blue hairline */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-400/40 to-transparent" />

      <div
        className={`container mx-auto px-4 flex items-center justify-between transition-all duration-300 ${
          scrolled ? 'py-2' : 'py-3'
        }`}
      >
        {/* Brand */}
        <Link href="/" className="group flex items-center gap-3 flex-shrink-0">
          <div
            className={`relative flex items-center justify-center transition-all duration-300 ${
              scrolled ? 'w-10 h-10' : 'w-12 h-12'
            }`}
          >
            <div className="absolute inset-0 bg-blue-500/15 group-hover:bg-blue-500/30 blur-md transition-all duration-300" />
            <ImageWithFallback
              src="/logos/league_logo.png"
              alt="Beluga League"
              className="relative w-full h-full object-contain drop-shadow-[0_0_12px_rgba(59,130,246,0.6)] group-hover:drop-shadow-[0_0_18px_rgba(59,130,246,0.9)] group-hover:scale-110 transition-all duration-300"
              fallback={
                <span className="text-white font-bold text-lg text-transparent bg-gradient-to-r from-blue-200 to-blue-400 bg-clip-text">
                  BL
                </span>
              }
            />
          </div>
          <div className="hidden sm:block leading-none">
            <div
              className={`font-black text-white tracking-tight transition-all duration-300 ${
                scrolled ? 'text-lg' : 'text-xl md:text-2xl'
              }`}
            >
              BELUGA LEAGUE
            </div>
            <div className="text-[9px] tracking-[0.25em] text-blue-300/60 uppercase mt-1 hidden md:block">
              Rocket League
            </div>
          </div>
        </Link>

        {/* Desktop Links — only at xl+ where all 8 links fit comfortably;
            below that the hamburger menu takes over so they never cluster. */}
        <div className="hidden xl:flex items-center gap-0.5">
          {navLinks.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-300 ${
                  active
                    ? 'text-blue-200 bg-blue-500/15 border border-blue-400/30'
                    : 'text-white/80 hover:text-blue-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                {link.label}
                {active && (
                  <span className="absolute -bottom-px left-1/2 -translate-x-1/2 w-8 h-px bg-gradient-to-r from-transparent via-blue-400 to-transparent" />
                )}
              </Link>
            );
          })}
        </div>

        {/* Right side — CTA + Mobile button */}
        <div className="flex items-center gap-2.5">
          {/* Twitch + YouTube (desktop) — brand-colored icon buttons beside Discord */}
          <div className="hidden sm:flex items-center gap-1.5">
            {NAV_SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
                className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center transition-all hover:-translate-y-0.5"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${s.color}99`; e.currentTarget.style.boxShadow = `0 0 16px ${s.color}55` }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = 'none' }}
              >
                <svg className="w-4 h-4 opacity-85" style={{ color: s.color }} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d={s.path} />
                </svg>
              </a>
            ))}
          </div>

          {/* Join Discord CTA (desktop) — Discord brand color + logo */}
          <a
            href="https://discord.gg/4J4c79hawF"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#5865F2] hover:bg-[#4752C4] text-white text-sm font-bold transition-all shadow-[0_0_20px_rgba(88,101,242,0.45)] hover:shadow-[0_0_30px_rgba(88,101,242,0.75)] hover:scale-105"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
            </svg>
            Join Discord
          </a>

          {/* Mobile menu button */}
          <button
            className="mobile-menu-btn xl:hidden p-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400/40 text-white transition-all"
            onClick={(e) => {
              e.stopPropagation();
              setMobileMenuOpen(!mobileMenuOpen);
            }}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div
          className="mobile-nav-container xl:hidden absolute top-full left-0 right-0 bg-black/95 backdrop-blur-xl border-b border-blue-500/20 shadow-2xl animate-fadeIn"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="container mx-auto px-4 py-5">
            <div className="flex flex-col gap-1">
              {navLinks.map((link, i) => {
                const active = isActive(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    style={{ animationDelay: `${i * 50}ms` }}
                    className={`group flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all animate-fadeIn ${
                      active
                        ? 'bg-blue-500/15 text-blue-200 border border-blue-400/40'
                        : 'text-white/80 hover:bg-white/5 hover:text-blue-200 border border-transparent hover:border-white/10'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full transition-all ${
                        active ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]' : 'bg-white/30 group-hover:bg-blue-400'
                      }`}
                    />
                    <span className="flex-1">{link.label}</span>
                    <span className="text-blue-400/50 group-hover:translate-x-1 transition-transform">→</span>
                  </Link>
                );
              })}
            </div>

            {/* Mobile CTA — Discord brand color + logo */}
            <a
              href="https://discord.gg/4J4c79hawF"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold transition-all shadow-[0_0_25px_rgba(88,101,242,0.45)]"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
              </svg>
              Join Discord
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
