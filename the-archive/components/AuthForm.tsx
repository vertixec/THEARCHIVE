'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from './Toast';

export default function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        showToast('ACCESS GRANTED');
        window.location.href = '/';
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        showToast('VERIFICATION EMAIL SENT');
      }
    } catch (error: any) {
      showToast(error.message.toUpperCase());
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (error: any) {
      showToast(error.message.toUpperCase());
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-panel border border-white/10 relative overflow-hidden group">
      <div className="scanline"></div>
      
      <div className="flex justify-between items-center mb-8 border-b border-white/10 pb-4">
        <h2 className="font-anton text-2xl tracking-tight text-white uppercase">
          {isLogin ? 'Login' : 'Register'}
        </h2>
        <div className="font-mono text-[10px] text-acid animate-pulse">
          STATUS: {loading ? 'PROCESSING...' : 'AWAITING INPUT'}
        </div>
      </div>

      <form onSubmit={handleAuth} className="space-y-6">
        <div>
          <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-widest mb-2">Identifier (Email)</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-black border border-white/20 p-3 font-mono text-xs text-acid focus:border-acid outline-none transition-all uppercase"
            placeholder="USER@ARCHIVE.SYS"
          />
        </div>

        <div>
          <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-widest mb-2">Access Key (Password)</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-black border border-white/20 p-3 font-mono text-xs text-acid focus:border-acid outline-none transition-all"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-acid text-black font-anton py-4 text-xl tracking-tighter hover:bg-white transition-all duration-300 uppercase disabled:opacity-50"
        >
          {isLogin ? 'Initialize Session' : 'Create Profile'}
        </button>
      </form>

      <div className="relative my-8">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/10"></div>
        </div>
        <div className="relative flex justify-center text-[10px]">
          <span className="px-2 bg-panel font-mono text-gray-500 uppercase">External Auth Providers</span>
        </div>
      </div>

      <button
        onClick={handleGoogleLogin}
        className="w-full bg-black border border-white/10 text-white font-oswald py-3 text-sm tracking-[0.2em] hover:border-acid hover:text-acid transition-all duration-300 uppercase flex items-center justify-center gap-3"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24">
          <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Access with Google
      </button>

      <div className="mt-8 text-center">
        <button
          onClick={() => setIsLogin(!isLogin)}
          className="font-mono text-[10px] text-gray-500 hover:text-acid transition-colors uppercase tracking-widest"
        >
          {isLogin ? 'Need a new profile? [Register]' : 'Existential profile? [Login]'}
        </button>
      </div>
    </div>
  );
}
