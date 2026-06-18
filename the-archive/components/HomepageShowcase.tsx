"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSync } from "@/components/SyncContext";
import Link from "next/link";
import Image from "next/image";

interface Asset {
  id: string;
  created_at: string;
  title?: string;
  category?: string;
  model?: string;
  image_url: string;
  volume?: string;
}

export default function HomepageShowcase() {
  const { setStatus } = useSync();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const cursorDotRef = useRef<HTMLDivElement | null>(null);
  const cursorRingRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch latest 7 assets
  useEffect(() => {
    async function fetchAssets() {
      setStatus("SYNCING");
      try {
        const response = await fetch("/api/showcase", { cache: "no-store" });
        if (!response.ok) {
          console.error("Error fetching assets:", response.status);
          setStatus("ERROR");
          return;
        }
        const payload = await response.json() as { assets?: Asset[] };
        setAssets(payload.assets ?? []);
        setStatus("ONLINE");
      } catch (error) {
        console.error("Error fetching assets:", error);
        setStatus("ERROR");
      } finally {
        setLoading(false);
      }
    }
    fetchAssets();
  }, [setStatus]);

  // Auto-advance logic
  const nextAsset = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % assets.length);
    setProgress(0);
  }, [assets.length]);

  const prevAsset = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + assets.length) % assets.length);
    setProgress(0);
  }, [assets.length]);

  useEffect(() => {
    if (loading || assets.length === 0) return;

    const interval = 50;
    const step = (interval / 5000) * 100;

    timerRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          nextAsset();
          return 0;
        }
        return prev + step;
      });
    }, interval);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loading, assets.length, nextAsset]);

  // Handle Interactivity
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") nextAsset();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") prevAsset();
    };

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > 50) {
        if (e.deltaY > 0) nextAsset();
        else prevAsset();
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (cursorDotRef.current) {
        cursorDotRef.current.style.left = `${e.clientX}px`;
        cursorDotRef.current.style.top = `${e.clientY}px`;
      }
      if (cursorRingRef.current) {
        cursorRingRef.current.style.left = `${e.clientX}px`;
        cursorRingRef.current.style.top = `${e.clientY}px`;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", handleWheel, { passive: true });
    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [nextAsset, prevAsset]);

  if (loading) return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <div className="font-space text-acid animate-pulse tracking-widest text-xs uppercase">LOADING_ARCHIVE_DATA...</div>
    </div>
  );

  if (assets.length === 0) return <PublicHome />;

  const currentAsset = assets[currentIndex];

  return (
    <div className="fixed inset-0 bg-black overflow-hidden font-space select-none cursor-none" onClick={nextAsset}>
      {/* Custom Cursor (positioned imperatively to avoid re-rendering on mousemove) */}
      <div ref={cursorDotRef} className="custom-cursor" style={{ left: -100, top: -100 }} />
      <div ref={cursorRingRef} className="custom-cursor-ring" style={{ left: -100, top: -100 }} />

      {/* Corner Decorations */}
      <div className="corner-l corner-top-left" />
      <div className="corner-l corner-top-right" />
      <div className="corner-l corner-bottom-left" />
      <div className="corner-l corner-bottom-right" />

      {/* Transitions Container */}
      <div className="absolute inset-0 flex items-center justify-center">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={currentAsset.id}
            initial={{ scale: 1.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 2, opacity: 0 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0"
          >
            <Image
              src={currentAsset.image_url}
              alt={currentAsset.title || currentAsset.category || "The Archive visual"}
              fill
              loading="eager"
              fetchPriority="high"
              sizes="100vw"
              quality={90}
              unoptimized={currentAsset.image_url.startsWith("https://cdn.midjourney.com/")}
              className="object-cover brightness-[0.85]"
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* UI Elements */}
      
      {/* Top Center: Vertix OS Label */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50 text-center">
        <div className="text-[9px] md:text-[10px] tracking-[0.3em] text-white/50 mb-1">VERTIX OS</div>
        <div className="text-acid font-bold tracking-[0.25em] md:tracking-[0.3em] text-[9px] md:text-xs uppercase">
          {new Date().toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' })}
        </div>
      </div>

      {/* Top Right: Subcategory */}
      <div className="absolute top-8 right-8 z-50">
        <div className="border border-white/20 px-2 py-0.5 md:px-3 md:py-1 text-[9px] md:text-[10px] tracking-widest text-white/70 backdrop-blur-sm uppercase">
          {currentAsset.category?.toUpperCase() || "VISUALS"}
        </div>
      </div>

      {/* Left Center: Depth Indicator */}
      <div className="absolute left-10 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-2">
        {assets.map((_, i) => (
          <div 
            key={i}
            className={`w-[2px] transition-all duration-500 ${i === currentIndex ? "h-12 bg-acid shadow-[0_0_10px_#c8ff00]" : "h-6 bg-white/20"}`}
          />
        ))}
      </div>

      {/* Right Center: Navigation Dots */}
      <div className="absolute right-10 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-4">
        {assets.map((_, i) => (
          <button
            key={i}
            onClick={(e) => { e.stopPropagation(); setCurrentIndex(i); setProgress(0); }}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${i === currentIndex ? "bg-acid scale-150 shadow-[0_0_10px_#c8ff00]" : "bg-white/30 hover:bg-white/60 cursor-none"}`}
          />
        ))}
      </div>

      {/* Bottom Left: Asset Info */}
      <div className="absolute bottom-12 left-12 z-50 max-w-xl">
        <div className="flex items-center gap-3 mb-4">
          <span className="bg-acid text-black text-[9px] font-bold px-1.5 py-0.5 blink-anim">NEW</span>
          <span className="text-[10px] tracking-widest text-white/50 uppercase">{currentAsset.volume || "GENERAL"}</span>
        </div>
        
        <h1 
          key={`title-${currentAsset.id}`}
          className="font-bebas text-7xl md:text-8xl text-white leading-none mb-4 glitch-trigger tracking-tighter uppercase"
          data-text={currentAsset.title?.toUpperCase()}
        >
          {currentAsset.title?.toUpperCase()}
        </h1>

        <div className="flex flex-col gap-1 text-[10px] tracking-widest text-white/40 uppercase mb-8">
          <div>MODEL: {currentAsset.model}</div>
          <div>DATE: {new Date(currentAsset.created_at).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })}</div>
        </div>

        <Link 
          href={`/visuals?id=${currentAsset.id}`}
          className="group flex items-center gap-4 bg-white/5 hover:bg-acid transition-all duration-300 border border-white/10 hover:border-acid px-6 py-3 cursor-none"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-xs group-hover:text-black tracking-[0.3em] font-bold uppercase">ACCESS ASSET</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="group-hover:translate-x-1 transition-transform stroke-white group-hover:stroke-black">
            <path d="M1 11L11 1M11 1H1M11 1V11" stroke="inherit" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>
      </div>

      {/* Bottom Right: Counter */}
      <div className="absolute bottom-12 right-12 z-50 flex items-baseline gap-1">
        <span className="font-bebas text-4xl text-acid">0{currentIndex + 1}</span>
        <span className="font-bebas text-xl text-white/20">/0{assets.length}</span>
      </div>

      {/* Bottom Center: Legal Footer */}
      <LegalFooter />

      {/* Bottom: Progress Bar */}
      <div className="absolute bottom-0 left-0 w-full h-[3px] bg-white/5 z-50">
        <motion.div 
          className="h-full bg-acid"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ ease: "linear", duration: 0.05 }}
          style={{ boxShadow: "0 0 10px #c8ff00" }}
        />
      </div>

      <style jsx global>{`
        body {
          overflow: hidden !important;
        }
      `}</style>
    </div>
  );
}

function PublicHome() {
  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white font-space">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(200,255,0,0.16),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.08),transparent_42%)]" />
      <div className="corner-l corner-top-left" />
      <div className="corner-l corner-top-right" />
      <div className="corner-l corner-bottom-left" />
      <div className="corner-l corner-bottom-right" />

      <main className="relative z-10 flex min-h-screen items-center px-6 py-20 md:px-12">
        <section className="max-w-4xl">
          <div className="mb-5 inline-block bg-acid px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-black">
            Public Beta Opening
          </div>
          <h1 className="font-anton text-7xl uppercase leading-none tracking-tight md:text-9xl">
            The Archive
          </h1>
          <p className="mt-6 max-w-2xl font-mono text-xs uppercase leading-relaxed tracking-[0.2em] text-white/50">
            A curated creative operating system for AI visuals, prompt systems, workflows,
            moodboards, and generation. Private members keep the deepest access. Public users
            can now start with a lighter free tier.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/pricing"
              className="bg-acid px-7 py-3 text-center font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-black transition-colors hover:bg-white"
            >
              View Access Tiers
            </Link>
            <Link
              href="/login"
              className="border border-white/15 px-7 py-3 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-white/65 transition-colors hover:border-acid hover:text-acid"
            >
              Enter Archive
            </Link>
          </div>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}

function LegalFooter() {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const links = [
    { label: 'Terms', href: '/terms' },
    { label: 'Privacy', href: '/privacy' },
    { label: 'Refunds', href: '/refund' },
    { label: 'Pricing', href: '/pricing' },
  ];
  return (
    <div
      onClick={stop}
      className="fixed bottom-3 left-1/2 z-[60] -translate-x-1/2 flex items-center gap-3 md:gap-4 bg-black/50 backdrop-blur-sm border border-white/10 px-3 py-1 md:px-4 md:py-1.5"
    >
      {links.map((link, i) => (
        <span key={link.href} className="flex items-center gap-3 md:gap-4">
          {i > 0 && <span className="h-2 w-px bg-white/15" />}
          <Link
            href={link.href}
            onClick={stop}
            className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/45 transition-colors hover:text-acid"
          >
            {link.label}
          </Link>
        </span>
      ))}
    </div>
  );
}
