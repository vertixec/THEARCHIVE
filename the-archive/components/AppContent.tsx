'use client';

import Loader from "@/components/Loader";
import Navigation from "@/components/Navigation";

export default function AppContent({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Loader />
      <Navigation />
      {children}
    </>
  );
}
