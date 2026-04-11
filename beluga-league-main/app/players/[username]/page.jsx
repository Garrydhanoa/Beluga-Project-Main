"use client"

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

export default function PlayerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const username = decodeURIComponent(params.username);
  
  const [player, setPlayer] = useState(null);
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
  
  useEffect(() => {
    async function fetchPlayerData() {
      try {
        setLoading(true);
        const response = await fetch('/api/players');
        const data = await response.json();
        
        if (data.error) {
          setError(data.error);
        } else {
          const foundPlayer = data.players.find(
            p => p.username.toLowerCase() === username.toLowerCase() ||
                 p.displayName.toLowerCase() === username.toLowerCase()
          );
          
          if (foundPlayer) {
            setPlayer(foundPlayer);
          } else {
            setError('Player not found');
          }
        }
      } catch (err) {
        setError('Failed to load player data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    
    fetchPlayerData();
  }, [username]);
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-xl text-blue-200">Loading player data...</p>
        </div>
      </div>
    );
  }
  
  if (error || !player) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-red-400 mb-4">{error || 'Player not found'}</p>
          <Link href="/players" className="text-blue-400 hover:text-blue-300">Back to Player Directory</Link>
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
      
      <div className="container mx-auto px-4 py-10 relative z-10 max-w-4xl">
        {/* Back button */}
        <button
          onClick={() => router.back()}
          className="mb-6 flex items-center gap-2 text-blue-300 hover:text-blue-200 transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back to Directory
        </button>
        
        {/* Player header */}
        <div className="bg-gradient-to-br from-blue-900/60 to-purple-900/40 backdrop-blur-md rounded-2xl border border-white/20 shadow-2xl p-8 mb-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                {/* Team Logo Avatar or Initial */}
                {getTeamLogo(player.team) ? (
                  <Link 
                    href={`/teams/${encodeURIComponent(player.team.replace(/ (Majors|AAA|AA)$/i, '').trim())}`}
                    className="w-16 h-16 rounded-full overflow-hidden bg-white/10 border-2 border-blue-400/50 shadow-lg hover:border-blue-300 hover:scale-105 transition-all duration-200 cursor-pointer"
                  >
                    <img 
                      src={getTeamLogo(player.team)} 
                      alt={`${player.team} logo`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.parentElement.classList.add('bg-gradient-to-br', 'from-blue-500/30', 'to-purple-500/30', 'flex', 'items-center', 'justify-center');
                        e.target.parentElement.innerHTML = `<span class="text-3xl font-bold text-blue-200">${player.displayName.charAt(0).toUpperCase()}</span>`;
                      }}
                    />
                  </Link>
                ) : (
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 border-2 border-blue-400/50 flex items-center justify-center">
                    <span className="text-3xl font-bold text-blue-200">
                      {player.displayName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div>
                  <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-purple-400 to-blue-200">
                    {player.displayName}
                  </h1>
                  {player.username !== player.displayName && (
                    <p className="text-lg text-blue-300/80 mt-1">@{player.username}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xl text-blue-200 mt-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
                {player.team && player.team !== 'Free Agent' ? player.team : 'Free Agent'}
              </div>
            </div>
            
            <div className="text-center bg-gradient-to-br from-blue-600/20 to-purple-600/20 rounded-2xl p-6 border-2 border-blue-400/30 shadow-lg min-w-[140px]">
              <div className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-300 to-purple-300 mb-2">
                {player.salary.toFixed(2)}
              </div>
              <div className="text-sm text-blue-300 uppercase tracking-wider font-semibold">Salary (SAL)</div>
            </div>
          </div>
          
          {/* Status badges */}
          <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-white/10">
            {player.isRegistered ? (
              <span className="px-4 py-2 bg-green-500/20 text-green-300 rounded-lg font-medium border border-green-500/40 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Registered
              </span>
            ) : (
              <span className="px-4 py-2 bg-red-500/20 text-red-300 rounded-lg font-medium border border-red-500/40 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                Not Registered
              </span>
            )}
            
            {player.isEligible && !player.isSuspended && !player.isIneligible && !player.isIR && (
              <span className="px-4 py-2 bg-blue-500/20 text-blue-300 rounded-lg font-medium border border-blue-500/40">
                ✓ Eligible
              </span>
            )}
            
            {/* Show Ineligible badge if isIneligible OR if registered but not eligible (Column J = NO) */}
            {(player.isIneligible || (player.isRegistered && !player.isEligible)) && !player.isSuspended && !player.isIR && (
              <span className="px-4 py-2 bg-red-500/20 text-red-300 rounded-lg font-medium border border-red-500/40">
                ✗ Ineligible
              </span>
            )}
            
            {player.isSuspended && (  <span className="px-4 py-2 bg-red-500/20 text-red-300 rounded-lg font-medium border border-red-500/40 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                Suspended
              </span>
            )}
            
            {player.isIneligible && (
              <span className="px-4 py-2 bg-red-500/20 text-red-300 rounded-lg font-medium border border-red-500/40">
                ✗ Ineligible
              </span>
            )}
            
            {player.isIR && (
              <span className="px-4 py-2 bg-red-500/20 text-red-300 rounded-lg font-medium border border-red-500/40 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                Injured Reserve
                {player.lastIRDate && <span className="text-xs">({player.lastIRDate})</span>}
              </span>
            )}
            
            {player.isRFA && (
              <span className="px-4 py-2 bg-red-500/20 text-red-300 rounded-lg font-medium border border-red-500/40 flex items-center gap-2">
                RFA
                {player.releaseDate && <span className="text-xs">(Until {player.releaseDate})</span>}
              </span>
            )}
            
            {player.isFreeAgent && (
              <span className="px-4 py-2 bg-purple-500/20 text-purple-300 rounded-lg font-medium border border-purple-500/40">
                Free Agent
              </span>
            )}
            
            {player.gmRole && (
              <span className="px-4 py-2 bg-yellow-500/20 text-yellow-300 rounded-lg font-medium border border-yellow-500/40 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                {player.gmRole}
              </span>
            )}
            
            {player.majorsCaptainRole && (
              <span className="px-4 py-2 bg-yellow-500/20 text-yellow-300 rounded-lg font-medium border border-yellow-500/40">
                {player.majorsCaptainRole}
              </span>
            )}
            
            {player.aaaCaptainRole && (
              <span className="px-4 py-2 bg-yellow-500/20 text-yellow-300 rounded-lg font-medium border border-yellow-500/40">
                {player.aaaCaptainRole}
              </span>
            )}
            
            {player.aaCaptainRole && (
              <span className="px-4 py-2 bg-yellow-500/20 text-yellow-300 rounded-lg font-medium border border-yellow-500/40">
                {player.aaCaptainRole}
              </span>
            )}
            
            {player.isPlaying && (
              <span className="px-4 py-2 bg-green-500/20 text-green-300 rounded-lg font-medium border border-green-500/40">
                Active Player
              </span>
            )}
          </div>
        </div>
        
        {/* Player details grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Basic info */}
          <div className="bg-gradient-to-br from-blue-900/40 to-blue-800/30 backdrop-blur-md rounded-xl border border-blue-400/30 p-6 shadow-lg">
            <div className="flex items-center gap-2 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z" clipRule="evenodd" />
              </svg>
              <h2 className="text-2xl font-bold text-blue-200">Basic Information</h2>
            </div>
            <div className="space-y-4">
              <div className="bg-black/20 rounded-lg p-3 border border-blue-500/20">
                <div className="text-sm text-blue-400 mb-1 font-medium">League</div>
                <div className="text-lg font-semibold text-white">{player.league}</div>
              </div>
              
              {player.team && player.team !== 'Free Agent' && (
                <div className="bg-black/20 rounded-lg p-3 border border-blue-500/20">
                  <div className="text-sm text-blue-400 mb-1 font-medium">Team</div>
                  <div className="text-lg font-semibold text-white">{player.team}</div>
                </div>
              )}
              
              {player.userId && (
                <div className="bg-black/20 rounded-lg p-3 border border-blue-500/20">
                  <div className="text-sm text-blue-400 mb-1 font-medium">User ID</div>
                  <div className="text-sm font-mono bg-black/40 rounded px-3 py-2 text-blue-200 border border-blue-500/20">
                    {player.userId}
                  </div>
                </div>
              )}
              
              {player.gmRole && (
                <div className="bg-black/20 rounded-lg p-3 border border-blue-500/20">
                  <div className="text-sm text-blue-400 mb-1 font-medium">Role</div>
                  <div className="text-lg font-semibold text-yellow-300">{player.gmRole}</div>
                </div>
              )}
              
              {(player.majorsCaptainRole || player.aaaCaptainRole || player.aaCaptainRole) && (
                <div className="bg-black/20 rounded-lg p-3 border border-blue-500/20">
                  <div className="text-sm text-blue-400 mb-1 font-medium">Captain</div>
                  <div className="space-y-1">
                    {player.majorsCaptainRole && (
                      <div className="text-lg font-semibold text-yellow-300">{player.majorsCaptainRole}</div>
                    )}
                    {player.aaaCaptainRole && (
                      <div className="text-lg font-semibold text-yellow-300">{player.aaaCaptainRole}</div>
                    )}
                    {player.aaCaptainRole && (
                      <div className="text-lg font-semibold text-yellow-300">{player.aaCaptainRole}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* SAL Stats */}
          <div className="bg-gradient-to-br from-purple-900/40 to-purple-800/30 backdrop-blur-md rounded-xl border border-purple-400/30 p-6 shadow-lg">
            <div className="flex items-center gap-2 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-400" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
              </svg>
              <h2 className="text-2xl font-bold text-purple-200">SAL Statistics</h2>
            </div>
            <div className="space-y-4">
              {player.sal2sPeak && (
                <div className="bg-black/20 rounded-lg p-3 border border-purple-500/20">
                  <div className="text-sm text-purple-400 mb-1 font-medium">2s Peak Rating</div>
                  <div className="text-lg font-semibold text-white">{player.sal2sPeak}</div>
                </div>
              )}
              
              {player.sal3sPeak && (
                <div className="bg-black/20 rounded-lg p-3 border border-purple-500/20">
                  <div className="text-sm text-purple-400 mb-1 font-medium">3s Peak Rating</div>
                  <div className="text-lg font-semibold text-white">{player.sal3sPeak}</div>
                </div>
              )}
              
              {player.sal2sCurrent && (
                <div className="bg-black/20 rounded-lg p-3 border border-purple-500/20">
                  <div className="text-sm text-purple-400 mb-1 font-medium">2s Current Rating</div>
                  <div className="text-lg font-semibold text-white">{player.sal2sCurrent}</div>
                </div>
              )}
              
              {player.sal3sCurrent && (
                <div className="bg-black/20 rounded-lg p-3 border border-purple-500/20">
                  <div className="text-sm text-purple-400 mb-1 font-medium">3s Current Rating</div>
                  <div className="text-lg font-semibold text-white">{player.sal3sCurrent}</div>
                </div>
              )}
              
              {!player.sal2sPeak && !player.sal3sPeak && !player.sal2sCurrent && !player.sal3sCurrent && (
                <div className="text-center py-8">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-purple-400/50 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <p className="text-purple-300/70 italic">No SAL statistics available</p>
                </div>
              )}
            </div>
          </div>
          
          {/* Accounts */}
          {(player.mainAccount || player.altAccount) && (
            <div className="bg-gradient-to-br from-green-900/40 to-green-800/30 backdrop-blur-md rounded-xl border border-green-400/30 p-6 shadow-lg">
              <div className="flex items-center gap-2 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
                <h2 className="text-2xl font-bold text-green-200">Accounts</h2>
              </div>
              <div className="space-y-4">
                {player.mainAccount && (
                  <div className="bg-black/20 rounded-lg p-3 border border-green-500/20">
                    <div className="text-sm text-green-400 mb-1 font-medium">Main Account</div>
                    <a
                      href={player.mainAccount.startsWith('http') ? player.mainAccount : `https://rocketleague.tracker.network/rocket-league/profile/epic/${encodeURIComponent(player.mainAccount)}/overview`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-lg font-semibold text-white hover:text-green-300 transition-colors flex items-center gap-2 group break-all"
                    >
                      <span className="truncate">{player.mainAccount}</span>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                        <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                      </svg>
                    </a>
                  </div>
                )}
                
                {player.altAccount && (
                  <div className="bg-black/20 rounded-lg p-3 border border-green-500/20">
                    <div className="text-sm text-green-400 mb-1 font-medium">Alt Account{player.altAccount.includes('\n') || player.altAccount.includes('http') ? 's' : ''}</div>
                    <div className="space-y-2">
                      {player.altAccount.split('\n').filter(acc => acc.trim()).map((account, idx) => (
                        <a
                          key={idx}
                          href={account.trim().startsWith('http') ? account.trim() : `https://rocketleague.tracker.network/rocket-league/profile/epic/${encodeURIComponent(account.trim())}/overview`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-lg font-semibold text-white hover:text-green-300 transition-colors flex items-center gap-2 group break-all"
                        >
                          <span className="truncate">{account.trim()}</span>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                            <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                          </svg>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* External Links */}
          {(player.ballchasingLink || player.rlTracker) && (
            <div className="bg-gradient-to-br from-cyan-900/40 to-cyan-800/30 backdrop-blur-md rounded-xl border border-cyan-400/30 p-6 shadow-lg">
              <div className="flex items-center gap-2 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-cyan-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                </svg>
                <h2 className="text-2xl font-bold text-cyan-200">External Links</h2>
              </div>
              <div className="space-y-3">
                {player.ballchasingLink && (
                  <a
                    href={player.ballchasingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 bg-black/20 rounded-lg p-4 border border-cyan-500/20 hover:border-cyan-400/50 hover:bg-black/30 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center group-hover:bg-cyan-500/30 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-cyan-400" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                        <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="text-cyan-200 font-semibold group-hover:text-cyan-100 transition-colors">Ballchasing Profile</div>
                      <div className="text-xs text-cyan-400/70">View replays and statistics</div>
                    </div>
                  </a>
                )}
                
                {player.rlTracker && (
                  <a
                    href={player.rlTracker}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 bg-black/20 rounded-lg p-4 border border-cyan-500/20 hover:border-cyan-400/50 hover:bg-black/30 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center group-hover:bg-cyan-500/30 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-cyan-400" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                        <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="text-cyan-200 font-semibold group-hover:text-cyan-100 transition-colors">RL Tracker</div>
                      <div className="text-xs text-cyan-400/70">View detailed stats and ranking</div>
                    </div>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
        
        {/* Action buttons */}
        <div className="flex flex-wrap gap-4 justify-center">
          <button
            onClick={() => router.back()}
            className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full font-medium text-white hover:from-blue-600 hover:to-purple-700 transition shadow-lg flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Directory
          </button>
          
          <Link
            href="/"
            className="px-8 py-4 bg-black/30 border border-white/20 rounded-full font-medium text-white hover:bg-black/50 hover:border-blue-400/40 transition shadow-lg flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
            </svg>
            Return to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
