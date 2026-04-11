"use client";

import React from 'react';
import useMediaQuery from '../hooks/useMediaQuery';

/**
 * ViewportDebug component - displays current viewport information
 * Only shown in development mode, can be toggled on/off
 */
export default function ViewportDebug({ show = true }) {
  const { isMobile, isTablet, isDesktop, windowWidth, windowHeight, orientation } = useMediaQuery();
  
  // Only show in development mode and when show prop is true
  if (process.env.NODE_ENV !== 'development' || !show) return null;
  
  // Get screen size label
  const getScreenSizeLabel = () => {
    if (isMobile) return 'Mobile';
    if (isTablet) return 'Tablet';
    if (isDesktop) return 'Desktop';
    return 'Unknown';
  };
  
  return (
    <div className="fixed bottom-2 left-2 z-[9999] bg-black/70 backdrop-blur-sm text-white text-xs rounded p-2 pointer-events-none select-none">
      <div className="font-mono">
        <div className={`inline-block px-1.5 py-0.5 rounded mr-1 ${
          isMobile ? 'bg-red-600' : 
          isTablet ? 'bg-yellow-600' : 
          'bg-green-600'
        }`}>
          {getScreenSizeLabel()}
        </div>
        <span>
          {windowWidth}x{windowHeight} ({orientation})
        </span>
      </div>
      <div className="mt-1 text-gray-300">
        <span className="sm:hidden">xs</span>
        <span className="hidden sm:inline md:hidden">sm</span>
        <span className="hidden md:inline lg:hidden">md</span>
        <span className="hidden lg:inline xl:hidden">lg</span>
        <span className="hidden xl:inline 2xl:hidden">xl</span>
        <span className="hidden 2xl:inline">2xl</span>
      </div>
    </div>
  );
}
