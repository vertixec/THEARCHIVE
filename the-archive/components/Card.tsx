'use client';

import { useState } from 'react';
import { useToast } from './Toast';

interface AssetCardProps {
  item: any;
  cardTitle: string;
  secondaryLabel: string;
  bottomLabel: string;
}

export default function Card({ item, cardTitle, secondaryLabel, bottomLabel }: AssetCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const { showToast } = useToast();

  const promptContent = (item.prompt_text || "IMAGE DATA").toString();
  const date = item.created_at ? new Date(item.created_at).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit' }) : "--/--";
  const displayImg = item.image_url || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=500";

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(promptContent);
    showToast("PROMPT COPIED");
  };

  return (
    <div 
      className={`card-container perspective-1000 aspect-[3/4] cursor-pointer group ${isFlipped ? 'flipped' : ''}`}
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <div className="card-flip-inner preserve-3d relative h-full w-full">
        {/* Front */}
        <div className="absolute inset-0 backface-hidden bg-black border border-white/5 overflow-hidden">
          <div className="scanline"></div>
          <img 
            src={displayImg} 
            alt={cardTitle}
            className="w-full h-full object-cover filter grayscale contrast-125 brightness-75 group-hover:grayscale-0 group-hover:brightness-100 group-hover:scale-105 transition-all duration-700 ease-out"
          />
          <div className="absolute top-3 left-3">
            <span className={`${secondaryLabel === 'FEATURED' ? 'bg-acid text-black' : 'bg-black/80 text-white'} backdrop-blur-md text-[8px] font-mono px-2 py-0.5 border border-white/10 tracking-widest uppercase`}>
              {secondaryLabel}
            </span>
          </div>
          <div className="absolute bottom-4 left-4 right-4">
            <div className="font-anton text-xl text-white uppercase tracking-tighter leading-none">{cardTitle}</div>
            <div className="w-0 group-hover:w-full h-0.5 bg-acid transition-all duration-500 mt-2"></div>
          </div>
        </div>

        {/* Back */}
        <div className="absolute inset-0 backface-hidden rotate-y-180 bg-panel border border-acid/30 p-5 flex flex-col justify-between overflow-hidden">
          <div className="h-full flex flex-col">
            <div className="flex justify-between items-start font-mono text-[9px] text-gray-500 border-b border-white/10 pb-3 mb-4 uppercase tracking-tighter">
              <div>
                <div className="text-acid mb-1">MODEL: {item.model || 'UNK'}</div>
                <div>REF: {item.id}</div>
              </div>
              <div className="text-right">
                <div>DATE: {date}</div>
              </div>
            </div>
            
            <div className="flex-grow overflow-y-auto pr-2 scroll-custom">
              <div className="flex items-center gap-2 mb-2">
                <div className="font-mono text-[10px] text-acid/80 uppercase tracking-widest border-l-2 border-acid pl-2">PROMPT:</div>
                <button 
                  onClick={handleCopy}
                  className="text-acid/50 hover:text-acid transition-colors p-1" 
                  title="Copy Prompt"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
              </div>
              <p className="font-mono text-[11px] text-white leading-relaxed uppercase opacity-90">{promptContent}</p>
            </div>

            <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 gap-2">
              <div className="bg-black/40 p-2 border border-white/5">
                <div className="font-mono text-[7px] text-gray-500 uppercase">{bottomLabel}</div>
                <div className="font-oswald text-[10px] text-white uppercase">{cardTitle}</div>
              </div>
              <div className="bg-black/40 p-2 border border-white/5">
                <div className="font-mono text-[7px] text-gray-500 uppercase">STATUS</div>
                <div className="font-oswald text-[10px] text-white uppercase">{secondaryLabel}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
