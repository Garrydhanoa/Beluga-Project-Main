'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

/**
 * Component that handles image loading gracefully, falling back to initials
 * when the image fails to load to avoid 404 errors in the console.
 */
export default function SafeTeamLogo({ 
  teamName, 
  size = 45, 
  priority = false,
  className = 'object-contain',
  containerClassName = ''
}) {
  const [imageError, setImageError] = useState(false);
  const [cachedError, setCachedError] = useState(false);
  
  // Initialize from localStorage on mount
  useEffect(() => {
    try {
      const cachedErrors = JSON.parse(localStorage.getItem('missingTeamLogos') || '{}');
      if (cachedErrors[teamName]) {
        setCachedError(true);
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [teamName]);
  
  // Get team initials for fallback
  const getInitials = () => {
    if (!teamName || typeof teamName !== 'string') return 'T';
    return teamName.split(' ')
      .map(word => word[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  };
  
  // Save to cache for future reference
  const handleImageError = () => {
    setImageError(true);
    try {
      const cachedErrors = JSON.parse(localStorage.getItem('missingTeamLogos') || '{}');
      cachedErrors[teamName] = true;
      localStorage.setItem('missingTeamLogos', JSON.stringify(cachedErrors));
    } catch (e) {
      // Ignore localStorage errors
    }
  };
  
  // Show fallback if we know the image is missing or teamName is not valid
  if (imageError || cachedError || !teamName || teamName === '[object Object]' || 
      typeof teamName !== 'string' || teamName.includes('[object Object]') || 
      teamName.includes('undefined') || teamName.includes('null')) {
    return (
      <div className={`flex items-center justify-center ${containerClassName}`}>
        <span className="font-bold text-blue-200">
          {getInitials()}
        </span>
      </div>
    );
  }
  
  // Otherwise try to load the image
  // Additional check right before rendering to prevent any issues
  if (!teamName || typeof teamName !== 'string') {
    return (
      <div className={`flex items-center justify-center ${containerClassName}`}>
        <span className="font-bold text-blue-200">
          {getInitials()}
        </span>
      </div>
    );
  }

  return (
    <div className={containerClassName}>
      <Image
        src={`/logos/${encodeURIComponent(teamName)}.png`}
        alt={teamName}
        width={size}
        height={size}
        className={className}
        onError={handleImageError}
        priority={priority}
      />
    </div>
  );
}
