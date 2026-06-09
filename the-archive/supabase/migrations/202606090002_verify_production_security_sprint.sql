-- Run after 202606090001_production_security_sprint.sql.
-- Every query should return the expected object/permission without changing balances.

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('generation_credit_operations', 'api_rate_limits')
order by table_name;

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'reserve_generation_credits',
    'complete_generation_operation',
    'refund_generation_operation',
    'set_generation_saved',
    'consume_api_rate_limit',
    'spend_generation_credits',
    'refund_generation_credits'
  )
order by routine_name, grantee;

select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('generations', 'generation_credit_operations', 'api_rate_limits')
order by tablename, policyname;

select
  count(*) as balance_rows,
  sum(credits) as purchased_credits,
  sum(monthly_credits) as monthly_credits
from public.user_credit_balances;
