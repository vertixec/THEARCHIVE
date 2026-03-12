'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from './Toast';

type Mode = 'login' | 'register' | 'forgot';

export default function AuthForm() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        showToast('ACCESS GRANTED');
        window.location.href = '/';
      } else if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        // Supabase silently "succeeds" for existing emails but returns empty identities
        if (data.user && data.user.identities?.length === 0) {
          showToast('EMAIL ALREADY REGISTERED — USE LOGIN OR RECOVERY');
          setMode('login');
          return;
        }
        showToast('VERIFICATION EMAIL SENT');
      } else {
        // forgot mode
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
        });
        if (error) throw error;
        showToast('RECOVERY EMAIL SENT — CHECK YOUR INBOX');
        setMode('login');
      }
    } catch (error: any) {
      showToast(error.message.toUpperCase());
    } finally {
      setLoading(false);
    }
  };

  const statusLabel = loading ? 'PROCESSING...' : 'AWAITING INPUT';
  const title = mode === 'login' ? 'Login' : mode === 'register' ? 'Register' : 'Recovery';

  return (
    <div className="w-full max-w-md p-8 bg-panel border border-white/10 relative overflow-hidden group">
      <div className="scanline"></div>

      <div className="flex justify-between items-center mb-8 border-b border-white/10 pb-4">
        <h2 className="font-anton text-2xl tracking-tight text-white uppercase">
          {title}
        </h2>
        <div className="font-mono text-[10px] text-acid animate-pulse">
          STATUS: {statusLabel}
        </div>
      </div>

      {/* Forgot mode description */}
      {mode === 'forgot' && (
        <p className="font-mono text-[10px] text-gray-400 uppercase tracking-widest mb-6 leading-relaxed">
          Enter your identifier and we will transmit a recovery link to your inbox.
        </p>
      )}

      <form onSubmit={handleAuth} className="space-y-6">
        {/* Email field — always visible */}
        <div>
          <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-widest mb-2">
            Identifier (Email)
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-black border border-white/20 p-3 font-mono text-xs text-acid focus:border-acid outline-none transition-all uppercase"
            placeholder="USER@ARCHIVE.SYS"
          />
        </div>

        {/* Password field — hidden in forgot mode */}
        {mode !== 'forgot' && (
          <div>
            <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-widest mb-2">
              Access Key (Password)
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black border border-white/20 p-3 font-mono text-xs text-acid focus:border-acid outline-none transition-all"
              placeholder="••••••••"
            />
            {/* Forgot link — only in login mode */}
            {mode === 'login' && (
              <div className="mt-2 text-right">
                <button
                  type="button"
                  onClick={() => setMode('forgot')}
                  className="font-mono text-[9px] text-gray-600 hover:text-acid transition-colors uppercase tracking-widest"
                >
                  Forgot access key?
                </button>
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-acid text-black font-anton py-4 text-xl tracking-tighter hover:bg-white transition-all duration-300 uppercase disabled:opacity-50"
        >
          {mode === 'login'
            ? 'Initialize Session'
            : mode === 'register'
            ? 'Create Profile'
            : 'Transmit Recovery Link'}
        </button>
      </form>


      <div className="mt-8 text-center flex flex-col gap-2">
        {mode === 'forgot' ? (
          <button
            onClick={() => setMode('login')}
            className="font-mono text-[10px] text-gray-500 hover:text-acid transition-colors uppercase tracking-widest"
          >
            ← Back to Login
          </button>
        ) : (
          <button
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="font-mono text-[10px] text-gray-500 hover:text-acid transition-colors uppercase tracking-widest"
          >
            {mode === 'login'
              ? 'Need a new profile? [Register]'
              : 'Existential profile? [Login]'}
          </button>
        )}
      </div>
    </div>
  );
}
