import { describe, expect, it } from 'vitest';
import { isSupportedRasterBytes } from './referenceImages';

describe('reference signatures', () => {
  it('accepts supported raster signatures', () => {
    expect(isSupportedRasterBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe(true);
    expect(isSupportedRasterBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(isSupportedRasterBytes(new TextEncoder().encode('GIF89a'))).toBe(true);
  });

  it('rejects SVG, HTML and arbitrary bytes', () => {
    expect(isSupportedRasterBytes(new TextEncoder().encode('<svg></svg>'))).toBe(false);
    expect(isSupportedRasterBytes(new TextEncoder().encode('<html></html>'))).toBe(false);
    expect(isSupportedRasterBytes(Uint8Array.from([1, 2, 3, 4]))).toBe(false);
  });
});
