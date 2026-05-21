'use client';

import { useState } from 'react';

export type SortMode = 'newest' | 'popular';
export type ViewMode = 'catalog' | 'infinite';

interface FiltersProps {
  activeTab: 'main' | 'systems' | 'community' | 'workflows';
  currentFilter: string;
  onFilterChange: (filter: string) => void;
  onSearchChange: (query: string) => void;
  sortMode?: SortMode;
  onSortChange?: (sort: SortMode) => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  types: string[];
}

function FilterIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="shrink-0 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function ViewModeIcon({ mode }: { mode: ViewMode }) {
  if (mode === 'infinite') {
    return (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3l7 7M21 3l-7 7M3 21l7-7M21 21l-7-7" />
      </svg>
    );
  }

  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
    </svg>
  );
}

export default function Filters({
  activeTab,
  currentFilter,
  onFilterChange,
  onSearchChange,
  sortMode = 'newest',
  onSortChange,
  viewMode,
  onViewModeChange,
  types,
}: FiltersProps) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);

  let filterAllText = 'ALL RECORDS';
  if (activeTab === 'systems') filterAllText = 'ALL SYSTEMS';
  if (activeTab === 'community') filterAllText = 'ALL COMMUNITY';
  if (activeTab === 'main') filterAllText = 'ALL ASSETS';
  if (activeTab === 'workflows') filterAllText = 'ALL WORKFLOWS';

  const sortOptions: { value: SortMode; label: string }[] = [
    { value: 'newest', label: 'NEWEST' },
    { value: 'popular', label: 'POPULAR' },
  ];
  const viewOptions: { value: ViewMode; label: string }[] = [
    { value: 'catalog', label: 'CATALOG' },
    { value: 'infinite', label: 'INFINITE' },
  ];

  return (
    <section className="sticky top-[72px] z-40 bg-dark/90 backdrop-blur-md border-y border-white/10 px-4 md:px-6 py-4">
      <div className="w-full flex flex-col md:flex-row gap-4 md:gap-6 items-center md:items-center justify-between text-center">
        <div className="flex w-full min-w-0 items-center gap-2 md:flex-1" id="filter-controls">
          <button
            type="button"
            onClick={() => {
              onFilterChange('ALL');
              setTagsOpen(false);
            }}
            className={`shrink-0 border px-4 py-2.5 font-mono text-[9px] md:text-[10px] uppercase tracking-widest transition-all whitespace-nowrap ${
              currentFilter === 'ALL' ? 'border-acid bg-acid text-black' : 'border-white/20 text-white/70 hover:border-acid/60 hover:text-acid'
            }`}
          >
            {filterAllText}
          </button>

          <div className="relative flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => setTagsOpen(open => !open)}
              className={`flex shrink-0 items-center justify-center gap-3 border px-4 py-2.5 font-mono text-[9px] md:text-[10px] uppercase tracking-widest transition-all ${
                tagsOpen ? 'border-acid bg-acid text-black' : 'border-white/20 text-white/70 hover:border-acid/60 hover:text-acid'
              }`}
              aria-expanded={tagsOpen}
            >
              <span>TAG</span>
              <svg className={`h-3 w-3 transition-transform duration-300 ${tagsOpen ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m9 6 6 6-6 6" />
              </svg>
            </button>

            <div
              className={`min-w-0 flex-1 overflow-hidden transition-[max-width,opacity,filter,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                tagsOpen ? 'max-w-full translate-x-0 opacity-100 blur-0' : 'max-w-0 translate-x-1 opacity-0 blur-sm pointer-events-none'
              }`}
            >
              <div className="flex max-w-full origin-left gap-2 overflow-x-auto no-scrollbar pr-2 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]">
                {types.map((type) => (
                  <button
                    key={type}
                    onClick={() => onFilterChange(type)}
                    className={`px-4 py-2.5 border border-white/20 font-mono text-[9px] md:text-[10px] uppercase tracking-widest transition-all whitespace-nowrap ${currentFilter === type ? 'bg-acid text-black border-acid' : 'text-white/60 hover:text-acid hover:border-acid/60'}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-stretch gap-2 w-full md:w-[25rem]">
          {onSortChange && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setSortOpen(open => !open)}
                aria-label="Filter records"
                aria-expanded={sortOpen}
                className={`h-full min-h-[42px] border px-3 transition-all ${
                  sortOpen || sortMode !== 'newest'
                    ? 'border-acid bg-acid text-black'
                    : 'border-white/20 bg-black text-white/60 hover:border-acid/60 hover:text-acid'
                }`}
              >
                <FilterIcon />
              </button>

              {sortOpen && (
                <div className="absolute right-0 top-[calc(100%+10px)] z-50 min-w-36 border border-white/15 bg-black/95 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl">
                  {sortOptions.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        onSortChange(option.value);
                        setSortOpen(false);
                      }}
                      className={`block w-full px-3 py-2 text-left font-mono text-[10px] uppercase tracking-widest transition-all ${
                        sortMode === option.value ? 'bg-acid text-black' : 'text-white/60 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {viewMode && onViewModeChange && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setViewOpen(open => !open)}
                aria-label="Change view mode"
                aria-expanded={viewOpen}
                title="View mode"
                className={`flex h-full min-h-[42px] items-center gap-2 border px-3 transition-all ${
                  viewOpen || viewMode !== 'catalog'
                    ? 'border-acid bg-acid text-black'
                    : 'border-white/20 bg-black text-white/60 hover:border-acid/60 hover:text-acid'
                }`}
              >
                <ViewModeIcon mode={viewMode} />
                <span className="hidden font-mono text-[9px] uppercase tracking-widest lg:inline">
                  {viewMode}
                </span>
              </button>

              {viewOpen && (
                <div className="absolute right-0 top-[calc(100%+10px)] z-50 min-w-40 border border-white/15 bg-black/95 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl">
                  {viewOptions.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        onViewModeChange(option.value);
                        setViewOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[10px] uppercase tracking-widest transition-all ${
                        viewMode === option.value ? 'bg-acid text-black' : 'text-white/60 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <ViewModeIcon mode={option.value} />
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex min-w-0 flex-1 items-center gap-2 bg-black border border-white/20 px-3 py-2.5 md:py-3 focus-within:border-acid transition-colors">
            <SearchIcon />
            <input
              type="text"
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="SEARCH RECORDS..."
              className="w-full bg-transparent font-mono text-[9px] md:text-[10px] text-acid outline-none uppercase tracking-widest"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
