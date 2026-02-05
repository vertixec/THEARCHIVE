'use client';

import { useEffect, useState } from 'react';

export default function Loader() {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setProgress(100);
      setTimeout(() => {
        setLoading(false);
      }, 1500);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  if (!loading) return null;

  return (
    <div id="loader" className={`fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center transition-all duration-800 ease-out ${progress === 100 ? 'opacity-0 invisible' : 'opacity-100'}`}>
      <h1 className="font-anton text-6xl md:text-9xl tracking-tighter animate-pulse text-white uppercase">Archive</h1>
      <div className="w-64 h-1 bg-gray-800 mt-4 overflow-hidden">
        <div 
          className="h-full bg-acid transition-all duration-[1500ms] ease-in-out" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>
      <div className="font-mono text-[10px] text-gray-500 mt-2 uppercase tracking-widest">
        {progress < 100 ? 'Initializing protocol...' : 'System Ready'}
      </div>
    </div>
  );
}
