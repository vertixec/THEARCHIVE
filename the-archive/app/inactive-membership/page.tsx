"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const VERTIX_OS_URL = process.env.NEXT_PUBLIC_VERTIX_OS_URL ?? "#";

const SUPPORT_EMAIL = "vertix.ia@gmail.com";

export default function InactiveMembershipPage() {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const handleCopyEmail = async () => {
    await navigator.clipboard.writeText(SUPPORT_EMAIL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-dark flex flex-col items-center justify-center text-white relative overflow-hidden">
      {/* Grain overlay */}
      <div className="film-grain pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 gap-8">
        {/* Badge */}
        <span className="bg-danger text-white font-space text-[10px] tracking-[0.3em] px-4 py-1.5 uppercase font-bold">
          ACCESS BLOCKED
        </span>

        {/* Title */}
        <h1 className="font-bebas text-6xl md:text-8xl lg:text-9xl leading-none tracking-tight uppercase">
          Inactive
          <br />
          Membership
        </h1>

        {/* Subtitle */}
        <p className="font-space text-[11px] md:text-[13px] tracking-[0.2em] text-white/60 uppercase max-w-sm leading-relaxed">
          Your membership is not active.
          <br />
          Access VERTIX OS to renew it.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 mt-2">
          <a
            href={VERTIX_OS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-acid text-black font-space text-[11px] tracking-[0.25em] font-bold uppercase px-8 py-3 hover:bg-acid/90 transition-colors"
          >
            GO TO VERTIX OS →
          </a>
          <button
            onClick={handleSignOut}
            className="border border-white/30 text-white font-space text-[11px] tracking-[0.25em] uppercase px-8 py-3 hover:border-white hover:text-white transition-colors"
          >
            SIGN OUT
          </button>
        </div>

        {/* Support */}
        <div className="flex flex-col items-center gap-2 mt-2">
          <p className="font-space text-[9px] tracking-[0.3em] text-white/30 uppercase">
            Customer Support
          </p>
          <button
            onClick={handleCopyEmail}
            className="font-space text-[11px] tracking-[0.15em] text-acid hover:text-acid/80 transition-colors cursor-pointer"
            title="Click to copy"
          >
            {copied ? "COPIED!" : SUPPORT_EMAIL}
          </button>
        </div>
      </div>

      {/* Footer */}
      <p className="absolute bottom-8 font-space text-[9px] tracking-[0.3em] text-white/20 uppercase">
        THE ARCHIVE — RESTRICTED ACCESS
      </p>
    </div>
  );
}
