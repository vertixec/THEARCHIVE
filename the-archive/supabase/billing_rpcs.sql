-- ============================================================
-- THE ARCHIVE - Billing RPCs
-- Atomic, idempotent functions for purchase lifecycle:
--   - create_payment_intent      (called by /api/billing/checkout)
--   - update_payment_intent_url  (called by /api/billing/checkout after LS createCheckout)
--   - confirm_payment_intent     (called by /api/billing/webhook on order_created)
--   - refund_payment_intent      (called by /api/billing/webhook on order_refunded)
--   - refund_generation_credits  (called by /api/generate on FAL failure)
-- All run as SECURITY DEFINER with explicit search_path.
-- Already applied to the live project via MCP apply_migration.
-- Kept here for repository history. Safe to re-run (CREATE OR REPLACE).
-- ============================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ------------------------------------------------------------
-- 1. create_payment_intent
-- ------------------------------------------------------------

create or replace function public.create_payment_intent(
  p_pack_id text
)
returns table (
  intent_id uuid,
  amount_usd numeric,
  image_credits integer,
  video_credits integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_pack public.credit_packs%rowtype;
  v_intent_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_pack
  from public.credit_packs
  where id = p_pack_id and is_active = true;

  if not found then
    raise exception 'pack_not_found_or_inactive';
  end if;

  insert into public.payment_intents (
    user_id, pack_id, amount_usd, image_credits, video_credits,
    provider, status
  )
  values (
    v_user_id, v_pack.id, v_pack.price_usd, v_pack.image_credits, v_pack.video_credits,
    'lemonsqueezy', 'pending'
  )
  returning id into v_intent_id;

  return query
  select v_intent_id, v_pack.price_usd, v_pack.image_credits, v_pack.video_credits;
end;
$$;

grant execute on function public.create_payment_intent(text) to authenticated;

-- ------------------------------------------------------------
-- 2. update_payment_intent_url
-- ------------------------------------------------------------

create or replace function public.update_payment_intent_url(
  p_intent_id uuid,
  p_checkout_url text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  update public.payment_intents
  set checkout_url = p_checkout_url
  where id = p_intent_id
    and user_id = v_user_id
    and status = 'pending';

  return found;
end;
$$;

grant execute on function public.update_payment_intent_url(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 3. confirm_payment_intent (idempotent — the critical one)
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
  v_next_credits integer;
  v_next_video_credits integer;
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

    return query
    select true,
           coalesce(v_balance.credits, 0),
           coalesce(v_balance.video_credits, 0);
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

  v_next_credits := v_balance.credits + v_intent.image_credits;
  v_next_video_credits := v_balance.video_credits + v_intent.video_credits;

  update public.user_credit_balances
  set credits = v_next_credits,
      video_credits = v_next_video_credits,
      updated_at = now()
  where user_id = v_intent.user_id;

  update public.payment_intents
  set status = 'confirmed',
      provider_reference = p_provider_reference,
      metadata = p_payload,
      confirmed_at = now()
  where id = p_intent_id;

  if v_intent.image_credits > 0 then
    insert into public.credit_transactions (
      user_id, amount, balance_after, credit_type, reason,
      payment_provider, payment_reference, metadata
    )
    values (
      v_intent.user_id, v_intent.image_credits, v_next_credits, 'general', 'purchase',
      'lemonsqueezy', p_provider_reference,
      jsonb_build_object('pack_id', v_intent.pack_id, 'intent_id', v_intent.id, 'bucket', 'image')
    );
  end if;

  if v_intent.video_credits > 0 then
    insert into public.credit_transactions (
      user_id, amount, balance_after, credit_type, reason,
      payment_provider, payment_reference, metadata
    )
    values (
      v_intent.user_id, v_intent.video_credits, v_next_video_credits, 'video', 'purchase',
      'lemonsqueezy', p_provider_reference,
      jsonb_build_object('pack_id', v_intent.pack_id, 'intent_id', v_intent.id, 'bucket', 'video')
    );
  end if;

  return query select true, v_next_credits, v_next_video_credits;
end;
$$;

-- No grant to authenticated: only service_role calls this (from webhook).

-- ------------------------------------------------------------
-- 4. refund_payment_intent (idempotent)
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
  v_next_credits integer;
  v_next_video_credits integer;
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

  v_next_credits := greatest(0, coalesce(v_balance.credits, 0) - v_intent.image_credits);
  v_next_video_credits := greatest(0, coalesce(v_balance.video_credits, 0) - v_intent.video_credits);

  update public.user_credit_balances
  set credits = v_next_credits,
      video_credits = v_next_video_credits,
      updated_at = now()
  where user_id = v_intent.user_id;

  update public.payment_intents
  set status = 'refunded',
      metadata = v_intent.metadata || p_payload
  where id = v_intent.id;

  if v_intent.image_credits > 0 then
    insert into public.credit_transactions (
      user_id, amount, balance_after, credit_type, reason,
      payment_provider, payment_reference, metadata
    )
    values (
      v_intent.user_id, -v_intent.image_credits, v_next_credits, 'general', 'refund',
      'lemonsqueezy', p_provider_reference,
      jsonb_build_object('pack_id', v_intent.pack_id, 'intent_id', v_intent.id, 'bucket', 'image', 'kind', 'purchase_refund')
    );
  end if;

  if v_intent.video_credits > 0 then
    insert into public.credit_transactions (
      user_id, amount, balance_after, credit_type, reason,
      payment_provider, payment_reference, metadata
    )
    values (
      v_intent.user_id, -v_intent.video_credits, v_next_video_credits, 'video', 'refund',
      'lemonsqueezy', p_provider_reference,
      jsonb_build_object('pack_id', v_intent.pack_id, 'intent_id', v_intent.id, 'bucket', 'video', 'kind', 'purchase_refund')
    );
  end if;

  return true;
end;
$$;

-- ------------------------------------------------------------
-- 5. refund_generation_credits
-- ------------------------------------------------------------

create or replace function public.refund_generation_credits(
  p_generation_type text,
  p_amount integer,
  p_reason text default 'fal_failure'
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
  v_balance public.user_credit_balances%rowtype;
  v_next_credits integer;
  v_next_video_credits integer;
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

  select * into v_balance
  from public.user_credit_balances
  where user_id = v_user_id
  for update;

  if not found then
    insert into public.user_credit_balances (user_id, credits, video_credits)
    values (v_user_id, 0, 0)
    returning * into v_balance;
  end if;

  if p_generation_type = 'image' then
    v_next_credits := v_balance.credits + p_amount;
    v_next_video_credits := v_balance.video_credits;

    update public.user_credit_balances
    set credits = v_next_credits,
        updated_at = now()
    where user_id = v_user_id;
  else
    v_next_credits := v_balance.credits;
    v_next_video_credits := v_balance.video_credits + p_amount;

    update public.user_credit_balances
    set video_credits = v_next_video_credits,
        updated_at = now()
    where user_id = v_user_id;
  end if;

  insert into public.credit_transactions (
    user_id, amount, balance_after, credit_type, reason, metadata
  )
  values (
    v_user_id,
    p_amount,
    case when p_generation_type = 'image' then v_next_credits else v_next_video_credits end,
    case when p_generation_type = 'image' then 'general' else 'video' end,
    'refund',
    jsonb_build_object('generation_type', p_generation_type, 'kind', p_reason)
  );

  return query select true, v_next_credits, v_next_video_credits;
end;
$$;

grant execute on function public.refund_generation_credits(text, integer, text) to authenticated;

commit;

-- ============================================================
-- Verification
-- ============================================================
select routine_name from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'create_payment_intent',
    'update_payment_intent_url',
    'confirm_payment_intent',
    'refund_payment_intent',
    'refund_generation_credits'
  )
order by routine_name;
