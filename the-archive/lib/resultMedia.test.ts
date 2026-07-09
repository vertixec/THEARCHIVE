import { describe, expect, it } from 'vitest';
import { resolveMediaType } from './resultMedia';

describe('resolveMediaType', () => {
  it('maps known content types to their extension', () => {
    expect(resolveMediaType('image/png', 'image')).toEqual({ mime: 'image/png', extension: 'png' });
    expect(resolveMediaType('image/jpeg', 'image')).toEqual({ mime: 'image/jpeg', extension: 'jpg' });
    expect(resolveMediaType('video/mp4', 'video')).toEqual({ mime: 'video/mp4', extension: 'mp4' });
  });

  it('ignores charset suffixes and casing', () => {
    expect(resolveMediaType('IMAGE/WEBP; charset=binary', 'image')).toEqual({
      mime: 'image/webp',
      extension: 'webp',
    });
  });

  it('falls back by generation type on unknown or missing content types', () => {
    expect(resolveMediaType(null, 'image')).toEqual({ mime: 'image/png', extension: 'png' });
    expect(resolveMediaType('application/octet-stream', 'video')).toEqual({
      mime: 'video/mp4',
      extension: 'mp4',
    });
  });
});
