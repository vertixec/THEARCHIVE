-- ============================================================
-- THE ARCHIVE - Billing foundation
-- Adds provider-agnostic billing layer:
--   - Rename stripe_* columns to provider-neutral names
--   - credit_packs catalog (seeded with Starter/Creator/Studio)
--   - payment_intents table for tracking checkout -> webhook flow
-- Already applied to the live project via MCP apply_migration.
-- Kept here for repository history. Re-running this is NOT idempotent
-- (the rename steps will fail the second time).
-- ============================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ------------------------------------------------------------
-- 1. Provider-neutral naming on existing tables
-- ------------------------------------------------------------

alter table public.credit_transactions
  rename column stripe_payment_id to payment_reference;

alter table public.credit_transactions
  add column if not exists payment_provider text;

alter table public.profiles
  rename column stripe_customer_id to payment_customer_id;

-- ------------------------------------------------------------
-- 2. Credit packs catalog
-- ------------------------------------------------------------

create table if not exists public.credit_packs (
  id text primary key,
  name text not null,
  description text,
  price_usd numeric(10,2) not null,
  image_credits integer not null default 0,
  video_credits integer not null default 0,
  lemonsqueezy_variant_id text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.credit_packs (id, name, description, price_usd, image_credits, video_credits, sort_order)
values
  ('starter', 'Starter Pack', '50 image credits + 5 video credits. Perfect to try the engine.', 5.00, 50, 5, 10),
  ('creator', 'Creator Pack', '200 image credits + 20 video credits. For active creators.', 15.00, 200, 20, 20),
  ('studio',  'Studio Pack',  '500 image credits + 60 video credits. Best value for studios.', 30.00, 500, 60, 30)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      price_usd = excluded.price_usd,
      image_credits = excluded.image_credits,
      video_credits = excluded.video_credits,
      sort_order = excluded.sort_order;

alter table public.credit_packs enable row level security;

drop policy if exists credit_packs_public_read on public.credit_packs;
create policy credit_packs_public_read on public.credit_packs
  for select
  using (is_active = true);

-- ------------------------------------------------------------
-- 3. Payment intents (idempotency + audit trail)
-- ------------------------------------------------------------

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pack_id text not null references public.credit_packs(id),
  amount_usd numeric(10,2) not null,
  image_credits integer not null,
  video_credits integer not null,
  provider text not null,
  provider_reference text unique,
  checkout_url text,
  status text not null default 'pending' check (status in ('pending','confirmed','failed','refunded')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists payment_intents_user_status_idx
  on public.payment_intents (user_id, status);

create index if not exists payment_intents_provider_reference_idx
  on public.payment_intents (provider_reference)
  where provider_reference is not null;

alter table public.payment_intents enable row level security;

drop policy if exists payment_intents_select_own on public.payment_intents;
create policy payment_intents_select_own on public.payment_intents
  for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies for client: writes happen via SECURITY DEFINER RPCs
-- (create_payment_intent, confirm_payment_intent, refund_payment_intent)

commit;

-- ============================================================
-- Verification
-- ============================================================
select id, name, price_usd, image_credits, video_credits, sort_order
from public.credit_packs
order by sort_order;
