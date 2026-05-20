-- ============================================================
-- THE ARCHIVE - Atomic credit spending
-- Run after business_access_hardening.sql.
--
-- This function spends the authenticated user's balance safely.
-- It locks the balance row, prevents overspending, and writes a
-- transaction record in one database operation.
-- ============================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

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
  v_current_video_credits integer;
  v_next_credits integer;
  v_next_video_credits integer;
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

  select b.credits, b.video_credits
    into v_current_credits, v_current_video_credits
  from public.user_credit_balances b
  where b.user_id = v_user_id
  for update;

  if not found then
    insert into public.user_credit_balances (user_id, credits, video_credits)
    values (v_user_id, 0, 0);
    v_current_credits := 0;
    v_current_video_credits := 0;
  end if;

  if p_generation_type = 'image' then
    if v_current_credits < p_amount then
      return query select false, v_current_credits, v_current_video_credits;
      return;
    end if;

    v_next_credits := v_current_credits - p_amount;
    v_next_video_credits := v_current_video_credits;

    update public.user_credit_balances
    set credits = v_next_credits,
        updated_at = now()
    where user_id = v_user_id;
  else
    if v_current_video_credits < p_amount then
      return query select false, v_current_credits, v_current_video_credits;
      return;
    end if;

    v_next_credits := v_current_credits;
    v_next_video_credits := v_current_video_credits - p_amount;

    update public.user_credit_balances
    set video_credits = v_next_video_credits,
        updated_at = now()
    where user_id = v_user_id;
  end if;

  insert into public.credit_transactions (
    user_id,
    amount,
    balance_after,
    credit_type,
    reason,
    metadata
  )
  values (
    v_user_id,
    -p_amount,
    case when p_generation_type = 'image' then v_next_credits else v_next_video_credits end,
    case when p_generation_type = 'image' then 'general' else 'video' end,
    'generation_spend',
    jsonb_build_object(
      'generation_type', p_generation_type,
      'model', p_model,
      'prompt_preview', left(coalesce(p_prompt, ''), 160)
    )
  );

  return query select true, v_next_credits, v_next_video_credits;
end;
$$;

grant execute on function public.spend_generation_credits(text, integer, text, text) to authenticated;

commit;

-- Verification
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'spend_generation_credits';

