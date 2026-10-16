-- Reconciliation evidence belongs to ONE completed delivery attempt, never to a delivery's entire history.
-- Additive only. No provider calls, scheduler activation or delivery retry is performed by this migration.
alter table public.publication_deliveries
 add column last_attempt_id uuid references public.publication_attempts(id) on delete restrict,
 add column last_reconciliation_id uuid references public.publication_events(id) on delete restrict;

-- The engine inserts an append-only attempt while holding its processing job and delivery locks. Bind that
-- exact attempt before completion changes the job status. No timestamp/UUID ordering or user-supplied pointer.
create function publications_private.remember_delivery_attempt() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if new.delivery_id is not null and exists(select 1 from public.publication_jobs j
   where j.id=new.job_id and j.type='deliver' and j.delivery_id=new.delivery_id and j.status='processing'
    and j.attempts=new.attempt_number and j.dispatched_at is not null and j.dispatched_at=new.started_at) then
  update public.publication_deliveries set last_attempt_id=new.id,last_reconciliation_id=null where id=new.delivery_id;
 end if;
 return new;
end $$;
create trigger publication_attempt_remember after insert on public.publication_attempts
 for each row execute function publications_private.remember_delivery_attempt();

-- Existing uncertain rows may be bound only when there is exactly one delivery job and its current completed
-- attempt is uncertain. Ambiguous histories deliberately remain unbound; historical "missing" events are NEVER
-- imported as proof. An operator must investigate ambiguous legacy rows rather than authorize an unsafe resend.
update public.publication_deliveries d set last_attempt_id=t.id
 from public.publication_attempts t join public.publication_jobs j on j.id=t.job_id
 where d.status='uncertain' and d.revision_id is not null and t.delivery_id=d.id and j.delivery_id=d.id
  and j.type='deliver' and j.status='failed' and j.attempts=t.attempt_number and t.result='uncertain'
  and j.dispatched_at=t.started_at and j.dispatched_at is not null
  and 1=(select count(*) from public.publication_jobs x where x.delivery_id=d.id and x.type='deliver');

create function publications_private.checked_uncertain_attempt(p_delivery_id uuid) returns public.publication_attempts
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare t public.publication_attempts;
begin
 select a.* into t from public.publication_deliveries d
  join public.publication_attempts a on a.id=d.last_attempt_id and a.delivery_id=d.id
  join public.publication_jobs j on j.id=a.job_id and j.delivery_id=d.id and j.type='deliver'
  where d.id=p_delivery_id and d.revision_id is not null and d.status='uncertain' and a.result='uncertain'
   and j.attempts=a.attempt_number and j.status='failed' and j.dispatched_at=a.started_at;
 if not found then raise exception 'Current uncertain attempt cannot be verified; operator investigation required' using errcode='55000'; end if;
 return t;
end $$;

create function public.publication_delivery_reconcile_context_checked(p_delivery_id uuid) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare d public.publication_deliveries;a public.publication_accounts;t public.publication_attempts;
begin
 select * into d from public.publication_deliveries where id=p_delivery_id;
 if not found or d.revision_id is null then raise exception 'Invalid delivery' using errcode='23514'; end if;
 t:=publications_private.checked_uncertain_attempt(d.id);
 select * into a from public.publication_accounts where id=d.publication_account_id;
 return jsonb_build_object('delivery_id',d.id,'attempt_id',t.id,'publication_id',d.publication_id,'platform',d.platform,
  'remote_id',d.remote_id,'connection_id',a.connection_id,
  'account',jsonb_build_object('external_account_id',a.external_account_id,'parent_external_id',a.parent_external_id),
  'text',(select text_content from public.publication_variants where id=d.variant_id),'since',t.started_at);
end $$;

create function public.publication_delivery_reconcile_checked(p_delivery_id uuid,p_attempt_id uuid,p_status text,p_remote_id text,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare d public.publication_deliveries;t public.publication_attempts;location text;event_id uuid;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_delivery_id is null or p_attempt_id is null
  or p_status is null or p_status not in('exists','missing','unknown')
  or (p_status='exists' and p_remote_id is null) or (p_status<>'exists' and p_remote_id is not null) then
  raise exception 'Invalid reconciliation' using errcode='22023'; end if;
 select * into d from public.publication_deliveries where id=p_delivery_id for update;
 if not found or d.revision_id is null then raise exception 'Invalid delivery' using errcode='23514'; end if;
 t:=publications_private.checked_uncertain_attempt(d.id);
 if t.id<>p_attempt_id then raise exception 'Stale provider check: attempt changed' using errcode='40001'; end if;
 if p_status='exists' then
  if d.platform in('facebook','instagram') then
   if p_remote_id !~ '^[0-9]{1,30}(_[0-9]{1,30})?$' then raise exception 'Invalid reconciliation' using errcode='22023'; end if;
  elsif d.platform='google_business_profile' then
   select a.external_account_id into location from public.publication_accounts a where a.id=d.publication_account_id;
   if location is null or p_remote_id !~ '^accounts/[0-9A-Za-z_-]{1,100}/locations/[0-9A-Za-z_-]{1,100}/localPosts/[0-9A-Za-z_-]{1,100}$'
    or left(p_remote_id,length(location)+1)<>location||'/' then raise exception 'Invalid reconciliation' using errcode='22023'; end if;
  else raise exception 'Invalid reconciliation' using errcode='22023'; end if;
 end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.delivery_reconciled',d.client_id,'publication',d.publication_id,
  jsonb_build_object('delivery_id',d.id,'attempt_id',t.id,'job_id',t.job_id,'attempt',t.attempt_number,'platform',d.platform,
   'result',p_status,'delivery_status',case when p_status='exists' then 'published' else 'uncertain' end)) returning id into event_id;
 -- Every result, including unknown, replaces the previous proof. The append-only event itself is never edited.
 update public.publication_deliveries set last_reconciliation_id=event_id,
  status=case when p_status='exists' then 'published' else status end,
  remote_id=case when p_status='exists' then p_remote_id else remote_id end,
  last_error_class=case when p_status='exists' then null else last_error_class end,
  last_error_code=case when p_status='exists' then null else last_error_code end where id=d.id;
 return jsonb_build_object('delivery_id',d.id,'attempt_id',t.id,'status',case when p_status='exists' then 'published' else 'uncertain' end);
end $$;

create function public.publication_delivery_confirm_not_published_checked(p_delivery_id uuid,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare d public.publication_deliveries;t public.publication_attempts;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_delivery_id is null then raise exception 'Invalid decision' using errcode='22023'; end if;
 select * into d from public.publication_deliveries where id=p_delivery_id for update;
 if not found or d.revision_id is null then raise exception 'Invalid delivery' using errcode='23514'; end if;
 t:=publications_private.checked_uncertain_attempt(d.id);
 if not exists(select 1 from public.publication_events e where e.id=d.last_reconciliation_id
   and e.action='publication.delivery_reconciled' and e.resource_type='publication' and e.resource_id=d.publication_id
   and e.client_id=d.client_id and e.metadata->>'delivery_id'=d.id::text and e.metadata->>'attempt_id'=t.id::text
   and e.metadata->>'result'='missing') then
  raise exception 'Reconcile first: latest provider check must find the CURRENT attempt missing' using errcode='55000'; end if;
 update public.publication_deliveries set status='failed',last_error_code='confirmed_not_published',last_reconciliation_id=null where id=d.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.delivery_confirmed_not_published',d.client_id,'publication',d.publication_id,
  jsonb_build_object('delivery_id',d.id,'attempt_id',t.id,'reconciliation_id',d.last_reconciliation_id,'platform',d.platform));
 return jsonb_build_object('delivery_id',d.id,'status','failed');
end $$;

-- Old unbound entry points must not remain an escape hatch. Keep their definitions/history for review, but
-- require every application caller to use the new checked contract (unmigrated installations fail closed).
revoke all on function public.publication_delivery_reconcile_context(uuid),public.publication_delivery_reconcile(uuid,text,text,text),
 public.publication_delivery_confirm_not_published(uuid,text) from public,anon,authenticated,service_role;
revoke all on function publications_private.remember_delivery_attempt(),publications_private.checked_uncertain_attempt(uuid),
 public.publication_delivery_reconcile_context_checked(uuid),public.publication_delivery_reconcile_checked(uuid,uuid,text,text,text),
 public.publication_delivery_confirm_not_published_checked(uuid,text) from public,anon,authenticated;
grant execute on function publications_private.remember_delivery_attempt(),publications_private.checked_uncertain_attempt(uuid),
 public.publication_delivery_reconcile_context_checked(uuid),public.publication_delivery_reconcile_checked(uuid,uuid,text,text,text),
 public.publication_delivery_confirm_not_published_checked(uuid,text) to service_role;
notify pgrst, 'reload schema';
