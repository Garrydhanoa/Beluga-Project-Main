"use client"

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion, useInView, animate } from 'framer-motion';
import BackgroundDecoration from './components/BackgroundDecoration';
import TeamLogoImg from './components/TeamLogo';
import { SOCIALS } from '../lib/socials';

const FALLBACK_TEAMS = [
  { name: "6 Speed" }, { name: "Archangels" }, { name: "Aviators" },
  { name: "Clovis Esports" }, { name: "Griffins" }, { name: "Immortals" },
  { name: "InTraCate" }, { name: "Kingdom" }, { name: "Lotus" },
  { name: "Malfeasance" }, { name: "MNML" }, { name: "Panthers" },
  { name: "Sublunary" }, { name: "Surge" },
];

// Champions and stats are now fetched from /api/public/league at runtime.
// FALLBACK stats are only shown when the API call hasn't completed yet.
const FALLBACK_STATS = [
  { value: 0, label: "Teams", suffix: "" },
  { value: 0, label: "Current Season", prefix: "Season ", small: true },
  { value: 0, label: "Discord Members", suffix: "" },
  { value: 3, label: "Divisions", suffix: "" },
];

function Counter({ to, prefix = "", suffix = "", duration = 2 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, to, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.floor(v)),
    });
    return () => controls.stop();
  }, [inView, to, duration]);

  return <span ref={ref}>{prefix}{display.toLocaleString()}{suffix}</span>;
}

function FadeIn({ children, delay = 0, y = 30, className = "" }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function Home() {
  const [TEAMS, setTeams] = useState(FALLBACK_TEAMS);
  const [activeSeason, setActiveSeason] = useState(null);
  const [pastChampions, setPastChampions] = useState([]);
  const [stats, setStats] = useState(FALLBACK_STATS);
  const [championMap, setChampionMap] = useState({});

  const LEFT_TEAMS = TEAMS.slice(0, Math.ceil(TEAMS.length / 2));
  const RIGHT_TEAMS = TEAMS.slice(Math.ceil(TEAMS.length / 2));

  // Derived, DB-driven labels (no more hardcoded "Season 9").
  const seasonNum = activeSeason?.season_number;
  const seasonLabel = seasonNum ? `Season ${seasonNum}` : 'Season';

  useEffect(() => {
    fetch('/api/public/league', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data?.season) setActiveSeason(data.season);

        if (data?.teamsByDivision) {
          const all = [...(data.teamsByDivision.Majors || []), ...(data.teamsByDivision.AAA || []), ...(data.teamsByDivision.AA || [])];
          // A franchise can field a team in multiple divisions — show each
          // franchise ONCE on the homepage (dedupe by name, case-insensitive).
          const seen = new Set();
          const unique = [];
          for (const t of all) {
            const key = (t.name || '').toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push({ name: t.name, hasLogo: t.hasLogo, id: t.id });
          }
          if (unique.length > 0) setTeams(unique);
        }

        if (Array.isArray(data?.pastChampions)) {
          setPastChampions(data.pastChampions);
          // Build CHAMPION_MAP from DB: { teamName: [seasonNumbers] }
          const map = {};
          for (const ps of data.pastChampions) {
            for (const champ of Object.values(ps.byDivision || {})) {
              if (!champ.teamName) continue;
              if (!map[champ.teamName]) map[champ.teamName] = [];
              map[champ.teamName].push(ps.seasonNumber);
            }
          }
          setChampionMap(map);
        }

        if (data?.totals) {
          const seasonNum = data.season?.season_number ?? data.season?.seasonNumber;
          const memberCount = data.totals.discordMemberCount;
          setStats([
            { value: data.totals.teams, label: "Teams", suffix: "" },
            // Season is rendered smaller (it's a label, not a big count).
            { value: seasonNum || 0, label: "Current Season", prefix: seasonNum ? "Season " : "", small: true },
            {
              value: typeof memberCount === "number" ? memberCount : (data.totals.players ?? 0),
              label: "Discord Members",
              suffix: "",
            },
            { value: data.totals.divisions || 3, label: "Divisions", suffix: "" },
          ]);
        }
      })
      .catch(() => {});
  }, []);

  // Aliases so the existing JSX (uses STATS, CHAMPION_MAP, PAST_CHAMPIONS) keeps working.
  const STATS = stats;
  const CHAMPION_MAP = championMap;
  const PAST_CHAMPIONS = (pastChampions || []).flatMap((ps) =>
    Object.entries(ps.byDivision || {}).map(([division, c]) => ({
      season: ps.seasonNumber,
      year: ps.year ? String(ps.year) : '',
      team: c.teamName,
      gm: c.gmDisplayName || 'TBD',
      division,
    }))
  );

  useEffect(() => {
    TEAMS.forEach((team) => {
      const img = new Image();
      img.src = `/logos/${team.name}.png`;
    });
  }, [TEAMS]);

  return (
    <div className="relative text-white overflow-hidden">
      <BackgroundDecoration />

      {/* ============ HERO ============ */}
      <section className="relative min-h-[92vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <video
            autoPlay
            muted
            loop
            playsInline
            className="w-full h-full object-cover opacity-40"
            src="/videos/intro-video.mp4"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-blue-950/60 to-black pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.85)_85%)] pointer-events-none" />
        </div>

        <div className="relative z-10 container mx-auto px-4 text-center">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 backdrop-blur-sm mb-6">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-xs sm:text-sm text-blue-200 font-medium tracking-[0.2em]">
                {seasonLabel.toUpperCase()} · NOW LIVE
              </span>
            </div>

            <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-tight mb-6 leading-[0.9]">
              <span className="block text-white drop-shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                BELUGA
              </span>
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-200 via-blue-300 to-blue-500">
                LEAGUE
              </span>
            </h1>

            <p className="text-lg sm:text-xl md:text-2xl text-blue-100/80 max-w-2xl mx-auto mb-10 leading-relaxed">
              The home of the Beluga Rocket League. Here on our page we commit, provide, improve and support at a high and professional level. We appreciate your consideration in our competitive journey.
            </p>

            <div className="relative z-20 flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="https://discord.gg/4J4c79hawF"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2.5 px-8 py-4 bg-blue-500 hover:bg-blue-400 rounded-full font-bold text-white transition-all shadow-[0_0_30px_rgba(59,130,246,0.5)] hover:shadow-[0_0_50px_rgba(59,130,246,0.8)] hover:scale-105"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
                </svg>
                Join Discord
              </a>
              <a
                href="#teams"
                className="px-8 py-4 bg-white/5 hover:bg-white/10 backdrop-blur-sm border border-white/20 hover:border-white/40 rounded-full font-semibold text-white transition-all"
              >
                Meet the Teams →
              </a>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto"
          >
            {STATS.map((s) => (
              <div
                key={s.label}
                className="relative text-center px-4 py-5 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md hover:border-blue-400/40 hover:bg-blue-500/10 transition-colors overflow-hidden"
              >
                <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-blue-500/10 blur-2xl pointer-events-none" />
                <div className={`relative font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-300 leading-none ${s.small ? 'text-2xl md:text-3xl pt-1.5 md:pt-2.5' : 'text-4xl md:text-5xl'}`}>
                  <Counter to={s.value} prefix={s.prefix} suffix={s.suffix} />
                </div>
                <div className="relative text-[10px] md:text-xs uppercase tracking-[0.25em] text-blue-300/70 mt-2">
                  {s.label}
                </div>
                {s.sub && (
                  <div className="relative mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold text-blue-200/80">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    {s.sub}
                  </div>
                )}
              </div>
            ))}
          </motion.div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 hidden sm:block">
          <div className="w-6 h-10 border-2 border-white/30 rounded-full flex items-start justify-center p-1.5">
            <motion.div
              animate={{ y: [0, 12, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              className="w-1 h-2 bg-white/60 rounded-full"
            />
          </div>
        </div>
      </section>

      {/* ============ ABOUT SECTION ============ */}
      <section className="container mx-auto px-4 py-24">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* LEFT — Quote + Differentiators */}
          <FadeIn>
            <div className="relative p-8 md:p-10 rounded-2xl bg-gradient-to-br from-blue-500/10 via-blue-900/10 to-blue-950/20 border border-blue-400/20 backdrop-blur-sm overflow-hidden">
              <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-blue-500/15 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-20 -left-20 w-52 h-52 rounded-full bg-blue-400/10 blur-3xl pointer-events-none" />

              {/* Quote */}
              <div className="relative">
                <div className="absolute -inset-4 bg-blue-500/5 blur-2xl rounded-full pointer-events-none" />
                <svg
                  className="relative h-14 w-14 text-blue-400/50 mb-3 drop-shadow-[0_0_20px_rgba(59,130,246,0.4)]"
                  fill="currentColor"
                  viewBox="0 0 32 32"
                  aria-hidden="true"
                >
                  <path d="M9.333 8C5.467 8 2.667 11.067 2.667 14.933c0 3.867 2.8 6.667 6.666 6.667.667 0 1.2-.133 1.734-.267-.8 2.8-3.067 4.934-6 5.334l.666 1.866c4.534-.666 8.267-4.533 8.267-9.6V14.933C13.867 11.067 13.2 8 9.333 8zm13.334 0C18.8 8 16 11.067 16 14.933c0 3.867 2.8 6.667 6.667 6.667.666 0 1.2-.133 1.733-.267-.8 2.8-3.067 4.934-6 5.334l.667 1.866C23.6 27.867 27.333 24 27.333 18.933V14.933C27.2 11.067 26.533 8 22.667 8z" />
                </svg>
                <p className="relative text-2xl md:text-[1.75rem] font-semibold text-white leading-[1.3] tracking-tight">
                  We built Beluga because every player deserves the opportunity to compete, be recognized, and feel like they&apos;re playing at{' '}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-200 to-blue-400">
                    the highest level
                  </span>
                  , regardless of rank.
                </p>
                <div className="relative mt-6 flex items-center gap-3">
                  <div className="flex-shrink-0 w-11 h-11 rounded-full bg-gradient-to-br from-blue-400 to-blue-700 flex items-center justify-center text-white font-bold text-sm shadow-[0_0_20px_rgba(59,130,246,0.4)]">
                    TR
                  </div>
                  <div>
                    <div className="text-sm font-bold text-blue-100">Tranq</div>
                    <div className="text-[10px] text-blue-300/70 tracking-[0.2em] uppercase">Beluga League</div>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="relative my-8 h-px bg-gradient-to-r from-transparent via-blue-400/30 to-transparent" />

              {/* Differentiators */}
              <div className="relative space-y-4">
                {[
                  {
                    title: "Professional Broadcasts",
                    desc: "Casted matches with live graphics every week.",
                    icon: (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    ),
                  },
                  {
                    title: "Custom Stats Tracking",
                    desc: "Full player dashboards, match histories, power rankings.",
                    icon: (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    ),
                  },
                  {
                    title: "Drafted Rosters",
                    desc: "Real teams, real GMs — no pickup squads.",
                    icon: (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    ),
                  },
                  {
                    title: "Dedicated Staff",
                    desc: "Active moderation keeping the league healthy.",
                    icon: (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    ),
                  },
                  {
                    title: "Community Events",
                    desc: "Tournaments, draft nights, and meetups between seasons.",
                    icon: (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    ),
                  },
                  {
                    title: "Open to All Ranks",
                    desc: "Six divisions — from Rookie to Grand Champion.",
                    icon: (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    ),
                  },
                ].map((item, i) => (
                  <motion.div
                    key={item.title}
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 + i * 0.06, duration: 0.4 }}
                    className="group flex items-start gap-4"
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-400/30 flex items-center justify-center group-hover:bg-blue-500/20 group-hover:border-blue-400/60 transition">
                      <svg className="h-5 w-5 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        {item.icon}
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-white">{item.title}</div>
                      <div className="text-xs text-blue-200/60 mt-0.5 leading-relaxed">{item.desc}</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </FadeIn>

          {/* RIGHT — Headline + Copy */}
          <FadeIn delay={0.15}>
            <div>
              <div className="inline-block px-3 py-1 rounded-full bg-blue-500/10 border border-blue-400/30 text-[10px] font-medium text-blue-300 tracking-[0.2em] uppercase mb-4">
                Why Beluga
              </div>
              <h2 className="text-4xl md:text-5xl font-black mb-6 leading-[1.05]">
                A League for Every Rank,{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-200 to-blue-400">
                  Every Player
                </span>
              </h2>
              <div className="space-y-4 text-lg text-blue-100/80 leading-relaxed">
                <p>
                  Beluga isn&apos;t just a regular discord league. We run full seasons with competitive rosters, casted matches, custom stats, and a community that&apos;s here for one another.
                </p>
                <p>
                  From first-time competitors to seasoned veterans, this is where players come to prove themselves.
                </p>
                <p>
                  We strive for respect amongst all our members, and something we take very seriously. Everyone should feel welcome and excited to be a part of the community.
                </p>
              </div>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="https://discord.gg/4J4c79hawF"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-blue-500 hover:bg-blue-400 font-semibold text-white transition shadow-[0_0_25px_rgba(59,130,246,0.4)] hover:shadow-[0_0_40px_rgba(59,130,246,0.7)]"
                >
                  Join the Community →
                </a>
                <Link
                  href="/rulebook"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white/5 hover:bg-white/10 border border-white/20 hover:border-white/40 font-semibold transition"
                >
                  Rulebook
                </Link>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ============ TEAMS GRID ============ */}
      <section id="teams" className="container mx-auto px-4 py-24 scroll-mt-24">
        <FadeIn>
          <div className="text-center mb-14">
            <div className="inline-block px-3 py-1 rounded-full bg-blue-500/10 border border-blue-400/30 text-[10px] font-medium text-blue-300 tracking-[0.2em] uppercase mb-4">
              {seasonLabel} Rosters
            </div>
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              Meet the{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-200 to-blue-400">
                teams
              </span>
            </h2>
            <p className="text-lg text-blue-100/70">{TEAMS.length} organizations competing this season.</p>
          </div>
        </FadeIn>

        {/* Desktop bracket */}
        <div className="hidden md:block max-w-7xl mx-auto">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-10 lg:gap-16 items-center">
            {/* LEFT COLUMN */}
            <div className="flex flex-col gap-4">
              {LEFT_TEAMS.map((team, i) => {
                const wins = CHAMPION_MAP[team.name] || [];
                return (
                  <FadeIn key={team.name} delay={i * 0.05} y={0}>
                    <Link
                      href={`/teams/${encodeURIComponent(team.name)}`}
                      className="group relative flex items-center gap-4 px-5 py-4 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-blue-400/60 hover:bg-blue-500/10 transition-all duration-300 hover:-translate-x-1.5"
                    >
                      <div className="w-14 h-14 flex-shrink-0 flex items-center justify-center">
                        <TeamLogoImg
                          name={team.name}
                          hasDbLogo={team.hasLogo}
                          className="max-w-full max-h-full"
                          imgClassName="max-w-full max-h-full object-contain drop-shadow-lg group-hover:scale-110 transition-transform"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-lg font-bold text-white/90 group-hover:text-blue-200 transition-colors truncate">
                          {team.name}
                        </div>
                        {wins.length > 0 && (
                          <div className="text-[10px] text-blue-300/60 tracking-wider uppercase mt-0.5 truncate font-semibold">
                            {wins.map((s) => `S${s}`).join(' · ')} Champion
                          </div>
                        )}
                      </div>
                      {wins.length > 0 && (
                        <div
                          title={`${wins.length}× Champion`}
                          className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-400/15 border border-blue-300/40 group-hover:bg-blue-400/25 group-hover:border-blue-300/70 transition-all"
                        >
                          <svg className="h-3.5 w-3.5 text-blue-200" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 2h14v2H5v-2z" />
                          </svg>
                          <span className="text-xs font-black text-blue-100 leading-none">
                            ×{wins.length}
                          </span>
                        </div>
                      )}
                      <div className="text-blue-400/50 group-hover:text-blue-300 group-hover:translate-x-1 transition-all flex-shrink-0 text-xl">
                        →
                      </div>
                      {/* Bracket connector line */}
                      <div className="absolute top-1/2 -right-10 lg:-right-16 w-10 lg:w-16 h-px bg-gradient-to-r from-blue-400/60 to-blue-400/10" />
                    </Link>
                  </FadeIn>
                );
              })}
            </div>

            {/* CENTER — CHAMPION */}
            <FadeIn delay={0.2}>
              <div className="relative flex flex-col items-center">
                {/* Vertical spine lines */}
                <div className="absolute top-1/2 -left-10 lg:-left-16 w-px h-[88%] -translate-y-1/2 bg-gradient-to-b from-blue-400/20 via-blue-400/60 to-blue-400/20" />
                <div className="absolute top-1/2 -right-10 lg:-right-16 w-px h-[88%] -translate-y-1/2 bg-gradient-to-b from-blue-400/20 via-blue-400/60 to-blue-400/20" />

                {/* Champion card */}
                <div className="relative px-10 py-10 rounded-3xl bg-gradient-to-b from-blue-500/25 via-blue-700/15 to-blue-950/40 border-2 border-blue-400/50 backdrop-blur-sm shadow-[0_0_80px_rgba(59,130,246,0.4)] min-w-[260px]">
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-blue-500 shadow-lg">
                    <span className="text-xs font-bold text-white tracking-[0.2em] uppercase whitespace-nowrap">
                      {seasonLabel}
                    </span>
                  </div>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.3),transparent_70%)] rounded-3xl pointer-events-none" />

                  <svg
                    className="h-20 w-20 mx-auto mb-4 text-blue-300 drop-shadow-[0_0_16px_rgba(59,130,246,0.8)]"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v2c0 2.21 1.79 4 4 4h.19c.68 1.36 1.97 2.37 3.52 2.76V19H7v2h10v-2h-3.71v-2.24c1.55-.39 2.84-1.4 3.52-2.76H17c2.21 0 4-1.79 4-4V7c0-1.1-.9-2-2-2zM5 9V7h2v3.82C5.84 10.4 5 9.3 5 9zm14 0c0 .3-.84 1.4-2 1.82V7h2v2z" />
                  </svg>
                  <div className="text-center relative">
                    <div className="text-[10px] tracking-[0.3em] uppercase text-blue-300/70 mb-1.5">
                      Champion
                    </div>
                    <div className="text-4xl font-black text-white">TBD</div>
                  </div>
                </div>
              </div>
            </FadeIn>

            {/* RIGHT COLUMN */}
            <div className="flex flex-col gap-4">
              {RIGHT_TEAMS.map((team, i) => {
                const wins = CHAMPION_MAP[team.name] || [];
                return (
                  <FadeIn key={team.name} delay={i * 0.05} y={0}>
                    <Link
                      href={`/teams/${encodeURIComponent(team.name)}`}
                      className="group relative flex items-center gap-4 px-5 py-4 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-blue-400/60 hover:bg-blue-500/10 transition-all duration-300 hover:translate-x-1.5"
                    >
                      <div className="text-blue-400/50 group-hover:text-blue-300 group-hover:-translate-x-1 transition-all flex-shrink-0 text-xl">
                        ←
                      </div>
                      {wins.length > 0 && (
                        <div
                          title={`${wins.length}× Champion`}
                          className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-400/15 border border-blue-300/40 group-hover:bg-blue-400/25 group-hover:border-blue-300/70 transition-all"
                        >
                          <svg className="h-3.5 w-3.5 text-blue-200" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 2h14v2H5v-2z" />
                          </svg>
                          <span className="text-xs font-black text-blue-100 leading-none">
                            ×{wins.length}
                          </span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0 text-right">
                        <div className="text-lg font-bold text-white/90 group-hover:text-blue-200 transition-colors truncate">
                          {team.name}
                        </div>
                        {wins.length > 0 && (
                          <div className="text-[10px] text-blue-300/60 tracking-wider uppercase mt-0.5 truncate font-semibold">
                            {wins.map((s) => `S${s}`).join(' · ')} Champion
                          </div>
                        )}
                      </div>
                      <div className="w-14 h-14 flex-shrink-0 flex items-center justify-center">
                        <TeamLogoImg
                          name={team.name}
                          hasDbLogo={team.hasLogo}
                          className="max-w-full max-h-full"
                          imgClassName="max-w-full max-h-full object-contain drop-shadow-lg group-hover:scale-110 transition-transform"
                        />
                      </div>
                      {/* Bracket connector line */}
                      <div className="absolute top-1/2 -left-10 lg:-left-16 w-10 lg:w-16 h-px bg-gradient-to-l from-blue-400/60 to-blue-400/10" />
                    </Link>
                  </FadeIn>
                );
              })}
            </div>
          </div>
        </div>

        {/* Mobile fallback — stacked list */}
        <div className="md:hidden space-y-3">
          <div className="mb-6 mx-auto max-w-xs relative px-6 py-5 rounded-2xl bg-gradient-to-b from-blue-500/25 to-blue-950/40 border-2 border-blue-400/50 backdrop-blur-sm shadow-[0_0_40px_rgba(59,130,246,0.3)]">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-blue-500">
              <span className="text-[10px] font-bold text-white tracking-[0.2em] uppercase">{seasonLabel}</span>
            </div>
            <div className="text-center">
              <div className="text-[9px] tracking-[0.3em] uppercase text-blue-300/70 mb-1">Champion</div>
              <div className="text-xl font-black text-white">TBD</div>
            </div>
          </div>
          {TEAMS.map((team, i) => {
            const wins = CHAMPION_MAP[team.name] || [];
            return (
              <FadeIn key={team.name} delay={i * 0.03} y={10}>
                <Link
                  href={`/teams/${encodeURIComponent(team.name)}`}
                  className="group flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 hover:border-blue-400/60 transition-all"
                >
                  <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center">
                    <TeamLogoImg
                      name={team.name}
                      hasDbLogo={team.hasLogo}
                      className="max-w-full max-h-full"
                      imgClassName="max-w-full max-h-full object-contain"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white/90 group-hover:text-blue-200 transition-colors truncate">
                      {team.name}
                    </div>
                    {wins.length > 0 && (
                      <div className="text-[9px] text-blue-300/60 tracking-wider uppercase mt-0.5">
                        {wins.map((s) => `S${s}`).join(' · ')} Champion
                      </div>
                    )}
                  </div>
                  {wins.length > 0 && (
                    <div className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-400/15 border border-blue-300/40">
                      <svg className="h-3 w-3 text-blue-200" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 2h14v2H5v-2z" />
                      </svg>
                      <span className="text-[10px] font-black text-blue-100 leading-none">×{wins.length}</span>
                    </div>
                  )}
                  <div className="text-blue-400/50 flex-shrink-0">→</div>
                </Link>
              </FadeIn>
            );
          })}
        </div>

        {/* ===== LEGACY RAIL (past champions strip) ===== */}
        <FadeIn delay={0.1}>
          <div className="mt-24 max-w-7xl mx-auto">
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-4">
                <div className="w-20 h-px bg-gradient-to-r from-transparent to-blue-400/60" />
                <span className="text-xs font-bold tracking-[0.3em] uppercase text-blue-300/70">
                  League Legacy
                </span>
                <div className="w-20 h-px bg-gradient-to-l from-transparent to-blue-400/60" />
              </div>
              <p className="text-base text-blue-200/60 mt-3">
                {pastChampions.length > 0 ? `${pastChampions.length} ${pastChampions.length === 1 ? 'season' : 'seasons'} of champions.` : 'Champions of seasons past.'}
              </p>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-4">
              {PAST_CHAMPIONS.map((champ, i) => (
                <FadeIn key={champ.season} delay={0.15 + i * 0.03} y={10}>
                  <div className="group relative flex flex-col items-center gap-3 p-4 rounded-2xl hover:bg-white/[0.03] transition-all">
                    <div className="text-xs font-bold text-blue-300/60 tracking-[0.25em] uppercase">
                      S{String(champ.season).padStart(2, '0')}
                    </div>
                    <div className="relative w-20 h-20 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full bg-blue-500/0 group-hover:bg-blue-500/20 blur-xl transition-all" />
                      <img
                        src={`/logos/${champ.team}.png`}
                        alt={champ.team}
                        className="relative max-w-full max-h-full object-contain drop-shadow-lg grayscale group-hover:grayscale-0 group-hover:scale-110 transition-all duration-300 opacity-70 group-hover:opacity-100"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                    <div className="text-sm font-bold text-white/70 group-hover:text-blue-200 transition-colors truncate max-w-full text-center">
                      {champ.team}
                    </div>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section id="join" className="relative py-24 md:py-28 overflow-hidden scroll-mt-24">
        {/* Vibrant blue background */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-blue-500 to-blue-700" />
        {/* Diagonal sheen overlay */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent" />
        {/* Subtle radial highlight */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.15),transparent_60%)]" />

        <div className="container mx-auto px-4 relative">
          <FadeIn>
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="text-4xl md:text-6xl font-black text-white mb-5 leading-tight tracking-tight drop-shadow-[0_2px_20px_rgba(0,0,0,0.25)]">
                Ready to Join the League?
              </h2>
              <p className="text-base md:text-lg text-blue-50/90 mb-10 max-w-2xl mx-auto leading-relaxed">
                Join hundreds of players already competing in drafted rosters, casted matches, and real championships in the premier Rocket League community.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href="https://discord.gg/4J4c79hawF"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-blue-950 hover:bg-black text-white font-bold text-base transition-all hover:scale-105 shadow-[0_8px_30px_rgba(0,0,0,0.3)]"
                >
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
                  </svg>
                  Join Discord - Free
                </a>
                <a
                  href="#teams"
                  className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-transparent hover:bg-white/10 border-2 border-white/80 hover:border-white text-white font-bold text-base transition-all hover:scale-105"
                >
                  Meet the Teams
                </a>
              </div>

              {/* Follow us — social links */}
              <div className="mt-10 flex flex-col items-center gap-3">
                <div className="text-[10px] font-bold tracking-[0.3em] uppercase text-white/70">Follow Beluga League</div>
                <div className="flex items-center gap-3">
                  {SOCIALS.map((s) => (
                    <a
                      key={s.label}
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={s.label}
                      className="w-11 h-11 rounded-full bg-black/25 hover:bg-black/40 border border-white/30 hover:border-white flex items-center justify-center text-white transition-all hover:scale-110 hover:-translate-y-0.5"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d={s.path} />
                      </svg>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

    </div>
  );
}
