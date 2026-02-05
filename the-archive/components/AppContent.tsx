'use client';

import Loader from "@/components/Loader";
import Navigation from "@/components/Navigation";
import { useSync } from "@/components/SyncContext";

export default function AppContent({ children }: { children: React.ReactNode }) {
  const { status } = useSync();
  return (
    <>
      <Loader />
      <Navigation status={status} />
      {children}
    </>
  );
}
