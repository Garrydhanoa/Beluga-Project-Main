"use client"

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import ImageWithFallback from '../../components/ImageWithFallback';
import { majorsSchedule, aaaSchedule, FIELD_CAPS, SALARY_RANGES } from '../../../lib/scheduleData';

export default function TeamPage() {
  const params = useParams();
  const teamName = params.teamName;
  const decodedTeamName = decodeURIComponent(teamName);
  
  const [activeTab, setActiveTab] = useState('roster');
  const [activeScheduleTab, setActiveScheduleTab] = useState("aa");
  const [teamDivisions, setTeamDivisions] = useState([]);
  const [teamSchedules, setTeamSchedules] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [animateItems, setAnimateItems] = useState(false);
  const [roster, setRoster] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState(null);
  const [activeRosterTab, setActiveRosterTab] = useState('aa');

  useEffect(() => {
    // Find all matches for this team across different divisions
    setIsLoading(true);
    
    // Create schedule objects for each division
    const schedules = {
      major: {},
      aa: {},
      aaa: {}
    };
    
    // Track which divisions this team plays in
    const divisions = [];
    
    // Check majors division - this should be unique
    let isInMajors = false;
    Object.entries(majorsSchedule).forEach(([week, matches]) => {
      const teamMatches = matches.filter(match => 
        match[0] === decodedTeamName || match[1] === decodedTeamName
      );
      
      if (teamMatches.length > 0) {
        if (!schedules.major) schedules.major = {};
        schedules.major[week] = teamMatches;
        isInMajors = true;
      }
    });
    if (isInMajors) divisions.push("major");
    
    // Check AAA division - uses the same schedule as AA
    let isInAAA = false;
    Object.entries(aaaSchedule).forEach(([week, matches]) => {
      const teamMatches = matches.filter(match => 
        match[0] === decodedTeamName || match[1] === decodedTeamName
      );
      
      if (teamMatches.length > 0) {
        if (!schedules.aaa) schedules.aaa = {};
        schedules.aaa[week] = teamMatches;
        isInAAA = true;
      }
    });
    if (isInAAA) divisions.push("aaa");
    
    // Check AA division - uses the same schedule as AAA
    let isInAA = false;
    Object.entries(aaaSchedule).forEach(([week, matches]) => {
      const teamMatches = matches.filter(match => 
        match[0] === decodedTeamName || match[1] === decodedTeamName
      );
      
      if (teamMatches.length > 0) {
        if (!schedules.aa) schedules.aa = {};
        schedules.aa[week] = teamMatches;
        isInAA = true;
      }
    });
    if (isInAA) divisions.push("aa");
    
    // After all divisions are gathered, sort them in the desired order: AA → AAA → MAJOR
    const sortedDivisions = [];
    if (divisions.includes("aa")) sortedDivisions.push("aa");
    if (divisions.includes("aaa")) sortedDivisions.push("aaa");
    if (divisions.includes("major")) sortedDivisions.push("major");
    
    setTeamDivisions(sortedDivisions);
    setTeamSchedules(schedules);
    
    // Set default active schedule tab to the first available division
    if (sortedDivisions.length > 0) {
      setActiveScheduleTab(sortedDivisions[0]);
    }
    
    setIsLoading(false);
    
    // Trigger animations after load
    setTimeout(() => {
      setAnimateItems(true);
    }, 100);
  }, [decodedTeamName]);

  // Fetch roster data when roster tab is active
  useEffect(() => {
    if (activeTab === 'roster' && !roster && !rosterLoading) {
      setRosterLoading(true);
      setRosterError(null);
      
      fetch(`/api/roster/${encodeURIComponent(decodedTeamName)}`)
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            setRosterError(data.error);
          } else {
            setRoster(data.roster);
            // Set default active roster tab to first available division with players
            const divisions = ['aa', 'aaa', 'major'];
            for (const div of divisions) {
              if (data.roster.players[div] && data.roster.players[div].length > 0) {
                setActiveRosterTab(div);
                break;
              }
            }
          }
        })
        .catch(err => {
          console.error('Error fetching roster:', err);
          setRosterError('Failed to load roster data');
        })
        .finally(() => {
          setRosterLoading(false);
        });
    }
  }, [activeTab, decodedTeamName, roster, rosterLoading]);

  // Helper function to get team initials for fallback
  const getTeamInitials = (name) => {
    return name.split(' ').map(word => word[0]).join('');
  };
  
  // Get the display name for a division
  const getDivisionDisplayName = (division) => {
    switch(division) {
      case 'major': return 'MAJOR';
      case 'aa': return 'AA';
      case 'aaa': return 'AAA';
      default: return division.toUpperCase();
    }
  };

  // Get field cap for each division (using centralized data)
  const getFieldCap = (division) => {
    switch(division) {
      case 'major': return FIELD_CAPS.majors;
      case 'aaa': return FIELD_CAPS.aaa;
      case 'aa': return FIELD_CAPS.aa;
      default: return 0;
    }
  };

  // Get salary range for each division
  const getSalaryRange = (division) => {
    switch(division) {
      case 'major': return SALARY_RANGES.majors;
      case 'aaa':   return SALARY_RANGES.aaa;
      case 'aa':    return SALARY_RANGES.aa;
      default: return null;
    }
  };

  // Calculate all possible 3-player combinations, flagging those over the field cap
  const calculateFieldCombinations = (players, division) => {
    if (!players || players.length < 3) return [];

    const fieldCap = getFieldCap(division);
    const combinations = [];

    // Generate all 3-player combinations
    for (let i = 0; i < players.length - 2; i++) {
      for (let j = i + 1; j < players.length - 1; j++) {
        for (let k = j + 1; k < players.length; k++) {
          const combo = [players[i], players[j], players[k]];
          const totalSalary = combo.reduce((sum, p) => sum + p.salary, 0);
          combinations.push({
            players: combo,
            totalSalary,
            overCap: totalSalary > fieldCap
          });
        }
      }
    }

    // Valid combos first (highest salary first), then over-cap (highest first)
    return combinations.sort((a, b) => {
      if (a.overCap !== b.overCap) return a.overCap ? 1 : -1;
      return b.totalSalary - a.totalSalary;
    });
  };

  // Helper function to get team logo path
  const getTeamLogo = (teamName) => {
    if (!teamName || teamName === 'N/A' || teamName === 'Free Agent') {
      return null;
    }
    
    // Remove division suffixes (Majors, AAA, AA) to get base team name
    const baseTeamName = teamName.replace(/ (Majors|AAA|AA)$/i, '').trim();
    
    // Map team names to logo filenames
    const logoMap = {
      '6 speed': '6 Speed.png',
      'archangels': 'Archangels.png',
      'aviators': 'Aviators.png',
      'clovis esports': 'Clovis Esports.png',
      'griffins': 'Griffins.png',
      'immortals': 'Immortals.png',
      'intricate': 'InTraCate.png',
      'kingdom': 'Kingdom.png',
      'lotus': 'Lotus.png',
      'malfeasance': 'Malfeasance.png',
      'mnml': 'MNML.png',
      'panthers': 'Panthers.png',
      'sublunary': 'Sublunary.png',
      'surge': 'Surge.png',
      'the kingdom': 'Kingdom.png'
    };
    
    const logoFile = logoMap[baseTeamName.toLowerCase()];
    return logoFile ? `/logos/${logoFile}` : null;
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-blue-900 via-blue-800 to-blue-950 text-white">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="bg-decor absolute top-20 left-10 w-64 h-64 rounded-full bg-blue-500/5 blur-3xl" data-speed="0.03"></div>
        <div className="bg-decor absolute bottom-40 right-10 w-80 h-80 rounded-full bg-purple-500/5 blur-3xl" data-speed="0.05"></div>
        <div className="bg-decor absolute top-1/4 right-1/4 w-40 h-40 rounded-full bg-blue-400/5 blur-2xl" data-speed="0.02"></div>
        <div className="bg-decor hidden lg:block absolute bottom-1/3 left-1/4 w-56 h-56 rounded-full bg-purple-400/5 blur-2xl" data-speed="0.04"></div>
      </div>
      
      {/* Main content starts here */}
      <div className={`container mx-auto px-4 py-10 transition-all duration-700 ${animateItems ? 'opacity-100' : 'opacity-0 translate-y-10'}`}>
        {/* Team header */}
        <div className="flex flex-col md:flex-row items-center justify-center md:justify-start gap-6 mb-10">
          <div className="w-40 h-40 relative flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 animate-pulse-slow"></div>
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/10 to-purple-500/10 transform scale-110 blur-md"></div>
            <img 
              src={`/logos/${decodedTeamName}.png`} 
              alt={`${decodedTeamName} Logo`} 
              className="w-4/5 h-4/5 object-contain relative z-10 drop-shadow-lg"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.style.display = 'none';
                if (e.currentTarget.parentElement) {
                  e.currentTarget.parentElement.classList.add('rounded-full', 'bg-gradient-to-br', 'from-blue-600/30', 'via-purple-600/30', 'to-blue-900/30', 'border', 'border-white/20', 'flex', 'items-center', 'justify-center');
                  e.currentTarget.parentElement.innerHTML = `
                    <div class="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 animate-pulse-slow"></div>
                    <span class="relative z-10 text-5xl font-bold text-white opacity-90">${getTeamInitials(decodedTeamName)}</span>
                  `;
                }
              }}
            />
          </div>
          <div>
            <h1 className="text-4xl md:text-6xl font-bold relative">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-purple-400 to-blue-200">
                {decodedTeamName}
              </span>
              <span className="absolute -left-2 -top-2 text-blue-500 opacity-20 blur-sm">
                {decodedTeamName}
              </span>
              <span className="absolute -right-2 -bottom-2 text-purple-500 opacity-20 blur-sm">
                {decodedTeamName}
              </span>
            </h1>
            <div className="mt-3 bg-black/30 backdrop-blur-sm rounded-lg py-2 px-4 inline-flex">
              <p className="text-lg text-blue-200">Beluga League Team</p>
            </div>
          </div>
        </div>
        
        {/* Tab Navigation */}
        <div className="flex justify-center mb-10">
          <div className="bg-black/30 backdrop-blur-sm rounded-full p-1 flex">
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-8 py-3 rounded-full font-medium transition-all ${
                activeTab === 'schedule' 
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white' 
                : 'text-blue-200 hover:text-white'
              }`}
            >
              Schedule
            </button>
            <button
              onClick={() => setActiveTab('roster')}
              className={`px-8 py-3 rounded-full font-medium transition-all ${
                activeTab === 'roster' 
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white' 
                : 'text-blue-200 hover:text-white'
              }`}
            >
              Roster
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={`px-8 py-3 rounded-full font-medium transition-all ${
                activeTab === 'stats' 
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white' 
                : 'text-blue-200 hover:text-white'
              }`}
            >
              Stats
            </button>
          </div>
        </div>
        
        {/* Content Sections */}
        <div className="min-h-[500px]">
          {/* Schedule Tab */}
          {activeTab === 'schedule' && (
            <div className="space-y-6 mb-10">
              <h2 className="text-2xl font-bold text-center">
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
                  {decodedTeamName}&apos;s Schedule
                </span>
              </h2>
              
              {/* Division Tabs */}
              {teamDivisions.length > 0 && (
                <div className="flex flex-wrap justify-center gap-4 mb-8">
                  {teamDivisions.map((division) => (
                    <button 
                      key={division}
                      className={`relative px-8 py-3 rounded-lg font-bold text-lg transition-all duration-300 transform 
                        ${activeScheduleTab === division 
                          ? 'bg-gradient-to-r from-blue-500 to-purple-600 scale-105 shadow-xl' 
                          : 'bg-black/30 hover:bg-black/50 border border-white/10'
                        } overflow-hidden group`}
                      onClick={() => setActiveScheduleTab(division)}
                    >
                      <span className={`relative z-10 ${activeScheduleTab === division ? 'text-white' : 'group-hover:text-blue-200 transition-colors'}`}>
                        {getDivisionDisplayName(division)}
                      </span>
                      {activeScheduleTab === division && (
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20 blur-sm"></div>
                      )}
                      <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300"></div>
                    </button>
                  ))}
                </div>
              )}
              
              {isLoading ? (
                <div className="flex justify-center py-20">
                  <div className="w-16 h-16 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin"></div>
                </div>
              ) : teamDivisions.length > 0 ? (
                <div className="space-y-8 perspective-1000">
                  {teamSchedules[activeScheduleTab] && Object.entries(teamSchedules[activeScheduleTab] || {}).map(([week, matches]) => (
                    <div key={week} className="bg-black/30 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden hover:border-blue-400/30 transition-all duration-300 transform hover:scale-[1.01] hover:shadow-[0_10px_40px_-15px_rgba(59,130,246,0.3)]">
                      <div className="px-6 py-4 bg-gradient-to-r from-blue-900/50 to-purple-900/50">
                        <h3 className="text-xl font-bold flex items-center">
                          <span className="inline-flex items-center justify-center w-10 h-10 mr-3 rounded-full bg-gradient-to-br from-blue-600/40 to-purple-600/40 text-white shadow-inner">
                            {week.split(' ')[1]}
                          </span>
                          <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-100 to-purple-100">
                            {week}
                          </span>
                        </h3>
                      </div>
                      <div className="p-6">
                        <div className="grid gap-4">
                          {matches.map((match, index) => {
                            // Always put the team on the left
                            const isTeamOnRight = match[1] === decodedTeamName;
                            const leftTeam = isTeamOnRight ? match[1] : match[0];
                            const rightTeam = isTeamOnRight ? match[0] : match[1];
                            
                            return (
                              <div 
                                key={`${week}-match-${index}`}
                                className="match-card bg-gradient-to-br from-blue-900/40 to-purple-900/40 shadow-[0_0_25px_rgba(59,130,246,0.2)] backdrop-blur-sm p-6 rounded-2xl border border-blue-400/30 transition-all transform hover:-translate-y-1 hover:scale-[1.02] hover:shadow-[0_5px_30px_rgba(59,130,246,0.5)] duration-300 relative group overflow-hidden"
                              >
                                <div className="absolute top-0 left-0 w-full h-full bg-grid-pattern opacity-5"></div>
                                <div className="absolute inset-0 overflow-hidden">
                                  <div className="absolute -left-10 top-1/2 -translate-y-1/2 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl"></div>
                                  <div className="absolute -right-10 top-1/2 -translate-y-1/2 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl"></div>
                                </div>
                                
                                <div className="flex items-center justify-between relative">
                                  {/* Left Team (Always the current team) */}
                                  <div className="flex flex-col items-center w-5/12 group/team">
                                    <div className="h-20 w-20 relative mb-3 flex items-center justify-center">
                                      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/40 to-purple-500/40 animate-pulse shadow-lg shadow-blue-500/30"></div>
                                      <div className="absolute inset-0 rounded-full bg-blue-500/30 transform scale-90 animate-pulse-slow blur-md"></div>
                                      <div className="h-16 w-16 relative flex items-center justify-center transform transition-transform duration-300 hover:scale-110 cursor-pointer">
                                        <img 
                                          src={`/logos/${leftTeam}.png`} 
                                          alt={leftTeam} 
                                          className="h-14 w-14 object-contain relative z-10 drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]"
                                          onError={(e) => {
                                            e.currentTarget.onerror = null;
                                            e.currentTarget.style.display = 'none';
                                            if (e.currentTarget.parentElement) {
                                              e.currentTarget.parentElement.classList.add('rounded-full', 'bg-gradient-to-br', 'from-blue-600/20', 'via-purple-600/20', 'to-blue-900/20', 'flex', 'items-center', 'justify-center');
                                              e.currentTarget.parentElement.innerHTML = `<span class="text-xl font-bold text-white opacity-80">${getTeamInitials(leftTeam)}</span>`;
                                            }
                                          }}
                                        />
                                      </div>
                                    </div>
                                    <div className="text-center">
                                      <p className="font-extrabold text-lg drop-shadow-[0_0_8px_rgba(59,130,246,0.8)] text-white mb-1">
                                        {leftTeam}
                                      </p>
                                      <span className="px-3 py-1 bg-blue-500/30 rounded-full text-xs font-medium text-blue-100">
                                        {isTeamOnRight ? getDivisionDisplayName(activeScheduleTab) : "Opponent"}
                                      </span>
                                    </div>
                                  </div>

                                  {/* VS */}
                                  <div className="flex-shrink-0 w-2/12 flex flex-col items-center justify-center">
                                    <div className="h-16 w-px bg-gradient-to-b from-transparent via-blue-400/50 to-transparent"></div>
                                    <div className="h-10 w-10 flex items-center justify-center rounded-full bg-gradient-to-r from-blue-800/80 to-purple-800/80 shadow-[0_0_15px_rgba(59,130,246,0.4)]">
                                      <span className="text-lg font-bold bg-gradient-to-r from-blue-200 to-purple-200 text-transparent bg-clip-text">VS</span>
                                    </div>
                                    <div className="h-16 w-px bg-gradient-to-b from-transparent via-purple-400/50 to-transparent"></div>
                                  </div>

                                  {/* Right Team (Always the opponent) */}
                                  <div className="flex flex-col items-center w-5/12 group/team">
                                    <div className="h-20 w-20 relative mb-3 flex items-center justify-center opacity-90 hover:opacity-100 transition-opacity">
                                      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20"></div>
                                      <div className="h-16 w-16 relative flex items-center justify-center transform transition-transform duration-300 hover:scale-110 cursor-pointer">
                                        <Link href={`/teams/${encodeURIComponent(rightTeam)}`}>
                                          <img 
                                            src={`/logos/${rightTeam}.png`} 
                                            alt={rightTeam} 
                                            className="h-14 w-14 object-contain relative z-10"
                                            onError={(e) => {
                                              e.currentTarget.onerror = null;
                                              e.currentTarget.style.display = 'none';
                                              if (e.currentTarget.parentElement) {
                                                e.currentTarget.parentElement.classList.add('rounded-full', 'bg-gradient-to-br', 'from-blue-600/20', 'via-purple-600/20', 'to-blue-900/20', 'flex', 'items-center', 'justify-center');
                                                e.currentTarget.parentElement.innerHTML = `<span class="text-xl font-bold text-white opacity-80">${getTeamInitials(rightTeam)}</span>`;
                                              }
                                            }}
                                          />
                                        </Link>
                                      </div>
                                    </div>
                                    <div className="text-center">
                                      <p className="font-medium text-lg text-blue-200 mb-1 group-hover/team:text-white transition-colors duration-300">
                                        {rightTeam}
                                      </p>
                                      <span className="px-3 py-1 bg-purple-500/20 rounded-full text-xs font-medium text-purple-200">
                                        Opponent
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Match details */}
                                <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                                  <span className="text-xs text-blue-300/70 bg-black/30 px-3 py-1 rounded-full">
                                    {week}
                                  </span>
                                </div>
                                
                                {/* Particle effects */}
                                <div className="absolute inset-0 overflow-hidden rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-500">
                                  <div className="absolute top-1/4 left-1/4 w-1 h-1 bg-blue-400 rounded-full animate-float"></div>
                                  <div className="absolute bottom-1/3 right-1/4 w-2 h-2 bg-purple-400 rounded-full animate-float animation-delay-300"></div>
                                  <div className="absolute top-1/3 right-1/3 w-1.5 h-1.5 bg-blue-300 rounded-full animate-float animation-delay-700"></div>
                                  <div className="absolute bottom-1/4 left-1/2 w-1 h-1 bg-purple-300 rounded-full animate-float animation-delay-1000"></div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-black/30 backdrop-blur-sm rounded-xl border border-white/10 p-10 text-center">
                  <p className="text-xl text-blue-200">No matches found for {decodedTeamName}.</p>
                </div>
              )}
            </div>
          )}
          
          {/* Roster Tab */}
          {activeTab === 'roster' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-center mb-8">
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
                  {decodedTeamName}&apos;s Roster
                </span>
              </h2>

              {rosterLoading ? (
                <div className="flex justify-center py-20">
                  <div className="w-16 h-16 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin"></div>
                </div>
              ) : rosterError ? (
                <div className="bg-red-500/10 backdrop-blur-sm rounded-xl border border-red-500/30 p-10 text-center">
                  <p className="text-xl text-red-300">{rosterError}</p>
                </div>
              ) : roster ? (
                <div className="space-y-8">
                  {/* Team Leadership */}
                  {(roster.gm || Object.values(roster.captains).some(c => c.length > 0)) && (
                    <div className="bg-gradient-to-br from-yellow-900/30 to-yellow-800/20 backdrop-blur-md rounded-xl border border-yellow-400/30 p-6 shadow-xl">
                      <h3 className="text-2xl font-bold text-yellow-300 mb-6 flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        Team Leadership
                      </h3>
                      
                      <div className="space-y-4">
                        {/* General Manager */}
                        {roster.gm && (
                          <div className="bg-black/30 rounded-lg p-4 border border-yellow-500/20">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                  <span className="px-3 py-1 bg-yellow-500/30 text-yellow-200 rounded-full text-sm font-bold">
                                    {roster.gm.gmRole}
                                  </span>
                                </div>
                                <Link
                                  href={`/players/${encodeURIComponent(roster.gm.username)}`}
                                  className="text-xl font-bold text-white hover:text-yellow-300 transition-colors"
                                >
                                  {roster.gm.displayName}
                                </Link>
                                <div className="text-sm text-yellow-200/70 mt-1">
                                  SAL: <span className="font-mono font-bold text-yellow-300">{roster.gm.salary.toFixed(2)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Captains by Division */}
                        {['major', 'aaa', 'aa'].map(division => {
                          const captains = roster.captains[division];
                          if (!captains || captains.length === 0) return null;
                          
                          return (
                            <div key={division} className="bg-black/30 rounded-lg p-4 border border-yellow-500/20">
                              <div className="grid gap-3">
                                {captains.map((captain, idx) => (
                                  <div key={idx} className="flex items-center justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-3 mb-2">
                                        <span className="px-3 py-1 bg-yellow-500/30 text-yellow-200 rounded-full text-sm font-bold">
                                          {captain.captainRole}
                                        </span>
                                      </div>
                                      <Link
                                        href={`/players/${encodeURIComponent(captain.username)}`}
                                        className="text-lg font-bold text-white hover:text-yellow-300 transition-colors"
                                      >
                                        {captain.displayName}
                                      </Link>
                                      <div className="text-sm text-yellow-200/70 mt-1">
                                        SAL: <span className="font-mono font-bold text-yellow-300">{captain.salary.toFixed(2)}</span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Division Tabs for Players */}
                  {Object.keys(roster.players).some(div => roster.players[div].length > 0) && (
                    <>
                      <div className="flex flex-wrap justify-center gap-4 mb-6">
                        {['aa', 'aaa', 'major'].map(division => {
                          if (!roster.players[division] || roster.players[division].length === 0) return null;
                          
                          return (
                            <button
                              key={division}
                              onClick={() => setActiveRosterTab(division)}
                              className={`px-8 py-3 rounded-lg font-bold text-lg transition-all duration-300 transform ${
                                activeRosterTab === division
                                  ? 'bg-gradient-to-r from-blue-500 to-purple-600 scale-105 shadow-xl'
                                  : 'bg-black/30 hover:bg-black/50 border border-white/10'
                              }`}
                            >
                              {getDivisionDisplayName(division)} League
                              <span className="ml-2 text-sm opacity-70">
                                ({roster.players[division].length})
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Players List */}
                      <div className="bg-black/40 backdrop-blur-md rounded-xl border border-white/10 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="bg-gradient-to-r from-blue-900/50 to-purple-900/50">
                                <th className="px-6 py-4 text-left text-sm font-bold text-blue-200 uppercase tracking-wider">
                                  Player
                                </th>
                                <th className="px-6 py-4 text-center text-sm font-bold text-blue-200 uppercase tracking-wider">
                                  SAL
                                </th>
                                <th className="px-6 py-4 text-center text-sm font-bold text-blue-200 uppercase tracking-wider hidden md:table-cell">
                                  2s Peak
                                </th>
                                <th className="px-6 py-4 text-center text-sm font-bold text-blue-200 uppercase tracking-wider hidden md:table-cell">
                                  3s Peak
                                </th>
                                <th className="px-6 py-4 text-center text-sm font-bold text-blue-200 uppercase tracking-wider hidden lg:table-cell">
                                  Account
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {roster.players[activeRosterTab]?.map((player, index) => (
                                <tr
                                  key={index}
                                  className={`${
                                    index % 2 === 0 ? 'bg-black/20' : 'bg-black/30'
                                  } hover:bg-blue-900/20 transition-colors duration-200`}
                                >
                                  <td className="px-6 py-4">
                                    <Link
                                      href={`/players/${encodeURIComponent(player.username)}`}
                                      className="flex items-center gap-3 group"
                                    >
                                      {/* Team Logo Avatar */}
                                      {getTeamLogo(decodedTeamName) ? (
                                        <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10 border-2 border-blue-400/30 shadow-lg flex-shrink-0 group-hover:border-blue-300 transition-colors">
                                          <img 
                                            src={getTeamLogo(decodedTeamName)} 
                                            alt={`${decodedTeamName} logo`}
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                              e.target.style.display = 'none';
                                              e.target.parentElement.classList.add('bg-gradient-to-br', 'from-blue-500/30', 'to-purple-500/30', 'flex', 'items-center', 'justify-center');
                                              e.target.parentElement.innerHTML = `<span class="text-white font-bold">${player.displayName.charAt(0).toUpperCase()}</span>`;
                                            }}
                                          />
                                        </div>
                                      ) : (
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center text-white font-bold flex-shrink-0">
                                          {player.displayName.charAt(0).toUpperCase()}
                                        </div>
                                      )}
                                      <div>
                                        <div className="font-bold text-white group-hover:text-blue-300 transition-colors">
                                          {player.displayName}
                                        </div>
                                        <div className="text-xs text-blue-300/70">
                                          @{player.username}
                                        </div>
                                      </div>
                                    </Link>
                                  </td>
                                  <td className="px-6 py-4 text-center">
                                    <span className="text-lg font-mono font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-300 to-purple-300">
                                      {player.salary.toFixed(2)}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-center hidden md:table-cell">
                                    <span className="text-blue-200">
                                      {player.sal2sPeak || '-'}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-center hidden md:table-cell">
                                    <span className="text-blue-200">
                                      {player.sal3sPeak || '-'}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-center hidden lg:table-cell">
                                    {player.mainAccount ? (
                                      <a
                                        href={player.mainAccount.startsWith('http') ? player.mainAccount : `https://rocketleague.tracker.network/rocket-league/profile/epic/${encodeURIComponent(player.mainAccount)}/overview`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-400 hover:text-blue-300 transition-colors text-sm underline"
                                      >
                                        View Profile
                                      </a>
                                    ) : (
                                      <span className="text-blue-300/50 text-sm">-</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Field Combinations Section */}
                      {roster.players[activeRosterTab]?.length >= 3 && (() => {
                        const combinations = calculateFieldCombinations(roster.players[activeRosterTab], activeRosterTab);
                        const validCombos = combinations.filter(c => !c.overCap);
                        const overCapCombos = combinations.filter(c => c.overCap);
                        const range = getSalaryRange(activeRosterTab);

                        if (combinations.length === 0) {
                          return (
                            <div className="mt-8 bg-black/40 backdrop-blur-md rounded-xl border border-white/10 p-6">
                              <h3 className="text-xl font-bold text-blue-200 mb-4">
                                Field Combinations (Cap: {getFieldCap(activeRosterTab)}{range ? ` | Range: ${range.min}–${range.max}` : ''})
                              </h3>
                              <p className="text-blue-300/70">No 3-player combinations found.</p>
                            </div>
                          );
                        }

                        return (
                          <div className="mt-8 bg-black/40 backdrop-blur-md rounded-xl border border-white/10 overflow-hidden">
                            <div className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 px-6 py-4">
                              <h3 className="text-xl font-bold text-blue-200 flex items-center justify-between">
                                <span>Possible Field Combinations</span>
                                <span className="text-sm font-normal text-blue-300 flex items-center gap-3">
                                  <span>Field Cap: <span className="font-mono font-bold">{getFieldCap(activeRosterTab)}</span></span>
                                  {range && (
                                    <span>Salary Range: <span className="font-mono font-bold">{range.min}–{range.max}</span></span>
                                  )}
                                </span>
                              </h3>
                              <p className="text-sm text-blue-300/70 mt-1">
                                {validCombos.length} valid lineup{validCombos.length !== 1 ? 's' : ''}
                                {overCapCombos.length > 0 && (
                                  <span className="text-red-400 ml-2">· {overCapCombos.length} over cap</span>
                                )}
                              </p>
                            </div>

                            <div className="p-6 max-h-[600px] overflow-y-auto">
                              <div className="grid gap-4">
                                {combinations.map((combo, index) => (
                                  <div
                                    key={index}
                                    className={`bg-gradient-to-br ${
                                      combo.overCap
                                        ? 'from-red-900/40 to-red-800/30 border-red-500/50 hover:border-red-400/70'
                                        : index === 0 ? 'from-yellow-900/30 to-yellow-800/20 border-yellow-400/40 hover:border-blue-400/60'
                                        : index < 5 ? 'from-blue-900/40 to-purple-900/30 border-blue-400/30 hover:border-blue-400/60'
                                        : 'from-blue-900/20 to-purple-900/20 border-blue-400/20 hover:border-blue-400/60'
                                    } backdrop-blur-sm rounded-lg border p-4 transition-all duration-200`}
                                  >
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-2">
                                        <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                                          combo.overCap ? 'bg-red-500/30 text-red-200' :
                                          index === 0 ? 'bg-yellow-500/30 text-yellow-200' :
                                          index < 5 ? 'bg-blue-500/30 text-blue-200' :
                                          'bg-blue-500/20 text-blue-300'
                                        }`}>
                                          #{index + 1}
                                        </span>
                                        {combo.overCap ? (
                                          <span className="px-2 py-1 bg-red-500/20 text-red-300 rounded text-xs font-medium">
                                            Over Cap
                                          </span>
                                        ) : index === 0 && (
                                          <span className="px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded text-xs font-medium flex items-center gap-1">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                            </svg>
                                            Highest
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-right">
                                        <div className={`text-2xl font-mono font-bold bg-clip-text text-transparent bg-gradient-to-r ${
                                          combo.overCap ? 'from-red-300 to-red-400' : 'from-blue-300 to-purple-300'
                                        }`}>
                                          {combo.totalSalary.toFixed(2)}
                                        </div>
                                        <div className={`text-xs ${combo.overCap ? 'text-red-400' : 'text-blue-400'}`}>Total SAL</div>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                      {combo.players.map((player, pIndex) => (
                                        <Link
                                          key={pIndex}
                                          href={`/players/${encodeURIComponent(player.username)}`}
                                          className={`rounded-lg p-3 transition-colors group ${
                                            combo.overCap ? 'bg-red-950/40 hover:bg-red-900/50' : 'bg-black/30 hover:bg-black/50'
                                          }`}
                                        >
                                          <div className="flex items-center gap-2 mb-2">
                                            {getTeamLogo(decodedTeamName) ? (
                                              <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 border border-blue-400/30 flex-shrink-0">
                                                <img
                                                  src={getTeamLogo(decodedTeamName)}
                                                  alt={`${decodedTeamName} logo`}
                                                  className="w-full h-full object-cover"
                                                />
                                              </div>
                                            ) : (
                                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                                                {player.displayName.charAt(0).toUpperCase()}
                                              </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                              <div className={`font-bold transition-colors truncate text-sm ${
                                                combo.overCap ? 'text-red-200 group-hover:text-red-100' : 'text-white group-hover:text-blue-300'
                                              }`}>
                                                {player.displayName}
                                              </div>
                                              <div className={`text-xs truncate ${combo.overCap ? 'text-red-300/70' : 'text-blue-300/70'}`}>
                                                @{player.username}
                                              </div>
                                            </div>
                                          </div>
                                          <div className="flex items-center justify-between text-xs">
                                            <span className={combo.overCap ? 'text-red-300/70' : 'text-blue-300/70'}>SAL:</span>
                                            <span className={`font-mono font-bold ${combo.overCap ? 'text-red-200' : 'text-blue-200'}`}>
                                              {player.salary.toFixed(2)}
                                            </span>
                                          </div>
                                          {(player.sal2sPeak || player.sal3sPeak) && (
                                            <div className="flex items-center justify-between text-xs mt-1">
                                              <span className={combo.overCap ? 'text-red-300/70' : 'text-blue-300/70'}>Peaks:</span>
                                              <span className={`font-mono ${combo.overCap ? 'text-red-200' : 'text-blue-200'}`}>
                                                {player.sal2sPeak || '?'} / {player.sal3sPeak || '?'}
                                              </span>
                                            </div>
                                          )}
                                        </Link>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}

                  {/* No Players Message */}
                  {!Object.keys(roster.players).some(div => roster.players[div].length > 0) && (
                    <div className="bg-black/30 backdrop-blur-sm rounded-xl border border-white/10 p-10 text-center">
                      <p className="text-xl text-blue-200">
                        No players found for {decodedTeamName}.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
          
          {/* Stats Tab - Under Development */}
          {activeTab === 'stats' && (
            <div className="bg-black/40 backdrop-blur-md p-12 rounded-2xl border border-white/10 shadow-xl max-w-3xl mx-auto text-center">
              <div className="w-24 h-24 mx-auto mb-6 relative">
                <div className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping"></div>
                <div className="absolute inset-4 rounded-full bg-blue-500/40"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
              </div>
              
              <h2 className="text-3xl font-bold mb-6 text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-purple-400 to-blue-200">
                Team Stats Coming Soon
              </h2>
              
              <p className="text-xl mb-8 text-blue-100">
                The {decodedTeamName} statistics dashboard is currently being developed.
              </p>
              
              <p className="text-lg text-blue-200 mb-6">
                Please check back soon for detailed team performance stats!
              </p>
            </div>
          )}
        </div>
        
        {/* Return to Home Button */}
        <div className="flex justify-center mt-16">
          <Link 
            href="/" 
            className="relative group px-8 py-4 bg-gradient-to-r from-black/20 to-black/40 backdrop-blur-sm rounded-full font-medium text-white border border-white/20 hover:border-blue-400 transition-all transform hover:scale-105 overflow-hidden"
          >
            <span className="relative z-10 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              Return to Home
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-500/20 transform translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
          </Link>
        </div>
      </div>
    </div>
  );
}
