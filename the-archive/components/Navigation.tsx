'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavigationProps {
  status?: 'ONLINE' | 'OFFLINE' | 'ERROR' | 'SYNCING';
}

export default function Navigation({ status = 'ONLINE' }: NavigationProps) {
  const pathname = usePathname();

  const isTabActive = (path: string) => {
    if (path === '/' && pathname === '/') return true;
    if (path !== '/' && pathname.startsWith(path)) return true;
    return false;
  };

  const getStatusColor = () => {
    if (status === 'ONLINE') return 'text-acid border-acid';
    if (status === 'OFFLINE') return 'text-gray-500 border-white/10';
    return 'text-danger border-danger';
  };

  return (
    <nav className="sticky top-0 z-50 bg-dark/95 backdrop-blur-md border-b border-white/10 h-[72px] flex justify-between items-center px-6">
      <div className="flex items-center gap-8">
        <Link 
          href="/" 
          className="font-anton text-2xl tracking-tight leading-none cursor-pointer hover:text-acid transition-colors select-none uppercase"
        >
          The<br />Archive
        </Link>
        <div className="hidden md:block w-px h-8 bg-white/20"></div>
        <div className="flex gap-6 font-oswald text-sm tracking-widest text-white uppercase h-full items-center">
          <Link 
            href="/" 
            className={`py-6 border-b-2 transition-all duration-300 hover:text-acid ${isTabActive('/') ? 'text-acid border-acid' : 'border-transparent'}`}
          >
            VISUALS
          </Link>
          <Link 
            href="/systems" 
            className={`py-6 border-b-2 transition-all duration-300 hover:text-acid ${isTabActive('/systems') ? 'text-acid border-acid' : 'border-transparent'}`}
          >
            SYSTEMS
          </Link>
          <Link 
            href="/community" 
            className={`py-6 border-b-2 transition-all duration-300 hover:text-acid ${isTabActive('/community') ? 'text-acid border-acid' : 'border-transparent'}`}
          >
            COMMUNITY
          </Link>
        </div>
      </div>
      <div id="sync-indicator" className={`font-mono text-[10px] border px-3 py-1 rounded-full uppercase tracking-tighter ${getStatusColor()}`}>
        Status: {status === 'ONLINE' ? 'V1 ONLINE' : status}
      </div>
    </nav>
  );
}
