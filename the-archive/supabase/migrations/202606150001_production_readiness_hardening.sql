begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.community_membership_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  source text not null check (source in ('manual', 'webhook')),
  action text not null check (action in ('grant', 'revoke')),
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  target_email text,
  previous_access_tier text,
  next_access_tier text,
  previous_status text,
  next_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.community_membership_audit enable row level security;

drop policy if exists "community_membership_audit_select_admin" on public.community_membership_audit;
create policy "community_membership_audit_select_admin"
  on public.community_membership_audit
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
    )
  );

create index if not exists community_membership_audit_target_created_idx
  on public.community_membership_audit (target_user_id, created_at desc);

create index if not exists credit_transactions_user_id_idx
  on public.credit_transactions (user_id);

create index if not exists payment_intents_pack_id_idx
  on public.payment_intents (pack_id);

drop policy if exists "_pricing_migrations_no_client_access" on public._pricing_migrations;
create policy "_pricing_migrations_no_client_access"
  on public._pricing_migrations
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "api_rate_limits_no_client_access" on public.api_rate_limits;
create policy "api_rate_limits_no_client_access"
  on public.api_rate_limits
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "Public Access" on public.prompts;
drop policy if exists "Allow public read access on workflows" on public.workflows;
drop policy if exists "Authenticated users can view community_visuals" on public.community_visuals;
drop policy if exists "Authenticated users can view functional_prompts" on public.functional_prompts;

drop policy if exists "Solo miembros activos pueden acceder" on public.profiles;
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "profiles_select_visible" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_visible"
  on public.profiles
  for select
  to anon, authenticated
  using (((select auth.uid()) = id) or (is_public = true));

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "boards_select_own" on public.boards;
drop policy if exists "boards_insert_own" on public.boards;
drop policy if exists "boards_update_own" on public.boards;
drop policy if exists "boards_delete_own" on public.boards;

create policy "boards_select_own"
  on public.boards
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "boards_insert_own"
  on public.boards
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "boards_update_own"
  on public.boards
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "boards_delete_own"
  on public.boards
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "board_items_select_own" on public.board_items;
drop policy if exists "board_items_insert_own" on public.board_items;
drop policy if exists "board_items_delete_own" on public.board_items;

create policy "board_items_select_own"
  on public.board_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.boards b
      where b.id = board_items.board_id
        and b.user_id = (select auth.uid())
    )
  );

create policy "board_items_insert_own"
  on public.board_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.boards b
      where b.id = board_items.board_id
        and b.user_id = (select auth.uid())
    )
  );

create policy "board_items_delete_own"
  on public.board_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.boards b
      where b.id = board_items.board_id
        and b.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can view their own likes" on public.user_likes;
drop policy if exists "Users can insert their own likes" on public.user_likes;
drop policy if exists "Users can delete their own likes" on public.user_likes;
drop policy if exists "user_likes_select_own" on public.user_likes;
drop policy if exists "user_likes_insert_own" on public.user_likes;
drop policy if exists "user_likes_delete_own" on public.user_likes;

create policy "user_likes_select_own"
  on public.user_likes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_likes_insert_own"
  on public.user_likes
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "user_likes_delete_own"
  on public.user_likes
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "prompts_select_tier_access" on public.prompts;
drop policy if exists "functional_prompts_select_tier_access" on public.functional_prompts;
drop policy if exists "community_visuals_select_tier_access" on public.community_visuals;
drop policy if exists "workflows_select_tier_access" on public.workflows;
drop policy if exists "community_drops_select_active_members" on public.community_drops;

create policy "prompts_select_tier_access"
  on public.prompts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.status = 'active'
        and (p.role = 'admin' or p.access_tier in ('free', 'community', 'pro'))
    )
  );

create policy "functional_prompts_select_tier_access"
  on public.functional_prompts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.status = 'active'
        and (p.role = 'admin' or p.access_tier in ('free', 'community', 'pro'))
    )
  );

create policy "community_visuals_select_tier_access"
  on public.community_visuals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.status = 'active'
        and (p.role = 'admin' or p.access_tier = 'community')
    )
  );

create policy "workflows_select_tier_access"
  on public.workflows
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.status = 'active'
        and (p.role = 'admin' or p.access_tier in ('community', 'pro'))
    )
  );

create policy "community_drops_select_tier_access"
  on public.community_drops
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.status = 'active'
        and (p.role = 'admin' or p.access_tier = 'community')
    )
  );

drop policy if exists "plans_select_authenticated" on public.plans;
drop policy if exists "plans_select_public" on public.plans;
create policy "plans_select_public"
  on public.plans
  for select
  to anon, authenticated
  using (
    is_public = true
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
    )
  );

drop policy if exists "credit_balances_select_own" on public.user_credit_balances;
create policy "credit_balances_select_own"
  on public.user_credit_balances
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "credit_transactions_select_own" on public.credit_transactions;
create policy "credit_transactions_select_own"
  on public.credit_transactions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "payment_intents_select_own" on public.payment_intents;
create policy "payment_intents_select_own"
  on public.payment_intents
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "usage_select_own" on public.user_generation_usage;
create policy "usage_select_own"
  on public.user_generation_usage
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "generations_select_own" on public.generations;
create policy "generations_select_own"
  on public.generations
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "generation_operations_select_own" on public.generation_credit_operations;
create policy "generation_operations_select_own"
  on public.generation_credit_operations
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.server_consume_api_rate_limit(
  p_user_id uuid,
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
  v_row public.api_rate_limits%rowtype;
  v_now timestamptz := now();
begin
  if p_user_id is null then raise exception 'not_authenticated'; end if;
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
  values (p_user_id, p_bucket, v_now, 0)
  on conflict (user_id, bucket) do nothing;

  select * into v_row
  from public.api_rate_limits
  where user_id = p_user_id and bucket = p_bucket
  for update;

  if v_row.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    update public.api_rate_limits
    set window_started_at = v_now, request_count = 1
    where user_id = p_user_id and bucket = p_bucket;
    return query select true, 0;
  elsif v_row.request_count >= p_limit then
    return query
    select false,
           greatest(
             1,
             ceil(extract(epoch from (v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now)))::integer
           );
  else
    update public.api_rate_limits
    set request_count = request_count + 1
    where user_id = p_user_id and bucket = p_bucket;
    return query select true, 0;
  end if;
end;
$$;

create or replace function public.server_reserve_generation_credits(
  p_user_id uuid,
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
  v_profile public.profiles%rowtype;
  v_balance public.user_credit_balances%rowtype;
  v_existing public.generation_credit_operations%rowtype;
  v_from_monthly integer;
  v_from_purchased integer;
  v_total integer;
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_operation_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'invalid_operation';
  end if;
  if p_generation_type not in ('image', 'video') then
    raise exception 'invalid_generation_type';
  end if;

  select * into v_profile from public.profiles where id = p_user_id;
  if not found or v_profile.status is distinct from 'active' then
    raise exception 'account_not_active';
  end if;

  select * into v_existing
  from public.generation_credit_operations
  where id = p_operation_id;

  if found then
    if v_existing.user_id <> p_user_id
      or v_existing.amount <> p_amount
      or v_existing.generation_type <> p_generation_type
    then
      raise exception 'operation_conflict';
    end if;
    select coalesce(b.credits, 0) + coalesce(b.monthly_credits, 0)
      into v_total
    from public.user_credit_balances b
    where b.user_id = p_user_id;

    return query select v_existing.status <> 'refunded', coalesce(v_total, 0), v_existing.id;
    return;
  end if;

  insert into public.user_credit_balances (user_id, credits, video_credits, monthly_credits)
  values (p_user_id, 0, 0, 0)
  on conflict (user_id) do nothing;

  select * into v_balance
  from public.user_credit_balances
  where user_id = p_user_id
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
  where b.user_id = p_user_id;

  insert into public.generation_credit_operations (
    id, user_id, generation_type, model, tool, amount,
    from_monthly, from_purchased, metadata
  )
  values (
    p_operation_id, p_user_id, p_generation_type, coalesce(p_model, 'unknown'),
    coalesce(p_tool, 'generate'), p_amount, v_from_monthly, v_from_purchased,
    jsonb_build_object('prompt_preview', left(coalesce(p_prompt, ''), 160))
  );

  insert into public.credit_transactions (
    user_id, amount, balance_after, credit_type, reason, metadata
  )
  values (
    p_user_id, -p_amount, v_total - p_amount,
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

create or replace function public.server_increment_generation_usage(
  p_user_id uuid,
  p_generation_type text,
  p_amount integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_generation_type not in ('image', 'video') then
    raise exception 'invalid_generation_type';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'p_amount_must_be_positive';
  end if;

  insert into public.user_generation_usage (user_id, year_month, image_count, video_count)
  values (
    p_user_id,
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

create or replace function public.server_set_generation_saved(
  p_user_id uuid,
  p_generation_id uuid,
  p_is_saved boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated boolean;
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;

  update public.generations
  set is_saved = p_is_saved
  where id = p_generation_id
    and user_id = p_user_id
  returning true into v_updated;

  return coalesce(v_updated, false);
end;
$$;

create or replace function public.server_create_payment_intent(
  p_user_id uuid,
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
  v_profile public.profiles%rowtype;
  v_pack public.credit_packs%rowtype;
  v_intent_id uuid;
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_user_id;

  if not found or v_profile.status is distinct from 'active' then
    raise exception 'account_not_active';
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
    p_user_id, v_pack.id, v_pack.price_usd, v_pack.image_credits, v_pack.video_credits,
    'paypal', 'pending'
  )
  returning id into v_intent_id;

  return query
  select v_intent_id, v_pack.price_usd, v_pack.image_credits, v_pack.video_credits;
end;
$$;

create or replace function public.server_update_payment_intent_url(
  p_user_id uuid,
  p_intent_id uuid,
  p_checkout_url text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_checkout_url is null or length(trim(p_checkout_url)) = 0 then
    raise exception 'checkout_url_required';
  end if;

  update public.payment_intents
  set checkout_url = p_checkout_url
  where id = p_intent_id
    and user_id = p_user_id
    and status = 'pending';

  return found;
end;
$$;

revoke execute on function public.consume_api_rate_limit(text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.reserve_generation_credits(uuid, text, integer, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.increment_generation_usage(text, integer)
  from public, anon, authenticated;
revoke execute on function public.set_generation_saved(uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.create_payment_intent(text)
  from public, anon, authenticated;
revoke execute on function public.update_payment_intent_url(uuid, text)
  from public, anon, authenticated;

revoke execute on function public.confirm_payment_intent(uuid, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.refund_payment_intent(text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.complete_generation_operation(uuid, uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.refund_generation_operation(uuid, text)
  from public, anon, authenticated;

grant execute on function public.confirm_payment_intent(uuid, text, jsonb) to service_role;
grant execute on function public.refund_payment_intent(text, jsonb) to service_role;
grant execute on function public.complete_generation_operation(uuid, uuid, integer) to service_role;
grant execute on function public.refund_generation_operation(uuid, text) to service_role;

revoke execute on function public.server_consume_api_rate_limit(uuid, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.server_reserve_generation_credits(uuid, uuid, text, integer, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.server_increment_generation_usage(uuid, text, integer)
  from public, anon, authenticated;
revoke execute on function public.server_set_generation_saved(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.server_create_payment_intent(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.server_update_payment_intent_url(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.server_consume_api_rate_limit(uuid, text, integer, integer) to service_role;
grant execute on function public.server_reserve_generation_credits(uuid, uuid, text, integer, text, text, text) to service_role;
grant execute on function public.server_increment_generation_usage(uuid, text, integer) to service_role;
grant execute on function public.server_set_generation_saved(uuid, uuid, boolean) to service_role;
grant execute on function public.server_create_payment_intent(uuid, text) to service_role;
grant execute on function public.server_update_payment_intent_url(uuid, uuid, text) to service_role;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated;

grant select on public.profiles to anon, authenticated;
grant update on public.profiles to authenticated;

grant select on public.plans to anon, authenticated;

grant select on public.prompts to authenticated;
grant select on public.functional_prompts to authenticated;
grant select on public.community_visuals to authenticated;
grant select on public.workflows to authenticated;
grant select on public.community_drops to authenticated;

grant select, insert, update, delete on public.boards to authenticated;
grant select, insert, delete on public.board_items to authenticated;
grant select, insert, delete on public.user_likes to authenticated;

grant select on public.generations to authenticated;
grant select on public.generation_credit_operations to authenticated;
grant select on public.user_credit_balances to authenticated;
grant select on public.user_generation_usage to authenticated;
grant select on public.credit_transactions to authenticated;
grant select on public.payment_intents to authenticated;

grant select on public.community_membership_audit to authenticated;
grant all privileges on public.community_membership_audit to service_role;

revoke all privileges on public._pricing_migrations from anon, authenticated, service_role;
revoke all privileges on public.api_rate_limits from anon, authenticated;

commit;
