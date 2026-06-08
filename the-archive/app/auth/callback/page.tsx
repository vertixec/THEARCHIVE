"use client";

import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const handleCallback = async () => {
      const searchParams = new URLSearchParams(window.location.search);
      // Supabase implicit flow puts tokens in the hash fragment (#access_token=...&type=recovery)
      const hashParams = new URLSearchParams(
        window.location.hash.replace(/^#/, ""),
      );

      // type can come from our custom redirectTo param OR from Supabase's hash
      const type = searchParams.get("type") || hashParams.get("type");
      const code = searchParams.get("code");
      const tokenHash = searchParams.get("token_hash");

      let authError = null;

      if (code) {
        // PKCE flow: code in query params
        const { error } = await supabase.auth.exchangeCodeForSession(
          window.location.search,
        );
        authError = error;
      } else if (tokenHash) {
        // token_hash flow (some Supabase configs)
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: (type ?? "recovery") as "recovery" | "magiclink" | "email",
        });
        authError = error;
      }
      // Implicit flow: Supabase client auto-sets session from hash fragment — no extra call needed

      if (authError) {
        router.push("/login?error=auth_callback_failed");
        return;
      }

      // Confirm a session actually exists. An expired/invalid link can reach
      // here without an error but also without setting a session — in that case
      // don't pretend the user is logged in.
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login?error=link_expired");
        return;
      }

      router.push(type === "recovery" ? "/auth/reset-password" : "/");
    };

    handleCallback();
  }, [router]);

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center">
      <div className="font-anton text-4xl text-white animate-pulse uppercase tracking-tighter">
        Verifying Session...
      </div>
      <div className="w-48 h-1 bg-gray-800 mt-4 overflow-hidden">
        <div className="h-full bg-acid animate-loading-bar"></div>
      </div>
    </div>
  );
}
