begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

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

revoke execute on function public.reserve_generation_credits(uuid, text, integer, text, text, text)
  from public, anon;
grant execute on function public.reserve_generation_credits(uuid, text, integer, text, text, text)
  to authenticated;

commit;
