'use client';

import { useGenerate, MAX_REFERENCE_IMAGES } from '@/components/GenerateContext';
import { useReferenceUpload } from './useReferenceUpload';

// Shared reference-images section used by freeform generation and Tools.
// Drag from the website grid, drop a file, or paste a URL — all routed through
// useReferenceUpload.
export default function ReferenceImages({ label = 'Reference images' }: { label?: string }) {
  const { referenceImageUrls, removeReferenceImageUrl } = useGenerate();
  const { isDragOver, setIsDragOver, isUploadingRef, isAtReferenceLimit, handleReferenceDrop } = useReferenceUpload();

  const dragProps = {
    onDragEnter: (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); },
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); },
    onDrop: handleReferenceDrop,
  };

  return (
    <section className="shrink-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="font-mono text-[9px] text-white/40 uppercase tracking-widest">{label}</div>
        <div className="font-mono text-[9px] text-acid/60 uppercase tracking-widest">
          {referenceImageUrls.length}/{MAX_REFERENCE_IMAGES}
        </div>
      </div>

      {referenceImageUrls.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {referenceImageUrls.map((url, index) => (
            <div key={`${url}-${index}`} className="relative aspect-square border border-white/10 bg-black overflow-hidden">
              <img src={url} alt={`Reference ${index + 1}`} className="h-full w-full object-cover pointer-events-none" />
              <button
                type="button"
                onClick={() => removeReferenceImageUrl(index)}
                className="absolute right-1 top-1 h-5 w-5 bg-black/80 border border-white/20 font-mono text-[10px] leading-none uppercase text-white/60 hover:text-acid hover:border-acid/60 transition-colors flex items-center justify-center"
                title="Remove"
                aria-label="Remove reference"
              >
                ×
              </button>
            </div>
          ))}

          {!isAtReferenceLimit && (
            <div
              {...dragProps}
              className={`relative aspect-square border border-dashed flex items-center justify-center text-center transition-colors ${
                isDragOver ? 'border-acid bg-acid/10' : 'border-white/15 bg-black/40 hover:border-white/25'
              }`}
            >
              <span className={`font-mono text-[8px] uppercase tracking-widest leading-tight px-1 ${isDragOver ? 'text-acid' : 'text-white/30'}`}>
                {isUploadingRef ? 'Uploading...' : isDragOver ? 'Drop here' : '+ Add'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div
          {...dragProps}
          className={`h-16 border border-dashed flex items-center justify-center px-4 text-center transition-colors ${
            isDragOver ? 'border-acid bg-acid/10' : 'border-white/15 bg-black/40 hover:border-white/25'
          }`}
        >
          <span className={`font-mono text-[9px] uppercase tracking-widest leading-relaxed ${isDragOver ? 'text-acid' : 'text-white/30'}`}>
            {isUploadingRef
              ? 'Uploading...'
              : isDragOver
              ? 'Release to use as reference'
              : `Drag up to ${MAX_REFERENCE_IMAGES} images here`}
          </span>
        </div>
      )}
    </section>
  );
}
