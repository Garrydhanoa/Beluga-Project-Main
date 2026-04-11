"use client";

import { useState, useEffect } from 'react';

export default function NotificationBar({ message }) {
  const [isVisible, setIsVisible] = useState(true);
  const [hasSeenNotification, setHasSeenNotification] = useState(false);

  useEffect(() => {
    // Check if user has already seen this notification
    const notificationStatus = localStorage.getItem('notification_seen_v2'); // Updated version
    if (notificationStatus === 'true') {
      setHasSeenNotification(true);
      setIsVisible(false);
    } else {
      setIsVisible(true);
    }
  }, []);

  const dismissNotification = () => {
    setIsVisible(false);
    // Set flag in localStorage so notification won't show on next visit
    localStorage.setItem('notification_seen_v2', 'true');
    setHasSeenNotification(true);
  };

  if (!isVisible || hasSeenNotification) {
    return null;
  }

  // Parse message to highlight "Player Directory"
  const renderMessage = () => {
    const parts = message.split(/(Player Directory)/g);
    return parts.map((part, index) => {
      if (part === 'Player Directory') {
        return (
          <span key={index} className="font-bold text-yellow-300 px-1">
            {part}
          </span>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-2 relative">
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center">
          <span className="font-bold mr-2">What&apos;s New:</span>
          <span>{renderMessage()}</span>
        </div>
        <button 
          onClick={dismissNotification} 
          className="ml-4 p-1 rounded-full hover:bg-white/20 transition-colors"
          aria-label="Dismiss notification"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}
