-- ============================================================
-- THE ARCHIVE - Business foundation
-- Plans, tiers, and credit ledger for the public product stage.
-- Safe to run after the existing schema. Review before production.
-- ============================================================

begin;

-- Avoid waiting behind long production locks. If the database is busy,
-- the migration aborts instead of hanging during traffic.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.profiles
  add column if not exists access_tier text default 'free',
  add column if not exists plan_id text,
  add column if not exists skool_member_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists onboarding_completed boolean default false;

create table if not exists public.plans (
  id text primary key,
  name text not null,
  access_tier text not null,
  monthly_image_limit integer not null default 0,
  monthly_video_limit integer not null default 0,
  signup_credits integer not null default 0,
  can_access_systems boolean default false,
  can_access_workflows boolean default false,
  can_access_community boolean default false,
  is_public boolean default true,
  created_at timestamptz default now()
);

insert into public.plans (
  id,
  name,
  access_tier,
  monthly_image_limit,
  monthly_video_limit,
  signup_credits,
  can_access_systems,
  can_access_workflows,
  can_access_community,
  is_public
)
values
  ('free', 'Free', 'free', 5, 0, 5, false, false, false, true),
  ('community', 'Community', 'community', 50, 5, 0, true, true, true, false),
  ('pro', 'Pro', 'pro', 100, 10, 0, true, true, false, true)
on conflict (id) do update set
  name = excluded.name,
  access_tier = excluded.access_tier,
  monthly_image_limit = excluded.monthly_image_limit,
  monthly_video_limit = excluded.monthly_video_limit,
  signup_credits = excluded.signup_credits,
  can_access_systems = excluded.can_access_systems,
  can_access_workflows = excluded.can_access_workflows,
  can_access_community = excluded.can_access_community,
  is_public = excluded.is_public;

create table if not exists public.user_credit_balances (
  user_id uuid references auth.users(id) on delete cascade primary key,
  credits integer not null default 0,
  video_credits integer not null default 0,
  updated_at timestamptz default now()
);

create table if not exists public.credit_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  amount integer not null,
  balance_after integer,
  credit_type text not null default 'general',
  reason text not null,
  related_generation_id uuid,
  stripe_payment_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.user_credit_balances enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.plans enable row level security;

drop policy if exists "plans_select_public" on public.plans;
create policy "plans_select_public" on public.plans
  for select
  using (is_public = true or exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  ));

drop policy if exists "credit_balances_select_own" on public.user_credit_balances;
create policy "credit_balances_select_own" on public.user_credit_balances
  for select
  using (auth.uid() = user_id);

drop policy if exists "credit_transactions_select_own" on public.credit_transactions;
create policy "credit_transactions_select_own" on public.credit_transactions
  for select
  using (auth.uid() = user_id);

-- Existing active members become community users. Existing active admins
-- are resolved as admin in application code via role='admin'.
update public.profiles
set access_tier = 'community',
    plan_id = 'community'
where status = 'active'
  and role in ('member', 'admin')
  and (access_tier is null or access_tier = 'free');

commit;

-- Verification queries. Run after commit if you want a visible report.
select
  count(*) filter (where access_tier = 'community') as community_profiles,
  count(*) filter (where access_tier = 'free') as free_profiles,
  count(*) filter (where role = 'admin') as admin_profiles
from public.profiles;

select id, name, access_tier, monthly_image_limit, monthly_video_limit, is_public
from public.plans
order by id;
