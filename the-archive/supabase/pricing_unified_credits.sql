-- ============================================================
-- THE ARCHIVE - Unified credit pool + per-model pricing
-- ============================================================
-- WHY: the old pricing lost money. Root causes fixed here:
--   1. gpt-image-2 ran at HIGH quality (~$0.211/img) for 1 flat credit.
--      (Fixed in app code: lib/falGenerate.ts now forces quality='medium'.)
--   2. Every model cost the same credits, so users could pick the most
--      expensive model for the price of the cheapest. Now cost is PER MODEL
--      (see lib/business.ts MODEL_CREDIT_COSTS) and the app passes the exact
--      amount to spend_generation_credits(p_amount).
--   3. Two confusing pools (image/video). Now ONE unified `credits` pool.
--      `video_credits` is kept as a zeroed legacy column (not dropped, so this
--      is reversible) — all spending and granting flow through `credits`.
--
-- New retail model: ~$0.02 per credit, model costs ≈ 4.5x FAL compute cost.
--   gpt-image-2(med)=12  flux-pro=10  nano-banana-pro=35  kling-1.6=65  seedance=275
--   Packs: Starter $5 / 250 cr · Creator $15 / 800 cr · Studio $30 / 1700 cr
--
-- HOW TO APPLY: review, then run ONCE in Supabase → SQL Editor (or via MCP
-- apply_migration). The whole file is safe to re-run: the only non-idempotent
-- step (balance revaluation) is guarded by public._pricing_migrations.
--
-- ⚠️ DEPLOY ORDER: apply THIS migration BEFORE deploying the matching app code,
-- or the app will briefly charge from the wrong pool.
-- ============================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ------------------------------------------------------------
-- 0. Migration guard (makes the one-time data steps re-runnable)
-- ------------------------------------------------------------

create table if not exists public._pricing_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 1. generations.credit_cost — persist what we charged, so the async
--    status poller can refund the EXACT amount (cost now varies by model).
-- ------------------------------------------------------------

alter table public.generations
  add column if not exists credit_cost integer;

-- ------------------------------------------------------------
-- 2. Reprice credit packs to the unified single-pool model.
--    image_credits now carries the FULL credit amount; video_credits = 0.
--    (Idempotent: ON CONFLICT updates in place.)
-- ------------------------------------------------------------

insert into public.credit_packs (id, name, description, price_usd, image_credits, video_credits, sort_order)
values
  ('starter', 'Starter Pack', '250 credits. ~20 images or a few clips. Credits never expire.', 5.00, 250, 0, 10),
  ('creator', 'Creator Pack', '800 credits. For active creators. Credits never expire.', 15.00, 800, 0, 20),
  ('studio',  'Studio Pack',  '1700 credits. Best value for studios. Credits never expire.', 30.00, 1700, 0, 30)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      price_usd = excluded.price_usd,
      image_credits = excluded.image_credits,
      video_credits = excluded.video_credits,
      sort_order = excluded.sort_order;

-- ------------------------------------------------------------
-- 3. Plans: free tier signup credits -> 60 (≈5 medium images).
--    Only updates if a `plans` table with these columns exists.
-- ------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'plans' and column_name = 'signup_credits'
  ) then
    update public.plans set signup_credits = 60 where access_tier = 'free';
  end if;
end$$;

-- ------------------------------------------------------------
-- 4. spend_generation_credits — single unified `credits` pool.
--    Signature unchanged so app code keeps working. p_amount is the
--    per-model cost computed in the app (creditCostForModel).
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
  v_current_credits integer;
  v_next_credits integer;
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

  select b.credits into v_current_credits
  from public.user_credit_balances b
  where b.user_id = v_user_id
  for update;

  if not found then
    insert into public.user_credit_balances (user_id, credits, video_credits)
    values (v_user_id, 0, 0);
    v_current_credits := 0;
  end if;

  if v_current_credits < p_amount then
    return query select false, v_current_credits, 0;
    return;
  end if;

  v_next_credits := v_current_credits - p_amount;

  update public.user_credit_balances
  set credits = v_next_credits,
      updated_at = now()
  where user_id = v_user_id;

  insert into public.credit_transactions (
    user_id, amount, balance_after, credit_type, reason, metadata
  )
  values (
    v_user_id,
    -p_amount,
    v_next_credits,
    -- Keep an informational label of what kind of generation it was.
    case when p_generation_type = 'image' then 'general' else 'video' end,
    'generation_spend',
    jsonb_build_object(
      'generation_type', p_generation_type,
      'model', p_model,
      'prompt_preview', left(coalesce(p_prompt, ''), 160)
    )
  );

  return query select true, v_next_credits, 0;
end;
$$;

grant execute on function public.spend_generation_credits(text, integer, text, text) to authenticated;

-- ------------------------------------------------------------
-- 5. refund_generation_credits — refund to the unified pool.
--    Keeps the security_hardening signature (p_user_id, service_role only).
-- ------------------------------------------------------------

create or replace function public.refund_generation_credits(
  p_generation_type text,
  p_amount integer,
  p_reason text default 'fal_failure',
  p_user_id uuid default null
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
  v_user_id uuid := coalesce(p_user_id, auth.uid());
  v_next_credits integer;
begin
  if v_user_id is null then
    return query select false, 0, 0;
    return;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'p_amount_must_be_positive';
  end if;
  if p_generation_type not in ('image', 'video') then
    raise exception 'invalid_generation_type: %', p_generation_type;
  end if;

  insert into public.user_credit_balances (user_id, credits, video_credits)
  values (v_user_id, 0, 0)
  on conflict (user_id) do nothing;

  update public.user_credit_balances
  set credits = credits + p_amount,
      updated_at = now()
  where user_id = v_user_id
  returning credits into v_next_credits;

  insert into public.credit_transactions (
    user_id, amount, balance_after, credit_type, reason, metadata
  )
  values (
    v_user_id,
    p_amount,
    v_next_credits,
    case when p_generation_type = 'image' then 'general' else 'video' end,
    'refund',
    jsonb_build_object('generation_type', p_generation_type, 'kind', p_reason)
  );

  return query select true, v_next_credits, 0;
end;
$$;

revoke execute on function public.refund_generation_credits(text, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.refund_generation_credits(text, integer, text, uuid) to service_role;

-- ------------------------------------------------------------
-- 6. confirm_payment_intent — grant the pack's credits into the unified pool.
--    Grants (image_credits + video_credits) so legacy intents still settle.
-- ------------------------------------------------------------

create or replace function public.confirm_payment_intent(
  p_intent_id uuid,
  p_provider_reference text,
  p_payload jsonb default '{}'::jsonb
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
  v_intent public.payment_intents%rowtype;
  v_balance public.user_credit_balances%rowtype;
  v_grant integer;
  v_next_credits integer;
begin
  select * into v_intent
  from public.payment_intents
  where id = p_intent_id
  for update;

  if not found then
    raise exception 'intent_not_found: %', p_intent_id;
  end if;

  if v_intent.status = 'confirmed' then
    select * into v_balance
    from public.user_credit_balances
    where user_id = v_intent.user_id;
    return query select true, coalesce(v_balance.credits, 0), 0;
    return;
  end if;

  if v_intent.status <> 'pending' then
    raise exception 'intent_not_pending: status=%', v_intent.status;
  end if;

  select * into v_balance
  from public.user_credit_balances
  where user_id = v_intent.user_id
  for update;

  if not found then
    insert into public.user_credit_balances (user_id, credits, video_credits)
    values (v_intent.user_id, 0, 0)
    returning * into v_balance;
  end if;

  v_grant := coalesce(v_intent.image_credits, 0) + coalesce(v_intent.video_credits, 0);
  v_next_credits := v_balance.credits + v_grant;

  update public.user_credit_balances
  set credits = v_next_credits,
      updated_at = now()
  where user_id = v_intent.user_id;

  update public.payment_intents
  set status = 'confirmed',
      provider_reference = p_provider_reference,
      metadata = p_payload,
      confirmed_at = now()
  where id = p_intent_id;

  insert into public.credit_transactions (
    user_id, amount, balance_after, credit_type, reason,
    payment_provider, payment_reference, metadata
  )
  values (
    v_intent.user_id, v_grant, v_next_credits, 'general', 'purchase',
    'lemonsqueezy', p_provider_reference,
    jsonb_build_object('pack_id', v_intent.pack_id, 'intent_id', v_intent.id)
  );

  return query select true, v_next_credits, 0;
end;
$$;

revoke execute on function public.confirm_payment_intent(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_payment_intent(uuid, text, jsonb) to service_role;

-- ------------------------------------------------------------
-- 7. refund_payment_intent — claw back the granted credits from the pool.
-- ------------------------------------------------------------

create or replace function public.refund_payment_intent(
  p_provider_reference text,
  p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.payment_intents%rowtype;
  v_balance public.user_credit_balances%rowtype;
  v_grant integer;
  v_next_credits integer;
begin
  select * into v_intent
  from public.payment_intents
  where provider_reference = p_provider_reference
  for update;

  if not found then
    return false;
  end if;

  if v_intent.status = 'refunded' then
    return true;
  end if;

  if v_intent.status <> 'confirmed' then
    raise exception 'cannot_refund_non_confirmed: status=%', v_intent.status;
  end if;

  select * into v_balance
  from public.user_credit_balances
  where user_id = v_intent.user_id
  for update;

  v_grant := coalesce(v_intent.image_credits, 0) + coalesce(v_intent.video_credits, 0);
  v_next_credits := greatest(0, coalesce(v_balance.credits, 0) - v_grant);

  update public.user_credit_balances
  set credits = v_next_credits,
      updated_at = now()
  where user_id = v_intent.user_id;

  update public.payment_intents
  set status = 'refunded',
      metadata = v_intent.metadata || p_payload
  where id = v_intent.id;

  insert into public.credit_transactions (
    user_id, amount, balance_after, credit_type, reason,
    payment_provider, payment_reference, metadata
  )
  values (
    v_intent.user_id, -v_grant, v_next_credits, 'general', 'refund',
    'lemonsqueezy', p_provider_reference,
    jsonb_build_object('pack_id', v_intent.pack_id, 'intent_id', v_intent.id, 'kind', 'purchase_refund')
  );

  return true;
end;
$$;

revoke execute on function public.refund_payment_intent(text, jsonb) from public, anon, authenticated;
grant execute on function public.refund_payment_intent(text, jsonb) to service_role;

-- ------------------------------------------------------------
-- 8. ONE-TIME balance revaluation (guarded — runs at most once).
--    Old credits were worth more $ each (image≈$0.10, video bundled), and
--    the new scale uses much larger per-action numbers. Convert existing
--    balances so nobody loses value, then fold video_credits into the pool:
--        new credits = old image credits ×5  +  old video credits ×15
--    Multipliers are intentionally generous. Adjust BEFORE running if you
--    have meaningful real balances. After this, video_credits = 0 everywhere.
-- ------------------------------------------------------------

do $$
begin
  if not exists (select 1 from public._pricing_migrations where id = 'unified_credits_revaluation_v1') then
    update public.user_credit_balances
    set credits = (coalesce(credits, 0) * 5) + (coalesce(video_credits, 0) * 15),
        video_credits = 0,
        updated_at = now();

    insert into public._pricing_migrations (id) values ('unified_credits_revaluation_v1');
  end if;
end$$;

commit;

-- ============================================================
-- Verification
-- ============================================================
select id, name, price_usd, image_credits, video_credits, sort_order
from public.credit_packs
order by sort_order;

select id, applied_at from public._pricing_migrations order by applied_at;
