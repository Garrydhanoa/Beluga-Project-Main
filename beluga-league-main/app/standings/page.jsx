"use client"

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import FloatingParticles from '../components/FloatingParticles';
import '../header-size-fix.js';

// This ensures consistent team names across the application
const CANONICAL_TEAM_NAMES = [
  "6 Speed", "Archangels", "Aviators", "Clovis Esports",
  "Griffins", "Immortals", "InTraCate", "Kingdom",
  "Lotus", "Malfeasance", "MNML", "Panthers",
  "Sublunary", "Surge"
];

// Team colors for personalized highlights
const TEAM_COLORS = {
  "6 Speed": {primary: "from-orange-400", secondary: "to-yellow-500"},
  "Archangels": {primary: "from-yellow-400", secondary: "to-orange-500"},
  "Aviators": {primary: "from-sky-400", secondary: "to-indigo-500"},
  "Clovis Esports": {primary: "from-cyan-400", secondary: "to-teal-500"},
  "Griffins": {primary: "from-amber-400", secondary: "to-yellow-600"},
  "Immortals": {primary: "from-amber-400", secondary: "to-red-500"},
  "InTraCate": {primary: "from-emerald-400", secondary: "to-cyan-500"},
  "Kingdom": {primary: "from-indigo-400", secondary: "to-blue-500"},
  "Lotus": {primary: "from-pink-400", secondary: "to-rose-500"},
  "Malfeasance": {primary: "from-violet-400", secondary: "to-purple-500"},
  "MNML": {primary: "from-gray-400", secondary: "to-slate-500"},
  "Panthers": {primary: "from-black", secondary: "to-gray-700"},
  "Sublunary": {primary: "from-teal-400", secondary: "to-emerald-500"},
  "Surge": {primary: "from-blue-400", secondary: "to-cyan-500"}
};

export default function StandingsPage() {
  const [activeTab, setActiveTab] = useState("majors");
  const [standings, setStandings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [animateItems, setAnimateItems] = useState(false);
  // Expanded team functionality removed - was causing mobile issues
  const [sortField, setSortField] = useState("position");
  const [sortDirection, setSortDirection] = useState("asc");
  const [highlighted, setHighlighted] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // For checking if this is the first load
  const isFirstLoad = useRef(true);
  
  // Initial page load effect - handle cached data immediately
  useEffect(() => {
    const loadInitialData = () => {
      try {
        // Check for cached data on first page load
        const cachedData = localStorage.getItem(`standings-${activeTab}`);
        const cachedTimestamp = localStorage.getItem(`standings-timestamp-${activeTab}`);
        
        if (cachedData && cachedTimestamp) {
          const data = JSON.parse(cachedData);
          setStandings(data.data);
          setFetchStatus({
            fromCache: true,
            cachedAt: data.cachedAt,
            fetchError: null
          });
          setIsLoading(false);
          
          // Only fetch fresh data if cache is over 60 minutes old (1 hour)
          const cacheAge = Date.now() - parseInt(cachedTimestamp, 10);
          setShouldFetch(cacheAge > 60 * 60 * 1000);
          
          console.log(`Loaded initial cached data, ${Math.round(cacheAge/1000/60)} minutes old`);
          return true;
        }
        return false;
      } catch (e) {
        console.error("Error loading cached data:", e);
        return false;
      }
    };
    
    if (!loadInitialData()) {
      // No cache found, we'll need to fetch on first load
      setShouldFetch(true);
    }
  }, []);
  
  // Team stats that will be displayed in the expanded view
  const teamStats = {
    "Malfeasance": { goalsScored: 29, goalsConceded: 22, shotAccuracy: "58%", possession: "49%" },
    // Add more teams as needed...
  };

  // State for tracking data freshness
  const [fetchStatus, setFetchStatus] = useState({
    fromCache: false,
    cachedAt: null,
    fetchError: null
  });

  // State to track if we should force a fetch
  const [shouldFetch, setShouldFetch] = useState(false);
  
  // Modified setActiveTab to trigger fetch only when changing divisions
  const handleDivisionChange = (division) => {
    // Don't re-fetch if we're already on this division
    if (division === activeTab) return;
    
    setActiveTab(division);
    setShouldFetch(true);
  };

  // Setup auto-refresh timer (every 60 minutes)
  useEffect(() => {
    // Define refresh interval constant for consistency
    const REFRESH_INTERVAL = 60 * 60 * 1000; // 60 minutes (1 hour) in milliseconds
    
    // Set up a regular interval to check for data freshness
    const intervalId = setInterval(() => {
      // Only trigger a refresh if we haven't refreshed in the last 30 minutes
      if (fetchStatus.cachedAt) {
        const lastUpdateTime = new Date(fetchStatus.cachedAt).getTime();
        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateTime;
        
        if (timeSinceLastUpdate > REFRESH_INTERVAL) {
          console.log(`Auto-refresh triggered after ${Math.round(timeSinceLastUpdate/1000/60)} minutes`);
          setShouldFetch(true);
        }
      }
    }, 60000); // Check every minute
    
    return () => clearInterval(intervalId); // Cleanup on unmount
  }, [fetchStatus.cachedAt]);

  // Get standings data with client-side caching
  useEffect(() => {
    // Function to check if client cache is valid
    const checkClientCache = () => {
      try {
        // Check if we have cached data in localStorage
        const cachedData = localStorage.getItem(`standings-${activeTab}`);
        const cachedTimestamp = localStorage.getItem(`standings-timestamp-${activeTab}`);
        
        if (cachedData && cachedTimestamp) {
          const cachedTime = parseInt(cachedTimestamp, 10);
          const now = Date.now();
          const cacheAge = now - cachedTime;
          
          // Use cache if it exists - server handles refresh timing
          console.log(`Using client cache for ${activeTab} (${Math.round(cacheAge / 1000 / 60)} minutes old)`);
          const parsedData = JSON.parse(cachedData);
          
          // Set standings from cache
          setStandings(parsedData.data);
          setFetchStatus({
            fromCache: true,
            cachedAt: parsedData.cachedAt,
            fetchError: null
          });
          
          setIsLoading(false);
          
          // Only fetch from server if cache is older than 60 minutes (1 hour)
          if (cacheAge > 60 * 60 * 1000) {
            return false;
          }
          
          setShouldFetch(false);
          return true;
        }
        return false;
      } catch (error) {
        console.error("Error reading from cache:", error);
        return false;
      }
    };
    
    // Try to use client cache first on initial load
    if (!shouldFetch && checkClientCache()) {
      return; // We used the cache, no need to fetch
    }
    
    // Handle the very first load - need to fetch if no cache exists
    if (isFirstLoad.current && !localStorage.getItem(`standings-${activeTab}`)) {
      console.log("First load with no cache - fetching data");
      isFirstLoad.current = false;
      setShouldFetch(true);
    }
    
    // Skip fetch if explicitly told not to fetch
    if (!shouldFetch) {
      return;
    }
    
    async function fetchStandings() {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch(`/api/standings?division=${activeTab}`);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch standings: ${response.statusText}`);
        }
        
        const responseData = await response.json();
        
        if (responseData.error) {
          throw new Error(responseData.error);
        }
        
        // Check if we have data (either fresh or cached)
        if (responseData.data && responseData.data.length > 0) {
          // Process each team to ensure we use canonical team names
          const processedData = responseData.data.map((team) => {
            const canonicalTeam = findCanonicalTeamName(team.team);
            
            return {
              ...team,
              team: canonicalTeam || team.team
            };
          });
          
          setStandings(processedData);
          
          // Store info about data freshness
          const fetchStatusData = {
            fromCache: responseData.fromCache || false,
            cachedAt: responseData.cachedAt,
            fetchError: responseData.fetchError
          };
          
          setFetchStatus(fetchStatusData);
          
          // Store in client-side cache (localStorage)
          try {
            localStorage.setItem(`standings-${activeTab}`, JSON.stringify({
              data: processedData,
              cachedAt: responseData.cachedAt,
              timestamp: Date.now()
            }));
            localStorage.setItem(`standings-timestamp-${activeTab}`, Date.now().toString());
          } catch (e) {
            console.warn('Failed to cache data in localStorage:', e);
          }
          
          // Show a non-blocking error if we're using cached data due to fetch error
          if (responseData.fetchError) {
            setError(`Using cached data from ${new Date(responseData.cachedAt)
              .toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })
            }. Unable to fetch fresh data: ${responseData.fetchError}`);
          }
        } else {
          // No data available
          setStandings([]);
          if (responseData.fetchError) {
            setError(`No data available: ${responseData.fetchError}`);
          } else {
            setError('No standings data available for this division');
          }
        }
      } catch (err) {
        console.error('Error fetching standings:', err);
        setError(err instanceof Error ? err.message : 'Failed to load standings data');
        setStandings([]); // Clear any previous data on complete failure
      } finally {
        setIsLoading(false);
        setShouldFetch(false); // Reset fetch flag after completion
      }
    }
    
    fetchStandings();
    // Reset expanded and sort when changing divisions
    // Expanded team functionality removed
    setSortField("position");
    setSortDirection("asc");
  }, [activeTab, shouldFetch]);

  // Find canonical team name based on input string
  const findCanonicalTeamName = (inputTeam) => {
    // First, try an exact match
    const exactMatch = CANONICAL_TEAM_NAMES.find(
      name => name.toLowerCase() === inputTeam.toLowerCase()
    );
    if (exactMatch) return exactMatch;
    
    // Next, try partial matches
    const partialMatch = CANONICAL_TEAM_NAMES.find(
      name => inputTeam.toLowerCase().includes(name.toLowerCase()) || 
             name.toLowerCase().includes(inputTeam.toLowerCase())
    );
    if (partialMatch) return partialMatch;
    
    // Special cases and abbreviations
    if (inputTeam.toLowerCase().includes("6 speed")) return "6 Speed";
    if (inputTeam.toLowerCase().includes("arch")) return "Archangels";
    if (inputTeam.toLowerCase().includes("avia")) return "Aviators";
    if (inputTeam.toLowerCase().includes("clovis")) return "Clovis Esports";
    if (inputTeam.toLowerCase().includes("griffi")) return "Griffins";
    if (inputTeam.toLowerCase().includes("immort")) return "Immortals";
    if (inputTeam.toLowerCase().includes("intra")) return "InTraCate";
    if (inputTeam.toLowerCase().includes("king")) return "Kingdom";
    if (inputTeam.toLowerCase().includes("lot")) return "Lotus";
    if (inputTeam.toLowerCase().includes("malf")) return "Malfeasance";
    if (inputTeam.toLowerCase().includes("mnml")) return "MNML";
    if (inputTeam.toLowerCase().includes("panth")) return "Panthers";
    if (inputTeam.toLowerCase().includes("sub")) return "Sublunary";
    if (inputTeam.toLowerCase().includes("surg")) return "Surge";
    
    return null; // No match found
  };

  // Add entrance animations after initial render
  useEffect(() => {
    setTimeout(() => {
      setAnimateItems(true);
    }, 100);
    
    // Force header size on mobile
    if (typeof window !== 'undefined' && window.innerWidth <= 640) {
      const header = document.querySelector('.super-large-mobile-header');
      if (header) {
        header.style.fontSize = '10rem';
        header.style.lineHeight = '0.85';
        header.style.letterSpacing = '-3px';
      }
    }
  }, []);

  // Helper function for team logo fallback
  const getTeamInitials = (teamName) => {
    return teamName.split(' ').map(word => word[0]).join('');
  };

  // Preload all team logos
  useEffect(() => {
    CANONICAL_TEAM_NAMES.forEach(team => {
      const img = new Image();
      img.src = `/logos/${team}.png`;
    });
  }, []);

  // Handle sorting
  const handleSort = (field) => {
    if (sortField === field) {
      // Toggle direction if clicking the same field
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      // Set initial direction based on the field
      setSortDirection(field === "position" || field === "losses" ? "asc" : "desc");
    }
  };

  // Apply sorting and filtering
  const sortedStandings = useMemo(() => {
    let result = [...standings];
    
    // Apply search filter if needed
    if (searchQuery) {
      result = result.filter(team => 
        team.team.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Apply sorting
    return result.sort((a, b) => {
      let comparison = 0;
      
      if (sortField === "position") {
        comparison = a.position - b.position;
      } else if (sortField === "wins") {
        comparison = b.wins - a.wins;
      } else if (sortField === "losses") {
        comparison = a.losses - b.losses;
      } else if (sortField === "winPercentage") {
        comparison = parseFloat(b.winPercentage) - parseFloat(a.winPercentage);
      } else if (sortField === "gameDiff") {
        comparison = b.gameDiff - a.gameDiff;
      } else if (sortField === "goalDiff") {
        comparison = b.goalDiff - a.goalDiff;
      }
      
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [standings, sortField, sortDirection, searchQuery]);

  // First, update the playoff cutoff to be 8 for all divisions
  const playoffCutoff = 8; // Changed from conditionally setting based on division

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-950 text-white relative overflow-hidden">
      {/* Background decorative elements with parallax effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="bg-decor absolute top-20 left-10 w-64 h-64 rounded-full bg-blue-500/5 blur-3xl animate-pulse-slow"></div>
        <div className="bg-decor absolute bottom-40 right-10 w-80 h-80 rounded-full bg-purple-500/5 blur-3xl animate-pulse-slow"></div>
        <div className="bg-decor hidden lg:block absolute bottom-1/3 left-1/4 w-56 h-56 rounded-full bg-purple-400/5 blur-2xl animate-pulse-slow"></div>
        
        {/* Animated floating particles */}
        {/* Using client component to avoid hydration mismatch */}
        <FloatingParticles />
      </div>
      
      <motion.div 
        className="container mx-auto px-3 sm:px-4 py-6 sm:py-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <motion.h1 
          className="super-large-mobile-header text-5xl sm:text-5xl md:text-6xl font-bold mb-6 sm:mb-10 text-center relative"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.7, type: "spring", stiffness: 100 }}
        >
          <div className="professional-header-wrapper px-4 py-2">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-purple-400 to-blue-200 shadow-text">
              League Standings
            </span>
            <span className="absolute left-1/2 -translate-x-1/2 -top-2 text-blue-500 opacity-10 blur-sm whitespace-nowrap">
              League Standings
            </span>
          </div>
        </motion.h1>

        {/* Search Box */}
        <motion.div 
          className="mb-6 relative max-w-md mx-auto"
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <div className="flex items-center">
            <div className="relative flex-grow">
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                className="h-5 w-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-blue-400" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search teams..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-full pl-12 pr-10 py-3 bg-black/30 border border-blue-500/30 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 text-white placeholder-blue-300/50"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-300 hover:text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Division Tabs */}
        <div className="flex flex-wrap justify-center gap-2 sm:gap-4 mb-8 sm:mb-12">
          {['aa', 'aaa', 'majors'].map((division) => (
            <motion.button 
              key={division}
              className={`relative px-4 sm:px-8 py-3 sm:py-4 rounded-lg font-bold text-base sm:text-lg transition-all duration-300 transform 
                ${activeTab === division 
                  ? 'bg-gradient-to-r from-blue-500 to-purple-600 scale-105 shadow-xl' 
                  : 'bg-black/30 hover:bg-black/50 border border-white/10'
                } overflow-hidden group division-tab w-[30%] sm:w-auto`}
              onClick={() => handleDivisionChange(division)}
              whileHover={{ scale: activeTab === division ? 1.05 : 1.03 }}
              whileTap={{ scale: 0.98 }}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: division === 'aa' ? 0.1 : division === 'aaa' ? 0.2 : 0.3, duration: 0.5 }}
            >
              <span className={`relative z-10 ${activeTab === division ? 'text-white' : 'group-hover:text-blue-200 transition-colors'}`}>
                {division === 'aa' ? 'AA' : division === 'aaa' ? 'AAA' : 'MAJORS'}
              </span>
              {activeTab === division && (
                <motion.div 
                  className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20 blur-sm"
                  layoutId="activeTab"
                  transition={{ type: "spring", damping: 20, stiffness: 300 }}
                ></motion.div>
              )}
              <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300"></div>
            </motion.button>
          ))}
        </div>

        {/* Division Title with animated underline */}
        <motion.div 
          className="text-center mb-6 sm:mb-10"
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <div className="relative inline-block">
            <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 text-transparent bg-clip-text inline-block">
              {activeTab.toUpperCase()} Division
            </h2>
            <motion.div 
              className="absolute -bottom-2 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.6, duration: 0.8 }}
            ></motion.div>
            <motion.div 
              className="absolute -top-1 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.7, duration: 0.8 }}
            ></motion.div>
          </div>
          
          {/* Division info with icons */}
          <div className="flex flex-col md:flex-row items-center justify-center gap-3 mt-4">
            {/* Data Last Updated Indicator */}
            <div className={`flex items-center px-3 py-1.5 rounded-full mb-2 md:mb-0 ${fetchStatus.fromCache ? (fetchStatus.fetchError ? 'bg-amber-800/30 text-amber-300' : 'bg-blue-800/30 text-blue-300') : 'bg-green-800/30 text-green-300'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
              <span className="text-xs font-medium">
                Last Updated: {
                  fetchStatus.cachedAt ? 
                    new Date(fetchStatus.cachedAt).toLocaleString('en-US', { 
                      month: 'short',
                      day: 'numeric', 
                      hour: 'numeric', 
                      minute: '2-digit', 
                      hour12: true,
                      timeZone: 'America/New_York'  // EST/EDT timezone
                    }) : 
                    'Just now'
                }
              </span>
            </div>
            
            <div className="flex items-center gap-3 text-sm text-blue-200">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-blue-300" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                </svg>
                <span>{activeTab === 'majors' ? '12 Teams' : '16 Teams'}</span>
              </div>
              <div className="h-4 w-px bg-blue-500/20"></div>
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-blue-300" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                </svg>
                <span>8 Week Season</span>
              </div>
              <div className="h-4 w-px bg-blue-500/20"></div>
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-blue-300" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
                </svg>
                <span>Top 8 Qualify</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Standings Table with glass effect and enhanced visuals */}
        <motion.div 
          className="bg-black/30 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden shadow-lg transition-all"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6 }}
        >
          {isLoading ? (
            <div className="flex flex-col justify-center items-center py-20">
              <div className="w-16 h-16 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin mb-6"></div>
              <p className="text-blue-300 animate-pulse">Loading standings...</p>
            </div>
          ) : error && standings.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-red-400 text-xl mb-4">{error}</div>
              <motion.button 
                onClick={() => {
                  setShouldFetch(true);
                  localStorage.removeItem(`standings-${activeTab}`); // Force fresh fetch
                  localStorage.removeItem(`standings-timestamp-${activeTab}`);
                }} 
                className="px-4 py-2 bg-blue-600 rounded-lg text-white hover:bg-blue-700 transition"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Try Again
              </motion.button>
            </div>
          ) : (
            <>
              {/* Show last updated status with clearer refresh indication */}
              {fetchStatus.cachedAt && (
                <div className="rounded-t-lg p-3 text-center border-b border-blue-500/20">
                  <div className="flex items-center justify-center gap-2">
                    {isLoading ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25"></circle>
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c5.52 0 10-4.48 10-10S17.52 2 12 2z" strokeOpacity="0.75" fill="none"></path>
                        <path d="M12 2v4" strokeOpacity="1"></path>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                      </svg>
                    )}
                    <span className="text-white">
                      <span className="font-semibold text-green-400">Last updated:</span> {
                        new Date(fetchStatus.cachedAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                          timeZone: 'America/New_York'
                        })
                      }
                      <span className="ml-2 text-blue-300">(Updates automatically every hour)</span>
                      {isLoading && (
                        <span className="text-blue-300 ml-2 animate-pulse">(Refreshing data...)</span>
                      )}
                      {fetchStatus.fetchError && !isLoading && (
                        <span className="text-amber-300 ml-2">(Unable to fetch fresh data)</span>
                      )}
                    </span>
                  </div>
                </div>
              )}
              
              {/* Table Headers with sorting functionality - Desktop */}
              
              <div className="hidden md:grid grid-cols-12 bg-gradient-to-r from-blue-800/70 to-purple-800/70 text-blue-100 font-semibold py-4 px-5 rounded-t-lg shadow-lg">
                <div 
                  className={`col-span-1 text-center cursor-pointer hover:text-white px-2 py-1.5 rounded-md transition-colors flex justify-center items-center ${sortField === 'position' ? 'bg-blue-700/50 text-white ring-1 ring-blue-400/50' : 'hover:bg-blue-700/40'}`}
                  onClick={() => handleSort('position')}
                >
                  <span className="mr-1 bg-gradient-to-r from-blue-300 to-purple-300 text-transparent bg-clip-text">#</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 ${sortField === 'position' ? 'opacity-100' : 'opacity-50'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortDirection === 'asc' ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                  </svg>
                </div>
                
                <div 
                  className="col-span-3 flex justify-center items-center px-2 py-1.5 rounded-md"
                >
                  <span className="font-bold bg-gradient-to-r from-blue-300 to-purple-300 text-transparent bg-clip-text">Teams</span>
                </div>
                
                <div 
                  className={`col-span-2 text-center cursor-pointer hover:text-white px-2 py-1.5 rounded-md transition-colors flex justify-center items-center ${sortField === 'wins' ? 'bg-blue-700/50 text-white ring-1 ring-blue-400/50' : 'hover:bg-blue-700/40'}`}
                  onClick={() => handleSort('wins')}
                >
                  <span className="mr-1 bg-gradient-to-r from-blue-300 to-purple-300 text-transparent bg-clip-text">W</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 ${sortField === 'wins' ? 'opacity-100' : 'opacity-50'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortDirection === 'asc' ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                  </svg>
                </div>
                
                <div 
                  className={`col-span-2 text-center cursor-pointer hover:text-white px-2 py-1.5 rounded-md transition-colors flex justify-center items-center ${sortField === 'losses' ? 'bg-blue-700/50 text-white ring-1 ring-blue-400/50' : 'hover:bg-blue-700/40'}`}
                  onClick={() => handleSort('losses')}
                >
                  <span className="mr-1 bg-gradient-to-r from-blue-300 to-purple-300 text-transparent bg-clip-text">L</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 ${sortField === 'losses' ? 'opacity-100' : 'opacity-50'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortDirection === 'asc' ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                  </svg>
                </div>
                
                <div 
                  className={`col-span-2 text-center cursor-pointer hover:text-white px-2 py-1.5 rounded-md transition-colors flex justify-center items-center ${sortField === 'gameDiff' ? 'bg-blue-700/50 text-white ring-1 ring-blue-400/50' : 'hover:bg-blue-700/40'}`}
                  onClick={() => handleSort('gameDiff')}
                >
                  <span className="mr-1 bg-gradient-to-r from-blue-300 to-purple-300 text-transparent bg-clip-text">GAME +/-</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 ${sortField === 'gameDiff' ? 'opacity-100' : 'opacity-50'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortDirection === 'asc' ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                  </svg>
                </div>
                
                <div 
                  className={`col-span-2 text-center cursor-pointer hover:text-white px-2 py-1.5 rounded-md transition-colors flex justify-center items-center ${sortField === 'goalDiff' ? 'bg-blue-700/50 text-white ring-1 ring-blue-400/50' : 'hover:bg-blue-700/40'}`}
                  onClick={() => handleSort('goalDiff')}
                >
                  <span className="mr-1 bg-gradient-to-r from-blue-300 to-purple-300 text-transparent bg-clip-text">GOAL +/-</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 ${sortField === 'goalDiff' ? 'opacity-100' : 'opacity-50'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortDirection === 'asc' ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                  </svg>
                </div>
              </div>

              {/* Mobile sorting options */}
              <div className="md:hidden p-3 bg-black/30 rounded-lg mb-3">
                <div className="text-sm font-medium mb-2 text-center text-blue-200">Sort By:</div>
                <div className="flex flex-wrap justify-center gap-2">
                  <button 
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium ${sortField === 'position' ? 'bg-blue-600 text-white' : 'bg-black/40 text-blue-300'}`}
                    onClick={() => handleSort('position')}
                  >
                    Default
                  </button>
                  <button 
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium ${sortField === 'wins' ? 'bg-blue-600 text-white' : 'bg-black/40 text-blue-300'}`}
                    onClick={() => handleSort('wins')}
                  >
                    Wins {sortField === 'wins' && (sortDirection === 'desc' ? '↓' : '↑')}
                  </button>
                  <button 
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium ${sortField === 'losses' ? 'bg-blue-600 text-white' : 'bg-black/40 text-blue-300'}`}
                    onClick={() => handleSort('losses')}
                  >
                    Losses {sortField === 'losses' && (sortDirection === 'desc' ? '↓' : '↑')}
                  </button>
                  <button 
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium ${sortField === 'gameDiff' ? 'bg-blue-600 text-white' : 'bg-black/40 text-blue-300'}`}
                    onClick={() => handleSort('gameDiff')}
                  >
                    Game +/- {sortField === 'gameDiff' && (sortDirection === 'desc' ? '↓' : '↑')}
                  </button>
                </div>
              </div>

              {/* Teams with hover effects and expanded details */}
              <div className="space-y-1">
                {sortedStandings.length === 0 && (
                  <div className="py-8 text-center text-blue-300">
                    No teams match your search criteria
                  </div>
                )}
                
                {sortedStandings.map((team, index) => (
                  <motion.div
                    key={`${team.team}-${index}`}
                    className={`
                      relative
                      backdrop-blur-sm px-4 py-3 sm:py-4 
                      transition-colors duration-300
                      border-b border-white/5 hover:border-blue-400/30
                      
                      ${highlighted === team.team ? 'ring-1 ring-blue-400' : ''}
                      bg-black/20 hover:bg-black/30
                    `}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ 
                      opacity: 1, 
                      y: 0
                    }}
                    transition={{ delay: index * 0.03, duration: 0.4 }}
                    onMouseEnter={() => setHighlighted(team.team)}
                    onMouseLeave={() => setHighlighted(null)}
                  >
                    {/* Position indicator for teams in top positions */}
                    {team.position <= 3 && (
                      <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-12 rounded-r">
                        <div className={`h-full w-full rounded-r ${
                          team.position === 1 ? 'bg-yellow-500/70' : 
                          team.position === 2 ? 'bg-slate-400/70' : 
                          'bg-amber-700/70'
                        }`}></div>
                      </div>
                    )}
                    
                    <div className="hidden md:grid grid-cols-12 items-center">
                      {/* Rank # with more vibrant colors */}
                      <div className="col-span-1 flex justify-center">
                        <div className={`w-9 h-9 flex items-center justify-center rounded-full transition-all shadow
                          ${team.positionStyle || (team.position <= playoffCutoff 
                            ? 'bg-gradient-to-br from-green-500/80 to-green-700/80' 
                            : 'bg-gradient-to-br from-red-500/70 to-red-700/70')} 
                          text-white font-bold
                          ${highlighted === team.team ? 'scale-110 shadow-lg' : ''}`}
                        >
                          {team.position}
                        </div>
                      </div>

                      {/* Team with custom colors on hover */}
                      <div className="col-span-3 flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center overflow-hidden border border-white/10 transition-all duration-300 
                          bg-gradient-to-br from-blue-900/50 to-purple-900/50
                          ${highlighted === team.team ? `bg-gradient-to-br ${TEAM_COLORS[team.team]?.primary || 'from-blue-600/40'} ${TEAM_COLORS[team.team]?.secondary || 'to-purple-600/40'} shadow-lg shadow-blue-900/30 scale-110` : ''}
                        `}>
                          <img
                            src={`/logos/${team.team}.png`}
                            alt={team.team}
                            className={`w-10 h-10 object-contain transition-all duration-300 ${highlighted === team.team ? 'scale-110' : ''}`}
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              if (e.currentTarget.parentElement) {
                                e.currentTarget.parentElement.innerHTML = `<span class="text-base font-bold">${getTeamInitials(team.team)}</span>`;
                              }
                            }}
                          />
                        </div>
                        <div>
                          <Link 
                            href={`/teams/${encodeURIComponent(team.team)}`} 
                            className="font-semibold text-white hover:text-blue-300 transition block"
                          >
                            {team.team}
                          </Link>
                          {/* Win percentage in smaller text */}
                          <div className="text-xs text-blue-300">
                            Win %: <span className="font-mono">
                              {typeof team.winPercentage === 'string' && team.winPercentage.includes('.') 
                                ? `${(parseFloat(team.winPercentage) * 100).toFixed(1)}%` 
                                : team.winPercentage.includes('%') 
                                  ? team.winPercentage 
                                  : `${team.winPercentage}%`}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Stats with enhanced visuals */}
                      <div className="col-span-2 text-center">
                        <span className="font-semibold text-green-400 bg-green-900/20 px-3 py-1.5 rounded-full text-lg">{team.wins}</span>
                      </div>
                      <div className="col-span-2 text-center">
                        <span className="font-semibold text-red-400 bg-red-900/20 px-3 py-1.5 rounded-full text-lg">{team.losses}</span>
                      </div>
                      <div className="col-span-2 text-center font-mono">
                        <span className={`text-lg font-medium ${
                          team.gameDiff > 0 ? 'text-green-400' : team.gameDiff < 0 ? 'text-red-400' : 'text-blue-400'
                        }`}>
                          {team.gameDiff > 0 ? '+' : ''}{team.gameDiff}
                        </span>
                      </div>
                      <div className="col-span-2 text-center font-mono">
                        <span className={`text-lg font-medium ${
                          team.goalDiff > 0 ? 'text-green-400' : team.goalDiff < 0 ? 'text-red-400' : 'text-blue-400'
                        }`}>
                          {team.goalDiff > 0 ? '+' : ''}{team.goalDiff}
                        </span>
                      </div>
                    </div>

                    {/* Mobile View with enhanced interactive elements */}
                    <div className="md:hidden">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 flex items-center justify-center rounded-full shadow
                            ${team.positionStyle || (team.position <= playoffCutoff 
                              ? 'bg-gradient-to-br from-green-500/80 to-green-700/80' 
                              : 'bg-gradient-to-br from-red-500/70 to-red-700/70')}
                            text-white font-bold
                          }`}
                          >
                            {team.position}
                          </div>
                          <div className={`w-11 h-11 rounded-full flex items-center justify-center overflow-hidden border border-white/10
                            bg-gradient-to-br ${TEAM_COLORS[team.team]?.primary || 'from-blue-900/50'} ${TEAM_COLORS[team.team]?.secondary || 'to-purple-900/50'}
                          `}>
                            <img
                              src={`/logos/${team.team}.png`}
                              alt={team.team}
                              className="w-9 h-9 object-contain"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                if (e.currentTarget.parentElement) {
                                  e.currentTarget.parentElement.innerHTML = `<span class="text-sm font-bold">${getTeamInitials(team.team)}</span>`;
                                }
                              }}
                            />
                          </div>
                          <Link href={`/teams/${encodeURIComponent(team.team)}`} className="font-medium text-sm">
                            {team.team}
                          </Link>
                        </div>
                        
                        <div className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span className="text-sm font-medium text-blue-300">W</span>
                            <span className="font-semibold text-green-400 bg-green-900/30 px-3 py-1 rounded-md text-base min-w-[32px] text-center">{team.wins}</span>
                          </div>
                          <div className="flex flex-col items-center">
                            <span className="text-sm font-medium text-blue-300">L</span>
                            <span className="font-semibold text-red-400 bg-red-900/30 px-3 py-1 rounded-md text-base min-w-[32px] text-center">{team.losses}</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Additional stats row for mobile */}
                      <div className="grid grid-cols-3 gap-2 mt-2 text-center text-xs">
                        <div>
                          <span className="text-blue-300 block">Win %</span>
                          <span className="font-mono text-white">
                            {typeof team.winPercentage === 'string' && team.winPercentage.includes('.') 
                              ? `${(parseFloat(team.winPercentage) * 100).toFixed(1)}%` 
                              : team.winPercentage.includes('%') 
                                ? team.winPercentage 
                                : `${team.winPercentage}%`}
                          </span>
                        </div>
                        <div>
                          <span className="text-blue-300 block">Game +/-</span>
                          <span className={`font-mono ${
                            team.gameDiff > 0 ? 'text-green-400' : team.gameDiff < 0 ? 'text-red-400' : 'text-blue-400'
                          }`}>
                            {team.gameDiff > 0 ? '+' : ''}{team.gameDiff}
                          </span>
                        </div>
                        <div>
                          <span className="text-blue-300 block">Goal +/-</span>
                          <span className={`font-mono ${
                            team.goalDiff > 0 ? 'text-green-400' : team.goalDiff < 0 ? 'text-red-400' : 'text-blue-400'
                          }`}>
                            {team.goalDiff > 0 ? '+' : ''}{team.goalDiff}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Expand/collapse button removed - not needed and causing mobile issues */}
                    
                    {/* Expanded team details removed - not needed and causing mobile issues */}
                  </motion.div>
                ))}
              </div>

              {/* Playoff visualization */}
              <div className="p-4 bg-black/30">
                <div className="flex justify-center">
                  <div className="text-center text-blue-100 px-4 py-2 bg-black/30 rounded-lg">
                    <span className="font-medium">Top 8 teams qualify for playoffs</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </motion.div>

        {/* Navigation Buttons with animations */}
        <motion.div 
          className="flex flex-wrap justify-center gap-4 mt-10"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.5 }}
        >
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Link
              href="/"
              className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full font-medium text-white hover:from-blue-600 hover:to-purple-700 transition shadow-lg inline-block group overflow-hidden relative"
            >
              <span className="relative z-10 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                </svg>
                Return to Home
              </span>
              <span className="absolute inset-0 translate-y-full group-hover:translate-y-0 bg-gradient-to-r from-blue-600/50 to-purple-700/50 transition-transform duration-300"></span>
            </Link>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Link
              href="/schedules"
              className="px-8 py-4 bg-black/30 border border-white/10 rounded-full font-medium text-white hover:bg-black/50 hover:border-blue-400/30 transition shadow-lg inline-block group"
            >
              <span className="flex items-center gap-2 group-hover:text-blue-300 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                </svg>
                View Schedules
              </span>
            </Link>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
