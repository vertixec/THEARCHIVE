'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

import { useAuth } from '@/components/AuthContext';

interface NavigationProps {
  status?: 'ONLINE' | 'OFFLINE' | 'ERROR' | 'SYNCING';
}

export default function Navigation({ status = 'ONLINE' }: NavigationProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

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

  const isAuthPage = pathname === '/login';

  return (
    <nav className="sticky top-0 z-50 bg-dark/95 backdrop-blur-md border-b border-white/10 h-[72px] flex justify-between items-center px-6">
      <div className="flex items-center gap-8">
        <Link 
          href="/" 
          className="font-anton text-2xl tracking-tight leading-none cursor-pointer hover:text-acid transition-colors select-none uppercase"
        >
          The<br />Archive
        </Link>
        {!isAuthPage && (
          <>
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
          </>
        )}
      </div>

      <div className="flex items-center gap-10">
        {!isAuthPage && (
          <Link 
            href="/favorites" 
            className={`font-oswald text-xs md:text-sm tracking-[0.2em] transition-all duration-300 hover:text-acid py-1 border-b-2 ${isTabActive('/favorites') ? 'text-acid border-acid' : 'text-white/60 border-transparent underline-offset-8'}`}
          >
            LIKES
          </Link>
        )}
        <div className="flex items-center gap-4">
          <div id="sync-indicator" className={`font-mono text-[10px] border px-3 py-1 rounded-full uppercase tracking-tighter ${getStatusColor()}`}>
            Status: {status === 'ONLINE' ? 'V1 ONLINE' : status}
          </div>
          {user && (
            <button 
              onClick={handleSignOut}
              className="font-mono text-[10px] text-gray-500 hover:text-danger border border-white/10 hover:border-danger px-3 py-1 rounded transition-all uppercase tracking-widest"
            >
              Sign_Out
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
