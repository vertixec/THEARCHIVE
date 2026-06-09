-- ============================================================
-- THE ARCHIVE - Community monthly credits (separate bucket + reset)
-- ============================================================
-- WHY: paid Skool community members get a monthly credit allowance (800/mo)
-- on top of any credits they buy. We DON'T want that allowance to mix with
-- purchased credits, because:
--   * monthly credits are use-it-or-lose-it (reset each cycle), and
--   * purchased credits must NEVER expire or be wiped by the reset.
--
-- DESIGN (two-bucket accounting on user_credit_balances):
--   * credits          -> PURCHASED credits. Persist forever. (existing column)
--   * monthly_credits  -> this cycle's community allowance. Reset every month.
--   Spendable balance  = credits + monthly_credits.
--   Spend order        = monthly_credits FIRST, then credits. So the allowance
--                        is consumed before the stuff the user paid for, and a
--                        reset only ever clears unused allowance.
--
-- The spend RPC keeps its signature and now RETURNS the TOTAL spendable
-- balance in `credits`, so the app/UI keep working unchanged.
--
-- HOW TO APPLY: review, then run ONCE in Supabase -> SQL Editor (or via MCP
-- apply_migration). Safe to re-run (idempotent: ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE, cron unschedule-then-schedule).
-- ============================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ------------------------------------------------------------
-- 1. Two-bucket columns on user_credit_balances.
-- ------------------------------------------------------------

alter table public.user_credit_balances
  add column if not exists monthly_credits integer not null default 0,
  add column if not exists monthly_credits_reset_at timestamptz;

-- ------------------------------------------------------------
-- 2. plans.monthly_credit_grant — config-driven allowance per tier.
--    Only the community tier gets a grant for now (pro/free = 0).
-- ------------------------------------------------------------

alter table public.plans
  add column if not exists monthly_credit_grant integer not null default 0;

update public.plans set monthly_credit_grant = 800 where access_tier = 'community';
update public.plans set monthly_credit_grant = 0   where access_tier in ('free', 'pro');

-- ------------------------------------------------------------
-- 3. spend_generation_credits — debit monthly_credits first, then credits.
--    Returns the TOTAL spendable balance in `credits` (monthly + purchased)
--    so the app keeps showing the right number with no code change.
-- ------------------------------------------------------------

create or replace function public.spend_generation_credits(
  p_generation_type text,
  p_amount integer,
  p_model text default null,
  p_prompt text default null
)
returns table (
  ok boolean,
  credits integer,
  video_credits integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_purchased integer;
  v_monthly integer;
  v_total integer;
  v_from_monthly integer;
  v_from_purchased integer;
  v_next_monthly integer;
  v_next_purchased integer;
  v_next_total integer;
begin
  if v_user_id is null then
    return query select false, 0, 0;
    return;
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'p_amount must be positive';
  end if;

  if p_generation_type not in ('image', 'video') then
    raise exception 'invalid generation type: %', p_generation_type;
  end if;

  select b.credits, b.monthly_credits
    into v_purchased, v_monthly
  from public.user_credit_balances b
  where b.user_id = v_user_id
  for update;

  if not found then
    insert into public.user_credit_balances (user_id, credits, video_credits, monthly_credits)
    values (v_user_id, 0, 0, 0);
    v_purchased := 0;
    v_monthly := 0;
  end if;

  v_total := coalesce(v_purchased, 0) + coalesce(v_monthly, 0);

  if v_total < p_amount then
    return query select false, v_total, 0;
    return;
  end if;

  -- Consume the monthly allowance first, then purchased credits.
  v_from_monthly := least(coalesce(v_monthly, 0), p_amount);
  v_from_purchased := p_amount - v_from_monthly;

  v_next_monthly := coalesce(v_monthly, 0) - v_from_monthly;
  v_next_purchased := coalesce(v_purchased, 0) - v_from_purchased;
  v_next_total := v_next_monthly + v_next_purchased;

  update public.user_credit_balances
  set credits = v_next_purchased,
      monthly_credits = v_next_monthly,
      updated_at = now()
  where user_id = v_user_id;

  insert into public.credit_transactions (
    user_id, amount, balance_after, credit_type, reason, metadata
  )
  values (
    v_user_id,
    -p_amount,
    v_next_total,
    case when p_generation_type = 'image' then 'general' else 'video' end,
    'generation_spend',
    jsonb_build_object(
      'generation_type', p_generation_type,
      'model', p_model,
      'prompt_preview', left(coalesce(p_prompt, ''), 160),
      'from_monthly', v_from_monthly,
      'from_purchased', v_from_purchased
    )
  );

  return query select true, v_next_total, 0;
end;
$$;

grant execute on function public.spend_generation_credits(text, integer, text, text) to authenticated;

-- ------------------------------------------------------------
-- 4. grant_community_credits_for_user — set ONE user's monthly allowance to
--    the configured grant (reset semantics: overwrite, not add). Used when an
--    admin promotes someone to community so they don't wait for the 1st.
--    service_role only.
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
  v_tier text;
  v_status text;
  v_next_total integer;
begin
  select access_tier, status into v_tier, v_status
  from public.profiles
  where id = p_user_id;

  if v_tier is distinct from 'community' or v_status is distinct from 'active' then
    return 0;  -- only active community members get the allowance
  end if;

  select monthly_credit_grant into v_grant
  from public.plans
  where access_tier = 'community';
  v_grant := coalesce(v_grant, 800);

  insert into public.user_credit_balances (user_id, credits, video_credits, monthly_credits, monthly_credits_reset_at)
  values (p_user_id, 0, 0, v_grant, now())
  on conflict (user_id) do update
    set monthly_credits = v_grant,
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
    v_grant,
    v_next_total,
    'monthly',
    'community_monthly_grant',
    jsonb_build_object('grant', v_grant, 'scope', 'single')
  );

  return v_grant;
end;
$$;

revoke execute on function public.grant_community_credits_for_user(uuid) from public, anon, authenticated;
grant execute on function public.grant_community_credits_for_user(uuid) to service_role;

-- ------------------------------------------------------------
-- 5. grant_monthly_community_credits — reset ALL active community members'
--    monthly allowance to the configured grant. Called by pg_cron monthly.
--    Use-it-or-lose-it: monthly_credits is OVERWRITTEN, not incremented.
-- ------------------------------------------------------------

create or replace function public.grant_monthly_community_credits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant integer;
  v_count integer := 0;
  r record;
begin
  select monthly_credit_grant into v_grant
  from public.plans
  where access_tier = 'community';
  v_grant := coalesce(v_grant, 800);

  for r in
    select id from public.profiles
    where access_tier = 'community' and status = 'active'
  loop
    insert into public.user_credit_balances (user_id, credits, video_credits, monthly_credits, monthly_credits_reset_at)
    values (r.id, 0, 0, v_grant, now())
    on conflict (user_id) do update
      set monthly_credits = v_grant,
          monthly_credits_reset_at = now(),
          updated_at = now();

    insert into public.credit_transactions (
      user_id, amount, balance_after, credit_type, reason, metadata
    )
    select
      r.id,
      v_grant,
      b.credits + b.monthly_credits,
      'monthly',
      'community_monthly_grant',
      jsonb_build_object('grant', v_grant, 'scope', 'cycle')
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

-- ------------------------------------------------------------
-- 6. Schedule the monthly reset with pg_cron (1st of each month, 06:00 UTC).
--    Runs OUTSIDE the transaction above. Re-runnable: unschedule then schedule.
--    Requires the pg_cron extension (enable in Supabase: Database -> Extensions,
--    or it may already be available in the `extensions`/`cron` schema).
-- ------------------------------------------------------------

create extension if not exists pg_cron;

do $$
begin
  -- Drop any previous version of this job so re-running this file is safe.
  perform cron.unschedule('the-archive-community-monthly-credits')
  where exists (
    select 1 from cron.job where jobname = 'the-archive-community-monthly-credits'
  );
end$$;

select cron.schedule(
  'the-archive-community-monthly-credits',
  '0 6 1 * *',
  $$select public.grant_monthly_community_credits();$$
);

-- ============================================================
-- Verification
-- ============================================================
select access_tier, monthly_credit_grant from public.plans order by access_tier;
select jobname, schedule, active from cron.job where jobname = 'the-archive-community-monthly-credits';
