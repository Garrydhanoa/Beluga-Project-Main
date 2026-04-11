"use client"
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import DOMPurify from 'dompurify';

export default function RulebookPage() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [tableOfContents, setTableOfContents] = useState([]);
  const [activeSection, setActiveSection] = useState('');
  const [tocVisible, setTocVisible] = useState(false); // Track mobile TOC visibility
  const contentRef = useRef(null);
  const tocRef = useRef(null);
  const publishedDocUrl = "https://docs.google.com/document/d/e/2PACX-1vTBi5BDycuXzBnOgE3oCZxxw9cHmkgcXdDqo3Norz-7HslR7JzYh3GTCMASTMT4zz_OukqF1Qo78OPb/pub";
  
  useEffect(() => {
    async function fetchGoogleDoc() {
      try {
        setLoading(true);
        // Fetch the published Google Doc HTML
        const response = await fetch(publishedDocUrl);
        const html = await response.text();
        
        // Extract content using DOM parser
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Get the main content
        const contentDiv = doc.querySelector('.doc-content');
        let extractedContent = '';
        
        if (contentDiv) {
          // Clean up the HTML and extract just what we need
          extractedContent = contentDiv.innerHTML;
        } else {
          // Fallback: try to get the content from the body
          const bodyContent = doc.body.innerHTML;
          // Extract content between main divs
          const contentMatch = bodyContent.match(/<div[^>]*id=['"]contents['"][^>]*>([\s\S]*?)<\/div>/i);
          if (contentMatch && contentMatch[1]) {
            extractedContent = contentMatch[1];
          }
        }
        
        // Sanitize the HTML
        const cleanHTML = DOMPurify.sanitize(extractedContent);
        setContent(cleanHTML);
      } catch (error) {
        console.error('Error fetching Google Doc:', error);
        setContent('<p>Error loading rulebook. Please try again later.</p>');
      } finally {
        setLoading(false);
      }
    }
    
    fetchGoogleDoc();
  }, [publishedDocUrl]);

  // Extract headings and build table of contents after content is loaded
  useEffect(() => {
    if (!content || !contentRef.current) return;
    
    const headingElements = contentRef.current.querySelectorAll('h1, h2, h3');
    const toc = [];
    
    headingElements.forEach((heading, index) => {
      const id = `section-${index}`;
      heading.id = id;
      
      const level = parseInt(heading.tagName.substring(1));
      toc.push({
        id,
        text: heading.textContent || `Section ${index + 1}`,
        level
      });
      
      // Add fancy decorative element to headings
      const decorElement = document.createElement('span');
      decorElement.className = 'heading-decorator';
      heading.appendChild(decorElement);
    });
    
    setTableOfContents(toc);
    
    // Improved intersection observer with better thresholds
    const observer = new IntersectionObserver(
      (entries) => {
        // Find the first entry that's intersecting
        const visibleEntries = entries.filter(entry => entry.isIntersecting);
        
        if (visibleEntries.length > 0) {
          // Sort by visibility ratio to find the most visible heading
          const mostVisible = visibleEntries.reduce((prev, current) => {
            return prev.intersectionRatio > current.intersectionRatio ? prev : current;
          });
          
          setActiveSection(mostVisible.target.id);
          
          // Ensure active section is visible in the TOC sidebar
          if (tocRef.current) {
            const activeButton = tocRef.current.querySelector(`[data-section="${mostVisible.target.id}"]`);
            if (activeButton) {
              activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }
        }
      },
      { 
        rootMargin: '-80px 0px -50% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1] 
      }
    );
    
    headingElements.forEach((heading) => {
      observer.observe(heading);
    });
    
    return () => {
      observer.disconnect();
    };
  }, [content]);
  
  // Scroll to active section when TOC first loads
  useEffect(() => {
    if (tocRef.current && activeSection) {
      const activeButton = tocRef.current.querySelector(`[data-section="${activeSection}"]`);
      if (activeButton) {
        activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [tableOfContents, activeSection]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-950 text-white">
      <div className="container mx-auto px-4 py-10 relative">
        <h1 className="text-4xl md:text-6xl font-bold mb-10 text-center relative">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-purple-400 to-blue-200">
            Beluga League Rulebook
          </span>
          <span className="absolute left-1/2 -translate-x-1/2 -top-2 text-blue-500 opacity-10 blur-sm whitespace-nowrap">
            Beluga League Rulebook
          </span>
        </h1>
        
        {/* Mobile TOC Toggle Button - Only visible on smaller screens */}
        {tableOfContents.length > 0 && (
          <button 
            className="lg:hidden w-full mb-4 py-2 px-4 bg-blue-900/50 hover:bg-blue-800/60 text-blue-100 rounded-lg flex items-center justify-between transition-colors"
            onClick={() => setTocVisible(!tocVisible)}
          >
            <span className="font-medium flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 4a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H3a1 1 0 01-1-1V4zm5 0a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H8a1 1 0 01-1-1V4zm5 0a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                <path d="M2 9a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H3a1 1 0 01-1-1V9zm5 0a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H8a1 1 0 01-1-1V9zm5 0a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1h-2a1 1 0 01-1-1V9z" />
                <path d="M2 14a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H3a1 1 0 01-1-1v-2zm5 0a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H8a1 1 0 01-1-1v-2zm5 0a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1h-2a1 1 0 01-1-1v-2z" />
              </svg>
              Table of Contents
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transform transition-transform duration-300 ${tocVisible ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        )}
        
        {loading ? (
          <div className="flex justify-center items-center min-h-[400px]">
            <div className="w-16 h-16 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin"></div>
          </div>
        ) : (
          <div className="lg:grid lg:grid-cols-[280px_1fr] gap-8">
            {/* Improved Fixed Sidebar Navigation */}
            {tableOfContents.length > 0 && (
              <>
                {/* Desktop TOC - Always visible on large screens */}
                <div className="hidden lg:block">
                  <div 
                    ref={tocRef}
                    className="bg-black/40 backdrop-blur-md rounded-xl border border-white/10 p-5 sticky top-24 max-h-[calc(100vh-150px)] overflow-y-auto scrollbar-thin toc-container"
                  >
                    <h3 className="text-lg font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-purple-400 text-center">
                      Contents
                    </h3>
                    <div className="h-px w-full bg-gradient-to-r from-transparent via-blue-500/30 to-transparent mb-4"></div>
                    <TocContent 
                      tableOfContents={tableOfContents} 
                      activeSection={activeSection}
                      setActiveSection={setActiveSection}
                    />
                  </div>
                </div>
                
                {/* Mobile TOC - Toggleable */}
                <div 
                  className={`lg:hidden fixed top-[70px] left-0 right-0 z-50 transition-all duration-300 ease-in-out ${
                    tocVisible 
                      ? 'opacity-100 translate-y-0' 
                      : 'opacity-0 -translate-y-10 pointer-events-none'
                  }`}
                >
                  <div className="mx-4 bg-black/90 backdrop-blur-md rounded-xl border border-white/10 p-5 max-h-[70vh] overflow-y-auto scrollbar-thin toc-container shadow-xl">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-purple-400">
                        Contents
                      </h3>
                      <button 
                        onClick={() => setTocVisible(false)}
                        className="text-blue-200 hover:text-white p-1"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                    <div className="h-px w-full bg-gradient-to-r from-transparent via-blue-500/30 to-transparent mb-4"></div>
                    <TocContent 
                      tableOfContents={tableOfContents} 
                      activeSection={activeSection}
                      setActiveSection={setActiveSection}
                      onItemClick={() => setTocVisible(false)}
                    />
                  </div>
                </div>
              </>
            )}
            
            {/* Main content */}
            <div>
              <div className="bg-black/30 backdrop-blur-md p-8 md:p-12 rounded-2xl border border-white/10 shadow-xl mb-10">
                {/* Custom styled content */}
                <div 
                  ref={contentRef}
                  className="rulebook-content text-blue-100 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: content }}
                />
                {!content && (
                  <div className="text-center text-blue-200 py-10">
                    <p className="text-xl mb-4">Unable to extract rulebook content.</p>
                    <p>Please view the rulebook directly:</p>
                    <a 
                      href={publishedDocUrl}
                      target="_blank"
                      rel="noopener noreferrer" 
                      className="inline-block mt-4 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
                    >
                      Open Rulebook
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Return to Home Button */}
        <div className="flex justify-center mt-10">
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
      
      {/* Semi-transparent overlay for mobile TOC */}
      {tocVisible && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setTocVisible(false)}
        ></div>
      )}

      <style jsx global>{`
        /* Better active section indicator */
        .sidebar-active {
          position: relative;
          box-shadow: 0 0 15px rgba(59, 130, 246, 0.3);
        }
        
        .sidebar-active::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: linear-gradient(to bottom, #3b82f6, #8b5cf6);
          border-radius: 0 2px 2px 0;
        }

        /* Improved scrollbar for table of contents */
        .toc-container::-webkit-scrollbar {
          width: 4px;
        }
        
        .toc-container::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 10px;
          margin: 4px 0;
        }
        
        .toc-container::-webkit-scrollbar-thumb {
          background: rgba(96, 165, 250, 0.5);
          border-radius: 10px;
        }
        
        .toc-container::-webkit-scrollbar-thumb:hover {
          background: rgba(96, 165, 250, 0.8);
        }

        /* Enhanced flash highlight effect */
        @keyframes flash-highlight {
          0% { background-color: rgba(96, 165, 250, 0); }
          30% { background-color: rgba(96, 165, 250, 0.2); }
          100% { background-color: rgba(96, 165, 250, 0); }
        }

        .flash-highlight {
          animation: flash-highlight 1.5s ease-out;
          border-radius: 4px;
          transition: all 0.3s ease;
        }

        /* Enhanced heading styles */
        .rulebook-content h1 {
          font-size: 2.5rem;
          font-weight: 800;
          margin-top: 3rem;
          margin-bottom: 1.5rem;
          padding-bottom: 0.5rem;
          position: relative;
          color: white;
          background-image: linear-gradient(to right, #60a5fa, #c084fc, #93c5fd);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 4px 12px rgba(96, 165, 250, 0.15);
          scroll-margin-top: 120px;
        }

        /* Add scroll margin to all headings for better positioning when scrolled to */
        .rulebook-content h1, 
        .rulebook-content h2, 
        .rulebook-content h3 {
          scroll-margin-top: 120px;
        }
        
        /* Animation for mobile TOC */
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }
        
        /* Apply a backdrop filter to improve readability */
        @supports (backdrop-filter: blur(10px)) {
          .backdrop-blur-md {
            backdrop-filter: blur(10px);
          }
        }
      `}</style>
    </div>
  );
}

// New component for TOC to avoid repetition
function TocContent({ 
  tableOfContents, 
  activeSection, 
  setActiveSection, 
  onItemClick 
}) {
  return (
    <nav className="space-y-1.5">
      {tableOfContents.map((item) => (
        <button 
          key={item.id} 
          data-section={item.id}
          className={`
            group w-full text-left py-2 px-3 rounded-lg text-sm transition-all duration-200 relative
            ${item.level === 1 ? 'font-bold' : item.level === 2 ? 'pl-6 font-medium' : 'pl-8'} 
            ${activeSection === item.id 
              ? 'bg-gradient-to-r from-blue-500/30 to-purple-500/20 text-white shadow-sm sidebar-active' 
              : 'hover:bg-blue-500/10 text-blue-200 hover:text-white'}
          `}
          onClick={() => {
            const element = document.getElementById(item.id);
            if (element) {
              // Enhanced scroll behavior with better positioning
              const headerOffset = 100;
              const elementPosition = element.getBoundingClientRect().top;
              const offsetPosition = elementPosition + window.scrollY - headerOffset;
              
              window.scrollTo({
                top: offsetPosition,
                behavior: "smooth"
              });
              
              setActiveSection(item.id);
              
              // Enhanced highlight effect
              element.classList.add('flash-highlight');
              setTimeout(() => {
                element.classList.remove('flash-highlight');
              }, 1000);
              
              // Close mobile menu if applicable
              if (onItemClick) onItemClick();
            }
          }}
          aria-current={activeSection === item.id ? 'true' : 'false'}
        >
          {/* Visual indicators for hierarchy */}
          {item.level === 2 && (
            <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-400"></span>
          )}
          {item.level === 3 && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-blue-300/70"></span>
          )}
          {/* Text content with truncate for long items */}
          <span className="truncate block">{item.text}</span>
          {/* Right arrow indicator with improved visibility */}
          <span className={`
            absolute right-2 top-1/2 -translate-y-1/2 transform transition-all duration-200
            ${activeSection === item.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-70'}
          `}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </span>
        </button>
      ))}
    </nav>
  );
}
