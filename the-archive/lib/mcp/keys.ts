// MCP personal access tokens: minting, hashing and lifecycle.
//
// The raw token exists exactly once — in the HTTP response that creates it.
// Everything persisted is sha256(token), so neither a database dump nor a
// compromised admin client can replay a user's key.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '../supabaseAdmin';
import type { McpKeyRow, McpScope } from './scopes';

export { MCP_SCOPES, SCOPE_DESCRIPTIONS, normalizeScopes } from './scopes';
export type { McpKeyRow, McpScope } from './scopes';

/** Identifies the token in secret scanners and in support conversations. */
export const TOKEN_PREFIX = 'tarc_';
/** 32 bytes of CSPRNG entropy, base64url encoded (43 chars). */
const TOKEN_ENTROPY_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = TOKEN_PREFIX.length + 6;

/** Metadata safe to return to the browser — never includes the hash. */
export const KEY_PUBLIC_COLUMNS =
  'id, user_id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at';

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * A token is only worth a database round trip if it has our shape. Rejecting
 * malformed input here keeps garbage out of the auth path.
 */
export function looksLikeToken(token: string): boolean {
  if (!token.startsWith(TOKEN_PREFIX)) return false;
  const body = token.slice(TOKEN_PREFIX.length);
  return body.length >= 32 && body.length <= 128 && /^[A-Za-z0-9_-]+$/.test(body);
}

export function mintToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + randomBytes(TOKEN_ENTROPY_BYTES).toString('base64url');
  return {
    token,
    hash: hashToken(token),
    prefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

/**
 * Constant-time equality for two hex digests. The lookup itself is an indexed
 * exact match on a 256-bit digest (not attackable by timing), but comparing
 * the fetched hash this way keeps the guarantee end to end.
 */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isKeyUsable(key: Pick<McpKeyRow, 'revoked_at' | 'expires_at'>): boolean {
  if (key.revoked_at) return false;
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return false;
  return true;
}

// ------------------------------------------------------------
// Lifecycle (all service-role; callers must have authenticated the session)
// ------------------------------------------------------------

export async function listKeys(userId: string): Promise<McpKeyRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('mcp_api_keys')
    .select(KEY_PUBLIC_COLUMNS)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .returns<McpKeyRow[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createKey(params: {
  userId: string;
  name: string;
  scopes: McpScope[];
  expiresInDays: number | null;
}): Promise<{ key: McpKeyRow; token: string }> {
  const { token, hash, prefix } = mintToken();
  const expiresAt =
    params.expiresInDays && params.expiresInDays > 0
      ? new Date(Date.now() + params.expiresInDays * 86_400_000).toISOString()
      : null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('mcp_api_keys')
    .insert({
      user_id: params.userId,
      name: params.name,
      token_hash: hash,
      token_prefix: prefix,
      scopes: params.scopes,
      expires_at: expiresAt,
    })
    .select(KEY_PUBLIC_COLUMNS)
    .single<McpKeyRow>();

  if (error || !data) {
    throw new Error(error?.message || 'Could not create the key');
  }
  return { key: data, token };
}

/** Soft-revoke: the row stays for auditing but can never authenticate again. */
export async function revokeKey(userId: string, keyId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('mcp_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id');

  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Best-effort "last used" stamp. Throttled to once a minute so a chatty agent
 * doesn't turn every tool call into a write.
 */
export async function touchKey(keyId: string, lastUsedAt: string | null): Promise<void> {
  if (lastUsedAt && Date.now() - new Date(lastUsedAt).getTime() < 60_000) return;
  const admin = createAdminClient();
  await admin
    .from('mcp_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyId);
}
