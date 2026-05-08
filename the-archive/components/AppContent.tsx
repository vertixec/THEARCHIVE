'use client';

import Loader from "@/components/Loader";
import BottomDock from "@/components/BottomDock";
import Navigation from "@/components/Navigation";
import { useGenerate } from "@/components/GenerateContext";

export default function AppContent({ children }: { children: React.ReactNode }) {
  const { isOpen } = useGenerate();

  return (
    <>
      <Loader />
      <div
        className={`transition-[padding] duration-300 ease-out ${
          isOpen ? 'md:pr-[480px]' : 'md:pr-0'
        }`}
      >
        <Navigation />
        {children}
      </div>
      <BottomDock />
    </>
  );
}
