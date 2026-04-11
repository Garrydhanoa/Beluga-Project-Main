"use client"

import { useState, useEffect } from "react";
import Link from "next/link";
import '../header-size-fix.js';
import { teams, majorsSchedule, aaaSchedule, getTeamInitials } from '../../lib/scheduleData';

export default function SchedulesPage() {
  const [activeTab, setActiveTab] = useState("aa");
  const [expandedWeek, setExpandedWeek] = useState("Week 1");
  const [animateItems, setAnimateItems] = useState(false);

  useEffect(() => {
    // Add entrance animations after initial render
    setAnimateItems(true);
    
    // Force header size on mobile
    if (typeof window !== 'undefined' && window.innerWidth <= 640) {
      const header = document.querySelector('.super-large-mobile-header');
      if (header) {
        header.style.fontSize = '10rem';
        header.style.lineHeight = '0.85';
        header.style.letterSpacing = '-3px';
      }
    }
    
    // Add confetti animation for tab switching
    const addConfetti = () => {
      const confettiColors = ['#60A5FA', '#818CF8', '#A78BFA', '#C084FC'];
      const confettiCount = 50;
      const container = document.querySelector('.confetti-container');
      if (!container) return;
      
      // Clear previous confetti
      container.innerHTML = '';
      
      // Create new confetti
      for (let i = 0; i < confettiCount; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        
        // Random properties for each piece
        const size = Math.random() * 8 + 4;
        const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        const left = Math.random() * 100;
        const animDur = Math.random() * 3 + 2;
        const opacity = Math.random() * 0.7 + 0.3;
        
        // Apply styles
        confetti.style.width = `${size}px`;
        confetti.style.height = `${size}px`;
        confetti.style.backgroundColor = color;
        confetti.style.left = `${left}%`;
        confetti.style.animationDuration = `${animDur}s`;
        confetti.style.opacity = opacity.toString();
        
        container.appendChild(confetti);
        
        // Remove after animation
        setTimeout(() => {
          if (confetti.parentNode === container) {
            container.removeChild(confetti);
          }
        }, animDur * 1000);
      }
    };
    
    // Setup parallax effect for background decorations
    const handleMouseMove = (e) => {
      const decorElements = document.querySelectorAll('.bg-decor');
      decorElements.forEach(elem => {
        const speed = parseFloat(elem.dataset.speed || "0.05");
        const x = (window.innerWidth - e.pageX * speed) / 100;
        const y = (window.innerHeight - e.pageY * speed) / 100;
        elem.style.transform = `translateX(${x}px) translateY(${y}px)`;
      });
      
      // Add dynamic glow to matches when mouse is near
      const matches = document.querySelectorAll('.match-card');
      matches.forEach(match => {
        const rect = match.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.sqrt(
          Math.pow(e.clientX - centerX, 2) + 
          Math.pow(e.clientY - centerY, 2)
        );
        
        // Calculate glow intensity based on distance (max 300px)
        const maxDistance = 300;
        const intensity = Math.max(0, 1 - distance / maxDistance);
        
        if (intensity > 0) {
          match.style.boxShadow = `0 0 ${intensity * 20}px rgba(59,130,246,${intensity * 0.4})`;
          match.style.borderColor = `rgba(96,165,250,${intensity * 0.8})`;
        } else {
          match.style.boxShadow = '';
          match.style.borderColor = '';
        }
      });
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    
    // Add tab change confetti
    const tabButtons = document.querySelectorAll('.division-tab');
    tabButtons.forEach(button => {
      button.addEventListener('click', addConfetti);
    });
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      tabButtons.forEach(button => {
        button.removeEventListener('click', addConfetti);
      });
    };
  }, []);

  // Get current schedule based on active tab
  const currentSchedule = activeTab === "majors" ? majorsSchedule : aaaSchedule;

  // Handle week toggle
  const toggleWeek = (week) => {
    setExpandedWeek(expandedWeek === week ? null : week);
  };



  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-950 text-white relative overflow-hidden">
      {/* Background decorative elements - keep them but hide some on small screens */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="bg-decor absolute top-20 left-10 w-64 h-64 rounded-full bg-blue-500/5 blur-3xl" data-speed="0.03"></div>
        <div className="bg-decor absolute bottom-40 right-10 w-80 h-80 rounded-full bg-purple-500/5 blur-3xl" data-speed="0.05"></div>
        <div className="bg-decor absolute top-1/4 right-1/4 w-40 h-40 rounded-full bg-blue-400/5 blur-2xl" data-speed="0.02"></div>
        <div className="bg-decor hidden lg:block absolute bottom-1/3 left-1/4 w-56 h-56 rounded-full bg-purple-400/5 blur-2xl" data-speed="0.04"></div>
        <svg className="bg-decor absolute -top-10 -left-10 text-blue-500/10 w-40 h-40 hidden sm:block" viewBox="0 0 200 200" data-speed="0.01">
          <path fill="currentColor" d="M44.3,-76.2C58.4,-69.1,71.9,-59.3,79.4,-45.8C86.9,-32.2,88.2,-16.1,85.6,-1.5C83,13.2,76.5,26.3,68.3,38.2C60,50.1,50,60.8,37.7,70.2C25.5,79.7,12.8,87.9,-0.7,89C-14.1,90.1,-28.2,84.1,-40.6,75.4C-53,66.8,-63.6,55.5,-71.7,42.2C-79.7,28.9,-85.2,14.5,-85.9,-0.4C-86.6,-15.3,-82.4,-30.5,-73.8,-42.7C-65.1,-55,-51.8,-64.2,-37.8,-71.2C-23.8,-78.2,-11.9,-82.9,1.6,-85.8C15.1,-88.7,30.1,-89.8,44.3,-76.2Z" transform="translate(100 100)" />
        </svg>
        <svg className="bg-decor absolute -bottom-20 -right-20 text-purple-500/10 w-72 h-72 hidden sm:block" viewBox="0 0 200 200" data-speed="0.03">
          <path fill="currentColor" d="M42.7,-73.4C54.9,-67.3,64.2,-54.9,71.5,-41.3C78.7,-27.7,83.8,-13.9,83.1,-0.4C82.5,13,76,26,68.6,38.5C61.2,51,52.8,63,41.2,70.7C29.5,78.4,14.7,81.7,0.2,81.4C-14.4,81.1,-28.7,77.2,-41.8,70.2C-54.8,63.3,-66.5,53.2,-73.6,40.4C-80.7,27.5,-83.2,13.8,-83.3,-0.1C-83.4,-13.9,-81.1,-27.8,-74.1,-39.7C-67.1,-51.5,-55.4,-61.4,-42.2,-67C-28.9,-72.6,-14.5,-74,0.3,-74.5C15.1,-75,30.2,-74.6,42.7,-68.4Z" transform="translate(100 100)" />
        </svg>
      </div>
      
      <div className={`container mx-auto px-3 sm:px-4 py-6 sm:py-10 transition-all duration-700 ${animateItems ? 'opacity-100' : 'opacity-0 translate-y-10'}`}>
        <h1 
          className="super-large-mobile-header text-5xl sm:text-5xl md:text-6xl font-bold mb-6 sm:mb-10 text-center relative"
        >
          <div className="professional-header-wrapper px-4 py-2">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-purple-400 to-blue-200 shadow-text">
              Match Schedules
            </span>
            <span className="absolute left-1/2 -translate-x-1/2 -top-2 text-blue-500 opacity-10 blur-sm whitespace-nowrap">
              Match Schedules
            </span>
          </div>
        </h1>

        {/* Division Tabs - Made more mobile-friendly */}
        <div className="flex flex-wrap justify-center gap-2 sm:gap-4 mb-8 sm:mb-12">
          <button 
            className={`division-tab relative px-4 sm:px-8 py-3 sm:py-4 rounded-lg font-bold text-base sm:text-lg transition-all duration-300 transform 
              ${activeTab === 'aa' 
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 scale-105 shadow-xl' 
                : 'bg-black/30 hover:bg-black/50 border border-white/10'
              } overflow-hidden group w-[30%] sm:w-auto`}
            onClick={() => setActiveTab('aa')}
          >
            <span className={`relative z-10 ${activeTab === 'aa' ? 'text-white' : 'group-hover:text-blue-200 transition-colors'}`}>AA</span>
            {activeTab === 'aa' && (
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20 blur-sm"></div>
            )}
            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300"></div>
          </button>
          <button 
            className={`relative px-4 sm:px-8 py-3 sm:py-4 rounded-lg font-bold text-base sm:text-lg transition-all duration-300 transform 
              ${activeTab === 'aaa' 
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 scale-105 shadow-xl' 
                : 'bg-black/30 hover:bg-black/50 border border-white/10'
              } overflow-hidden group division-tab w-[30%] sm:w-auto`}
            onClick={() => setActiveTab('aaa')}
          >
            <span className={`relative z-10 ${activeTab === 'aaa' ? 'text-white' : 'group-hover:text-blue-200 transition-colors'}`}>AAA</span>
            {activeTab === 'aaa' && (
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20 blur-sm"></div>
            )}
            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300"></div>
          </button>
          <button 
            className={`relative px-4 sm:px-8 py-3 sm:py-4 rounded-lg font-bold text-base sm:text-lg transition-all duration-300 transform 
              ${activeTab === 'majors' 
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 scale-105 shadow-xl' 
                : 'bg-black/30 hover:bg-black/50 border border-white/10'
              } overflow-hidden group division-tab w-[30%] sm:w-auto`}
            onClick={() => setActiveTab('majors')}
          >
            <span className={`relative z-10 ${activeTab === 'majors' ? 'text-white' : 'group-hover:text-blue-200 transition-colors'}`}>MAJORS</span>
            {activeTab === 'majors' && (
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20 blur-sm"></div>
            )}
            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300"></div>
          </button>
        </div>

        {/* Division Title - Optimized for mobile */}
        <div className="text-center mb-6 sm:mb-10">
          <div className="relative inline-block">
            <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 text-transparent bg-clip-text inline-block">
              {activeTab.toUpperCase()} Division
            </h2>
            <div className="absolute -bottom-2 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
            <div className="absolute -top-1 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent"></div>
          </div>
          <p className="text-xs sm:text-sm md:text-base text-blue-200 mt-2 flex flex-wrap items-center justify-center gap-1 sm:gap-2">
            <span>{activeTab === 'majors' ? '12 Teams' : '16 Teams'}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 hidden sm:block"></span>
            <span className="w-1 h-1 rounded-full bg-blue-400 sm:hidden mx-1"></span>
            <span>8 Week Season</span>
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 hidden sm:block"></span>
            <span className="w-1 h-1 rounded-full bg-purple-400 sm:hidden mx-1"></span>
            <span>
              {activeTab === 'majors' 
                ? 'Elite Division' 
                : activeTab === 'aa' 
                  ? 'Amateur Division' 
                  : 'Challenger Division'}
            </span>
          </p>
        </div>

        {/* Week Sections - Optimized grid for mobile */}
        <div className="space-y-4 sm:space-y-6 mb-6 sm:mb-10 relative perspective-1000">
          {Object.keys(currentSchedule).map((week, weekIndex) => (
            <div 
              key={week}
              className={`bg-black/30 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden transition-all duration-500 transform ${
                animateItems ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
              } hover:border-blue-400/30`}
              style={{ transitionDelay: `${weekIndex * 50}ms` }}
            >
              {/* Week Header - Made more touch-friendly */}
              <div 
                className="px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-blue-900/50 to-purple-900/50 flex items-center justify-between cursor-pointer hover:bg-gradient-to-r hover:from-blue-800/60 hover:to-purple-800/60 transition-colors"
                onClick={() => toggleWeek(week)}
              >
                <h3 className="text-lg sm:text-xl font-bold flex items-center">
                  <span className="inline-flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 mr-2 sm:mr-3 rounded-full bg-gradient-to-br from-blue-600/20 to-purple-600/20 text-white text-sm sm:text-base">
                    {week.split(' ')[1]}
                  </span>
                  {week}
                </h3>
                <div 
                  className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-full bg-gradient-to-br from-blue-500/10 to-purple-500/10 transition-all duration-300"
                  style={{
                    transform: expandedWeek === week ? 'rotate(180deg)' : 'rotate(0deg)'
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>

              {/* Matches - Mobile-optimized grid */}
              {expandedWeek === week && (
                <div className="px-3 sm:px-6 py-5 sm:py-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6">
                  {currentSchedule[week].map((match, index) => (
                    <div 
                      key={`${week}-match-${index}`} 
                      className="match-card bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-sm p-3 sm:p-5 rounded-xl border border-white/10 hover:border-blue-400 transition-all transform hover:-translate-y-1 hover:scale-102 sm:hover:scale-105 hover:shadow-[0_5px_30px_rgba(59,130,246,0.5)] hover:z-10 duration-300 relative group overflow-hidden"
                      style={{ animationDelay: `${index * 100}ms` }}
                    >
                      {/* Background elements - keep them */}
                      <div className="absolute -left-20 -bottom-20 w-48 h-48 opacity-0 group-hover:opacity-10 transition-opacity duration-500 transform rotate-12 blur-sm">
                        <img 
                          src={`/logos/${match[0]}.png`} 
                          alt="" 
                          className="w-full h-full object-contain"
                          onError={(e) => { e.currentTarget.style.display = 'none' }}
                        />
                      </div>
                      <div className="absolute -right-20 -top-20 w-48 h-48 opacity-0 group-hover:opacity-10 transition-opacity duration-500 transform -rotate-12 blur-sm">
                        <img 
                          src={`/logos/${match[1]}.png`} 
                          alt="" 
                          className="w-full h-full object-contain"
                          onError={(e) => { e.currentTarget.style.display = 'none' }}
                        />
                      </div>
                      
                      {/* Match layout */}
                      <div className="flex items-center justify-between relative">
                        {/* Team 1 (Left Side) */}
                        <div className="flex flex-col items-center w-5/12 group/team">
                          <div className="h-12 w-12 sm:h-16 sm:w-16 relative mb-2 sm:mb-3 flex items-center justify-center hover:scale-110 transition-transform cursor-pointer">
                            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-600/10 to-blue-400/10 group-hover/team:from-blue-500/30 group-hover/team:to-blue-400/30 animate-pulse-slow"></div>
                            <div className="absolute inset-0 rounded-full bg-blue-500/5 group-hover/team:bg-blue-500/30 transform scale-75 group-hover/team:scale-110 transition-all duration-500 blur-md"></div>
                            <Link href={`/teams/${encodeURIComponent(match[0])}`} className="flex items-center justify-center w-full h-full">
                              <img 
                                src={`/logos/${match[0]}.png`} 
                                alt={match[0]} 
                                className="h-10 w-10 sm:h-14 sm:w-14 object-contain relative z-10"
                                onError={(e) => {
                                  e.currentTarget.onerror = null;
                                  e.currentTarget.style.display = 'none';
                                  if (e.currentTarget.parentElement) {
                                    e.currentTarget.parentElement.classList.add('rounded-full', 'bg-gradient-to-br', 'from-blue-600/20', 'via-blue-400/20', 'to-blue-900/20', 'flex', 'items-center', 'justify-center');
                                    e.currentTarget.parentElement.innerHTML = `<span class="text-sm sm:text-xl font-bold text-white opacity-80">${getTeamInitials(match[0])}</span>`;
                                  }
                                }}
                              />
                            </Link>
                          </div>
                          <p className="text-center font-medium text-xs sm:text-sm truncate w-full bg-clip-text text-transparent bg-gradient-to-r from-blue-200 to-blue-100 group-hover/team:from-white group-hover/team:to-blue-200 transition-all duration-300">
                            {match[0]}
                          </p>
                        </div>

                        {/* VS */}
                        <div className="flex-shrink-0 w-2/12 flex flex-col items-center justify-center">
                          <div className="w-px h-8 sm:h-12 bg-gradient-to-b from-transparent via-blue-400/30 to-transparent group-hover:via-blue-400/70 transition-all duration-300"></div>
                          <div className="my-1 p-1 sm:p-2 rounded-full bg-black/40 backdrop-blur-sm group-hover:bg-gradient-to-r group-hover:from-blue-900/50 group-hover:to-purple-900/50 transition-all duration-300">
                            <span className="text-sm sm:text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-400 text-transparent bg-clip-text group-hover:from-blue-300 group-hover:to-purple-300 transition-all duration-300">VS</span>
                          </div>
                          <div className="w-px h-8 sm:h-12 bg-gradient-to-b from-transparent via-purple-400/30 to-transparent group-hover:via-purple-400/70 transition-all duration-300"></div>
                        </div>

                        {/* Team 2 (Right Side) */}
                        <div className="flex flex-col items-center w-5/12 group/team">
                          <div className="h-12 w-12 sm:h-16 sm:w-16 relative mb-2 sm:mb-3 flex items-center justify-center hover:scale-110 transition-transform cursor-pointer">
                            {/* Update this div to match Team 1 structure but with purple colors */}
                            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-400/10 to-purple-600/10 group-hover/team:from-purple-400/30 group-hover/team:to-purple-600/30 animate-pulse-slow"></div>
                            <div className="absolute inset-0 rounded-full bg-purple-500/5 group-hover/team:bg-purple-500/30 transform scale-75 group-hover/team:scale-110 transition-all duration-500 blur-md"></div>
                            <Link href={`/teams/${encodeURIComponent(match[1])}`} className="flex items-center justify-center w-full h-full">
                              <img 
                                src={`/logos/${match[1]}.png`} 
                                alt={match[1]} 
                                className="h-10 w-10 sm:h-14 sm:w-14 object-contain relative z-10"
                                onError={(e) => {
                                  e.currentTarget.onerror = null;
                                  e.currentTarget.style.display = 'none';
                                  if (e.currentTarget.parentElement) {
                                    e.currentTarget.parentElement.classList.add('rounded-full', 'bg-gradient-to-br', 'from-purple-600/20', 'via-blue-600/20', 'to-purple-900/20', 'flex', 'items-center', 'justify-center');
                                    e.currentTarget.parentElement.innerHTML = `<span class="text-sm sm:text-xl font-bold text-white opacity-80">${getTeamInitials(match[1])}</span>`;
                                  }
                                }}
                              />
                            </Link>
                          </div>
                          <p className="text-center font-medium text-xs sm:text-sm truncate w-full bg-clip-text text-transparent bg-gradient-to-r from-purple-100 to-purple-200 group-hover/team:from-white group-hover/team:to-purple-200 transition-all duration-300">
                            {match[1]}
                          </p>
                        </div>
                      </div>
                      
                      {/* Particle effects - keep them */}
                      <div className="absolute inset-0 overflow-hidden rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-500">
                        <div className="absolute top-0 left-1/4 w-1 h-1 bg-blue-400 rounded-full animate-float"></div>
                        <div className="absolute bottom-1/3 right-1/4 w-1.5 h-1.5 bg-purple-400 rounded-full animate-float animation-delay-300"></div>
                        <div className="absolute top-1/3 right-1/3 w-1 h-1 bg-blue-300 rounded-full animate-float animation-delay-700"></div>
                        <div className="absolute bottom-1/4 left-1/3 w-1 h-1 bg-purple-300 rounded-full animate-float animation-delay-1000"></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Return Home Button - Mobile-friendly sizing */}
        <div className="flex justify-center mt-10 sm:mt-16">
          <Link 
            href="/" 
            className="relative group px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-black/20 to-black/40 backdrop-blur-sm rounded-full font-medium text-white border border-white/20 hover:border-blue-400 transition-all transform hover:scale-105 overflow-hidden"
          >
            <span className="relative z-10 flex items-center gap-2 text-sm sm:text-base">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              Return to Home
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-500/20 transform translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
          </Link>
        </div>
      </div>

      {/* Confetti container remains the same */}
      <div className="confetti-container fixed inset-0 pointer-events-none z-40 overflow-hidden"></div>
    </div>
  );
}
