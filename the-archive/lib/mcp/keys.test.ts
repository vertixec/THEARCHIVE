import { describe, expect, it } from 'vitest';
import {
  TOKEN_PREFIX,
  hashToken,
  hashesMatch,
  isKeyUsable,
  looksLikeToken,
  mintToken,
} from './keys';
import { normalizeScopes } from './scopes';
import { extractBearerToken } from './auth';

describe('token minting', () => {
  it('produces a prefixed, high-entropy, unique token', () => {
    const a = mintToken();
    const b = mintToken();
    expect(a.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it('stores a hash that matches the token and a prefix that does not', () => {
    const { token, hash, prefix } = mintToken();
    expect(hashToken(token)).toBe(hash);
    // The displayed prefix must never be enough to reconstruct the token.
    expect(token.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(token.length);
    expect(hashToken(prefix)).not.toBe(hash);
  });
});

describe('token shape check', () => {
  it('accepts a freshly minted token', () => {
    expect(looksLikeToken(mintToken().token)).toBe(true);
  });

  it('rejects tokens with the wrong prefix, length or alphabet', () => {
    expect(looksLikeToken('wrongprefix_abcdefghijklmnopqrstuvwxyz123456')).toBe(false);
    expect(looksLikeToken(`${TOKEN_PREFIX}short`)).toBe(false);
    expect(looksLikeToken(`${TOKEN_PREFIX}${'a'.repeat(200)}`)).toBe(false);
    expect(looksLikeToken(`${TOKEN_PREFIX}${'a'.repeat(40)}; drop table--`)).toBe(false);
    expect(looksLikeToken('')).toBe(false);
  });
});

describe('hash comparison', () => {
  it('matches identical digests and rejects different or malformed ones', () => {
    const { hash } = mintToken();
    expect(hashesMatch(hash, hash)).toBe(true);
    expect(hashesMatch(hash, mintToken().hash)).toBe(false);
    expect(hashesMatch(hash, hash.slice(0, 32))).toBe(false);
    expect(hashesMatch('', '')).toBe(false);
  });
});

describe('key usability', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  it('accepts a live key and rejects revoked or expired ones', () => {
    expect(isKeyUsable({ revoked_at: null, expires_at: null })).toBe(true);
    expect(isKeyUsable({ revoked_at: null, expires_at: future })).toBe(true);
    expect(isKeyUsable({ revoked_at: past, expires_at: null })).toBe(false);
    expect(isKeyUsable({ revoked_at: null, expires_at: past })).toBe(false);
  });
});

describe('scope normalization', () => {
  it('always grants read and drops anything unknown', () => {
    expect(normalizeScopes([])).toEqual(['read']);
    expect(normalizeScopes(['generate'])).toEqual(['read', 'generate']);
    expect(normalizeScopes(['admin', 'write', 'root'])).toEqual(['read', 'write']);
    expect(normalizeScopes('generate')).toEqual(['read']);
    expect(normalizeScopes(null)).toEqual(['read']);
  });
});

describe('bearer header parsing', () => {
  it('extracts the token and tolerates casing and padding', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
    expect(extractBearerToken('  bearer   abc123  ')).toBe('abc123');
  });

  it('rejects missing, empty or non-bearer schemes', () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
    expect(extractBearerToken('Basic abc123')).toBeNull();
    expect(extractBearerToken('abc123')).toBeNull();
  });
});
