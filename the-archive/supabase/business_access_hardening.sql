-- ============================================================
-- THE ARCHIVE - Business access hardening
-- Run after business_foundation.sql.
--
-- Goal:
-- 1. New public signups become free users, not community members.
-- 2. Premium content RLS uses access_tier/role, not only status='active'.
-- 3. Existing users receive an initial visible credit balance.
-- ============================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ------------------------------------------------------------
-- 1. Signup trigger: public users start as Free.
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    status,
    role,
    access_tier,
    plan_id
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

  insert into public.user_credit_balances (user_id, credits, video_credits)
  values (new.id, 5, 0)
  on conflict (user_id) do nothing;

  insert into public.credit_transactions (
    user_id,
    amount,
    balance_after,
    credit_type,
    reason,
    metadata
  )
  values (
    new.id,
    5,
    5,
    'general',
    'signup_bonus',
    jsonb_build_object('plan_id', 'free')
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2. Backfill balances for existing users.
-- This does not change generation enforcement yet; it prepares
-- the visible account/billing layer.
-- ------------------------------------------------------------

insert into public.user_credit_balances (user_id, credits, video_credits)
select
  p.id,
  case
    when p.role = 'admin' then 9999
    when p.access_tier = 'community' then 50
    when p.access_tier = 'pro' then 100
    else 5
  end as credits,
  case
    when p.role = 'admin' then 9999
    when p.access_tier = 'community' then 5
    when p.access_tier = 'pro' then 10
    else 0
  end as video_credits
from public.profiles p
on conflict (user_id) do nothing;

insert into public.credit_transactions (
  user_id,
  amount,
  balance_after,
  credit_type,
  reason,
  metadata
)
select
  p.id,
  b.credits,
  b.credits,
  'general',
  'migration',
  jsonb_build_object('access_tier', p.access_tier, 'plan_id', p.plan_id)
from public.profiles p
join public.user_credit_balances b on b.user_id = p.id
where not exists (
  select 1
  from public.credit_transactions ct
  where ct.user_id = p.id
    and ct.reason = 'migration'
);

-- ------------------------------------------------------------
-- 3. Premium content RLS.
-- Free users can be active without reading all premium tables.
-- ------------------------------------------------------------

drop policy if exists "prompts_select_active_members" on public.prompts;
drop policy if exists "functional_prompts_select_active_members" on public.functional_prompts;
drop policy if exists "community_visuals_select_active_members" on public.community_visuals;
drop policy if exists "workflows_select_active_members" on public.workflows;

create policy "prompts_select_tier_access"
  on public.prompts for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.status = 'active'
        and (
          profiles.role = 'admin'
          or profiles.access_tier in ('free', 'community', 'pro')
        )
    )
  );

create policy "functional_prompts_select_tier_access"
  on public.functional_prompts for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.status = 'active'
        and (
          profiles.role = 'admin'
          or profiles.access_tier in ('community', 'pro')
        )
    )
  );

create policy "community_visuals_select_tier_access"
  on public.community_visuals for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.status = 'active'
        and (
          profiles.role = 'admin'
          or profiles.access_tier = 'community'
        )
    )
  );

create policy "workflows_select_tier_access"
  on public.workflows for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.status = 'active'
        and (
          profiles.role = 'admin'
          or profiles.access_tier in ('community', 'pro')
        )
    )
  );

commit;

-- Verification
select access_tier, role, status, count(*)
from public.profiles
group by access_tier, role, status
order by access_tier, role, status;

select count(*) as credit_balance_rows
from public.user_credit_balances;

