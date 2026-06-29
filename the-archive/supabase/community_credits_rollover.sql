-- ============================================================
-- THE ARCHIVE - Community monthly credits: ROLLOVER WITH CAP
-- ============================================================
-- WHY: the original community allowance (see community_monthly_credits.sql)
-- was use-it-or-lose-it: the monthly reset OVERWROTE monthly_credits with the
-- flat grant, wiping any unused balance. The /roast council's Buyer flagged
-- this as churn fuel ("I resent watching 800 credits evaporate the weeks I'm
-- busy"). This migration switches the allowance to ROLLOVER WITH A CAP:
--   * unused monthly credits carry over to next cycle, and
--   * the balance is capped so we never open an unbounded FAL liability.
--
-- MARGIN SAFETY (the Logician's lens): FAL compute cost ~= $0.0045 / credit.
-- Keep  cap * $0.0045  <  monthly membership price  to stay cash-positive even
-- if a member burns the full capped balance in one month.
--   cap 1600 -> $7.20 FAL max/mo  (safe for any membership >= ~$8/mo)
-- The cap is CONFIG-DRIVEN (plans.monthly_credit_cap), so tuning it later is a
-- one-line UPDATE, no function change.
--
-- HOW TO APPLY: review, then run ONCE in Supabase -> SQL Editor (or via MCP
-- apply_migration). Safe to re-run (idempotent: ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE).
-- ============================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ------------------------------------------------------------
-- 1. plans.monthly_credit_cap — config-driven rollover ceiling per tier.
--    Default 2x the grant for community (1600). pro/free unused (0 = no grant).
-- ------------------------------------------------------------

alter table public.plans
  add column if not exists monthly_credit_cap integer not null default 0;

update public.plans set monthly_credit_cap = 1600 where access_tier = 'community';
update public.plans set monthly_credit_cap = 0    where access_tier in ('free', 'pro');

-- ------------------------------------------------------------
-- 2. grant_community_credits_for_user — single user (admin promotion).
--    Now ADDITIVE up to the cap (was: overwrite). Logs the actual delta added.
-- ------------------------------------------------------------

create or replace function public.grant_community_credits_for_user(
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant integer;
  v_cap integer;
  v_tier text;
  v_status text;
  v_prev_monthly integer;
  v_next_monthly integer;
  v_added integer;
  v_next_total integer;
begin
  select access_tier, status into v_tier, v_status
  from public.profiles
  where id = p_user_id;

  if v_tier is distinct from 'community' or v_status is distinct from 'active' then
    return 0;  -- only active community members get the allowance
  end if;

  select monthly_credit_grant, monthly_credit_cap into v_grant, v_cap
  from public.plans
  where access_tier = 'community';
  v_grant := coalesce(v_grant, 800);
  v_cap := coalesce(nullif(v_cap, 0), v_grant);  -- 0/null cap -> fall back to grant (no rollover)

  -- Read current monthly balance (default 0 if no row yet).
  select coalesce(monthly_credits, 0) into v_prev_monthly
  from public.user_credit_balances
  where user_id = p_user_id;
  v_prev_monthly := coalesce(v_prev_monthly, 0);

  v_next_monthly := least(v_prev_monthly + v_grant, v_cap);
  v_added := v_next_monthly - v_prev_monthly;

  insert into public.user_credit_balances (user_id, credits, video_credits, monthly_credits, monthly_credits_reset_at)
  values (p_user_id, 0, 0, v_next_monthly, now())
  on conflict (user_id) do update
    set monthly_credits = v_next_monthly,
        monthly_credits_reset_at = now(),
        updated_at = now();

  select credits + monthly_credits into v_next_total
  from public.user_credit_balances
  where user_id = p_user_id;

  insert into public.credit_transactions (
    user_id, amount, balance_after, credit_type, reason, metadata
  )
  values (
    p_user_id,
    v_added,
    v_next_total,
    'monthly',
    'community_monthly_grant',
    jsonb_build_object('grant', v_grant, 'cap', v_cap, 'added', v_added, 'scope', 'single')
  );

  return v_added;
end;
$$;

revoke execute on function public.grant_community_credits_for_user(uuid) from public, anon, authenticated;
grant execute on function public.grant_community_credits_for_user(uuid) to service_role;

-- ------------------------------------------------------------
-- 3. grant_monthly_community_credits — monthly cron reset for ALL active
--    community members. Now ROLLOVER WITH CAP: monthly_credits is
--    INCREMENTED by the grant up to the cap (was: overwritten).
-- ------------------------------------------------------------

create or replace function public.grant_monthly_community_credits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant integer;
  v_cap integer;
  v_count integer := 0;
  v_prev_monthly integer;
  v_next_monthly integer;
  v_added integer;
  r record;
begin
  select monthly_credit_grant, monthly_credit_cap into v_grant, v_cap
  from public.plans
  where access_tier = 'community';
  v_grant := coalesce(v_grant, 800);
  v_cap := coalesce(nullif(v_cap, 0), v_grant);  -- 0/null cap -> fall back to grant (no rollover)

  for r in
    select id from public.profiles
    where access_tier = 'community' and status = 'active'
  loop
    select coalesce(monthly_credits, 0) into v_prev_monthly
    from public.user_credit_balances
    where user_id = r.id;
    v_prev_monthly := coalesce(v_prev_monthly, 0);

    v_next_monthly := least(v_prev_monthly + v_grant, v_cap);
    v_added := v_next_monthly - v_prev_monthly;

    insert into public.user_credit_balances (user_id, credits, video_credits, monthly_credits, monthly_credits_reset_at)
    values (r.id, 0, 0, v_next_monthly, now())
    on conflict (user_id) do update
      set monthly_credits = v_next_monthly,
          monthly_credits_reset_at = now(),
          updated_at = now();

    insert into public.credit_transactions (
      user_id, amount, balance_after, credit_type, reason, metadata
    )
    select
      r.id,
      v_added,
      b.credits + b.monthly_credits,
      'monthly',
      'community_monthly_grant',
      jsonb_build_object('grant', v_grant, 'cap', v_cap, 'added', v_added, 'scope', 'cycle')
    from public.user_credit_balances b
    where b.user_id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.grant_monthly_community_credits() from public, anon, authenticated;
grant execute on function public.grant_monthly_community_credits() to service_role;

commit;

-- ============================================================
-- Verification
-- ============================================================
select access_tier, monthly_credit_grant, monthly_credit_cap from public.plans order by access_tier;
