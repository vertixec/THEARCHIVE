'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthContext';
import { useGenerate } from '@/components/GenerateContext';

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10.5V20h13v-9.5" />
      <path d="M9.5 20v-5h5v5" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m7 17 4-4 3 3 2-2 3 3" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="12" height="12" rx="2" />
      <path d="m16 10 4-2.5v9L16 14" />
      <path d="M8 3v3" />
      <path d="M12 3v3" />
    </svg>
  );
}

function ToolsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.6 5.1a3 3 0 0 0 1.9 1.9L20.6 12l-5.1 1.6a3 3 0 0 0-1.9 1.9L12 20.6l-1.6-5.1a3 3 0 0 0-1.9-1.9L3.4 12l5.1-1.6a3 3 0 0 0 1.9-1.9z" />
      <path d="M19 4.5v2.4" />
      <path d="M20.2 5.7h-2.4" />
      <path d="M5 17.5v1.8" />
      <path d="M5.9 18.4H4.1" />
    </svg>
  );
}

function DockButton({
  active,
  title,
  hovered,
  children,
  onClick,
  onHover,
}: {
  active?: boolean;
  title: string;
  hovered?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  onHover: (title: string | null) => void;
}) {
  return (
    <div className="relative flex h-16 w-16 items-center justify-center">
      {hovered && <DockTooltip label={title} />}
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => onHover(title)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(title)}
        onBlur={() => onHover(null)}
        aria-label={title}
        className={`h-12 w-12 flex items-center justify-center rounded-2xl transition-all duration-200 ease-out will-change-transform ${
          active
            ? 'bg-acid text-black shadow-[0_0_22px_rgba(200,255,0,0.35)]'
            : 'bg-white/[0.04] text-white/70 hover:bg-acid hover:text-black'
        } ${hovered ? '-translate-y-3 scale-[1.28]' : 'scale-100'}`}
      >
        {children}
      </button>
    </div>
  );
}

function DockLink({
  href,
  active,
  title,
  hovered,
  hasNotification,
  children,
  onHover,
}: {
  href: string;
  active?: boolean;
  title: string;
  hovered?: boolean;
  hasNotification?: boolean;
  children: React.ReactNode;
  onHover: (title: string | null) => void;
}) {
  return (
    <div className="relative flex h-16 w-16 items-center justify-center">
      {hovered && <DockTooltip label={title} />}
      <Link
        href={href}
        onMouseEnter={() => onHover(title)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(title)}
        onBlur={() => onHover(null)}
        aria-label={title}
        className={`h-12 w-12 flex items-center justify-center rounded-2xl transition-all duration-200 ease-out will-change-transform ${
          active
            ? 'bg-acid text-black shadow-[0_0_22px_rgba(200,255,0,0.35)]'
            : 'bg-white/[0.04] text-white/70 hover:bg-acid hover:text-black'
        } ${hovered ? '-translate-y-3 scale-[1.28]' : 'scale-100'}`}
      >
        {children}
        {hasNotification && !active && (
          <span className="absolute right-1.5 top-1.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-acid opacity-70" />
            <span className="relative inline-flex h-3 w-3 rounded-full border border-black bg-acid shadow-[0_0_14px_rgba(200,255,0,0.8)]" />
          </span>
        )}
      </Link>
    </div>
  );
}

function DockTooltip({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute -top-11 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-white shadow-2xl">
      {label}
      <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-black" />
    </div>
  );
}

export default function BottomDock() {
  const pathname = usePathname();
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const { user } = useAuth();
  const { closePanel, openPanel, setGenerationType, generationType, isOpen, panelMode, setPanelMode } = useGenerate();

  const hiddenRoutes = pathname === '/' || pathname === '/login' || pathname === '/inactive-membership' || pathname.startsWith('/auth');

  useEffect(() => {
    if (pathname === '/') closePanel();
  }, [closePanel, pathname]);

  if (!user || hiddenRoutes) return null;

  const openGenerator = (type: 'image' | 'video') => {
    if (isOpen && panelMode === 'generate' && generationType === type) {
      closePanel();
      return;
    }
    setPanelMode('generate');
    setGenerationType(type);
    openPanel();
  };

  const openTools = () => {
    if (isOpen && panelMode === 'tools') {
      closePanel();
      return;
    }
    setPanelMode('tools');
    openPanel();
  };

  return (
    <nav
      className={`fixed bottom-7 z-[70] -translate-x-1/2 transition-[left] duration-300 ease-out ${
        isOpen ? 'left-1/2 md:left-[calc(50%-240px)]' : 'left-1/2'
      }`}
      aria-label="Quick actions"
    >
      <div className="flex origin-bottom items-center gap-2 rounded-[30px] border border-white/10 bg-black/[0.18] px-4 py-2 text-white shadow-[0_18px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.10)] backdrop-blur-2xl transition-all duration-300 ease-out will-change-transform hover:scale-[1.035] hover:gap-3 hover:border-white/20 hover:bg-black/[0.28] hover:px-5 hover:py-2.5 hover:shadow-[0_22px_80px_rgba(0,0,0,0.65),0_0_28px_rgba(200,255,0,0.10),inset_0_1px_0_rgba(255,255,255,0.16)]">
        <DockLink href="/" title="Home" active={pathname === '/'} hovered={hoveredAction === 'Home'} onHover={setHoveredAction}>
          <HomeIcon />
        </DockLink>
        <DockButton title="Generate Image" active={isOpen && panelMode === 'generate' && generationType === 'image'} hovered={hoveredAction === 'Generate Image'} onHover={setHoveredAction} onClick={() => openGenerator('image')}>
          <ImageIcon />
        </DockButton>
        <DockButton title="Generate Video" active={isOpen && panelMode === 'generate' && generationType === 'video'} hovered={hoveredAction === 'Generate Video'} onHover={setHoveredAction} onClick={() => openGenerator('video')}>
          <VideoIcon />
        </DockButton>
        <DockButton title="Tools" active={isOpen && panelMode === 'tools'} hovered={hoveredAction === 'Tools'} onHover={setHoveredAction} onClick={openTools}>
          <ToolsIcon />
        </DockButton>
      </div>
    </nav>
  );
}
