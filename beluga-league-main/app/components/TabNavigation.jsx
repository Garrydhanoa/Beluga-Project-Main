"use client";

import { useState } from 'react';
import { motion } from 'framer-motion';
import useMediaQuery from '../hooks/useMediaQuery';

export default function TabNavigation({ tabs, activeTab, onChange, variant = 'primary' }) {
  const { isMobile } = useMediaQuery();
  
  // Handle dropdown functionality for mobile view
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  // Get the active tab label for mobile dropdown
  const getActiveTabLabel = () => {
    return tabs.find(tab => tab.id === activeTab)?.label || 'Select';
  };
  
  const handleTabClick = (tabId) => {
    onChange(tabId);
    setIsDropdownOpen(false);
  };
  
  // Different background styles based on variant
  const getVariantStyles = () => {
    switch(variant) {
      case 'secondary':
        return {
          active: 'bg-gradient-to-r from-purple-500 to-blue-600',
          inactive: 'bg-black/30 hover:bg-black/50 border border-white/10',
          text: 'text-white'
        };
      default:
        return {
          active: 'bg-gradient-to-r from-blue-500 to-purple-600',
          inactive: 'bg-black/30 hover:bg-black/50 border border-white/10',
          text: 'text-white'
        };
    }
  };
  
  const styles = getVariantStyles();
  
  // Display dropdown on mobile, tabs on desktop
  if (isMobile) {
    return (
      <div className="w-full relative z-10">
        <button
          className={`w-full text-left px-4 py-3 rounded-lg font-bold 
            flex items-center justify-between
            ${activeTab ? styles.active : styles.inactive}`}
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        >
          <span>{getActiveTabLabel()}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-5 w-5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        
        {/* Dropdown menu */}
        {isDropdownOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full left-0 right-0 mt-1 bg-black/80 backdrop-blur-md rounded-lg overflow-hidden border border-white/10 shadow-lg"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`w-full text-left px-4 py-3 
                  ${activeTab === tab.id ? 'bg-blue-900/50 text-blue-200' : 'hover:bg-black/50 text-white'}`}
                onClick={() => handleTabClick(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </motion.div>
        )}
      </div>
    );
  }
  
  // Desktop view with horizontal tabs
  return (
    <div className="flex flex-wrap justify-center gap-2 sm:gap-4">
      {tabs.map((tab) => (
        <motion.button 
          key={tab.id}
          className={`relative px-4 sm:px-6 py-3 rounded-lg font-bold text-base transition-all duration-300 transform 
            ${activeTab === tab.id 
              ? `${styles.active} scale-105 shadow-xl` 
              : `${styles.inactive}`
            } overflow-hidden group`}
          onClick={() => handleTabClick(tab.id)}
          whileHover={{ scale: activeTab === tab.id ? 1.05 : 1.03 }}
          whileTap={{ scale: 0.98 }}
        >
          <span className={`relative z-10 ${activeTab === tab.id ? styles.text : 'group-hover:text-blue-200 transition-colors'}`}>
            {tab.label}
          </span>
          {activeTab === tab.id && (
            <motion.div 
              className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20 blur-sm"
              layoutId="activeTabBackground"
              transition={{ type: "spring", damping: 20, stiffness: 300 }}
            ></motion.div>
          )}
          <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300"></div>
        </motion.button>
      ))}
    </div>
  );
}
