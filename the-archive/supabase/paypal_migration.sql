-- ============================================================
-- THE ARCHIVE - PayPal migration
-- Switches the billing provider from Lemon Squeezy to PayPal.
--   1. create_payment_intent  -> provider = 'paypal'
--   2. confirm_payment_intent  -> stamp transactions with the intent's own
--                                 provider (no more hardcoded 'lemonsqueezy')
--   3. refund_payment_intent   -> same provider-agnostic fix
-- Credit math is UNCHANGED. Existing lemonsqueezy intents keep their provider
-- value because confirm/refund now read it from the row.
-- Safe to re-run (CREATE OR REPLACE).
-- ============================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ------------------------------------------------------------
-- 1. create_payment_intent  (provider 'lemonsqueezy' -> 'paypal')
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
    'paypal', 'pending'
  )
  returning id into v_intent_id;

  return query
  select v_intent_id, v_pack.price_usd, v_pack.image_credits, v_pack.video_credits;
end;
$$;

grant execute on function public.create_payment_intent(text) to authenticated;

-- ------------------------------------------------------------
-- 2. confirm_payment_intent  (use v_intent.provider, not a literal)
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
      v_intent.provider, p_provider_reference,
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
      v_intent.provider, p_provider_reference,
      jsonb_build_object('pack_id', v_intent.pack_id, 'intent_id', v_intent.id, 'bucket', 'video')
    );
  end if;

  return query select true, v_next_credits, v_next_video_credits;
end;
$$;

-- ------------------------------------------------------------
-- 3. refund_payment_intent  (use v_intent.provider, not a literal)
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
      v_intent.provider, p_provider_reference,
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
      v_intent.provider, p_provider_reference,
      jsonb_build_object('pack_id', v_intent.pack_id, 'intent_id', v_intent.id, 'bucket', 'video', 'kind', 'purchase_refund')
    );
  end if;

  return true;
end;
$$;

commit;

-- ============================================================
-- Verification
-- ============================================================
select id, provider, status from public.payment_intents order by created_at desc limit 5;
