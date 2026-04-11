import Link from 'next/link';
import React from 'react';

export default function FancyButton({ 
  href, 
  children, 
  external = false, 
  className = '',
  fullWidthMobile = true, // New prop to control full width on mobile
  size = 'default' // New prop for button size options
}) {
  // Build button classes with responsive sizing
  const sizeClasses = {
    'small': 'px-3 py-2 text-sm',
    'default': 'px-4 sm:px-6 py-3',
    'large': 'px-5 sm:px-8 py-4 text-lg'
  };
  
  const selectedSizeClass = sizeClasses[size] || sizeClasses.default;
  
  // Apply full width on mobile if specified
  const responsiveWidthClass = fullWidthMobile ? 'w-full sm:w-auto' : '';
  
  const buttonClass = `fancy-button ${selectedSizeClass} ${responsiveWidthClass} ${className}`;
  
  // Extra touch padding for mobile
  const touchClass = 'touch-manipulation'; // Improves touch responsiveness
  
  if (external) {
    return (
      <a 
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${buttonClass} ${touchClass}`}
      >
        {children}
      </a>
    );
  }
  
  return (
    <Link href={href} className={`${buttonClass} ${touchClass}`}>
      {children}
    </Link>
  );
}
