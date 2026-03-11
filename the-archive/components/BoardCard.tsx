import Link from 'next/link';

interface BoardWithMosaic {
  id: string;
  name: string;
  itemCount: number;
  mosaicImages: (string | null)[];
}

interface BoardCardProps {
  board: BoardWithMosaic;
}

export default function BoardCard({ board }: BoardCardProps) {
  const slots = [0, 1, 2, 3];

  return (
    <Link href={`/favorites/${board.id}`} className="group block border border-white/10 bg-panel hover:border-acid/40 transition-all duration-300 overflow-hidden">
      {/* 2x2 Mosaic */}
      <div className="grid grid-cols-2 aspect-square">
        {slots.map(i => (
          board.mosaicImages[i] ? (
            <div key={i} className="overflow-hidden">
              <img
                src={board.mosaicImages[i]!}
                alt=""
                className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
              />
            </div>
          ) : (
            <div key={i} className="bg-acid/5 border-white/5 flex items-center justify-center">
              <svg className="w-4 h-4 text-acid/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-white/10 group-hover:border-acid/20 transition-colors">
        <div className="font-mono text-[8px] text-acid uppercase tracking-widest mb-1">VAULT</div>
        <div className="font-anton text-base text-white uppercase leading-none truncate group-hover:text-acid transition-colors">
          {board.name}
        </div>
        <div className="font-mono text-[9px] text-white/40 mt-1 uppercase tracking-wider">
          {board.itemCount} {board.itemCount === 1 ? 'ITEM' : 'ITEMS'}
        </div>
      </div>
    </Link>
  );
}
