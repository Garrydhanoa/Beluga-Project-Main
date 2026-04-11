/* Dynamic header size adjustment for mobile - professional look */

// This script runs only on client-side to adjust header size based on actual viewport
if (typeof window !== 'undefined') {
  function enhanceMobileHeaders() {
    const headers = document.querySelectorAll('.super-large-mobile-header');
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    
    // For mobile screens
    if (vw <= 640) {
      // Professional sizing - readable but bold
      let fontSize;
      let headerPadding;
      
      if (vw <= 350) {
        // Smallest screens
        fontSize = Math.max(vw * 0.08, 42); // 8% of viewport width, min 42px
        headerPadding = '0.5rem 1rem';
      } else if (vw <= 400) {
        // Small screens
        fontSize = Math.max(vw * 0.085, 48); // 8.5% of viewport width, min 48px
        headerPadding = '0.75rem 1.25rem';
      } else {
        // Medium-sized mobile screens
        fontSize = Math.max(vw * 0.09, 54); // 9% of viewport width, min 54px
        headerPadding = '1rem 1.5rem';
      }
      
      // Apply professional styling to headers
      headers.forEach(header => {
        // Font settings
        header.style.fontSize = `${fontSize}px`;
        header.style.lineHeight = '1.1';
        header.style.letterSpacing = '-0.5px';
        header.style.fontWeight = '800';
        
        // Find header wrapper and apply styles
        const wrapper = header.querySelector('.professional-header-wrapper');
        if (wrapper) {
          wrapper.style.padding = headerPadding;
          
          // Add subtle animation for more professional feel
          if (!wrapper.classList.contains('enhanced')) {
            wrapper.classList.add('enhanced');
            wrapper.style.transition = 'all 0.3s ease-out';
            
            // Create subtle border accent
            const accent = document.createElement('div');
            accent.className = 'header-accent';
            accent.style.position = 'absolute';
            accent.style.bottom = '0';
            accent.style.left = '50%';
            accent.style.transform = 'translateX(-50%)';
            accent.style.width = '80%';
            accent.style.height = '2px';
            accent.style.background = 'linear-gradient(to right, transparent, rgba(255,255,255,0.3), transparent)';
            wrapper.appendChild(accent);
          }
        }
      });
    }
  }
  
  // Run on load and resize
  window.addEventListener('DOMContentLoaded', enhanceMobileHeaders);
  window.addEventListener('resize', enhanceMobileHeaders);
  
  // Run once after a short delay to ensure everything is loaded
  setTimeout(enhanceMobileHeaders, 500);
}
