"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import { useAuth } from "@/components/AuthContext";

interface NavigationProps {
  status?: "ONLINE" | "OFFLINE" | "ERROR" | "SYNCING";
}

export default function Navigation({ status = "ONLINE" }: NavigationProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

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
    if (status === "ONLINE") return "text-acid border-acid";
    if (status === "OFFLINE") return "text-gray-500 border-white/10";
    return "text-danger border-danger";
  };

  const isAuthPage = pathname === "/login";

  return (
    <nav className="sticky top-0 z-50 bg-dark/95 backdrop-blur-md border-b border-white/10 h-[72px] flex justify-between items-center px-6">
      <div className="flex items-center gap-8">
        <Link
          href="/"
          className="font-anton text-2xl tracking-tight leading-none cursor-pointer hover:text-acid transition-colors select-none uppercase"
        >
          The
          <br />
          Archive
        </Link>
        {!isAuthPage && (
          <>
            <div className="hidden md:block w-px h-8 bg-white/20"></div>
            <div className="flex gap-6 font-oswald text-sm tracking-widest text-white uppercase h-full items-center">
              <Link
                href="/"
                className={`py-6 border-b-2 transition-all duration-300 hover:text-acid ${isTabActive("/") ? "text-acid border-acid" : "border-transparent"}`}
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
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-10">
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
        <div className="flex items-center gap-4">
          <div
            id="sync-indicator"
            className={`font-mono text-[10px] border px-3 py-1 rounded-full uppercase tracking-tighter ${getStatusColor()}`}
          >
            Status: {status === "ONLINE" ? "V1 ONLINE" : status}
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
