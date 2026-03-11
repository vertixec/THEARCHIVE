"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import { useAuth } from "@/components/AuthContext";

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState<"ONLINE" | "ERROR" | "SYNCING">("SYNCING");

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const { error } = await supabase.auth.getSession();
        setSupabaseStatus(error ? "ERROR" : "ONLINE");
      } catch {
        setSupabaseStatus("ERROR");
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const isTabActive = (path: string) => {
    if (path === "/" && pathname === "/") return true;
    if (path !== "/" && pathname.startsWith(path)) return true;
    return false;
  };

  const getStatusColor = () => {
    if (supabaseStatus === "ONLINE") return "text-acid border-acid";
    if (supabaseStatus === "SYNCING") return "text-gray-500 border-white/10";
    return "text-danger border-danger";
  };

  const isAuthPage = pathname === "/login";
  const isHomePage = pathname === "/";

  if (isAuthPage) {
    return null;
  }

  if (isHomePage) {
    return (
      <>
        {/* Floating Trigger */}
        <div className="fixed top-8 left-8 z-[100] flex items-center gap-4">
          <button
            onClick={() => setIsMenuOpen(true)}
            className="group flex items-center gap-2 md:gap-3 bg-black/40 backdrop-blur-md border border-white/10 hover:border-acid px-2.5 py-1 md:px-4 md:py-2 transition-all duration-300 cursor-none"
          >
            <div className="flex flex-col gap-[3px] w-3 md:w-4">
              <div className="h-[1px] w-full bg-white group-hover:bg-acid transition-colors"></div>
              <div className="h-[1px] w-2/3 bg-white group-hover:bg-acid transition-colors"></div>
              <div className="h-[1px] w-full bg-white group-hover:bg-acid transition-colors"></div>
            </div>
            <span className="font-space text-[8px] md:text-[10px] tracking-[0.25em] md:tracking-[0.3em] text-white/70 group-hover:text-acid font-bold">INDEX</span>
          </button>
        </div>

        {/* Full Screen Menu Overlay */}
        {isMenuOpen && (
          <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-xl flex flex-col p-8 md:p-12 select-none overflow-y-auto scroll-custom">
            {/* Close Button */}
            <button
              onClick={() => setIsMenuOpen(false)}
              className="absolute top-10 right-10 z-[210] group flex items-center gap-2 font-space text-[12px] tracking-widest text-white/50 hover:text-acid transition-all cursor-none"
            >
              <span className="hidden md:inline">[ CLOSE ]</span>
              <div className="w-8 h-8 flex items-center justify-center border border-white/10 group-hover:border-acid rounded-full transition-all bg-black/50">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </button>

            {/* Content Wrapper for Centering */}
            <div className="flex-1 flex flex-col items-center justify-center min-h-[600px] py-20">
              {/* Corner Decorators (Internal) */}
              <div className="corner-l corner-top-left border-acid/30" />
              <div className="corner-l corner-top-right border-acid/30" />
              <div className="corner-l corner-bottom-left border-acid/30" />
              <div className="corner-l corner-bottom-right border-acid/30" />

              {/* Nav Links */}
              <div className="flex flex-col gap-4 md:gap-8 text-center">
                {[
                  { label: "SHOWCASE", path: "/" },
                  { label: "VISUALS", path: "/visuals" },
                  { label: "SYSTEMS", path: "/systems" },
                  { label: "COMMUNITY", path: "/community" },
                  { label: "WORKFLOWS", path: "/workflows" },
                  { label: "MOODBOARD", path: "/moodboard" },
                ].map((link) => (
                  <Link
                    key={link.path}
                    href={link.path}
                    onClick={() => setIsMenuOpen(false)}
                    className="group relative overflow-hidden h-16 md:h-24 flex items-center justify-center"
                  >
                    <div className="font-bebas text-5xl md:text-8xl text-white/10 group-hover:text-acid/20 transition-all duration-300 tracking-tighter uppercase whitespace-nowrap">
                      {link.label}
                    </div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                       <div className="font-bebas text-4xl md:text-7xl text-acid glitch-trigger uppercase whitespace-nowrap" data-text={link.label}>
                         {link.label}
                       </div>
                    </div>
                  </Link>
                ))}
              </div>

              {/* User Controls - Now part of flex flow */}
              <div className="flex flex-col items-center gap-6 mt-8">
                 <div className="flex flex-col md:flex-row items-center gap-4 md:gap-8">
                   {user && (
                      <button
                        onClick={handleSignOut}
                        className="font-space text-[10px] tracking-widest text-white/40 hover:text-danger hover:border-danger border border-white/10 px-6 py-2 transition-all cursor-none"
                      >
                        TERMINATE_SESSION
                      </button>
                   )}
                   <div className={`font-space text-[10px] tracking-widest border px-6 py-2 rounded-full uppercase whitespace-nowrap ${getStatusColor()}`}>
                     VERTIX OS
                   </div>
                 </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <nav className="sticky top-0 z-50 bg-dark/95 backdrop-blur-md border-b border-white/10 h-[72px] flex items-center px-4 md:px-6 relative">
        {/* Left Side: Logo */}
        <div className="flex items-center gap-4 md:gap-8">
          <Link
            href="/"
            className="font-anton text-xl md:text-2xl tracking-tight leading-none cursor-pointer hover:text-acid transition-colors select-none uppercase"
          >
            The
            <br />
            Archive
          </Link>
          {!isAuthPage && (
            <>
              <div className="hidden md:block w-px h-8 bg-white/20"></div>
              <div className="hidden md:flex gap-6 font-oswald text-sm tracking-widest text-white uppercase h-full items-center">
                <Link
                  href="/visuals"
                  className={`py-6 border-b-2 transition-all duration-300 hover:text-acid ${isTabActive("/visuals") ? "text-acid border-acid" : "border-transparent"}`}
                >
                  VISUALS
                </Link>
                <Link
                  href="/systems"
                  className={`py-6 border-b-2 transition-all duration-300 hover:text-acid ${isTabActive("/systems") ? "text-acid border-acid" : "border-transparent"}`}
                >
                  SYSTEMS
                </Link>
                <Link
                  href="/community"
                  className={`py-6 border-b-2 transition-all duration-300 hover:text-acid ${isTabActive("/community") ? "text-acid border-acid" : "border-transparent"}`}
                >
                  COMMUNITY
                </Link>
                <Link
                  href="/workflows"
                  className={`py-6 border-b-2 transition-all duration-300 hover:text-acid ${isTabActive("/workflows") ? "text-acid border-acid" : "border-transparent"}`}
                >
                  WORKFLOWS
                </Link>
                <Link
                  href="/moodboard"
                  className={`py-6 border-b-2 transition-all duration-300 hover:text-acid ${isTabActive("/moodboard") ? "text-acid border-acid" : "border-transparent"}`}
                >
                  MOODBOARD
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Center: Mobile Menu Button (INDEX) */}
        {!isAuthPage && (
          <button
            onClick={() => setIsMenuOpen(true)}
            className="md:hidden absolute left-1/2 -translate-x-1/2 group flex items-center gap-2 bg-white/5 border border-white/10 hover:border-acid px-3 py-1.5 transition-all duration-300 z-50"
          >
            <div className="flex flex-col gap-1 w-4">
              <div className="h-[1px] w-full bg-white group-hover:bg-acid"></div>
              <div className="h-[1px] w-2/3 bg-white group-hover:bg-acid"></div>
            </div>
            <span className="font-space text-[9px] tracking-widest text-white/70 group-hover:text-acid font-bold">INDEX</span>
          </button>
        )}

        {/* Right Side: Favorites and Status */}
        <div className="flex items-center gap-3 md:gap-10 ml-auto items-center">
          {!isAuthPage && (
            <Link
              href="/favorites"
              className={`transition-all duration-300 hover:text-acid py-1 border-b-2 flex items-center justify-center ${isTabActive("/favorites") ? "text-acid border-acid" : "text-white/60 border-transparent"}`}
              title="LIKES"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path>
              </svg>
            </Link>
          )}

          <div className="hidden md:flex items-center gap-4">
            <div
              id="sync-indicator"
              className={`font-mono text-[10px] border px-3 py-1 rounded-full uppercase tracking-tighter ${getStatusColor()}`}
            >
              VERTIX OS
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

      {/* Mobile Overlay Menu - Reusing the same logic as Homepage but simplified for secondary nav */}
      {isMenuOpen && !isHomePage && (
        <div className="fixed inset-0 z-[200] bg-black/98 backdrop-blur-2xl flex flex-col p-8 md:p-12 select-none overflow-y-auto scroll-custom">
          {/* Close Button */}
          <button
            onClick={() => setIsMenuOpen(false)}
            className="absolute top-10 right-10 z-[210] group flex items-center gap-2 font-space text-[12px] tracking-widest text-white/50 hover:text-acid transition-all"
          >
            <span>[ CLOSE ]</span>
            <div className="w-8 h-8 flex items-center justify-center border border-white/10 group-hover:border-acid rounded-full transition-all bg-black/50">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </button>

          <div className="flex-1 flex flex-col items-center justify-center py-20">
              <div className="corner-l corner-top-left border-acid/30" />
              <div className="corner-l corner-top-right border-acid/30" />
              <div className="corner-l corner-bottom-left border-acid/30" />
              <div className="corner-l corner-bottom-right border-acid/30" />

             <div className="flex flex-col gap-6 text-center">
              {[
                { label: "SHOWCASE", path: "/" },
                { label: "VISUALS", path: "/visuals" },
                { label: "SYSTEMS", path: "/systems" },
                { label: "COMMUNITY", path: "/community" },
                { label: "WORKFLOWS", path: "/workflows" },
                { label: "MOODBOARD", path: "/moodboard" },
              ].map((link) => (
                <Link
                  key={link.path}
                  href={link.path}
                  onClick={() => setIsMenuOpen(false)}
                  className="font-bebas text-5xl text-white/30 hover:text-acid transition-all duration-300 tracking-tighter uppercase"
                >
                  {link.label}
                </Link>
              ))}
            </div>

            <div className="flex flex-col items-center gap-6 mt-12">
               <div className="flex flex-col items-center gap-4">
                 {user && (
                    <button
                      onClick={handleSignOut}
                      className="font-space text-[10px] tracking-widest text-white/40 hover:text-danger hover:border-danger border border-white/10 px-6 py-2 transition-all"
                    >
                      TERMINATE_SESSION
                    </button>
                 )}
                 <div className={`font-space text-[10px] tracking-widest border px-6 py-2 rounded-full uppercase whitespace-nowrap ${getStatusColor()}`}>
                   VERTIX OS
                 </div>
               </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
