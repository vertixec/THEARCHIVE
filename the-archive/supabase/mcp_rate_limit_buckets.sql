-- ============================================================
-- Rate-limit buckets for the MCP server
-- ============================================================
-- server_consume_api_rate_limit keeps a server-side ALLOWLIST of
-- (bucket, limit, window) triples. That is the whole point of the function:
-- the caller passes the numbers, but the database only honours combinations we
-- sanctioned, so no route can quietly grant itself a laxer budget.
--
-- Adding a bucket therefore means adding a row to the allowlist — never
-- loosening the check. New entries:
--
--   mcp:read   120/60s   browsing the archive from an agent
--   mcp:write   30/60s   saving to moodboards
--   mcp:keys     5/300s  creating API keys from the settings page
--
-- Generation over MCP deliberately reuses the existing 'generate' bucket
-- (10/60s) so an agent shares the web app's budget instead of getting a second
-- one — an MCP key cannot be used to double a member's generation rate.
--
-- Apply AFTER supabase/security_hardening.sql (which defines the function) and
-- alongside supabase/mcp_api_keys.sql.
-- ============================================================

create or replace function public.server_consume_api_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.api_rate_limits%rowtype;
  v_now timestamptz := now();
begin
  if p_user_id is null then raise exception 'not_authenticated'; end if;
  if p_limit <= 0 or p_window_seconds <= 0 then raise exception 'invalid_rate_limit'; end if;
  if not (
    (p_bucket = 'generate' and p_limit = 10 and p_window_seconds = 60)
    or (p_bucket = 'tool:style-transfer' and p_limit = 5 and p_window_seconds = 600)
    or (p_bucket = 'tool:ads' and p_limit = 2 and p_window_seconds = 600)
    or (p_bucket = 'upload-reference' and p_limit = 20 and p_window_seconds = 600)
    or (p_bucket = 'mcp:read' and p_limit = 120 and p_window_seconds = 60)
    or (p_bucket = 'mcp:write' and p_limit = 30 and p_window_seconds = 60)
    or (p_bucket = 'mcp:keys' and p_limit = 5 and p_window_seconds = 300)
  ) then
    raise exception 'invalid_rate_limit_bucket';
  end if;

  insert into public.api_rate_limits (user_id, bucket, window_started_at, request_count)
  values (p_user_id, p_bucket, v_now, 0)
  on conflict (user_id, bucket) do nothing;

  select * into v_row
  from public.api_rate_limits
  where user_id = p_user_id and bucket = p_bucket
  for update;

  if v_row.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    update public.api_rate_limits
    set window_started_at = v_now, request_count = 1
    where user_id = p_user_id and bucket = p_bucket;
    return query select true, 0;
  elsif v_row.request_count >= p_limit then
    return query
    select false,
           greatest(
             1,
             ceil(extract(epoch from (v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now)))::integer
           );
  else
    update public.api_rate_limits
    set request_count = request_count + 1
    where user_id = p_user_id and bucket = p_bucket;
    return query select true, 0;
  end if;
end;
$function$;

revoke all on function public.server_consume_api_rate_limit(uuid, text, integer, integer)
  from public, anon, authenticated;
