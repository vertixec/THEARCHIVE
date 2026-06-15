begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index if not exists community_membership_audit_actor_user_id_idx
  on public.community_membership_audit (actor_user_id);

drop policy if exists "prompts_insert_admin" on public.prompts;

commit;
