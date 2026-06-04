"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';

function hashMessage(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

export default function NotificationBar() {
  const [isVisible, setIsVisible] = useState(false);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    fetch('/api/public/notification', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const n = d?.notification;
        if (!n || !n.enabled || !n.message) return;
        setConfig(n);
        // Dismissal keyed to the message text so a NEW message re-shows even if a
        // previous one was dismissed.
        const key = 'notif_dismissed_' + hashMessage(n.message);
        if (localStorage.getItem(key) !== 'true') setIsVisible(true);
      })
      .catch(() => {});
  }, []);

  const dismiss = () => {
    setIsVisible(false);
    if (config?.message) {
      localStorage.setItem('notif_dismissed_' + hashMessage(config.message), 'true');
    }
  };

  if (!isVisible || !config) return null;
  const message = config.message;
  const href = config.href || '/players';

  const renderMessage = () => {
    const parts = message.split(/(Player Directory)/g);
    return parts.map((part, i) =>
      part === 'Player Directory' ? (
        <span key={i} className="font-bold text-blue-200 underline decoration-blue-400/60 underline-offset-2">
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  return (
    <div className="relative overflow-hidden bg-gradient-to-r from-blue-950 via-blue-800 to-blue-950 text-white border-b border-blue-400/30">
      {/* Animated shimmer */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-400/10 to-transparent animate-shimmer pointer-events-none" />

      {/* Top hairline */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-300/60 to-transparent" />

      <div className="container mx-auto px-4 py-2.5 relative">
        <div className="flex items-center justify-between gap-4">
          <Link href={href} className="group flex items-center gap-3 flex-1 min-w-0">
            {/* Badge pill */}
            <div className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-400/20 border border-blue-300/40 backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-pulse" />
              <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-blue-100 hidden sm:inline">
                New
              </span>
              <svg className="sm:hidden h-3 w-3 text-blue-200" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
              </svg>
            </div>

            {/* Message */}
            <div className="flex-1 min-w-0 text-xs sm:text-sm text-white/90 group-hover:text-white transition-colors truncate">
              {renderMessage()}
            </div>

            {/* Arrow */}
            <span className="hidden sm:inline text-blue-300 font-bold text-sm group-hover:translate-x-1 transition-transform">
              →
            </span>
          </Link>

          {/* Close */}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dismiss();
            }}
            className="flex-shrink-0 p-1.5 rounded-lg hover:bg-white/10 transition-colors text-blue-200/70 hover:text-white"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
