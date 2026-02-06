import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthContext';

interface AssetCardProps {
  item: any;
  cardTitle: string;
  secondaryLabel: string;
  bottomLabel: string;
  itemType: 'visual' | 'system' | 'community' | 'workflow';
  initialIsLiked?: boolean;
  onToggle?: (itemId: string, itemType: string, newIsLiked: boolean) => void;
}

export default function Card({ item, cardTitle, secondaryLabel, bottomLabel, itemType, initialIsLiked = false, onToggle }: AssetCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const { showToast } = useToast();
  const [isLiked, setIsLiked] = useState(initialIsLiked);
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    setIsLiked(initialIsLiked);
  }, [initialIsLiked]);

  const toggleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (isProcessing) return;

    if (!user) {
      showToast('LOGIN REQUIRED');
      return;
    }

    setIsProcessing(true);
    const previousLikedState = isLiked;
    
    // Optimistic Update
    setIsLiked(!previousLikedState);
    showToast(!previousLikedState ? 'ADDED TO LIKES' : 'REMOVED FROM LIKES');
    if (onToggle) onToggle(item.id, itemType, !previousLikedState);

    try {
      if (previousLikedState) {
        const { error } = await supabase
          .from('user_likes')
          .delete()
          .eq('user_id', user.id)
          .eq('item_id', item.id)
          .eq('item_type', itemType);
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_likes')
          .insert({
            user_id: user.id,
            item_id: item.id,
            item_type: itemType
          });
        
        if (error) throw error;
      }
    } catch (error: any) {
      console.error('Like toggle error:', error);
      setIsLiked(previousLikedState);
      if (onToggle) onToggle(item.id, itemType, previousLikedState);
      showToast('SYNC ERROR');
    } finally {
      setIsProcessing(false);
    }
  };

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
      onClick={() => {
        console.log('Card container clicked - Flipped status:', !isFlipped);
        setIsFlipped(!isFlipped);
      }}
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
          <div className="absolute top-3 left-3 z-20">
            <span className={`${secondaryLabel === 'FEATURED' ? 'bg-acid text-black' : 'bg-black/80 text-white'} backdrop-blur-md text-[8px] font-mono px-2 py-0.5 border border-white/10 tracking-widest uppercase`}>
              {secondaryLabel}
            </span>
          </div>
          
          <div className="absolute top-3 right-3 flex gap-2 z-[40]">
            <button 
              type="button"
              onClick={(e) => {
                toggleLike(e);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className={`p-2 transition-all duration-200 hover:scale-125 active:scale-95 pointer-events-auto rounded-full bg-black/50 backdrop-blur-md border border-white/20 shadow-xl ${isLiked ? 'text-acid border-acid/50' : 'text-white/60 hover:text-acid'}`}
              title={isLiked ? "Unlike" : "Like"}
              aria-label="Toggle Like"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill={isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path>
              </svg>
            </button>
          </div>

          <div className="absolute bottom-4 left-4 right-4 z-20">
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
              {itemType === 'workflow' ? (
                <div className="h-full flex flex-col justify-center items-center text-center">
                  <div className="font-mono text-[10px] text-acid/80 uppercase tracking-widest mb-4 border-b border-acid pb-1">WORKFLOW ACCESS</div>
                  <h3 className="font-anton text-2xl text-white uppercase mb-6 tracking-tight">{item.name}</h3>
                  <a 
                    href={item.link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="bg-acid text-black font-oswald text-xs px-6 py-2 rounded hover:brightness-110 transition-all flex items-center gap-2 uppercase tracking-widest font-bold"
                  >
                    Go To Workflow
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </a>
                </div>
              ) : (
                <>
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
                </>
              )}
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
