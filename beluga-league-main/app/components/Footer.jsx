"use client"

import Link from 'next/link';
import ImageWithFallback from './ImageWithFallback';

export default function Footer() {
  return (
    <footer className="bg-gradient-to-r from-black/90 via-black/80 to-black/90 text-white py-6 sm:py-8 mt-10 sm:mt-16 border-t border-white/5">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center mb-6">
          {/* Logo and brand */}
          <Link href="/" className="group">
            <div className="flex items-center mb-6 md:mb-0">
              <div className="w-14 h-14 flex items-center justify-center">
                <ImageWithFallback 
                  src="/logos/league_logo.png" 
                  alt="Beluga League" 
                  className="w-13 h-13 object-contain drop-shadow-[0_0_8px_rgba(59,130,246,0.5)] group-hover:drop-shadow-[0_0_10px_rgba(59,130,246,0.7)] transition-all duration-300"
                  fallback={<span className="text-white font-bold text-lg bg-gradient-to-r from-blue-300 to-purple-400 text-transparent bg-clip-text">BL</span>}
                />
              </div>
              <span className="text-sm sm:text-base text-blue-200 font-medium group-hover:text-blue-100 transition-colors duration-300 ml-3 self-center pb-1 leading-tight">Beluga League</span>
            </div>
          </Link>
          
          {/* Navigation Links */}
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 mb-6 md:mb-0">
            <Link href="/" className="hover:text-blue-300 font-medium">
              Home
            </Link>
            <Link href="/schedules" className="hover:text-blue-300 font-medium">
              Schedules
            </Link>
            <Link href="/standings" className="hover:text-blue-300 font-medium">
              Standings
            </Link>
            <Link href="/power-rankings" className="hover:text-blue-300 font-medium">
              Power Rankings
            </Link>
            <Link href="/players" className="hover:text-blue-300 font-medium">
              Player Directory
            </Link>
          </div>
          
          {/* Social Links */}
          <div className="flex flex-col items-center space-y-3">
            <h4 className="text-lg font-semibold text-blue-300 mb-2">Socials</h4>
            <div className="flex space-x-6">
              <a
                href="https://discord.gg/4J4c79hawF"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white hover:text-blue-300 transform hover:scale-110 transition"
                aria-label="Discord"
              >
                <svg
                  className="w-7 h-7"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
                </svg>
              </a>
              <a
                href="https://youtube.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white hover:text-red-400 transform hover:scale-110 transition"
                aria-label="YouTube"
              >
                <svg
                  className="w-7 h-7"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </a>
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white hover:text-blue-400 transform hover:scale-110 transition"
                aria-label="Twitter"
              >
                <svg
                  className="w-7 h-7"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723 10.054 10.054 0 01-3.127 1.184 4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
                </svg>
              </a>
              {/* Add TikTok */}
              <a
                href="https://tiktok.com/@belaguerl"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white hover:text-pink-400 transform hover:scale-110 transition"
                aria-label="TikTok"
              >
                <svg 
                  className="w-7 h-7" 
                  fill="currentColor" 
                  viewBox="0 0 24 24" 
                  aria-hidden="true"
                >
                  <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
                </svg>
              </a>
            </div>
          </div>
        </div>
        
        {/* Copyright */}
        <div className="text-center text-xs sm:text-sm text-gray-400 border-t border-white/5 pt-4">
          © {new Date().getFullYear()} Beluga League. All rights reserved.
        </div>
        
        {/* Developer Credit */}
        <div className="text-center mt-4 pt-3 border-t border-white/5">
          <p className="text-xs sm:text-sm text-gray-500 inline-flex items-center justify-center gap-2">
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 text-transparent bg-clip-text font-medium">
              Developed by
            </span>
            <span className="font-semibold text-blue-400">
              @garrydhanoa639
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}
