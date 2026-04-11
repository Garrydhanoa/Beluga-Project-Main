"use client";

import React, { useState, useEffect } from 'react';
import useMediaQuery from '../hooks/useMediaQuery';

export default function FloatingParticles() {
  const [particles, setParticles] = useState([]);
  const { isMobile, isTablet, isSSR } = useMediaQuery();
  const [hasMounted, setHasMounted] = useState(false);
  
  // Detect mounting to avoid hydration mismatch
  useEffect(() => {
    setHasMounted(true);
  }, []);
  
  // Generate particles after component is mounted with responsive adjustments
  useEffect(() => {
    if (!hasMounted || isSSR) return;
    
    // Determine appropriate particle count based on device
    const getParticleCount = () => {
      if (isMobile) return 8;  // Minimal particles for mobile
      if (isTablet) return 15; // Medium amount for tablets
      return 20;               // Full amount for desktop
    };
    
    // Generate new particles with device-specific settings
    const generateParticles = () => {
      const count = getParticleCount();
      
      const newParticles = Array(count).fill(0).map((_, i) => ({
        id: i,
        top: `${Math.random() * 100}%`,
        left: `${Math.random() * 100}%`,
        duration: `${isMobile ? Math.random() * 15 + 15 : Math.random() * 10 + 10}s`, // Slower animation on mobile
        delay: `${Math.random() * 5}s`,
        size: isMobile ? 0.8 : isTablet ? 1 : 1.2, // Size based on device
        opacity: isMobile ? 0.2 : 0.3 // Lower opacity on mobile for better performance
      }));
      
      setParticles(newParticles);
    };
    
    // Generate particles initially and when screen size category changes
    generateParticles();
    
  }, [isMobile, isTablet, hasMounted, isSSR]); // Regenerate when device type changes
  
  // If not mounted yet, return empty to avoid hydration mismatch
  if (!hasMounted || isSSR) {
    return <div className="absolute inset-0 pointer-events-none"></div>;
  }
  
  // Skip rendering particles on very small devices for performance
  if (isMobile && typeof window !== 'undefined' && window.innerWidth < 380) {
    return <div className="absolute inset-0 pointer-events-none"></div>;
  }
  
  return (
    <div className="absolute inset-0 pointer-events-none">
      {particles.map((particle) => (
        <div 
          key={particle.id}
          className="absolute rounded-full bg-blue-400/30 animate-float"
          style={{
            top: particle.top,
            left: particle.left,
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            animationDuration: particle.duration,
            animationDelay: particle.delay,
            opacity: particle.opacity
          }}
        ></div>
      ))}
    </div>
  );
}
