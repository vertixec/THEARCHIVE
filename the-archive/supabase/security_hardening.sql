-- ============================================================
-- THE ARCHIVE - Security hardening
-- Cierra dos huecos de RLS detectados en la auditoría:
--   C1. Escalada de privilegios en profiles (UPDATE sin restricción
--       de columnas: un usuario podía cambiarse role/access_tier/status).
--   C2. Bypass del límite mensual en user_generation_usage
--       (policy FOR ALL permitía resetear los contadores desde el cliente).
--
-- Ejecutar en Supabase → SQL Editor. Idempotente.
-- ============================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ------------------------------------------------------------
-- C1. profiles: bloquear cambios a columnas sensibles desde el
--     cliente (authenticated/anon). service_role y SQL admin
--     (dashboard) siguen pudiendo modificarlas.
--
-- Estrategia: trigger BEFORE UPDATE que revierte cualquier intento
-- de tocar columnas protegidas cuando el llamador es un cliente.
-- Es más robusto que enumerar grants por columna y no rompe los
-- updates legítimos (full_name, username, avatar_url, is_public…).
-- ------------------------------------------------------------

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo restringimos a clientes finales. service_role / postgres /
  -- migraciones del dashboard (auth.role() null) pasan sin cambios.
  if auth.role() in ('authenticated', 'anon') then
    new.role               := old.role;
    new.status             := old.status;
    new.access_tier        := old.access_tier;
    new.plan_id            := old.plan_id;
    new.email              := old.email;
    new.payment_customer_id := old.payment_customer_id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_columns on public.profiles;

-- Corre ANTES del trigger touch_updated_at; el orden alfabético
-- ('p' < 't') ya lo garantiza en Postgres.
create trigger profiles_protect_columns
  before update on public.profiles
  for each row
  execute function public.protect_profile_columns();

-- Reafirmar la policy de UPDATE con WITH CHECK explícito para que
-- tampoco se pueda reasignar la fila a otro id.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ------------------------------------------------------------
-- C2. user_generation_usage: solo-lectura desde el cliente.
--     El incremento pasa a una RPC security definer.
-- ------------------------------------------------------------

drop policy if exists "users see own usage" on public.user_generation_usage;
create policy "usage_select_own" on public.user_generation_usage
  for select
  using (user_id = auth.uid());
-- (sin policies de insert/update/delete: las escrituras van por RPC)

create or replace function public.increment_generation_usage(
  p_generation_type text,
  p_amount integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_year_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if p_generation_type not in ('image', 'video') then
    raise exception 'invalid generation type: %', p_generation_type;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'p_amount must be positive';
  end if;

  insert into public.user_generation_usage (user_id, year_month, image_count, video_count)
  values (
    v_user_id,
    v_year_month,
    case when p_generation_type = 'image' then p_amount else 0 end,
    case when p_generation_type = 'video' then p_amount else 0 end
  )
  on conflict (user_id, year_month) do update set
    image_count = public.user_generation_usage.image_count
      + (case when p_generation_type = 'image' then p_amount else 0 end),
    video_count = public.user_generation_usage.video_count
      + (case when p_generation_type = 'video' then p_amount else 0 end);
end;
$$;

grant execute on function public.increment_generation_usage(text, integer) to authenticated;
revoke execute on function public.increment_generation_usage(text, integer) from anon, public;

-- ------------------------------------------------------------
-- C3. RPCs sensibles: cerrar EXECUTE para clientes.
--
-- Postgres concede EXECUTE a PUBLIC por defecto, así que pese a los
-- comentarios "solo service_role" en billing_rpcs.sql, estas funciones
-- eran invocables por usuarios autenticados:
--   - confirm_payment_intent  -> confirmar un pago SIN pagar (créditos gratis)
--   - refund_payment_intent   -> idem inverso
--   - refund_generation_credits -> SUMA créditos -> acuñar créditos ilimitados
-- ------------------------------------------------------------

revoke execute on function public.confirm_payment_intent(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.refund_payment_intent(text, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_payment_intent(uuid, text, jsonb) to service_role;
grant execute on function public.refund_payment_intent(text, jsonb) to service_role;

-- create/update payment intent: solo authenticated (el route de checkout las
-- llama como el usuario); fuera anon/public.
revoke execute on function public.create_payment_intent(text) from anon, public;
revoke execute on function public.update_payment_intent_url(uuid, text) from anon, public;

-- La trigger-function no necesita EXECUTE para nadie.
revoke execute on function public.protect_profile_columns() from public, anon, authenticated;

-- refund_generation_credits: rediseñada para recibir p_user_id y ejecutarse
-- SOLO desde el servidor (service_role). El route /api/generate la invoca con
-- el cliente admin pasando user.id.
drop function if exists public.refund_generation_credits(text, integer, text);

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
    set credits = v_next_credits, updated_at = now()
    where user_id = v_user_id;
  else
    v_next_credits := v_balance.credits;
    v_next_video_credits := v_balance.video_credits + p_amount;
    update public.user_credit_balances
    set video_credits = v_next_video_credits, updated_at = now()
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

revoke execute on function public.refund_generation_credits(text, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.refund_generation_credits(text, integer, text, uuid) to service_role;

commit;

-- ============================================================
-- Verificación
-- ============================================================
select tgname
from pg_trigger
where tgrelid = 'public.profiles'::regclass
  and not tgisinternal;

select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'user_generation_usage')
order by tablename, policyname;
