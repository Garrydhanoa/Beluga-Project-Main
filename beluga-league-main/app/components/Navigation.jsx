"use client"

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ImageWithFallback from './ImageWithFallback';

const NAV_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Schedules', href: '/schedules' },
  { label: 'Standings', href: '/standings' },
  { label: 'Power Rankings', href: '/power-rankings' },
  { label: 'Players', href: '/players' },
  { label: 'Rulebook', href: '/rulebook' },
];

export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

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
              Rocket League · Season 9
            </div>
          </div>
        </Link>

        {/* Desktop Links */}
        <div className="hidden lg:flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 ${
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
        <div className="flex items-center gap-3">
          {/* Join Discord CTA (desktop) */}
          <a
            href="https://discord.gg/4J4c79hawF"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500 hover:bg-blue-400 text-white text-sm font-bold transition-all shadow-[0_0_20px_rgba(59,130,246,0.4)] hover:shadow-[0_0_30px_rgba(59,130,246,0.7)] hover:scale-105"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            Join Discord
          </a>

          {/* Mobile menu button */}
          <button
            className="mobile-menu-btn lg:hidden p-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400/40 text-white transition-all"
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
          className="mobile-nav-container lg:hidden absolute top-full left-0 right-0 bg-black/95 backdrop-blur-xl border-b border-blue-500/20 shadow-2xl animate-fadeIn"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="container mx-auto px-4 py-5">
            <div className="flex flex-col gap-1">
              {NAV_LINKS.map((link, i) => {
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

            {/* Mobile CTA */}
            <a
              href="https://discord.gg/4J4c79hawF"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-bold transition-all shadow-[0_0_25px_rgba(59,130,246,0.4)]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Join Discord
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
