// Client-safe MCP vocabulary: scopes and the shape of a key's public metadata.
// Kept apart from lib/mcp/keys.ts so the settings UI can import it without
// pulling node:crypto and the service-role Supabase client into the browser
// bundle.

export const MCP_SCOPES = ['read', 'write', 'generate'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  read: 'Browse the archive, your creations, boards and account balance.',
  write: 'Save items into your moodboards.',
  generate: 'Start image and video generations. Spends your credits.',
};

/** Everything about a key that is safe to show — never includes the hash. */
export type McpKeyRow = {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

export function normalizeScopes(raw: unknown): McpScope[] {
  const list = Array.isArray(raw) ? raw : [];
  const scopes = MCP_SCOPES.filter((scope) => list.includes(scope));
  // Every key can at least read; a scope-less key would be a confusing no-op.
  return scopes.includes('read') ? scopes : (['read', ...scopes] as McpScope[]);
}
