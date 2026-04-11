"use client"

import { useState, useEffect } from 'react';
import Link from 'next/link';
import BackgroundDecoration from './components/BackgroundDecoration';

export default function Home() {
  const [showVideo, setShowVideo] = useState(false);
  
  // Team names
  const teams = [
    "6 Speed",
    "Archangels",
    "Aviators",
    "Clovis Esports",
    "Griffins",
    "Immortals",
    "InTraCate",
    "Kingdom",
    "Lotus",
    "Malfeasance",
    "MNML",
    "Panthers",
    "Sublunary",
    "Surge"
  ];
  
  const [animateItems, setAnimateItems] = useState(false);
  
  // Preload all team logos to prevent loading issues
  useEffect(() => {
    // Preload all team logos
    teams.forEach(team => {
      const img = new Image();
      img.src = `/logos/${team}.png`;
    });

    // Animate items on page load
    setTimeout(() => {
      setAnimateItems(true);
    }, 100);
  }, []);
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-950 text-white">
      {/* Background decorative elements */}
      <BackgroundDecoration />
      
      {/* Hero Section with gradient background */}
      <div className="relative">
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-black/80 via-blue-900/30 to-black/50"></div>
        <div className="container mx-auto px-4 py-20 relative z-10">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="md:w-1/2 text-white mb-10 md:mb-0">
              <h1 className="text-6xl font-bold mb-8 relative">
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-purple-400 to-blue-200 animate-pulse-slow">
                  Welcome to Beluga League
                </span>
                <span className="absolute -left-2 -top-2 text-blue-500 opacity-20 blur-sm">
                  Welcome to Beluga League
                </span>
                <span className="absolute -right-2 -bottom-2 text-purple-500 opacity-20 blur-sm">
                  Welcome to Beluga League
                </span>
              </h1>
              <p className="text-2xl mb-10 text-blue-100 leading-relaxed drop-shadow-md">
                The premier Rocket League discord community for competitive play,
                camaraderie, and celebration of the game we love.
              </p>
              <div className="flex flex-wrap space-x-0 space-y-4 sm:space-y-0 sm:space-x-4">
                <a 
                  href="https://discord.gg/4J4c79hawF"
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full font-medium text-white hover:from-blue-600 hover:to-purple-700 transition shadow-lg transform hover:scale-105 inline-block text-center w-full sm:w-auto"
                >
                  Join Discord
                </a>
                
                <a 
                  href="#applications"
                  className="px-8 py-4 bg-black/30 backdrop-blur-sm border border-white/20 hover:border-blue-400 rounded-full font-medium text-white transition shadow-lg transform hover:scale-105 inline-block text-center w-full sm:w-auto"
                >
                  <span className="flex items-center justify-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                      <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                    </svg>
                    Applications
                  </span>
                </a>
              </div>
            </div>
            <div className="md:w-1/2 flex justify-center">
              <div className="relative w-80 h-80 md:w-[400px] md:h-[400px] overflow-hidden flex items-center justify-center">
                <img 
                  src="/logos/league_logo.png" 
                  alt="Beluga League" 
                  className="w-full h-full object-contain drop-shadow-[0_0_25px_rgba(59,130,246,0.8)]"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.style.display = 'none';
                    if (e.currentTarget.parentElement) {
                      e.currentTarget.parentElement.classList.add('rounded-full', 'bg-gradient-to-br', 'from-blue-500/30', 'to-purple-600/30', 'border', 'border-white/10');
                      e.currentTarget.parentElement.innerHTML += '<div class="absolute inset-5 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 opacity-20 blur-xl animate-pulse-slow"></div><span class="text-9xl font-bold text-white opacity-90">BL</span>';
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* About Section with Video */}
      <div className="container mx-auto px-4 py-16">
        <div className="bg-gradient-to-br from-black/40 to-black/60 backdrop-blur-sm p-8 rounded-xl border border-white/10 shadow-xl">
          <div className="flex flex-col md:flex-row items-center gap-10">
            <div className="md:w-1/2">
              <div 
                className="relative w-full aspect-video rounded-lg overflow-hidden shadow-2xl cursor-pointer group"
                onClick={() => setShowVideo(true)}
              >
                {/* Video Thumbnail Preview */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-600/50 to-purple-800/50">
                  <video
                    src="/videos/intro-video.mp4"
                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                    preload="metadata"
                    muted
                    playsInline
                  />
                </div>

                {/* Play Button Overlay */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-20 h-20 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center transform group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>

                {/* Video Duration Badge */}
                <div className="absolute bottom-3 right-3 bg-black/70 px-2 py-1 rounded text-white text-sm font-medium">
                  0:45
                </div>
              </div>
            </div>
            <div className="md:w-1/2 text-white">
              <h2 className="text-4xl font-bold mb-6 relative">
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                  About Our League
                </span>
                <span className="absolute -left-1 -top-1 text-blue-500 opacity-10 blur-sm">
                  About Our League
                </span>
              </h2>
              <p className="text-lg mb-4 text-blue-100">
                Beluga League was founded with a singular vision: to create a competitive yet welcoming environment for Rocket League players of all skill levels.
              </p>
              <p className="text-lg mb-4 text-blue-100">
                We host regular seasons with professionally managed tournaments, custom stats tracking, and community events that bring players together.
              </p>
              <p className="text-lg text-blue-100">
                Whether you&apos;re a seasoned veteran or just starting out, there&apos;s a place for you in our community.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Teams Section with enhanced styling - Updated to show 4 per row */}
      <div className="container mx-auto px-4 py-16">
        <h2 className="text-4xl font-bold mb-12 text-center relative">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-purple-400">
            Our Teams For the Season
          </span>
          <span className="absolute left-1/2 -translate-x-1/2 -top-2 text-blue-500 opacity-10 blur-sm whitespace-nowrap">
            Our Teams For the Season
          </span>
        </h2>
        {/* Update the teams section to link to team pages */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-4 gap-6">
          {teams.map((team) => (
            <Link
              href={`/teams/${encodeURIComponent(team)}`}
              key={team}
              className="group bg-gradient-to-b from-black/40 to-black/70 backdrop-blur-sm p-6 rounded-lg border border-white/10 hover:border-blue-400 transition-all transform hover:-translate-y-2 hover:shadow-[0_0_25px_rgba(59,130,246,0.5)] duration-300 relative overflow-hidden"
            >
              {/* Background glow effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-purple-500/0 group-hover:from-blue-500/10 group-hover:to-purple-500/10 transition-all duration-500"></div>
              
              {/* Moving particle effect */}
              <div className="absolute -inset-1 bg-grid opacity-0 group-hover:opacity-20 transition-opacity duration-500"></div>
              
              <div className="aspect-square relative mb-4 flex items-center justify-center overflow-hidden">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/0 via-purple-500/0 to-blue-600/0 group-hover:from-blue-500/20 group-hover:via-purple-500/20 group-hover:to-blue-600/20 transition-all duration-500 transform scale-0 group-hover:scale-100 blur-xl"></div>
                <img 
                  src={`/logos/${team}.png`} 
                  alt={`${team} Logo`} 
                  className="w-4/5 h-4/5 object-contain drop-shadow-lg transform group-hover:scale-110 transition-transform duration-500 relative z-10"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.style.display = 'none';
                    if (e.currentTarget.parentElement) {
                      const teamName = team || "BL";
                      const initials = teamName.split(' ').map(word => word[0]).join('');
                      e.currentTarget.parentElement.classList.add('rounded-full', 'bg-gradient-to-br', 'from-blue-600/30', 'via-purple-600/30', 'to-blue-900/30', 'border', 'border-white/20', 'flex', 'items-center', 'justify-center');
                      e.currentTarget.parentElement.innerHTML = `
                        <div class="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 animate-pulse-slow"></div>
                        <span class="relative z-10 text-4xl font-bold text-white opacity-90">${initials}</span>
                      `;
                    }
                  }}
                />
              </div>
              <h3 className="text-center text-white font-bold text-lg relative group-hover:text-blue-300 transition-colors duration-300">
                <span className="relative z-10">{team}</span>
                <span className="absolute left-0 right-0 bottom-0 h-1 bg-gradient-to-r from-blue-500/0 via-blue-500/50 to-blue-500/0 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500"></span>
              </h3>
            </Link>
          ))}
        </div>
      </div>

      {/* YouTube Showcase Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="bg-gradient-to-br from-black/40 to-black/60 backdrop-blur-sm p-8 rounded-xl border border-white/10 shadow-xl">
          <h2 className="text-4xl font-bold mb-8 text-center relative">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-purple-400">
              Season 6 Highlights
            </span>
            <span className="absolute left-1/2 -translate-x-1/2 -top-2 text-blue-500 opacity-10 blur-sm whitespace-nowrap">
              Season 6 Highlights
            </span>
          </h2>

          {/* Video Container */}
          <div className="aspect-video w-full max-w-4xl mx-auto rounded-lg overflow-hidden shadow-[0_0_25px_rgba(59,130,246,0.3)] mb-10">
            <iframe 
              className="w-full h-full"
              src="https://www.youtube.com/embed/e1TvkdWSJzs" 
              title="Beluga League Season 6 Montage"
              frameBorder="0" 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
              allowFullScreen
            ></iframe>
          </div>

          {/* Call to action for clips */}
          <div className="text-center mt-8">
            <p className="text-xl text-blue-100 mb-6">
              Got amazing Rocket League moments? We want to feature them in our next montage!
            </p>
            <a 
              href="https://docs.google.com/forms/d/e/1FAIpQLScbzUr27qDf1mz0JEAtXfL5Xp1oBNklOJtrRI-CuvdFth1B8w/viewform?usp=header"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 bg-gradient-to-r from-purple-500 to-blue-600 rounded-full font-medium text-white hover:from-purple-600 hover:to-blue-700 transition shadow-lg transform hover:scale-105 inline-flex items-center space-x-2 hover:shadow-[0_0_20px_rgba(147,51,234,0.5)]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              <span>Send Clips Here</span>
              
              {/* Add a subtle animation for the button */}
              <span className="absolute inset-0 rounded-full bg-white/10 transform scale-0 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-300"></span>
            </a>
          </div>
        </div>
      </div>

      {/* Enhanced Call to Action with customized design */}
      <div className="relative py-24 overflow-hidden">
        {/* Animated background particles */}
        <div className="absolute inset-0 bg-gradient-to-r from-purple-800/80 via-blue-800/50 to-black/70">
          <div className="absolute top-20 left-1/4 w-20 h-20 rounded-full bg-blue-500/10 blur-xl animate-pulse-slow"></div>
          <div className="absolute bottom-40 right-1/3 w-32 h-32 rounded-full bg-purple-500/10 blur-xl animate-pulse"></div>
          <div className="absolute top-1/2 left-2/3 w-16 h-16 rounded-full bg-blue-400/10 blur-lg animate-pulse-slow"></div>
        </div>
        
        {/* Glowing borders */}
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-4xl mx-auto">
            <div className="relative bg-black/30 backdrop-blur-md rounded-2xl p-10 border border-white/10 overflow-hidden shadow-[0_0_40px_rgba(59,130,246,0.3)]">
              {/* Animated highlight corner */}
              <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500/20 rounded-full blur-xl animate-pulse-slow"></div>
              <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-purple-500/20 rounded-full blur-xl animate-pulse"></div>
              
              {/* Content with enhanced typography */}
              <div className="text-center relative z-10">
                <div className="inline-block relative mb-3">
                  <span className="absolute -inset-1 rounded-lg bg-gradient-to-r from-blue-500/30 to-purple-500/30 blur-xl animate-pulse-slow"></span>
                  <h2 className="relative text-5xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-purple-400 to-blue-200 mb-8">
                    Ready to Compete?
                  </h2>
                </div>
                
                <p className="text-2xl text-blue-100 mb-10 max-w-2xl mx-auto">
                  Join the most exciting Rocket League community and show off your
                  skills in our next season.
                </p>
                
                {/* Enhanced buttons with hover effects */}
                <div className="flex flex-col sm:flex-row justify-center gap-6">
                  <a 
                    href="https://docs.google.com/forms/d/e/1FAIpQLScR3pdfPVDn9H0u_FIo6KaNMG8HvHRvuai7GSnk3XuVH-raUA/viewform?usp=header" 
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative px-10 py-5 bg-gradient-to-r from-blue-600 to-blue-800 rounded-xl font-bold text-white text-lg hover:from-blue-700 hover:to-blue-900 transition shadow-lg transform hover:scale-105 inline-block text-center overflow-hidden"
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transition-transform group-hover:rotate-12" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                      Apply For GM
                    </span>
                    <div className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-white/0 via-white/20 to-white/0 skew-x-20 transition-transform translate-x-[-180%] group-hover:translate-x-[180%] duration-700"></div>
                  </a>
                  
                  <Link
                    href="/rulebook" 
                    className="group relative px-10 py-5 bg-black/40 backdrop-blur-sm rounded-xl font-bold text-white text-lg border border-white/20 hover:border-blue-400 transition transform hover:scale-105 inline-block text-center overflow-hidden"
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transition-transform group-hover:rotate-12" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 005.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0014.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                      </svg>
                      Rulebook
                    </span>
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-blue-600/0 via-blue-600/20 to-blue-600/0 transform translate-y-full group-hover:translate-y-0 transition-transform duration-500"></div>
                  </Link>
                </div>
                
                {/* Decorative elements */}
                <div className="absolute left-4 top-4 w-20 h-1 bg-gradient-to-r from-blue-500 to-transparent rounded-full"></div>
                <div className="absolute right-4 bottom-4 w-20 h-1 bg-gradient-to-l from-purple-500 to-transparent rounded-full"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Video Modal - Updated to use intro-video */}
      {showVideo && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowVideo(false)}>
          <div className="relative w-full max-w-4xl aspect-video bg-black rounded-lg overflow-hidden">
            {/* Updated to use intro-video */}
            <video 
              className="w-full h-full object-cover" 
              controls 
              autoPlay
              onClick={(e) => e.stopPropagation()}
            >
              <source src="/videos/intro-video.mp4" type="video/mp4" />
              Your browser does not support the video tag.
            </video>

            <button 
              className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 hover:bg-black/80 transition"
              onClick={(e) => {
                e.stopPropagation();
                setShowVideo(false);
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Applications Section */}
      <div id="applications" className="container mx-auto px-4 py-16 scroll-mt-24">
        <div className="text-center mb-12">
          <div className="relative inline-block">
            <h2 className="text-4xl font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-purple-400 to-blue-200">
              Join Our Team
            </h2>
            <div className="absolute -inset-4 bg-blue-500/10 rounded-full blur-xl animate-pulse-slow -z-10"></div>
          </div>
          <p className="text-xl text-blue-100 max-w-2xl mx-auto">
            Apply for various positions in the Beluga League and help shape the future of our community!
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Mod/Admin Application Card */}
          <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden shadow-lg hover:shadow-blue-500/20 hover:border-blue-400/50 transition-all duration-300 transform hover:-translate-y-2 group">
            <div className="h-24 bg-gradient-to-r from-blue-600/40 to-purple-600/40 flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-grid opacity-20"></div>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-white group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-blue-500/10 blur-2xl"></div>
            </div>
            <div className="p-6">
              <h3 className="text-2xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-purple-300">
                Mod/Admin Application
              </h3>
              <p className="text-blue-100 mb-6">
                Help moderate our community, enforce rules, and ensure everyone has a positive experience.
              </p>
              <a 
                href="https://docs.google.com/forms/d/e/1FAIpQLSc9HYfC_4jsb2urOUgT3ZfL3-aQsuLPbTy3Ao9-5uMG9LR3nQ/viewform"
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-blue-800 text-white font-medium hover:from-blue-700 hover:to-blue-900 transition-all group-hover:shadow-lg"
              >
                <span>Apply as Mod/Admin</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          </div>

          {/* GM Application Card */}
          <div className="bg-gradient-to-br from-purple-900/30 to-indigo-900/30 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden shadow-lg hover:shadow-purple-500/20 hover:border-purple-400/50 transition-all duration-300 transform hover:-translate-y-2 group">
            <div className="h-24 bg-gradient-to-r from-purple-600/40 to-indigo-600/40 flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-grid opacity-20"></div>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-white group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-purple-500/10 blur-2xl"></div>
            </div>
            <div className="p-6">
              <h3 className="text-2xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-indigo-300">
                GM Application
              </h3>
              <p className="text-blue-100 mb-6">
                Lead your own team, draft players, and compete for the championship in our league seasons.
              </p>
              <a 
                href="https://docs.google.com/forms/d/e/1FAIpQLScR3pdfPVDn9H0u_FIo6KaNMG8HvHRvuai7GSnk3XuVH-raUA/viewform"
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-800 text-white font-medium hover:from-purple-700 hover:to-indigo-900 transition-all group-hover:shadow-lg"
              >
                <span>Apply as GM</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          </div>

          {/* Beluga Helper Application Card */}
          <div className="bg-gradient-to-br from-indigo-900/30 to-blue-900/30 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden shadow-lg hover:shadow-indigo-500/20 hover:border-indigo-400/50 transition-all duration-300 transform hover:-translate-y-2 group">
            <div className="h-24 bg-gradient-to-r from-indigo-600/40 to-blue-600/40 flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-grid opacity-20"></div>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-white group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 11V9a2 2 0 00-2-2m2 4v4a2 2 0 104 0v-1m-4-3H9m2 0h4m6 1a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-indigo-500/10 blur-2xl"></div>
            </div>
            <div className="p-6">
              <h3 className="text-2xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-blue-300">
                Beluga Helper Application
              </h3>
              <p className="text-blue-100 mb-6">
                For people who are interested in helping the community in other ways than being a moderator/admin
              </p>
              <a 
                href="https://docs.google.com/forms/d/e/1FAIpQLSfCTiDxUZGTVXT77GIMtMU5uEJlPrMyAy9kfdnDGwyMy6rqvA/viewform"
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-800 text-white font-medium hover:from-indigo-700 hover:to-blue-900 transition-all group-hover:shadow-lg"
              >
                <span>Apply as Helper</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          </div>
        </div>
        
        {/* Floating particles */}
        <div className="absolute -left-10 top-1/3 w-20 h-20 rounded-full bg-blue-500/10 blur-xl"></div>
        <div className="absolute -right-10 bottom-1/3 w-20 h-20 rounded-full bg-purple-500/10 blur-xl"></div>
      </div>
    </div>
  );
}
