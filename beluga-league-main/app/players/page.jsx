"use client"

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function PlayerDirectoryPage() {
  const router = useRouter();
  const [players, setPlayers] = useState([]);
  const [filteredPlayers, setFilteredPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
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
  
  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('all');
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [salaryRange, setSalaryRange] = useState([0, 25]);
  const [showOnlyRegistered, setShowOnlyRegistered] = useState(false);
  const [showOnlyEligible, setShowOnlyEligible] = useState(false);
  const [showOnlyFreeAgents, setShowOnlyFreeAgents] = useState(false);
  const [sortBy, setSortBy] = useState('salary'); // name, salary, team, league
  const [sortOrder, setSortOrder] = useState('desc');
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const playersPerPage = 20;
  
  // Preserve scroll position and page when returning
  useEffect(() => {
    const savedPage = sessionStorage.getItem('playerDirectoryPage');
    const savedScrollPos = sessionStorage.getItem('playerDirectoryScroll');
    
    if (savedPage) {
      setCurrentPage(parseInt(savedPage, 10));
      sessionStorage.removeItem('playerDirectoryPage');
    }
    
    if (savedScrollPos) {
      setTimeout(() => {
        window.scrollTo(0, parseInt(savedScrollPos, 10));
        sessionStorage.removeItem('playerDirectoryScroll');
      }, 100);
    }
  }, []);
  
  // Save scroll position and page before navigating
  const handlePlayerClick = (username) => {
    sessionStorage.setItem('playerDirectoryPage', currentPage.toString());
    sessionStorage.setItem('playerDirectoryScroll', window.scrollY.toString());
    router.push(`/players/${encodeURIComponent(username)}`);
  };
  
  // Fetch players data
  useEffect(() => {
    async function fetchPlayers() {
      try {
        setLoading(true);
        const response = await fetch('/api/players');
        const data = await response.json();
        
        if (data.error) {
          setError(data.error);
        } else {
          setPlayers(data.players);
          setFilteredPlayers(data.players);
        }
      } catch (err) {
        setError('Failed to load player data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    
    fetchPlayers();
  }, []);
  
  // Filter and sort players
  useEffect(() => {
    let filtered = [...players];
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p => 
        p.username.toLowerCase().includes(query) ||
        p.displayName.toLowerCase().includes(query) ||
        p.team.toLowerCase().includes(query)
      );
    }
    
    // Team filter
    if (selectedTeam !== 'all') {
      filtered = filtered.filter(p => p.team === selectedTeam);
    }
    
    // League filter
    if (selectedLeague !== 'all') {
      filtered = filtered.filter(p => p.league === selectedLeague);
    }
    
    // Salary range filter
    filtered = filtered.filter(p => 
      p.salary >= salaryRange[0] && p.salary <= salaryRange[1]
    );
    
    // Registration filter
    if (showOnlyRegistered) {
      filtered = filtered.filter(p => p.isRegistered);
    }
    
    // Eligibility filter
    if (showOnlyEligible) {
      filtered = filtered.filter(p => p.isEligible && !p.isSuspended && !p.isIneligible);
    }
    
    // Free agents filter
    if (showOnlyFreeAgents) {
      filtered = filtered.filter(p => p.isFreeAgent);
    }
    
    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.displayName.localeCompare(b.displayName);
          break;
        case 'salary':
          comparison = a.salary - b.salary;
          break;
        case 'team':
          comparison = a.team.localeCompare(b.team);
          break;
        case 'league':
          comparison = a.league.localeCompare(b.league);
          break;
        default:
          comparison = 0;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    
    setFilteredPlayers(filtered);
    setCurrentPage(1); // Reset to first page when filters change
  }, [players, searchQuery, selectedTeam, selectedLeague, salaryRange, showOnlyRegistered, showOnlyEligible, showOnlyFreeAgents, sortBy, sortOrder]);
  
  // Get unique teams and leagues
  const teams = ['all', ...new Set(players.map(p => p.team).filter(Boolean).sort())];
  const leagues = ['all', ...new Set(players.map(p => p.league).filter(Boolean).sort())];
  
  // Pagination
  const indexOfLastPlayer = currentPage * playersPerPage;
  const indexOfFirstPlayer = indexOfLastPlayer - playersPerPage;
  const currentPlayers = filteredPlayers.slice(indexOfFirstPlayer, indexOfLastPlayer);
  const totalPages = Math.ceil(filteredPlayers.length / playersPerPage);
  
  // Handle sort toggle
  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-xl text-blue-200">Loading players...</p>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-red-400 mb-4">{error}</p>
          <Link href="/" className="text-blue-400 hover:text-blue-300">Return to Home</Link>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-950 text-white">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="bg-decor absolute top-20 left-10 w-64 h-64 rounded-full bg-blue-500/5 blur-3xl"></div>
        <div className="bg-decor absolute bottom-40 right-10 w-80 h-80 rounded-full bg-purple-500/5 blur-3xl"></div>
      </div>
      
      <div className="container mx-auto px-4 py-10 relative z-10">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-5xl md:text-6xl font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-purple-400 to-blue-200">
            Player Directory
          </h1>
          <p className="text-xl text-blue-200">
            {filteredPlayers.length} {filteredPlayers.length === 1 ? 'player' : 'players'} found
          </p>
        </div>
        
        {/* Filters */}
        <div className="bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 p-6 mb-6">
          {/* Search bar */}
          <div className="mb-4">
            <div className="relative">
              <input
                type="text"
                className="w-full bg-black/40 text-white border border-blue-500/30 rounded-lg px-4 py-3 pl-10 focus:outline-none focus:border-blue-400 transition-all duration-300"
                placeholder="Search by name or team..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="absolute left-3 top-3.5 text-blue-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          </div>
          
          {/* Filter options */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {/* Team filter */}
            <div>
              <label className="text-sm text-blue-300 mb-2 block">Team</label>
              <select
                className="w-full bg-black/40 text-white border border-blue-500/30 rounded px-3 py-2 focus:outline-none focus:border-blue-400"
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
              >
                {teams.map(team => (
                  <option key={team} value={team}>
                    {team === 'all' ? 'All Teams' : team}
                  </option>
                ))}
              </select>
            </div>
            
            {/* League filter */}
            <div>
              <label className="text-sm text-blue-300 mb-2 block">League</label>
              <select
                className="w-full bg-black/40 text-white border border-blue-500/30 rounded px-3 py-2 focus:outline-none focus:border-blue-400"
                value={selectedLeague}
                onChange={(e) => setSelectedLeague(e.target.value)}
              >
                {leagues.map(league => (
                  <option key={league} value={league}>
                    {league === 'all' ? 'All Leagues' : league}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Sort by */}
            <div>
              <label className="text-sm text-blue-300 mb-2 block">Sort By</label>
              <select
                className="w-full bg-black/40 text-white border border-blue-500/30 rounded px-3 py-2 focus:outline-none focus:border-blue-400"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="name">Name</option>
                <option value="salary">Salary</option>
                <option value="team">Team</option>
                <option value="league">League</option>
              </select>
            </div>
            
            {/* Sort order */}
            <div>
              <label className="text-sm text-blue-300 mb-2 block">Order</label>
              <select
                className="w-full bg-black/40 text-white border border-blue-500/30 rounded px-3 py-2 focus:outline-none focus:border-blue-400"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
          </div>
          
          {/* Salary range */}
          <div className="mb-4">
            <label className="text-sm text-blue-300 mb-2 block">
              Salary Range: {salaryRange[0].toFixed(1)} - {salaryRange[1].toFixed(1)}
            </label>
            <div className="flex gap-4 items-center">
              <input
                type="range"
                min="0"
                max="25"
                step="0.5"
                value={salaryRange[0]}
                onChange={(e) => setSalaryRange([parseFloat(e.target.value), salaryRange[1]])}
                className="flex-1"
              />
              <input
                type="range"
                min="0"
                max="25"
                step="0.5"
                value={salaryRange[1]}
                onChange={(e) => setSalaryRange([salaryRange[0], parseFloat(e.target.value)])}
                className="flex-1"
              />
            </div>
          </div>
          
          {/* Checkboxes */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyRegistered}
                onChange={(e) => setShowOnlyRegistered(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-blue-200">Registered Only</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyEligible}
                onChange={(e) => setShowOnlyEligible(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-blue-200">Eligible Only</span>
            </label>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyFreeAgents}
                onChange={(e) => setShowOnlyFreeAgents(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-blue-200">Free Agents Only</span>
            </label>
          </div>
        </div>
        
        {/* Players grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
          {currentPlayers.map((player, index) => (
            <div
              key={`${player.userId}-${index}`}
              onClick={() => handlePlayerClick(player.username)}
              className="bg-gradient-to-br from-blue-900/50 to-purple-900/40 backdrop-blur-sm rounded-xl p-5 border border-blue-500/30 hover:border-blue-400/60 hover:shadow-xl hover:shadow-blue-500/20 transition-all duration-300 cursor-pointer group relative overflow-hidden"
            >
              {/* Hover gradient effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600/0 via-blue-600/5 to-purple-600/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              
              <div className="relative z-10">
                {/* Player header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0 flex items-start gap-3">
                    {/* Team Logo Avatar */}
                    {getTeamLogo(player.team) && (
                      <Link
                        href={`/teams/${encodeURIComponent(player.team.replace(/ (Majors|AAA|AA)$/i, '').trim())}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-shrink-0 w-10 h-10 rounded-full overflow-hidden bg-white/10 border-2 border-blue-400/30 shadow-lg hover:border-blue-300 hover:scale-110 transition-all duration-200"
                      >
                        <img 
                          src={getTeamLogo(player.team)} 
                          alt={`${player.team} logo`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.target.style.display = 'none';
                          }}
                        />
                      </Link>
                    )}
                    
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-bold text-lg mb-1 group-hover:text-blue-200 transition-colors truncate">
                        {player.displayName}
                      </h3>
                      {player.username !== player.displayName && (
                        <p className="text-xs text-blue-300/80 mb-1 truncate">@{player.username}</p>
                      )}
                      <p className="text-sm text-blue-200 font-medium truncate">{player.team}</p>
                    </div>
                  </div>
                  <div className="text-right ml-3 flex-shrink-0">
                    <div className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-300 to-purple-300">
                      {player.salary.toFixed(2)}
                    </div>
                    <div className="text-xs text-blue-400 uppercase font-semibold">SAL</div>
                  </div>
                </div>
                
                {/* League badge */}
                <div className="mb-3">
                  <span className="inline-block px-3 py-1 bg-blue-500/30 text-blue-100 rounded-md text-xs font-medium border border-blue-400/20">
                    {player.league}
                  </span>
                </div>
                
                {/* Status badges */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {player.isRegistered ? (
                    <span className="text-xs px-2.5 py-1 bg-green-500/20 text-green-300 rounded-md font-medium border border-green-500/30">
                      ✓ Registered
                    </span>
                  ) : (
                    <span className="text-xs px-2.5 py-1 bg-red-500/20 text-red-300 rounded-md font-medium border border-red-500/30">
                      ✗ Not Registered
                    </span>
                  )}
                  
                  {player.isEligible && !player.isSuspended && !player.isIneligible && !player.isIR && (
                    <span className="text-xs px-2.5 py-1 bg-blue-500/20 text-blue-300 rounded-md font-medium border border-blue-500/30">
                      Eligible
                    </span>
                  )}
                  
                  {/* Show Ineligible badge if isIneligible OR if registered but not eligible (Column J = NO) */}
                  {(player.isIneligible || (player.isRegistered && !player.isEligible)) && !player.isSuspended && !player.isIR && (
                    <span className="text-xs px-2.5 py-1 bg-red-500/20 text-red-300 rounded-md font-medium border border-red-500/30">
                      Ineligible
                    </span>
                  )}
                  
                  {player.isSuspended && (
                    <span className="text-xs px-2.5 py-1 bg-red-500/20 text-red-300 rounded-md font-medium border border-red-500/30">
                      Suspended
                    </span>
                  )}
                  
                  {player.isIR && (
                    <span className="text-xs px-2.5 py-1 bg-red-500/20 text-red-300 rounded-md font-medium border border-red-500/30">
                      IR
                    </span>
                  )}
                  
                  {player.isRFA && (
                    <span className="text-xs px-2.5 py-1 bg-red-500/20 text-red-300 rounded-md font-medium border border-red-500/30">
                      RFA
                    </span>
                  )}
                  
                  {player.isFreeAgent && (
                    <span className="text-xs px-2.5 py-1 bg-purple-500/20 text-purple-300 rounded-md font-medium border border-purple-500/30">
                      FA
                    </span>
                  )}
                </div>
                
                {/* GM and Captain roles */}
                {(player.gmRole || player.majorsCaptainRole || player.aaaCaptainRole || player.aaCaptainRole) && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {player.gmRole && (
                      <span className="text-xs px-2.5 py-1 bg-yellow-500/20 text-yellow-300 rounded-md font-medium border border-yellow-500/30">
                        {player.gmRole}
                      </span>
                    )}
                    
                    {player.majorsCaptainRole && (
                      <span className="text-xs px-2.5 py-1 bg-yellow-500/20 text-yellow-300 rounded-md font-medium border border-yellow-500/30">
                        {player.majorsCaptainRole}
                      </span>
                    )}
                    
                    {player.aaaCaptainRole && (
                      <span className="text-xs px-2.5 py-1 bg-yellow-500/20 text-yellow-300 rounded-md font-medium border border-yellow-500/30">
                        {player.aaaCaptainRole}
                      </span>
                    )}
                    
                    {player.aaCaptainRole && (
                      <span className="text-xs px-2.5 py-1 bg-yellow-500/20 text-yellow-300 rounded-md font-medium border border-yellow-500/30">
                        {player.aaCaptainRole}
                      </span>
                    )}
                  </div>
                )}
                
                {/* SAL peaks */}
                {(player.sal2sPeak || player.sal3sPeak) && (
                  <div className="text-xs text-blue-300/90 pt-3 border-t border-white/10 space-y-1">
                    {player.sal2sPeak && (
                      <div className="flex justify-between">
                        <span className="text-blue-400">2s Peak:</span>
                        <span className="font-semibold">{player.sal2sPeak}</span>
                      </div>
                    )}
                    {player.sal3sPeak && (
                      <div className="flex justify-between">
                        <span className="text-blue-400">3s Peak:</span>
                        <span className="font-semibold">{player.sal3sPeak}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {/* Click indicator */}
              <div className="absolute bottom-2 right-2 text-blue-400/0 group-hover:text-blue-400/50 transition-all duration-300">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          ))}
        </div>
        
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-8">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-6 py-2 bg-blue-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Previous
            </button>
            
            <div className="flex gap-2 flex-wrap justify-center max-w-md">
              {/* Show first page */}
              {currentPage > 3 && (
                <>
                  <button
                    onClick={() => setCurrentPage(1)}
                    className="px-4 py-2 rounded-lg transition bg-black/40 text-blue-300 hover:bg-black/60"
                  >
                    1
                  </button>
                  {currentPage > 4 && <span className="px-2 py-2 text-blue-300">...</span>}
                </>
              )}
              
              {/* Show pages around current page */}
              {[...Array(totalPages)].map((_, i) => {
                const pageNum = i + 1;
                // Show current page and 2 pages before and after
                if (pageNum >= currentPage - 2 && pageNum <= currentPage + 2) {
                  return (
                    <button
                      key={i}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`px-4 py-2 rounded-lg transition ${
                        currentPage === pageNum
                          ? 'bg-blue-600 text-white font-bold'
                          : 'bg-black/40 text-blue-300 hover:bg-black/60'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                }
                return null;
              })}
              
              {/* Show last page */}
              {currentPage < totalPages - 2 && (
                <>
                  {currentPage < totalPages - 3 && <span className="px-2 py-2 text-blue-300">...</span>}
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    className="px-4 py-2 rounded-lg transition bg-black/40 text-blue-300 hover:bg-black/60"
                  >
                    {totalPages}
                  </button>
                </>
              )}
            </div>
            
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-6 py-2 bg-blue-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition flex items-center gap-2"
            >
              Next
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}
        
        {/* Back button */}
        <div className="flex justify-center">
          <Link
            href="/"
            className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full font-medium text-white hover:from-blue-600 hover:to-purple-700 transition shadow-lg"
          >
            Return to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
