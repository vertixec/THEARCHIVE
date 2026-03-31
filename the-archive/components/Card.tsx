import { useState, useEffect, useRef } from "react";
import { useToast } from "./Toast";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "./AuthContext";
import type { AnyItem, ItemType } from "@/lib/types";

interface AssetCardProps {
  item: AnyItem;
  cardTitle: string;
  secondaryLabel: string;
  secondaryLabelName?: string;
  bottomLabel: string;
  itemType: ItemType;
  initialIsLiked?: boolean;
  onToggle?: (itemId: string, itemType: string, newIsLiked: boolean) => void;
  isFlipped?: boolean;
  onFlip?: () => void;
  highlighted?: boolean;
  onInteraction?: () => void;
}

export default function Card({
  item,
  cardTitle,
  secondaryLabel,
  secondaryLabelName = 'STATUS',
  bottomLabel,
  itemType,
  initialIsLiked = false,
  onToggle,
  isFlipped = false,
  onFlip,
  highlighted = false,
  onInteraction,
}: AssetCardProps) {
  const { showToast } = useToast();
  const [isLiked, setIsLiked] = useState(initialIsLiked);
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showMoodboardMenu, setShowMoodboardMenu] = useState(false);
  const [showBoardsList, setShowBoardsList] = useState(false);
  const [moodboards, setMoodboards] = useState<{ id: string; name: string }[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const hasFetchedBoards = useRef(false);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);

  useEffect(() => {
    setIsLiked(initialIsLiked);
  }, [initialIsLiked]);

  const toggleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isProcessing) return;

    if (!user) {
      showToast("LOGIN REQUIRED");
      return;
    }

    setIsProcessing(true);
    const previousLikedState = isLiked;

    // Optimistic Update
    setIsLiked(!previousLikedState);
    showToast(!previousLikedState ? "ADDED TO LIKES" : "REMOVED FROM LIKES");
    if (onToggle) onToggle(item.id, itemType, !previousLikedState);

    try {
      if (previousLikedState) {
        const { error } = await supabase
          .from("user_likes")
          .delete()
          .eq("user_id", user.id)
          .eq("item_id", item.id)
          .eq("item_type", itemType);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("user_likes").insert({
          user_id: user.id,
          item_id: item.id,
          item_type: itemType,
        });

        if (error) throw error;
      }
    } catch (error: any) {
      console.error("Like toggle error:", error);
      setIsLiked(previousLikedState);
      if (onToggle) onToggle(item.id, itemType, previousLikedState);
      showToast("SYNC ERROR");
    } finally {
      setIsProcessing(false);
    }
  };

  const promptContent = (item.prompt_text || "IMAGE DATA").toString();
  const date = item.created_at
    ? new Date(item.created_at).toLocaleDateString("en-US", {
        day: "2-digit",
        month: "2-digit",
      })
    : "--/--";
  const displayImg =
    item.image_url ||
    "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=500";
  const instructions = item.instructions || "";

  const fetchBoards = async () => {
    if (!user || hasFetchedBoards.current) return;
    setLoadingBoards(true);
    const { data } = await supabase
      .from('boards')
      .select('id, name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setMoodboards(data || []);
    hasFetchedBoards.current = true;
    setLoadingBoards(false);
  };

  const handleAddToBoard = async (boardId: string, boardName: string) => {
    if (!user) return;
    const { error } = await supabase.from('board_items').upsert(
      { board_id: boardId, item_id: item.id, item_type: 'visual', image_url: item.image_url || null },
      { onConflict: 'board_id,item_id,item_type' }
    );
    showToast(error ? 'SYNC ERROR' : `ADDED TO ${boardName}`);
    setShowMoodboardMenu(false);
    setShowCreateInput(false);
    setNewBoardName('');
  };

  const handleCreateAndAdd = async () => {
    if (!newBoardName.trim() || !user || isCreatingBoard) return;
    setIsCreatingBoard(true);
    try {
      const { data, error } = await supabase
        .from('boards')
        .insert({ user_id: user.id, name: newBoardName.trim().toUpperCase() })
        .select('id, name')
        .single();
      if (!error && data) {
        // Reset cache so the new board appears next time the list is opened
        hasFetchedBoards.current = false;
        setMoodboards([]);
        await handleAddToBoard(data.id, data.name);
      } else {
        showToast('SYNC ERROR');
        setShowMoodboardMenu(false);
      }
    } finally {
      setNewBoardName('');
      setShowCreateInput(false);
      setIsCreatingBoard(false);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(promptContent);
    showToast("PROMPT COPIED");
  };

  const handleCopyColors = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { getPalette } = await import("colorthief");
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
        const sep = displayImg.includes("?") ? "&" : "?";
        img.src = displayImg + sep + "_cors=1";
      });
      const palette = await getPalette(img, { colorCount: 6 });
      if (!palette) throw new Error("no palette");
      const hexColors = palette.map((c) => c.hex().toUpperCase());
      navigator.clipboard.writeText(hexColors.join(", "));
      showToast("COLORS COPIED");
    } catch {
      showToast("COLOR EXTRACT FAILED");
    }
  };

  return (
    <div
      id={`card-${item.id}`}
      className={`card-container perspective-1000 aspect-[3/4] cursor-pointer group ${isFlipped && itemType !== "community" ? "flipped" : ""}`}
      onClick={() => {
        if (itemType === "community") return;
        if (onInteraction) onInteraction();
        if (onFlip) onFlip();
      }}
    >
      <div className="card-flip-inner preserve-3d relative h-full w-full">
        {/* Front */}
        <div className="absolute inset-0 backface-hidden bg-black border border-white/5 overflow-hidden">
          <div className="scanline"></div>
          <img
            src={displayImg}
            alt={cardTitle}
            className={`w-full h-full object-cover filter transition-all duration-700 ease-out ${highlighted ? 'grayscale-0 brightness-110 contrast-100 scale-105' : 'grayscale-0 brightness-100 md:grayscale md:contrast-125 md:brightness-75 group-hover:grayscale-0 group-hover:brightness-100 group-hover:scale-105'}`}
          />
          {highlighted && (
            <div className="absolute inset-0 z-[60] border-2 border-acid shadow-[inset_0_0_15px_#c8ff00,0_0_20px_#c8ff00] pointer-events-none animate-pulse" />
          )}
          <div className="absolute top-3 left-3 z-20">
            <span
              className={`${secondaryLabel === "FEATURED" ? "bg-acid text-black" : "bg-black/80 text-white"} backdrop-blur-md text-[8px] font-mono px-2 py-0.5 border border-white/10 tracking-widest uppercase`}
            >
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
              className={`p-2 transition-all duration-200 hover:scale-125 active:scale-95 pointer-events-auto rounded-full bg-black/50 backdrop-blur-md border border-white/20 shadow-xl ${isLiked ? "text-acid border-acid/50" : "text-white/60 hover:text-acid"}`}
              title={isLiked ? "Unlike" : "Like"}
              aria-label="Toggle Like"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill={isLiked ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none"
              >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path>
              </svg>
            </button>
          </div>

          <div className="absolute bottom-3 md:bottom-4 left-3 md:left-4 right-3 md:right-4 z-20">
            <div className="font-anton text-lg md:text-xl text-white uppercase tracking-tighter leading-none">
              {cardTitle}
            </div>
            <div className="w-0 group-hover:w-full h-0.5 bg-acid transition-all duration-500 mt-2"></div>
          </div>
        </div>

        {/* Back */}
        <div className="absolute inset-0 backface-hidden rotate-y-180 bg-panel border border-acid/30 p-4 md:p-5 flex flex-col justify-between overflow-hidden">
          <div className="h-full flex flex-col">
            <div className="flex justify-between items-start font-mono text-[8px] md:text-[9px] text-gray-500 border-b border-white/10 pb-2 md:pb-3 mb-3 md:mb-4 uppercase tracking-tighter relative">
              <div className="flex flex-col">
                {itemType !== "workflow" ? (
                  <>
                    <div className="text-acid mb-0.5 md:mb-1">
                      MODEL: {item.model || "UNK"}
                    </div>
                    <div>REF: {item.id}</div>
                  </>
                ) : (
                  item.tools && (
                    <div className="text-acid mb-0.5 md:mb-1">
                      TOOLS: {item.tools}
                    </div>
                  )
                )}
              </div>
              <div className="text-right flex flex-col items-end">
                <div>DATE: {date}</div>
              </div>
            </div>

            <div className="flex-grow overflow-y-auto pr-1 md:pr-2 scroll-custom">
              {itemType === "workflow" ? (
                <div className="h-full flex flex-col justify-center items-center text-center px-1">
                  <div className="font-mono text-[8px] md:text-[10px] text-acid/80 uppercase tracking-widest mb-2 md:mb-4 border-b border-acid pb-1">
                    WORKFLOW ACCESS
                  </div>
                  <h3 className="font-anton text-lg md:text-2xl text-white uppercase mb-2 tracking-tight">
                    {item.name}
                  </h3>
                  <div className="font-mono text-[8px] md:text-[10px] text-white/70 uppercase mb-4 md:mb-6 max-w-[180px] md:max-w-[200px] leading-tight md:leading-relaxed italic border-l border-acid/30 pl-2 md:pl-3 text-left">
                    {item.use_cases || "NO CASE DEFINED"}
                  </div>
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="bg-acid text-black font-oswald text-[10px] md:text-xs px-4 md:px-6 py-1.5 md:py-2 rounded hover:brightness-110 transition-all flex items-center gap-2 uppercase tracking-widest font-bold"
                  >
                    Go To Workflow
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </a>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-[9px] md:text-[10px] text-acid/80 uppercase tracking-widest border-l-2 border-acid pl-2">
                        PROMPT:
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleCopy}
                          className="text-acid/50 hover:text-acid transition-colors p-1"
                          title="Copy Prompt"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                        </button>

                        {itemType === "visual" && (
                          <button
                            onClick={handleCopyColors}
                            className="text-acid/50 hover:text-acid transition-colors p-1"
                            title="Copy Color Palette"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <circle cx="13.5" cy="6.5" r="2.5"></circle>
                              <circle cx="19" cy="12" r="2.5"></circle>
                              <circle cx="13.5" cy="17.5" r="2.5"></circle>
                              <circle cx="5" cy="12" r="2.5"></circle>
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2v-.5c0-.55-.22-1.05-.59-1.41a.996.996 0 0 1 0-1.18C13.78 16.55 14 16.05 14 15.5V15c0-1.1.9-2 2-2h1.5c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z"></path>
                            </svg>
                          </button>
                        )}

                        {itemType === "system" && instructions && (
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent card from flipping or unflipping
                              setShowTooltip(!showTooltip);
                            }}
                            className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all duration-200 ${showTooltip ? "bg-acid text-black border-acid" : "border-acid/30 text-acid/50 hover:text-acid hover:border-acid"}`}
                            title="Show Instructions"
                          >
                            <span className="font-serif italic text-[10px] pb-0.5">
                              {showTooltip ? "×" : "i"}
                            </span>
                          </button>
                        </div>
                      )}
                      </div>
                    </div>
                    {itemType === "visual" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMoodboardMenu(m => !m);
                          setShowBoardsList(false);
                          setShowCreateInput(false);
                          setNewBoardName('');
                        }}
                        className={`transition-colors p-1 shrink-0 ${showMoodboardMenu ? 'text-acid' : 'text-acid/50 hover:text-acid'}`}
                        title="Add to MoodBoard"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <line x1="3" y1="6" x2="21" y2="6" />
                          <line x1="3" y1="12" x2="21" y2="12" />
                          <line x1="3" y1="18" x2="21" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <p className="font-mono text-[10px] md:text-[11px] text-white leading-tight md:leading-relaxed uppercase opacity-90">
                    {promptContent}
                  </p>
                </>
              )}
            </div>

            {/* Tooltip Overlay - Click to toggle */}
            {showTooltip && instructions && (
              <div
                className="absolute top-20 left-5 right-5 bg-black/98 border border-acid/60 p-4 z-[100] shadow-[0_0_30px_rgba(0,0,0,0.8)] backdrop-blur-2xl transition-all duration-300 animate-in fade-in zoom-in-95 cursor-default"
                onClick={(e) => e.stopPropagation()} // Prevent card flip when clicking inside tooltip
              >
                <div className="text-acid font-mono text-[8px] mb-3 border-b border-acid/20 pb-1 tracking-widest uppercase flex justify-between items-center">
                  <span>Instructions</span>
                  <button
                    onClick={() => setShowTooltip(false)}
                    className="hover:text-white transition-colors uppercase text-[7px]"
                  >
                    [ Close ]
                  </button>
                </div>
                <div className="text-white font-mono text-[10px] leading-relaxed uppercase text-left italic">
                  {instructions}
                </div>
                {/* Arrow pointing to the button area */}
                <div className="absolute -top-1 left-[125px] w-2 h-2 bg-black border-t border-l border-acid/60 rotate-45"></div>
              </div>
            )}

            <div className="mt-3 md:mt-4 pt-3 md:pt-4 border-t border-white/10 grid grid-cols-2 gap-2">
              <div className="bg-black/40 p-1.5 md:p-2 border border-white/5">
                <div className="font-mono text-[7px] text-gray-500 uppercase">
                  {bottomLabel}
                </div>
                <div className="font-oswald text-[9px] md:text-[10px] text-white uppercase">
                  {cardTitle}
                </div>
              </div>
              <div className="bg-black/40 p-1.5 md:p-2 border border-white/5">
                <div className="font-mono text-[7px] text-gray-500 uppercase">
                  {secondaryLabelName}
                </div>
                <div className="font-oswald text-[9px] md:text-[10px] text-white uppercase">
                  {secondaryLabel}
                </div>
              </div>
            </div>
          </div>

          {/* MoodBoard dropdown */}
          {itemType === 'visual' && showMoodboardMenu && (
            <>
              {/* Backdrop to close on outside click */}
              <div
                className="absolute inset-0 z-[98]"
                onClick={(e) => { e.stopPropagation(); setShowMoodboardMenu(false); setShowCreateInput(false); setNewBoardName(''); }}
              />
              {/* Dropdown panel */}
              <div
                className="absolute top-[52px] right-4 bg-[#0d0d0d] border border-white/20 w-[172px] z-[100] shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                {!showBoardsList ? (
                  /* Step 1: main menu options */
                  <>
                    <button
                      onClick={() => { fetchBoards(); setShowBoardsList(true); }}
                      className="w-full text-left px-3 py-2.5 font-mono text-[9px] text-white/60 hover:bg-white/5 hover:text-white uppercase tracking-widest flex items-center gap-2 transition-colors border-b border-white/5"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                        <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                      </svg>
                      Add to MoodBoard
                    </button>
                    <button
                      onClick={() => { setShowBoardsList(true); setShowCreateInput(true); }}
                      className="w-full text-left px-3 py-2.5 font-mono text-[9px] text-acid/70 hover:text-acid hover:bg-acid/5 uppercase tracking-widest flex items-center gap-2 transition-colors"
                    >
                      <span className="text-acid font-bold text-sm leading-none">⊕</span>
                      Create MoodBoard
                    </button>
                  </>
                ) : (
                  /* Step 2: boards list */
                  <>
                    <div className="px-3 py-1.5 border-b border-white/10">
                      <span className="font-mono text-[8px] text-acid/60 uppercase tracking-widest">Moodboards</span>
                    </div>

                    <div className="max-h-36 overflow-y-auto scroll-custom">
                      {loadingBoards ? (
                        <div className="px-3 py-2.5 font-mono text-[9px] text-white/30 uppercase tracking-widest">Loading...</div>
                      ) : (
                        moodboards.map(board => (
                          <button
                            key={board.id}
                            onClick={() => handleAddToBoard(board.id, board.name)}
                            className="w-full text-left px-3 py-2 font-mono text-[9px] text-white/60 hover:bg-white/5 hover:text-white uppercase tracking-widest flex items-center gap-2 transition-colors border-b border-white/5 last:border-0"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                              <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                            </svg>
                            <span className="truncate">{board.name}</span>
                          </button>
                        ))
                      )}
                    </div>

                    <div className="border-t border-white/10">
                      {!showCreateInput ? (
                        <button
                          onClick={() => setShowCreateInput(true)}
                          className="w-full text-left px-3 py-2.5 font-mono text-[9px] text-acid/70 hover:text-acid hover:bg-acid/5 uppercase tracking-widest flex items-center gap-2 transition-colors"
                        >
                          <span className="text-acid font-bold text-sm leading-none">⊕</span>
                          Create MoodBoard
                        </button>
                      ) : (
                        <div className="px-3 py-2 flex flex-col gap-1.5">
                          <input
                            autoFocus
                            value={newBoardName}
                            onChange={e => setNewBoardName(e.target.value.toUpperCase())}
                            onKeyDown={e => {
                              e.stopPropagation();
                              if (e.key === 'Enter') handleCreateAndAdd();
                              if (e.key === 'Escape') { setShowCreateInput(false); setNewBoardName(''); }
                            }}
                            onClick={e => e.stopPropagation()}
                            placeholder="BOARD NAME..."
                            maxLength={40}
                            className="bg-black border border-acid/50 focus:border-acid px-2 py-1 font-mono text-[9px] text-acid uppercase tracking-widest outline-none w-full placeholder:text-acid/20"
                          />
                          <div className="flex gap-1">
                            <button
                              onClick={handleCreateAndAdd}
                              disabled={isCreatingBoard || !newBoardName.trim()}
                              className="flex-1 py-1 bg-acid text-black font-mono text-[8px] uppercase tracking-widest disabled:opacity-40 hover:bg-acid/80 transition-colors"
                            >
                              {isCreatingBoard ? '...' : 'Create'}
                            </button>
                            <button
                              onClick={() => { setShowCreateInput(false); setNewBoardName(''); }}
                              className="px-2 py-1 font-mono text-[8px] text-white/40 hover:text-white border border-white/10 hover:border-white/20 transition-colors"
                            >✕</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
