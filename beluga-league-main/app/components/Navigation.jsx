"use client"

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ImageWithFallback from './ImageWithFallback';
import useMediaQuery from '../hooks/useMediaQuery';

export default function Navigation() {
  const { isMobile } = useMediaQuery();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  
  // Close mobile menu when clicking outside or changing route
  useEffect(() => {
    const handleClickOutside = (e) => {
      const target = e.target;
      if (mobileMenuOpen && !target.closest('.mobile-nav-container')) {
        setMobileMenuOpen(false);
      }
    };
    
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [mobileMenuOpen]);
  
  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);
  
  const isActive = (path) => pathname === path;

  return (
    <nav className="w-full bg-black/30 backdrop-blur-md border-b border-white/10 sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        {/* Logo and brand name - UPDATED */}
        <div className="flex items-center">
          <Link href="/" className="flex items-center group">
            <div className="relative w-[64px] h-[64px] flex items-center justify-center">
              {/* Using a subtle glow effect instead of a circle */}
              <div className="absolute inset-0 bg-blue-500/10 group-hover:bg-blue-500/20 blur-md transition-all duration-300"></div>
              <ImageWithFallback 
                src="/logos/league_logo.png" 
                alt="Beluga League" 
                className="w-[60px] h-[60px] object-contain relative z-10 transition-transform duration-300 group-hover:scale-110 drop-shadow-[0_0_10px_rgba(59,130,246,0.6)]"
                fallback={<span className="text-white font-bold text-2xl bg-gradient-to-r from-blue-300 to-purple-400 text-transparent bg-clip-text">BL</span>}
              />
            </div>
            <div className="text-xl sm:text-2xl md:text-3xl font-bold ml-3 self-center pb-1">
              <span className="bg-gradient-to-r from-blue-300 to-purple-400 text-transparent bg-clip-text inline-block transition-all duration-300 group-hover:from-blue-200 group-hover:to-purple-300 leading-tight">
                Beluga League
              </span>
            </div>
          </Link>
        </div>
        
        {/* Mobile menu button */}
        <button 
          className="md:hidden p-3 rounded-lg bg-black/30 text-white hover:bg-black/40 transition-colors z-[999]"
          onClick={(e) => {
            e.stopPropagation();
            setMobileMenuOpen(!mobileMenuOpen);
          }}
          aria-label="Toggle menu"
          aria-expanded={mobileMenuOpen}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {mobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
        
        {/* Desktop Navigation */}
        <div className="hidden md:flex space-x-8 text-white">
          <Link
            href="/"
            className="font-medium hover:text-blue-300 transition-colors duration-300 relative group"
          >
            Home
            <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-blue-400 group-hover:w-full transition-all duration-300"></span>
          </Link>
          <Link
            href="/schedules"
            className="font-medium hover:text-blue-300 transition-colors duration-300 relative group"
          >
            Schedules
            <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-blue-400 group-hover:w-full transition-all duration-300"></span>
          </Link>
          <Link
            href="/standings"
            className="font-medium hover:text-blue-300 transition-colors duration-300 relative group"
          >
            Standings
            <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-blue-400 group-hover:w-full transition-all duration-300"></span>
          </Link>
          <Link
            href="/power-rankings"
            className="font-medium hover:text-blue-300 transition-colors duration-300 relative group"
          >
            Power Rankings
            <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-blue-400 group-hover:w-full transition-all duration-300"></span>
          </Link>
          <Link
            href="/players"
            className="font-medium hover:text-blue-300 transition-colors duration-300 relative group"
          >
            Player Directory
            <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-blue-400 group-hover:w-full transition-all duration-300"></span>
          </Link>
        </div>
      </div>
      
      {/* Mobile Navigation Menu */}
      {mobileMenuOpen && (
        <div 
          className="md:hidden mobile-nav-container fixed top-[61px] left-0 w-full h-auto bg-black/95 backdrop-blur-md z-[990] border-b border-white/10 animate-fadeIn"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="container mx-auto px-4 py-4">
            <div className="flex flex-col space-y-4">
              <Link
                href="/"
                className={`font-medium py-3 pl-4 relative rounded-md ${
                  isActive('/') ? 'bg-blue-900/30 text-blue-300' : 'hover:bg-black/40 hover:text-blue-300'
                }`}
              >
                Home
                {isActive('/') && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2/3 bg-blue-400 rounded-r"></span>}
              </Link>
              <Link
                href="/schedules"
                className={`font-medium py-3 pl-4 relative rounded-md ${
                  isActive('/schedules') ? 'bg-blue-900/30 text-blue-300' : 'hover:bg-black/40 hover:text-blue-300'
                }`}
              >
                Schedules
                {isActive('/schedules') && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2/3 bg-blue-400 rounded-r"></span>}
              </Link>
              <Link
                href="/standings"
                className={`font-medium py-3 pl-4 relative rounded-md ${
                  isActive('/standings') ? 'bg-blue-900/30 text-blue-300' : 'hover:bg-black/40 hover:text-blue-300'
                }`}
              >
                Standings
                {isActive('/standings') && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2/3 bg-blue-400 rounded-r"></span>}
              </Link>
              <Link
                href="/power-rankings"
                className={`font-medium py-3 pl-4 relative rounded-md ${
                  isActive('/power-rankings') ? 'bg-blue-900/30 text-blue-300' : 'hover:bg-black/40 hover:text-blue-300'
                }`}
              >
                Power Rankings
                {isActive('/power-rankings') && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2/3 bg-blue-400 rounded-r"></span>}
              </Link>
              <Link
                href="/players"
                className={`font-medium py-3 pl-4 relative rounded-md ${
                  isActive('/players') ? 'bg-blue-900/30 text-blue-300' : 'hover:bg-black/40 hover:text-blue-300'
                }`}
              >
                Player Directory
                {isActive('/players') && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2/3 bg-blue-400 rounded-r"></span>}
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
