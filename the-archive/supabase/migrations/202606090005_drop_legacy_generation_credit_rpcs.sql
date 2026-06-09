begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop function if exists public.spend_generation_credits(text, integer, text, text);
drop function if exists public.refund_generation_credits(text, integer, text, uuid);

commit;
