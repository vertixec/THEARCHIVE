import { describe, expect, it } from 'vitest';
import { canAccessFeature, isActivePlatformUser } from './business';

describe('business access', () => {
  it('blocks inactive and banned profiles even when their tier has access', () => {
    expect(isActivePlatformUser({ id: '1', status: 'inactive', access_tier: 'community' })).toBe(false);
    expect(isActivePlatformUser({ id: '2', status: 'banned', role: 'admin' })).toBe(false);
    expect(canAccessFeature({ id: '1', status: 'inactive', access_tier: 'community' }, 'generate_video')).toBe(false);
  });

  it('allows active profiles according to their tier', () => {
    expect(canAccessFeature({ id: '1', status: 'active', access_tier: 'free' }, 'generate_image')).toBe(true);
    expect(canAccessFeature({ id: '2', status: 'active', access_tier: 'free' }, 'generate_video')).toBe(false);
    expect(canAccessFeature({ id: '3', status: 'active', role: 'admin' }, 'admin_panel')).toBe(true);
  });
});
