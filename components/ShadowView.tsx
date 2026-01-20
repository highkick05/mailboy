import React, { useRef, useEffect } from 'react';

interface ShadowViewProps {
  html: string;
  className?: string;
}

export const ShadowView: React.FC<ShadowViewProps> = ({ html, className }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    if (hostRef.current && !shadowRootRef.current) {
      // 1. Create the Shadow DOM "Bubble"
      shadowRootRef.current = hostRef.current.attachShadow({ mode: 'open' });
    }
    
    if (shadowRootRef.current) {
      // 2. Inject the content directly (Fast & Isolated)
      shadowRootRef.current.innerHTML = html;
    }
  }, [html]);

  return <div ref={hostRef} className={className} />;
};