"use client";

import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import useMediaQuery from '../hooks/useMediaQuery';

/**
 * PageHeader component - creates a responsive, animated page header
 * with optimized behavior for both mobile and desktop
 */
export default function PageHeader({ 
  title,
  subtitle = null,
  breadcrumbs = [],
  actionButton = null,
  animationDelay = 0
}) {
  const { isMobile } = useMediaQuery();
  
  return (
    <div className="w-full mb-8 sm:mb-12">
      {/* Breadcrumbs - Hidden on smallest mobile screens */}
      {breadcrumbs.length > 0 && (
        <motion.div 
          className="mb-4 sm:mb-6 hidden xs:flex flex-wrap items-center text-sm text-blue-300"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: animationDelay }}
        >
          <Link href="/" className="hover:text-blue-200 transition-colors">
            Home
          </Link>
          
          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={index}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mx-2 text-blue-400/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-blue-200 transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-blue-100">{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </motion.div>
      )}
      
      {/* Header with Title and Action Button */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: animationDelay + 0.1 }}
          className={`text-center ${isMobile ? 'w-full' : 'text-left'}`}
        >
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold relative">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-purple-400 to-blue-200">
              {title}
            </span>
            <span className="absolute left-1/2 -translate-x-1/2 sm:left-0 sm:transform-none -top-2 text-blue-500 opacity-10 blur-sm whitespace-nowrap">
              {title}
            </span>
          </h1>
          
          {subtitle && (
            <p className="text-blue-200 mt-2 text-base sm:text-lg max-w-2xl">
              {subtitle}
            </p>
          )}
        </motion.div>
        
        {actionButton && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: animationDelay + 0.3 }}
            className="w-full sm:w-auto"
          >
            {actionButton}
          </motion.div>
        )}
      </div>
    </div>
  );
}
