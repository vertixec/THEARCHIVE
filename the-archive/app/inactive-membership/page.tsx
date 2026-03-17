"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const VERTIX_OS_URL = process.env.NEXT_PUBLIC_VERTIX_OS_URL ?? "#";
const SUPPORT_EMAIL = "vertix.ia@gmail.com";

function TVStatic() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Low resolution for chunky CRT pixel look
    const W = 320;
    const H = 180;
    canvas.width = W;
    canvas.height = H;

    let animId: number;
    let lastTime = 0;
    const FPS = 24;
    const interval = 1000 / FPS;

    const draw = (timestamp: number) => {
      animId = requestAnimationFrame(draw);
      if (timestamp - lastTime < interval) return;
      lastTime = timestamp;

      const imageData = ctx.createImageData(W, H);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        // Occasionally add a bright flash pixel for realism
        const v = Math.random() < 0.04
          ? 255
          : Math.floor(Math.random() * 180);
        data[i]     = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = Math.floor(Math.random() * 200 + 30);
      }

      // Horizontal band sweep — a brighter rolling line
      const bandY = Math.floor((Date.now() / 40) % H);
      for (let x = 0; x < W; x++) {
        const idx = (bandY * W + x) * 4;
        data[idx]     = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = Math.floor(Math.random() * 80 + 20);
      }

      ctx.putImageData(imageData, 0, 0);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{
        imageRendering: "pixelated",
        opacity: 0.18,
        mixBlendMode: "screen",
      }}
    />
  );
}

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
      {/* TV static */}
      <TVStatic />

      {/* Scanlines overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-[1]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.35) 2px, rgba(0,0,0,0.35) 4px)",
        }}
      />

      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-[2]"
        style={{
          background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.75) 100%)",
        }}
      />

      {/* Grain overlay */}
      <div className="film-grain pointer-events-none z-[3]" />

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
      <p className="absolute bottom-8 font-space text-[9px] tracking-[0.3em] text-white/20 uppercase z-10">
        THE ARCHIVE — RESTRICTED ACCESS
      </p>
    </div>
  );
}
