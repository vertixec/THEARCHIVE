// Bearer-token authentication for the MCP server.
//
// Two independent gates protect every tool call:
//   1. SCOPES — baked into the key at creation ('read' | 'write' | 'generate').
//      A read-only key cannot spend a single credit, so a leaked key from a
//      user's editor config is not a billing incident.
//   2. TIER FEATURES — resolved from `profiles` on EVERY request, never cached
//      in the token. Revoking a Skool membership instantly takes community
//      content away from keys that were minted while it was active.

import { createAdminClient } from '../supabaseAdmin';
import {
  canAccessFeature,
  getPlanForProfile,
  isActivePlatformUser,
  resolveAccessTier,
  type AccessTier,
  type BusinessProfile,
  type Feature,
} from '../business';
import {
  hashToken,
  hashesMatch,
  isKeyUsable,
  looksLikeToken,
  touchKey,
  type McpScope,
} from './keys';

export type McpContext = {
  userId: string;
  profile: BusinessProfile;
  tier: AccessTier;
  scopes: McpScope[];
  keyId: string;
  keyName: string;
};

export type AuthFailure = {
  /** Machine-readable reason, surfaced in the WWW-Authenticate header. */
  code: 'missing_token' | 'invalid_token' | 'inactive_account' | 'error';
  message: string;
};

export type AuthResult =
  | { ok: true; context: McpContext }
  | { ok: false; failure: AuthFailure };

type KeyAuthRow = {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export async function authenticate(authorizationHeader: string | null): Promise<AuthResult> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    return {
      ok: false,
      failure: { code: 'missing_token', message: 'Missing bearer token.' },
    };
  }

  // Cheap shape check first: keeps malformed input out of the database.
  if (!looksLikeToken(token)) {
    return {
      ok: false,
      failure: { code: 'invalid_token', message: 'Invalid API key.' },
    };
  }

  const admin = createAdminClient();
  const presentedHash = hashToken(token);

  const { data: key, error } = await admin
    .from('mcp_api_keys')
    .select('id, user_id, name, token_hash, scopes, last_used_at, expires_at, revoked_at')
    .eq('token_hash', presentedHash)
    .maybeSingle<KeyAuthRow>();

  if (error) {
    console.error('MCP key lookup failed:', error);
    return { ok: false, failure: { code: 'error', message: 'Authentication failed.' } };
  }

  // One generic message for "no such key", "revoked" and "expired": telling a
  // caller which one it was only helps an attacker enumerate.
  if (!key || !hashesMatch(key.token_hash, presentedHash) || !isKeyUsable(key)) {
    return {
      ok: false,
      failure: { code: 'invalid_token', message: 'Invalid, revoked or expired API key.' },
    };
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('id, status, role, access_tier, plan_id')
    .eq('id', key.user_id)
    .maybeSingle<BusinessProfile>();

  // Banned/inactive accounts lose API access even with a valid key.
  if (!profile || !isActivePlatformUser(profile)) {
    return {
      ok: false,
      failure: {
        code: 'inactive_account',
        message: 'This account is not active. Check your membership at THE ARCHIVE.',
      },
    };
  }

  await touchKey(key.id, key.last_used_at).catch((touchError) => {
    console.error('MCP key touch failed (non-fatal):', touchError);
  });

  return {
    ok: true,
    context: {
      userId: key.user_id,
      profile,
      tier: resolveAccessTier(profile),
      scopes: (key.scopes ?? []).filter(
        (scope): scope is McpScope => scope === 'read' || scope === 'write' || scope === 'generate',
      ),
      keyId: key.id,
      keyName: key.name,
    },
  };
}

export function hasScope(context: McpContext, scope: McpScope): boolean {
  return context.scopes.includes(scope);
}

export function hasFeature(context: McpContext, feature: Feature): boolean {
  return canAccessFeature(context.profile, feature);
}

export function planFor(context: McpContext) {
  return getPlanForProfile(context.profile);
}
