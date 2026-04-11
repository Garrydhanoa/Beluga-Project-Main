"use client";

import { useEffect } from "react";

/**
 * BackgroundDecoration component
 * Creates decorative background elements with parallax effect
 */
export default function BackgroundDecoration() {
  // Add parallax effect to background elements with device detection
  useEffect(() => {
    // Check if device is mobile/tablet
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    
    // Only add mouse move effect on desktop devices
    if (!isMobile) {
      const handleMouseMove = (e) => {
        const decorElements = document.querySelectorAll(".bg-decor");
        decorElements.forEach((elem) => {
          const htmlElem = elem;
          const speed = parseFloat(htmlElem.dataset.speed || "0.05");
          const x = (window.innerWidth - e.pageX * speed) / 100;
          const y = (window.innerHeight - e.pageY * speed) / 100;
          htmlElem.style.transform = `translateX(${x}px) translateY(${y}px)`;
        });
      };

      document.addEventListener("mousemove", handleMouseMove);
      return () => document.removeEventListener("mousemove", handleMouseMove);
    } else {
      // For mobile, use simpler animations to improve performance
      const decorElements = document.querySelectorAll(".bg-decor");
      decorElements.forEach((elem) => {
        // Add a subtle animation class for mobile
        elem.classList.add("animate-pulse-slow");
      });
    }
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      {/* Gradient blobs */}
      <div
        className="bg-decor absolute top-20 left-10 w-64 h-64 rounded-full bg-blue-500/5 blur-3xl"
        data-speed="0.03"
      ></div>

      <div
        className="bg-decor absolute bottom-40 right-10 w-80 h-80 rounded-full bg-purple-500/5 blur-3xl"
        data-speed="0.05"
      ></div>

      <div
        className="bg-decor hidden lg:block absolute bottom-1/3 left-1/4 w-56 h-56 rounded-full bg-purple-400/5 blur-2xl"
        data-speed="0.04"
      ></div>

      {/* SVG blob top left */}
      <svg
        className="bg-decor absolute -top-10 -left-10 text-blue-500/10 w-40 h-40 hidden sm:block"
        viewBox="0 0 200 200"
        data-speed="0.01"
      >
        <path
          fill="currentColor"
          d="M44.3,-76.2C58.4,-69.1,71.9,-59.3,79.4,-45.8C86.9,-32.2,88.2,-16.1,85.6,-1.5C83,13.2,76.5,26.3,68.3,38.2C60,50.1,50,60.8,37.7,70.2C25.5,79.7,12.8,87.9,-0.7,89C-14.1,90.1,-28.2,84.1,-40.6,75.4C-53,66.8,-63.6,55.5,-71.7,42.2C-79.7,28.9,-85.2,14.5,-85.9,-0.4C-86.6,-15.3,-82.4,-30.5,-73.8,-42.7C-65.1,-55,-51.8,-64.2,-37.8,-71.2C-23.8,-78.2,-11.9,-82.9,1.6,-85.8C15.1,-88.7,30.1,-89.8,44.3,-76.2Z"
          transform="translate(100 100)"
        />
      </svg>

      {/* SVG blob bottom right */}
      <svg
        className="bg-decor absolute -bottom-20 -right-20 text-purple-500/10 w-72 h-72 hidden sm:block"
        viewBox="0 0 200 200"
        data-speed="0.03"
      >
        <path
          fill="currentColor"
          d="M42.7,-73.4C54.9,-67.3,64.2,-54.9,71.5,-41.3C78.7,-27.7,83.8,-13.9,83.1,-0.4C82.5,13,76,26,68.6,38.5C61.2,51,52.8,63,41.2,70.7C29.5,78.4,14.7,81.7,0.2,81.4C-14.4,81.1,-28.7,77.2,-41.8,70.2C-54.8,63.3,-66.5,53.2,-73.6,40.4C-80.7,27.5,-83.2,13.8,-83.3,-0.1C-83.4,-13.9,-81.1,-27.8,-74.1,-39.7C-67.1,-51.5,-55.4,-61.4,-42.2,-67C-28.9,-72.6,-14.5,-74,0.3,-74.5C15.1,-75,30.2,-74.6,42.7,-68.4Z"
          transform="translate(100 100)"
        />
      </svg>

      {/* Additional middle decorative element */}
      <div
        className="bg-decor absolute top-1/3 right-1/4 w-40 h-40 rounded-full bg-gradient-to-br from-blue-400/5 to-purple-400/5 blur-2xl hidden lg:block"
        data-speed="0.02"
      ></div>
    </div>
  );
}
