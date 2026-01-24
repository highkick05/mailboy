import React from 'react';

interface ComposeFABProps {
  onClick: () => void;
}

export function ComposeFAB({ onClick }: ComposeFABProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-8 right-8 z-50 p-4 bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-2xl transition-all duration-300 hover:scale-110 hover:rotate-3 focus:outline-none focus:ring-4 focus:ring-blue-400/50 group"
      aria-label="Compose Email"
    >
      <div className="relative">
        {/* Pencil Icon */}
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          width="28" 
          height="28" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      </div>
      
      {/* Tooltip (Optional, appears on hover) */}
      <span className="absolute right-full mr-4 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
        New Message
      </span>
    </button>
  );
}