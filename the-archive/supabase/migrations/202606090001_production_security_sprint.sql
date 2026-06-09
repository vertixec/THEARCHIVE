begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.generation_credit_operations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_id uuid references public.generations(id) on delete set null,
  generation_type text not null check (generation_type in ('image', 'video')),
  model text not null,
  tool text not null,
  amount integer not null check (amount > 0),
  from_monthly integer not null default 0 check (from_monthly >= 0),
  from_purchased integer not null default 0 check (from_purchased >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'refunded')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  refunded_at timestamptz,
  check (amount = from_monthly + from_purchased)
);

create index if not exists generation_credit_operations_user_created_idx
  on public.generation_credit_operations (user_id, created_at desc);

alter table public.generation_credit_operations enable row level security;

drop policy if exists "generation_operations_select_own" on public.generation_credit_operations;
create policy "generation_operations_select_own"
  on public.generation_credit_operations for select
  using (auth.uid() = user_id);

alter table public.generations
  add column if not exists credit_operation_id uuid references public.generation_credit_operations(id);

alter table public.generations enable row level security;

do $policies$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'generations'
  loop
    execute format('drop policy if exists %I on public.generations', v_policy.policyname);
  end loop;
end;
$policies$;

create policy "generations_select_own"
  on public.generations for select
  using (auth.uid() = user_id);

revoke insert, update, delete on public.generations from anon, authenticated;

create or replace function public.reserve_generation_credits(
  p_operation_id uuid,
  p_generation_type text,
  p_amount integer,
  p_model text,
  p_tool text,
  p_prompt text default null
)
returns table (
  ok boolean,
  credits integer,
  operation_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_balance public.user_credit_balances%rowtype;
  v_existing public.generation_credit_operations%rowtype;
  v_from_monthly integer;
  v_from_purchased integer;
  v_total integer;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_operation_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'invalid_operation';
  end if;
  if p_generation_type not in ('image', 'video') then
    raise exception 'invalid_generation_type';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;
  if not found or v_profile.status is distinct from 'active' then
    raise exception 'account_not_active';
  end if;

  select * into v_existing
  from public.generation_credit_operations
  where id = p_operation_id;

  if found then
    if v_existing.user_id <> v_user_id
      or v_existing.amount <> p_amount
      or v_existing.generation_type <> p_generation_type
    then
      raise exception 'operation_conflict';
    end if;
    select coalesce(b.credits, 0) + coalesce(b.monthly_credits, 0) into v_total
    from public.user_credit_balances b where b.user_id = v_user_id;
    return query select v_existing.status <> 'refunded', coalesce(v_total, 0), v_existing.id;
    return;
  end if;

  insert into public.user_credit_balances (user_id, credits, video_credits, monthly_credits)
  values (v_user_id, 0, 0, 0)
  on conflict (user_id) do nothing;

  select * into v_balance
  from public.user_credit_balances
  where user_id = v_user_id
  for update;

  v_total := coalesce(v_balance.credits, 0) + coalesce(v_balance.monthly_credits, 0);
  if v_total < p_amount then
    return query select false, v_total, p_operation_id;
    return;
  end if;

  v_from_monthly := least(coalesce(v_balance.monthly_credits, 0), p_amount);
  v_from_purchased := p_amount - v_from_monthly;

  update public.user_credit_balances b
  set monthly_credits = b.monthly_credits - v_from_monthly,
      credits = b.credits - v_from_purchased,
      updated_at = now()
  where b.user_id = v_user_id;

  insert into public.generation_credit_operations (
    id, user_id, generation_type, model, tool, amount,
    from_monthly, from_purchased, metadata
  )
  values (
    p_operation_id, v_user_id, p_generation_type, coalesce(p_model, 'unknown'),
    coalesce(p_tool, 'generate'), p_amount, v_from_monthly, v_from_purchased,
    jsonb_build_object('prompt_preview', left(coalesce(p_prompt, ''), 160))
  );

  insert into public.credit_transactions (
    user_id, amount, balance_after, credit_type, reason, metadata
  )
  values (
    v_user_id, -p_amount, v_total - p_amount,
    case when p_generation_type = 'video' then 'video' else 'general' end,
    'generation_spend',
    jsonb_build_object(
      'operation_id', p_operation_id,
      'generation_type', p_generation_type,
      'model', p_model,
      'tool', p_tool,
      'from_monthly', v_from_monthly,
      'from_purchased', v_from_purchased
    )
  );

  return query select true, v_total - p_amount, p_operation_id;
end;
$$;

create or replace function public.complete_generation_operation(
  p_operation_id uuid,
  p_generation_id uuid default null,
  p_actual_amount integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op public.generation_credit_operations%rowtype;
  v_actual integer;
  v_actual_monthly integer;
  v_actual_purchased integer;
  v_restore_monthly integer;
  v_restore_purchased integer;
  v_balance_after integer;
begin
  select * into v_op from public.generation_credit_operations where id = p_operation_id for update;
  if not found then return false; end if;
  if v_op.status = 'completed' then return true; end if;
  if v_op.status <> 'reserved' then return false; end if;

  v_actual := coalesce(p_actual_amount, v_op.amount);
  if v_actual <= 0 or v_actual > v_op.amount then
    raise exception 'invalid_actual_amount';
  end if;

  v_actual_monthly := least(v_op.from_monthly, v_actual);
  v_actual_purchased := v_actual - v_actual_monthly;
  v_restore_monthly := v_op.from_monthly - v_actual_monthly;
  v_restore_purchased := v_op.from_purchased - v_actual_purchased;

  if v_restore_monthly > 0 or v_restore_purchased > 0 then
    update public.user_credit_balances
    set monthly_credits = monthly_credits + v_restore_monthly,
        credits = credits + v_restore_purchased,
        updated_at = now()
    where user_id = v_op.user_id
    returning credits + monthly_credits into v_balance_after;

    insert into public.credit_transactions (
      user_id, amount, balance_after, credit_type, reason, metadata
    )
    values (
      v_op.user_id, v_restore_monthly + v_restore_purchased, v_balance_after,
      case when v_op.generation_type = 'video' then 'video' else 'general' end,
      'refund',
      jsonb_build_object('operation_id', v_op.id, 'kind', 'partial_completion')
    );
  end if;

  update public.generation_credit_operations
  set status = 'completed',
      amount = v_actual,
      from_monthly = v_actual_monthly,
      from_purchased = v_actual_purchased,
      generation_id = coalesce(p_generation_id, generation_id),
      completed_at = now()
  where id = v_op.id;

  return true;
end;
$$;

create or replace function public.refund_generation_operation(
  p_operation_id uuid,
  p_reason text default 'generation_failed'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op public.generation_credit_operations%rowtype;
  v_balance_after integer;
begin
  select * into v_op from public.generation_credit_operations where id = p_operation_id for update;
  if not found then return false; end if;
  if v_op.status = 'refunded' then return true; end if;
  if v_op.status <> 'reserved' then return false; end if;

  update public.user_credit_balances
  set monthly_credits = monthly_credits + v_op.from_monthly,
      credits = credits + v_op.from_purchased,
      updated_at = now()
  where user_id = v_op.user_id
  returning credits + monthly_credits into v_balance_after;

  update public.generation_credit_operations
  set status = 'refunded',
      refunded_at = now(),
      metadata = metadata || jsonb_build_object('refund_reason', p_reason)
  where id = v_op.id;

  insert into public.credit_transactions (
    user_id, amount, balance_after, credit_type, reason, metadata
  )
  values (
    v_op.user_id, v_op.amount, v_balance_after,
    case when v_op.generation_type = 'video' then 'video' else 'general' end,
    'refund',
    jsonb_build_object('operation_id', v_op.id, 'kind', p_reason)
  );

  return true;
end;
$$;

create or replace function public.set_generation_saved(
  p_generation_id uuid,
  p_is_saved boolean
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.generations
  set is_saved = p_is_saved
  where id = p_generation_id and user_id = auth.uid()
  returning true;
$$;

create table if not exists public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, bucket)
);

alter table public.api_rate_limits enable row level security;

create or replace function public.consume_api_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.api_rate_limits%rowtype;
  v_now timestamptz := now();
begin
  if v_user_id is null then raise exception 'not_authenticated'; end if;
  if p_limit <= 0 or p_window_seconds <= 0 then raise exception 'invalid_rate_limit'; end if;
  if not (
    (p_bucket = 'generate' and p_limit = 10 and p_window_seconds = 60)
    or (p_bucket = 'tool:style-transfer' and p_limit = 5 and p_window_seconds = 600)
    or (p_bucket = 'tool:ads' and p_limit = 2 and p_window_seconds = 600)
    or (p_bucket = 'upload-reference' and p_limit = 20 and p_window_seconds = 600)
  ) then
    raise exception 'invalid_rate_limit_bucket';
  end if;

  insert into public.api_rate_limits (user_id, bucket, window_started_at, request_count)
  values (v_user_id, p_bucket, v_now, 0)
  on conflict (user_id, bucket) do nothing;

  select * into v_row from public.api_rate_limits
  where user_id = v_user_id and bucket = p_bucket for update;

  if v_row.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    update public.api_rate_limits
    set window_started_at = v_now, request_count = 1
    where user_id = v_user_id and bucket = p_bucket;
    return query select true, 0;
  elsif v_row.request_count >= p_limit then
    return query select false, greatest(1, ceil(extract(epoch from (v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now)))::integer);
  else
    update public.api_rate_limits set request_count = request_count + 1
    where user_id = v_user_id and bucket = p_bucket;
    return query select true, 0;
  end if;
end;
$$;

revoke all on public.generation_credit_operations from public, anon, authenticated;
grant select on public.generation_credit_operations to authenticated;
revoke all on public.api_rate_limits from public, anon, authenticated;

revoke execute on function public.reserve_generation_credits(uuid, text, integer, text, text, text) from public, anon;
grant execute on function public.reserve_generation_credits(uuid, text, integer, text, text, text) to authenticated;

revoke execute on function public.complete_generation_operation(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.refund_generation_operation(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_generation_operation(uuid, uuid, integer) to service_role;
grant execute on function public.refund_generation_operation(uuid, text) to service_role;

revoke execute on function public.set_generation_saved(uuid, boolean) from public, anon;
grant execute on function public.set_generation_saved(uuid, boolean) to authenticated;

revoke execute on function public.consume_api_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to authenticated;

do $revoke$
begin
  if to_regprocedure('public.spend_generation_credits(text,integer,text,text)') is not null then
    execute 'revoke execute on function public.spend_generation_credits(text, integer, text, text) from public, anon, authenticated';
  end if;

  if to_regprocedure('public.refund_generation_credits(text,integer,text,uuid)') is not null then
    execute 'revoke execute on function public.refund_generation_credits(text, integer, text, uuid) from public, anon, authenticated';
  end if;
end;
$revoke$;

commit;
