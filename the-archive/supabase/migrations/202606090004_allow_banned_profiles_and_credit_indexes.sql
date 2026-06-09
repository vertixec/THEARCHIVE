begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.profiles
  drop constraint if exists profiles_status_check;

alter table public.profiles
  add constraint profiles_status_check
  check (status in ('active', 'inactive', 'banned'));

create index if not exists generation_credit_operations_generation_id_idx
  on public.generation_credit_operations (generation_id)
  where generation_id is not null;

create index if not exists generations_credit_operation_id_idx
  on public.generations (credit_operation_id)
  where credit_operation_id is not null;

commit;
