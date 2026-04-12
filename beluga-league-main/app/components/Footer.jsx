"use client"

import Link from 'next/link';
import ImageWithFallback from './ImageWithFallback';

const QUICK_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Schedules', href: '/schedules' },
  { label: 'Standings', href: '/standings' },
  { label: 'Power Rankings', href: '/power-rankings' },
  { label: 'Player Directory', href: '/players' },
  { label: 'Rulebook', href: '/rulebook' },
];

const SOCIALS = [
  {
    label: 'Discord',
    href: 'https://discord.gg/4J4c79hawF',
    path: 'M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z',
  },
  {
    label: 'YouTube',
    href: 'https://youtube.com',
    path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  },
  {
    label: 'Twitter',
    href: 'https://twitter.com',
    path: 'M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723 10.054 10.054 0 01-3.127 1.184 4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z',
  },
  {
    label: 'TikTok',
    href: 'https://tiktok.com/@belaguerl',
    path: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
  },
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
                  className="group w-10 h-10 rounded-xl bg-white/[0.03] border border-white/10 hover:bg-blue-500/20 hover:border-blue-400/60 flex items-center justify-center transition-all hover:-translate-y-0.5 hover:shadow-[0_0_20px_rgba(59,130,246,0.4)]"
                >
                  <svg
                    className="w-5 h-5 text-blue-200/70 group-hover:text-blue-200 transition-colors"
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
          <a
            href="https://veloxstudios.com"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2 text-blue-100/50 hover:text-blue-200 transition-colors"
          >
            <span className="tracking-wider uppercase text-[10px]">Coded by</span>
            <span className="relative font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-blue-500 group-hover:from-blue-200 group-hover:to-blue-400 transition-all">
              VELOX STUDIOS
              <span className="absolute left-0 right-0 -bottom-0.5 h-px bg-gradient-to-r from-blue-400/0 via-blue-400/60 to-blue-400/0 scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
            </span>
          </a>
        </div>
      </div>
    </footer>
  );
}
