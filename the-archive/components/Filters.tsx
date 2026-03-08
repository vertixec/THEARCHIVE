'use client';

interface FiltersProps {
  activeTab: 'main' | 'systems' | 'community';
  currentFilter: string;
  onFilterChange: (filter: string) => void;
  onSearchChange: (query: string) => void;
  types: string[];
}

export default function Filters({ activeTab, currentFilter, onFilterChange, onSearchChange, types }: FiltersProps) {
  let filterAllText = 'ALL RECORDS';
  if (activeTab === 'systems') filterAllText = 'ALL SYSTEMS';
  if (activeTab === 'community') filterAllText = 'ALL COMMUNITY';
  if (activeTab === 'main') filterAllText = 'ALL ASSETS';

  return (
    <section className="sticky top-[72px] z-40 bg-dark/90 backdrop-blur-md border-y border-white/10 px-4 md:px-6 py-4">
      <div className="w-full flex flex-col md:flex-row gap-4 md:gap-6 items-center md:items-center justify-between text-center">
        <div className="flex overflow-x-auto pb-2 md:pb-0 no-scrollbar gap-2 w-full md:w-auto md:justify-start" id="filter-controls">
          <div className="flex flex-nowrap gap-2 min-w-max mx-auto md:mx-0 px-4 md:px-0">
            <button 
              onClick={() => onFilterChange('ALL')} 
              className={`px-4 py-1.5 border border-white/20 font-mono text-[9px] md:text-[10px] uppercase tracking-widest transition-all whitespace-nowrap ${currentFilter === 'ALL' ? 'bg-acid text-black border-acid' : ''}`}
            >
              {filterAllText}
            </button>
            {types.map((type) => (
              <button 
                key={type}
                onClick={() => onFilterChange(type)}
                className={`px-4 py-1.5 border border-white/20 font-mono text-[9px] md:text-[10px] uppercase tracking-widest transition-all whitespace-nowrap ${currentFilter === type ? 'bg-acid text-black border-acid' : ''}`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex items-center gap-2 w-full md:w-64 bg-black border border-white/20 px-3 py-2.5 md:py-3 focus-within:border-acid transition-colors">
          <svg className="shrink-0 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          <input
            type="text"
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="SEARCH RECORDS..."
            className="w-full bg-transparent font-mono text-[9px] md:text-[10px] text-acid outline-none uppercase tracking-widest"
          />
        </div>
      </div>
    </section>
  );
}
