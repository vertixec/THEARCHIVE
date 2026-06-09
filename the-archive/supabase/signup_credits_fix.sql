-- ============================================================
-- THE ARCHIVE - Fix new-user signup credits
-- ============================================================
-- The handle_new_user() trigger granted a hardcoded 5 credits. With the new
-- per-model pricing a single image costs 12 credits, so a new user couldn't
-- generate anything. This raises the grant to the free plan's signup_credits
-- (60 today), read from the `plans` table so it stays in sync with config.
--
-- Only affects FUTURE signups. Idempotent (CREATE OR REPLACE). Run in
-- Supabase → SQL Editor.
-- ============================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signup_credits integer;
begin
  insert into public.profiles (
    id, email, full_name, status, role, access_tier, plan_id
  )
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    'active',
    'user',
    'free',
    'free'
  )
  on conflict (id) do update
    set
      email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      access_tier = coalesce(public.profiles.access_tier, 'free'),
      plan_id = coalesce(public.profiles.plan_id, 'free');

  -- Free-tier signup grant, from the plans table (fallback 60).
  select signup_credits into v_signup_credits
  from public.plans
  where access_tier = 'free';
  v_signup_credits := coalesce(v_signup_credits, 60);

  insert into public.user_credit_balances (user_id, credits, video_credits)
  values (new.id, v_signup_credits, 0)
  on conflict (user_id) do nothing;

  insert into public.credit_transactions (
    user_id, amount, balance_after, credit_type, reason, metadata
  )
  values (
    new.id,
    v_signup_credits,
    v_signup_credits,
    'general',
    'signup_bonus',
    jsonb_build_object('plan_id', 'free')
  )
  on conflict do nothing;

  return new;
end;
$$;

commit;

-- Verification: confirm the free plan grant the trigger will use.
select access_tier, signup_credits from public.plans where access_tier = 'free';
