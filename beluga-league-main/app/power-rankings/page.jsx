'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import FancySection from '../components/FancySection';
import SafeTeamLogo from '../components/SafeTeamLogo';
import './power-rankings.css';

export default function PowerRankingsPage() {
  // State
  const [activeTab, setActiveTab] = useState('majors');
  const [activeWeek, setActiveWeek] = useState(1);
  const [powerRankings, setPowerRankings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchStatus, setFetchStatus] = useState({
    fromCache: false,
    cachedAt: null,
    fetchError: null
  });
  
  // Function to change week with loading state
  const changeWeek = (week) => {
    if (week === activeWeek) return; // Don't reload if same week
    setIsLoading(true);
    setActiveWeek(week);
  };
  
  // Function to change division with loading state
  const changeDivision = (division) => {
    if (division === activeTab) return; // Don't reload if same division
    setIsLoading(true);
    setActiveTab(division);
  };

  // For mobile view handling
  const maxAvailableWeek = 8;
  const weeks = Array.from({ length: maxAvailableWeek }, (_, i) => i + 1);

  // Function to safely get a team name as string
  const safeTeamName = (team) => {
    if (!team) return 'Unknown Team';
    
    // Handle string case
    if (typeof team === 'string') return team;
    
    // Handle object case with team property
    if (typeof team === 'object' && team !== null) {
      // If it has a team property that's a string, use that
      if (team.team && typeof team.team === 'string') {
        return team.team;
      }
      
      // If team has a name property directly, use that
      if (team.name && typeof team.name === 'string') {
        return team.name;
      }
      
      // If team property is also an object, try to get its string representation
      if (team.team && typeof team.team === 'object' && team.team !== null) {
        // Try to get name or id
        if (team.team.name && typeof team.team.name === 'string') return team.team.name;
        if (team.team.id && typeof team.team.id === 'string') return team.team.id;
        
        // Don't use JSON stringify - it could lead to [object Object]
        return 'Unknown Team';
      }
      
      // Don't use JSON stringify as it can lead to [object Object]
      return 'Unknown Team';
    }
    
    // Don't try string conversion as it can lead to [object Object]
    return 'Unknown Team';
  };

  // Helper function to get team initials
  const getTeamInitials = (teamName) => {
    if (!teamName) return '';
    const teamNameStr = safeTeamName(teamName);
    return teamNameStr.split(' ').map(word => word[0]).join('');
  };

  // Function to get team trend (up, down, or neutral)
  const getTeamTrend = useCallback((teamName) => {
    return 'neutral'; // Default is neutral for now
  }, []);

  // Function to get trend icon/badge
  const getTrendIcon = (trend) => {
    switch (trend) {
      case 'up':
        return {
          icon: '↑',
          badgeClass: 'trend-badge rising',
          label: 'Rising'
        };
      case 'down':
        return {
          icon: '↓',
          badgeClass: 'trend-badge falling',
          label: 'Falling'
        };
      default:
        return {
          icon: '→',
          badgeClass: 'trend-badge stable',
          label: 'Stable'
        };
    }
  };

  // Fetch power rankings data
  useEffect(() => {
    async function fetchPowerRankings() {
      try {
        setIsLoading(true);
        setError(null);
        
        // Define cache key for potential fallback use
        const cacheKey = `power-rankings-${activeTab}-week${activeWeek}`;
        
        // First check local storage cache to avoid unnecessary fetches
        const cachedData = localStorage.getItem(cacheKey);
        const cachedTimestamp = localStorage.getItem(`${cacheKey}-timestamp`);
        
        let useCachedData = false;
        let parsedCachedData = null;
        
        if (cachedData && cachedTimestamp) {
          try {
            parsedCachedData = JSON.parse(cachedData);
            // Only use cache if it's less than 1 hour old
            const cacheAge = Date.now() - parseInt(cachedTimestamp, 10);
            if (cacheAge < 60 * 60 * 1000) { // 1 hour in ms
              useCachedData = true;
              console.log(`Using cached data for ${activeTab} week ${activeWeek} (${Math.floor(cacheAge / 60000)} minutes old)`);
            }
          } catch (e) {
            console.warn("Error parsing cached data:", e);
          }
        }
        
        // If we have valid cached data that's less than an hour old, use it
        if (useCachedData && parsedCachedData) {
          setPowerRankings(parsedCachedData);
          setFetchStatus({
            fromCache: true,
            cachedAt: new Date(parseInt(cachedTimestamp, 10)).toLocaleString(),
            fetchError: null
          });
          setIsLoading(false);
          return;
        }
        
        // Fetch from API
        try {
          const response = await fetch(
            `/api/power-rankings?division=${activeTab}&week=${activeWeek}`,
            { cache: 'no-store' }
          );
          
          // Check if response is JSON
          const contentType = response.headers.get("content-type");
          if (!contentType || !contentType.includes("application/json")) {
            const textResponse = await response.text();
            console.error("API returned non-JSON response:", textResponse.substring(0, 200) + "...");
            throw new Error("API returned invalid format. Please try again later.");
          }
          
          const data = await response.json();
          
          if (response.ok) {
            // Make sure we always have a valid data structure even if the API returns incomplete data
            const safeData = {
              division: data.division || activeTab.toUpperCase(),
              week: data.week || activeWeek,
              data: {
                teams: [],
                players: []
              }
            };
            
            // Process teams data safely
            if (Array.isArray(data.data?.teams)) {
              // First filter out any invalid team entries
              const validTeams = data.data.teams.filter(team => 
                team && 
                (typeof team === 'object' || typeof team === 'string')
              );
              
              // Then map them to safe values
              safeData.data.teams = validTeams
                .map(team => {
                  const teamName = safeTeamName(team.team || team);
                  
                  // Skip any problematic team names
                  if (teamName === '[object Object]' || !teamName) {
                    return null;
                  }
                  
                  return {
                    ...team,
                    team: teamName,
                    points: parseFloat(team.points) || 0
                  };
                })
                .filter(Boolean); // Remove any null entries
            }
            
            // Process players data safely
            if (Array.isArray(data.data?.players)) {
              safeData.data.players = data.data.players
                .filter(player => player && (typeof player === 'object' || typeof player === 'string'))
                .map(player => ({
                  ...player,
                  player: typeof player.player === 'string' ? player.player : 
                          typeof player.player === 'object' ? JSON.stringify(player.player).replace(/[{}"]/g, '') : 
                          String(player.player || player || 'Unknown Player'),
                  points: parseFloat(player.points) || 0
                }));
            }
            
            setPowerRankings(safeData);
            
            // Set status information
            setFetchStatus({
              fromCache: data.fromCache || false,
              cachedAt: data.cachedAt ? new Date(data.cachedAt).toISOString() : new Date().toISOString(),
              fetchError: data.fetchError || null
            });
            
            // Save to localStorage for future use
            try {
              localStorage.setItem(cacheKey, JSON.stringify(safeData));
              localStorage.setItem(`${cacheKey}-timestamp`, Date.now().toString());
            } catch (e) {
              console.warn("Error saving to cache:", e);
            }
          } else {
            // Instead of throwing an error, create an empty data structure
            setPowerRankings({
              division: activeTab.toUpperCase(),
              week: activeWeek,
              data: {
                teams: [],
                players: []
              }
            });
            
            setFetchStatus({
              fromCache: false,
              cachedAt: new Date().toLocaleString(),
              fetchError: data.error || "No data available for this week"
            });
          }
        } catch (fetchError) {
          // Don't throw error, instead set empty data
          console.error("API request failed:", fetchError.message);
          
          setPowerRankings({
            division: activeTab.toUpperCase(),
            week: activeWeek,
            data: {
              teams: [],
              players: []
            }
          });
          
          setFetchStatus({
            fromCache: false,
            cachedAt: new Date().toLocaleString(),
            fetchError: "No data available for this week"
          });
        }
      } catch (err) {
        console.error("Error fetching power rankings:", err);
        setError(null); // Don't set error, just provide empty data
        
        // Try cached data as fallback
        const cacheKey = `power-rankings-${activeTab}-week${activeWeek}`;
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          try {
            const parsedData = JSON.parse(cachedData);
            setPowerRankings(parsedData);
            setFetchStatus({
              fromCache: true,
              cachedAt: localStorage.getItem(`${cacheKey}-timestamp`) 
                ? new Date(parseInt(localStorage.getItem(`${cacheKey}-timestamp`), 10)).toLocaleString()
                : 'Unknown',
              fetchError: "Using cached data"
            });
          } catch (e) {
            // If cache fails, use empty data
            setPowerRankings({
              division: activeTab.toUpperCase(),
              week: activeWeek,
              data: {
                teams: [],
                players: []
              }
            });
            
            setFetchStatus({
              fromCache: false,
              cachedAt: new Date().toLocaleString(),
              fetchError: "No data available for this week"
            });
          }
        } else {
          // No cache, use empty data
          setPowerRankings({
            division: activeTab.toUpperCase(),
            week: activeWeek,
            data: {
              teams: [],
              players: []
            }
          });
          
          setFetchStatus({
            fromCache: false,
            cachedAt: new Date().toLocaleString(),
            fetchError: "No data available for this week"
          });
        }
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchPowerRankings();
  }, [activeTab, activeWeek]);

  return (
    <FancySection>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="power-rankings-container"
      >
        <h1 className="text-3xl md:text-4xl font-bold text-center mb-6 text-white">
          Power Rankings
        </h1>
        
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-8">
          {/* Division Tabs */}
          <div className="flex-grow max-w-md mx-auto md:mx-0">
            <div className="grid grid-cols-3 bg-black/30 border border-blue-900/50 rounded-md overflow-hidden">
              <button
                onClick={() => changeDivision('aa')}
                className={`py-2 px-4 text-sm font-medium transition-colors ${
                  activeTab === 'aa' ? 'bg-blue-900/40 text-blue-200' : 'text-gray-300 hover:bg-blue-900/20'
                }`}
              >
                AA
              </button>
              <button
                onClick={() => changeDivision('aaa')}
                className={`py-2 px-4 text-sm font-medium transition-colors ${
                  activeTab === 'aaa' ? 'bg-blue-900/40 text-blue-200' : 'text-gray-300 hover:bg-blue-900/20'
                }`}
              >
                AAA
              </button>
              <button
                onClick={() => changeDivision('majors')}
                className={`py-2 px-4 text-sm font-medium transition-colors ${
                  activeTab === 'majors' ? 'bg-blue-900/40 text-blue-200' : 'text-gray-300 hover:bg-blue-900/20'
                }`}
              >
                Majors
              </button>
            </div>
          </div>
          
          {/* Week Selector */}
          <div className="flex items-center gap-2 justify-center md:justify-end">
            <span className="text-sm text-blue-300">Week:</span>
            <div className="flex gap-1">
              {weeks.map((week) => (
                <button
                  key={week}
                  onClick={() => changeWeek(week)}
                  title={week > (new Date().getDay() === 0 ? 7 : 6) ? `Week ${week} data not available yet` : `View Week ${week}`}
                  className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium transition-all
                    ${activeWeek === week 
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' 
                      : week > (new Date().getDay() === 0 ? 7 : 6)  // Simple logic to suggest which weeks might not have data
                        ? 'bg-black/30 text-gray-500 border border-gray-700/50 cursor-default opacity-50'
                        : 'bg-black/30 text-blue-300 hover:bg-blue-900/30 border border-blue-900/50'}`}
                  disabled={false} // We still allow clicking all weeks but style them differently
                >
                  {week}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 border-4 border-t-blue-500 border-r-transparent border-b-blue-300 border-l-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-blue-300">Loading power rankings data...</p>
          </div>
        ) : (
          <>
            {/* Main Rankings Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10">
              {/* Teams Rankings */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="bg-black/30 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden neon-border"
              >
                <div className="bg-gradient-to-r from-blue-900/80 to-purple-900/80 py-4 px-5 flex items-center justify-between">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    Top Teams
                  </h3>
                  <span className="text-sm text-blue-300">{activeTab.toUpperCase()} Division</span>
                </div>
                <div className="divide-y divide-white/5">
                  {powerRankings?.data?.teams?.filter(team => {
                    // More strict filtering to prevent any problematic objects from being rendered
                    return team && 
                           typeof team === 'object' && 
                           team.team && 
                           typeof safeTeamName(team.team) === 'string' &&
                           safeTeamName(team.team) !== '[object Object]';
                  }).map((team, index) => {
                    const teamName = safeTeamName(team.team);
                    const trend = getTeamTrend(teamName);
                    const trendInfo = getTrendIcon(trend);
                    const points = typeof team.points === 'number' ? team.points : 
                                 typeof team.points === 'string' ? parseFloat(team.points) || 0 : 0;
                    
                    return (
                      <div 
                        id={`team-card-${index}`}
                        key={`team-${index}`}
                        className="p-5 sm:p-6 flex items-center gap-4 hover:bg-white/5 transition-colors relative tilt-card"
                      >
                        {/* Crown for first place */}
                        {index === 0 && (
                          <div className="crown">👑</div>
                        )}
                        
                        <div className="flex-shrink-0">
                          <div className={`w-12 h-12 flex items-center justify-center text-lg font-bold
                            ${index === 0 ? 'bg-gradient-to-br from-yellow-400 to-yellow-600 text-yellow-900 glow-border' : 
                              index === 1 ? 'bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800' : 
                              index === 2 ? 'bg-gradient-to-br from-amber-700 to-amber-800 text-amber-100' :
                              'bg-gradient-to-br from-blue-900 to-blue-800 text-blue-200'} 
                            rounded-full shadow-lg card-content`}
                          >
                            {index + 1}
                          </div>
                        </div>
                        
                        <div className="flex flex-grow items-center gap-3 card-content">
                          <div className={`w-14 h-14 rounded-full flex items-center justify-center overflow-hidden border ${index < 3 ? 'border-blue-400/30' : 'border-white/10'} bg-gradient-to-br from-blue-900/50 to-purple-900/50 shadow-inner`}>
                            <SafeTeamLogo 
                              teamName={teamName} 
                              size={45}
                              priority={index < 3}
                              containerClassName="w-full h-full flex items-center justify-center"
                            />
                          </div>
                          
                          <div>
                            <div className="flex items-center">
                              <Link href={`/teams/${encodeURIComponent(teamName)}`} className={`font-medium text-base sm:text-lg hover:text-blue-300 transition ${index === 0 ? 'glow-text' : ''}`}>
                                {teamName}
                              </Link>
                            </div>
                            <div className="text-sm text-blue-300 flex items-center gap-2">
                              <span className="font-semibold">{points}</span> points
                              <span className={trendInfo.badgeClass} title={trendInfo.label}>
                                {trendInfo.icon}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {(!powerRankings?.data?.teams || powerRankings.data.teams.length === 0) && (
                    <div className="py-10 text-center text-gray-400">
                      No team rankings available for {activeTab.toUpperCase()} Division Week {activeWeek}.
                    </div>
                  )}
                </div>
              </motion.div>
              
              {/* Players Rankings */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.5 }}
                className="bg-black/30 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden neon-border"
              >
                <div className="bg-gradient-to-r from-blue-900/80 to-purple-900/80 py-4 px-5 flex items-center justify-between">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Top Players
                  </h3>
                  <span className="text-sm text-blue-300">{activeTab.toUpperCase()} Division</span>
                </div>
                <div className="divide-y divide-white/5">
                  {powerRankings?.data?.players?.filter(player => player && typeof player === 'object').map((player, index) => {
                    // Safely get player name and points
                    const playerName = typeof player.player === 'string' ? player.player : 
                                     typeof player.player === 'object' ? JSON.stringify(player.player).replace(/[{}"]/g, '') : 
                                     String(player.player || 'Unknown Player');
                                     
                    const points = typeof player.points === 'number' ? player.points : 
                                 typeof player.points === 'string' ? parseFloat(player.points) || 0 : 0;
                    
                    return (
                      <div 
                        key={`player-${index}`}
                        className="p-5 sm:p-6 flex items-center gap-4 hover:bg-white/5 transition-colors tilt-card"
                      >
                        <div className="flex-shrink-0">
                          <div className={`w-12 h-12 flex items-center justify-center text-lg font-bold
                            ${index === 0 ? 'bg-gradient-to-br from-yellow-400 to-yellow-600 text-yellow-900 glow-border' : 
                              index === 1 ? 'bg-gradient-to-br from-gray-300 to-gray-400 text-gray-800' : 
                              index === 2 ? 'bg-gradient-to-br from-amber-700 to-amber-800 text-amber-100' :
                              'bg-gradient-to-br from-blue-900 to-blue-800 text-blue-200'} 
                            rounded-full shadow-lg card-content`}
                          >
                            {index + 1}
                          </div>
                        </div>
                        
                        <div>
                          <div className="flex items-center">
                            <span className={`font-medium text-base sm:text-lg ${index === 0 ? 'glow-text' : ''}`}>
                              {playerName}
                            </span>
                          </div>
                          <div className="text-sm text-blue-300">
                            <span className="font-semibold">{points}</span> points
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {(!powerRankings?.data?.players || powerRankings.data.players.length === 0) && (
                    <div className="py-10 text-center text-gray-400">
                      No player rankings available for {activeTab.toUpperCase()} Division Week {activeWeek}.
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
            
            {/* Data source info */}
            <div className="mt-6 text-center text-sm text-blue-300/70">
              <p>Last updated: {
                fetchStatus.cachedAt ? 
                new Date(fetchStatus.cachedAt).toLocaleString('en-US', {
                  timeZone: 'America/New_York',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                }) + ' EST' : 
                'Unknown'
              }</p>
              {fetchStatus.fetchError && (
                <p className="text-xs text-blue-300/50">
                  {fetchStatus.fromCache 
                    ? "Using cached data - Unable to fetch latest rankings" 
                    : fetchStatus.fetchError === "No data available for this week"
                      ? "This week&apos;s rankings have not been published yet"
                      : typeof fetchStatus.fetchError === 'object'
                        ? (fetchStatus.fetchError.message || "Error fetching data")
                        : String(fetchStatus.fetchError)}
                </p>
              )}
            </div>
          </>
        )}
      </motion.div>
    </FancySection>
  );
}
