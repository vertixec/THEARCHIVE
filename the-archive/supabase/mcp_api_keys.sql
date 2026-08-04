-- ============================================================
-- MCP API keys — personal access tokens for THE ARCHIVE's MCP server
-- ============================================================
-- These tokens let a member connect THE ARCHIVE to an AI agent (Claude,
-- Cursor, ...) over the Streamable HTTP MCP endpoint at /api/mcp.
--
-- SECURITY MODEL
--   * The raw token is NEVER stored. Only sha256(token) lives here, so a dump
--     of this table cannot be replayed against the API.
--   * The table is service-role only: RLS is on with NO policies and the
--     anon/authenticated grants are revoked. Every read/write goes through a
--     server route that has already authenticated the session.
--   * Scopes are least-privilege by default: a key is 'read' unless the user
--     explicitly grants 'write' (boards) or 'generate' (spends credits).
--   * Tier/feature access is NOT baked into the key. It is resolved from
--     profiles on every request, so revoking a Skool membership instantly
--     downgrades what an existing key can read.
--
-- Apply with: supabase SQL editor, or via the Supabase MCP apply_migration.
-- ============================================================

create table if not exists public.mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- sha256 hex of the full token. Unique so a collision can never authenticate
  -- as the wrong user.
  token_hash text not null unique,
  -- First 12 chars of the token ("tarc_ab12cd"), for display only. Enough to
  -- identify a key in the UI, useless for authentication.
  token_prefix text not null,
  scopes text[] not null default array['read']::text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,

  constraint mcp_api_keys_name_len check (char_length(name) between 1 and 60),
  constraint mcp_api_keys_scopes_valid check (
    scopes <@ array['read', 'write', 'generate']::text[]
    and coalesce(array_length(scopes, 1), 0) >= 1
  )
);

-- Auth lookup is by hash; keep it the fast path.
create unique index if not exists mcp_api_keys_token_hash_idx
  on public.mcp_api_keys (token_hash);

-- Listing a user's live keys.
create index if not exists mcp_api_keys_user_active_idx
  on public.mcp_api_keys (user_id)
  where revoked_at is null;

-- ------------------------------------------------------------
-- Cap live keys per user (defense against key-table spam). Enforced in the
-- database so concurrent creates can't race past the application check.
-- ------------------------------------------------------------
create or replace function public.enforce_mcp_key_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  live_count integer;
begin
  select count(*) into live_count
  from public.mcp_api_keys
  where user_id = new.user_id
    and revoked_at is null;

  if live_count >= 10 then
    raise exception 'MCP key limit reached (10 active keys per user)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists mcp_api_keys_limit on public.mcp_api_keys;
create trigger mcp_api_keys_limit
  before insert on public.mcp_api_keys
  for each row execute function public.enforce_mcp_key_limit();

-- ------------------------------------------------------------
-- Lock the table down to the service role.
-- RLS on + zero policies = no row is visible to anon/authenticated even if a
-- grant is reintroduced later. The revokes remove the default schema grants.
-- ------------------------------------------------------------
alter table public.mcp_api_keys enable row level security;

revoke all on public.mcp_api_keys from anon, authenticated;

-- Postgres grants EXECUTE on every new function to PUBLIC, so revoking from
-- anon/authenticated alone would leave this callable over /rest/v1/rpc.
-- Triggers run the function as the table owner, so this does not break the
-- limit check.
revoke all on function public.enforce_mcp_key_limit() from public, anon, authenticated;

comment on table public.mcp_api_keys is
  'Personal access tokens for the MCP server (/api/mcp). Service-role only; raw tokens are never stored.';
