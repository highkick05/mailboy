import React from 'react';

export const Logo = ({ className }: { className?: string }) => (
  <svg 
    viewBox="0 0 64 64" 
    className={className} 
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* White Background with Rounded Corners */}
    <rect x="0" y="0" width="64" height="64" rx="14" fill="#ffffff" />
    
    {/* Blue Envelope Outline */}
    <g transform="translate(14, 20)">
      <rect x="0" y="0" width="36" height="24" rx="3" 
            fill="none" 
            stroke="#2563eb" 
            strokeWidth="3" 
            strokeLinejoin="round" />
      <path d="M0 0 L18 13 L36 0" 
            fill="none" 
            stroke="#2563eb" 
            strokeWidth="3" 
            strokeLinecap="round" 
            strokeLinejoin="round" />
    </g>
  </svg>
);