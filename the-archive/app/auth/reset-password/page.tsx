'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/Toast';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      showToast('ACCESS KEY MUST BE AT LEAST 8 CHARACTERS');
      return;
    }
    if (password !== confirm) {
      showToast('ACCESS KEYS DO NOT MATCH');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      showToast('ACCESS KEY UPDATED — REDIRECTING...');
      setTimeout(() => {
        window.location.href = '/login';
      }, 1500);
    } catch (error: any) {
      showToast(error.message.toUpperCase());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-72px)] bg-dark flex flex-col items-center justify-center p-6 relative">
      {/* Background Decor */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl h-full max-h-[600px] border-[1px] border-white/5 pointer-events-none"></div>

      <div className="relative z-10 w-full flex flex-col items-center">
        <div className="mb-12 text-center">
          <div className="bg-acid text-black font-mono text-[10px] px-3 py-1 font-bold uppercase tracking-[0.3em] inline-block mb-4">
            Security Gate
          </div>
          <h1 className="font-anton text-7xl md:text-9xl text-white uppercase tracking-tighter leading-none">
            New Key
          </h1>
          <p className="font-mono text-xs text-white/40 mt-4 uppercase tracking-[0.2em] max-w-md mx-auto">
            Set a new access key for your archive account.
          </p>
        </div>

        {/* Reset Form Card */}
        <div className="w-full max-w-md p-8 bg-panel border border-white/10 relative overflow-hidden">
          <div className="scanline"></div>

          <div className="flex justify-between items-center mb-8 border-b border-white/10 pb-4">
            <h2 className="font-anton text-2xl tracking-tight text-white uppercase">
              Reset Key
            </h2>
            <div className="font-mono text-[10px] text-acid animate-pulse">
              STATUS: {loading ? 'PROCESSING...' : 'AWAITING INPUT'}
            </div>
          </div>

          <form onSubmit={handleReset} className="space-y-6">
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-widest mb-2">
                New Access Key
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black border border-white/20 p-3 font-mono text-xs text-acid focus:border-acid outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-widest mb-2">
                Confirm Access Key
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full bg-black border border-white/20 p-3 font-mono text-xs text-acid focus:border-acid outline-none transition-all"
                placeholder="••••••••"
              />
              {/* Visual match indicator */}
              {confirm.length > 0 && (
                <p className={`mt-2 font-mono text-[9px] uppercase tracking-widest transition-colors ${password === confirm ? 'text-acid' : 'text-red-500'}`}>
                  {password === confirm ? '✓ Keys match' : '✗ Keys do not match'}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-acid text-black font-anton py-4 text-xl tracking-tighter hover:bg-white transition-all duration-300 uppercase disabled:opacity-50"
            >
              {loading ? 'Updating...' : 'Commit New Key'}
            </button>
          </form>

          <div className="mt-8 text-center">
            <a
              href="/login"
              className="font-mono text-[10px] text-gray-500 hover:text-acid transition-colors uppercase tracking-widest"
            >
              ← Return to Login
            </a>
          </div>
        </div>

        <div className="mt-12 font-mono text-[8px] text-gray-600 uppercase tracking-[0.5em] flex gap-8">
          <span>Archive V1</span>
        </div>
      </div>
    </div>
  );
}
