"use client";

import { useState, useEffect } from 'react';

/**
 * A custom React hook that provides information about the current viewport size
 * and common media query breakpoints.
 * 
 * @returns {Object} An object containing:
 *   - isMobile: boolean - True if screen width is < 640px
 *   - isTablet: boolean - True if screen width is >= 640px and < 1024px
 *   - isDesktop: boolean - True if screen width is >= 1024px
 *   - windowWidth: number - Current window width
 *   - windowHeight: number - Current window height
 *   - orientation: string - 'portrait' or 'landscape'
 *   - isSSR: boolean - True if running during server-side rendering
 */
export default function useMediaQuery() {
  // Check if we're in a browser environment
  const isClient = typeof window === 'object';
  
  // Initialize with sensible defaults for SSR
  const [state, setState] = useState({
    windowWidth: isClient ? window.innerWidth : 1024,
    windowHeight: isClient ? window.innerHeight : 768,
    isSSR: !isClient
  });
  
  // Handle hydration mismatch by only setting derived values after mount
  const [hasMounted, setHasMounted] = useState(false);
  
  useEffect(() => {
    setHasMounted(true);
    
    if (!isClient) return;
    
    // Set initial values
    setState({
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      isSSR: false
    });
    
    // Debounced resize handler for performance
    const handleResize = () => {
      // Use requestAnimationFrame to limit updates during rapid resizing
      window.requestAnimationFrame(() => {
        setState({
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
          isSSR: false
        });
      });
    };
    
    // Add event listeners
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    // Clean up
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [isClient]);
  
  // Only calculate these values on the client after mounting to prevent hydration mismatch
  const derivedValues = hasMounted && isClient ? {
    isMobile: state.windowWidth < 640,
    isTablet: state.windowWidth >= 640 && state.windowWidth < 1024,
    isDesktop: state.windowWidth >= 1024,
    orientation: state.windowWidth > state.windowHeight ? 'landscape' : 'portrait'
  } : {
    // Safe defaults for SSR
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    orientation: 'landscape'
  };
  
  return {
    ...state,
    ...derivedValues
  };
}
