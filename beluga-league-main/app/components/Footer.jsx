"use client"

import Link from 'next/link';
import ImageWithFallback from './ImageWithFallback';
import { SOCIALS } from '../../lib/socials';

const QUICK_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Schedules', href: '/schedules' },
  { label: 'Standings', href: '/standings' },
  { label: 'Power Rankings', href: '/power-rankings' },
  { label: 'Player Directory', href: '/players' },
  { label: 'Rulebook', href: '/rulebook' },
];

export default function Footer() {
  return (
    <footer className="relative mt-20 border-t border-blue-500/20 bg-gradient-to-b from-black via-blue-950/20 to-black text-white overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full bg-blue-400/5 blur-3xl pointer-events-none" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-400/50 to-transparent" />

      <div className="container mx-auto px-4 py-14 relative">
        {/* Top grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-12">
          {/* Brand column */}
          <div className="md:col-span-5">
            <Link href="/" className="group inline-flex items-center gap-3 mb-4">
              <div className="w-12 h-12 flex items-center justify-center">
                <ImageWithFallback
                  src="/logos/league_logo.png"
                  alt="Beluga League"
                  className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(59,130,246,0.6)] group-hover:drop-shadow-[0_0_20px_rgba(59,130,246,0.9)] transition-all duration-300"
                  fallback={<span className="text-white font-bold text-lg text-transparent bg-gradient-to-r from-blue-200 to-blue-400 bg-clip-text">BL</span>}
                />
              </div>
              <div>
                <div className="text-xl font-black text-white leading-none">BELUGA LEAGUE</div>
                <div className="text-[10px] tracking-[0.25em] text-blue-300/60 uppercase mt-1">
                  Est. Rocket League
                </div>
              </div>
            </Link>
            <p className="text-sm text-blue-100/60 leading-relaxed max-w-sm mb-6">
              The premier Rocket League discord community for competitive play, camaraderie, and the game we love.
            </p>
            <a
              href="https://discord.gg/4J4c79hawF"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/40 hover:border-blue-400/70 text-blue-200 text-sm font-semibold transition"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Join Discord
              <span>→</span>
            </a>
          </div>

          {/* Quick Links */}
          <div className="md:col-span-4">
            <h4 className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-5">
              Quick Links
            </h4>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-3">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="group inline-flex items-center gap-2 text-sm text-blue-100/70 hover:text-blue-200 transition-colors"
                  >
                    <span className="w-0 group-hover:w-3 h-px bg-blue-400 transition-all duration-300" />
                    <span>{link.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Socials */}
          <div className="md:col-span-3">
            <h4 className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-5">
              Follow Us
            </h4>
            <div className="flex flex-wrap gap-3">
              {SOCIALS.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="group w-10 h-10 rounded-xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.08] hover:border-white/30 flex items-center justify-center transition-all hover:-translate-y-0.5"
                  style={{ boxShadow: 'none' }}
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 0 20px ${social.color}66`; e.currentTarget.style.borderColor = `${social.color}99` }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '' }}
                >
                  <svg
                    className="w-5 h-5 opacity-80 group-hover:opacity-100 transition-opacity"
                    style={{ color: social.color }}
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d={social.path} />
                  </svg>
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-blue-400/20 to-transparent mb-6" />

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div className="text-blue-100/50">
            © {new Date().getFullYear()} Beluga League · All rights reserved.
          </div>
          <div className="group inline-flex items-center gap-2 text-blue-100/50">
            <span className="tracking-wider uppercase text-[10px]">Developed by</span>
            <span className="relative font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-cyan-300 to-indigo-400 group-hover:from-blue-200 group-hover:via-cyan-200 group-hover:to-indigo-300 transition-all">
              @garrydhanoa639
              <span className="absolute left-0 right-0 -bottom-0.5 h-px bg-gradient-to-r from-blue-400/0 via-blue-400/60 to-blue-400/0 scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
