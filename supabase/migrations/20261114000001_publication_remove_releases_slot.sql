-- Retirer une publication jamais diffusée libère son créneau à venir : l'agent (ou un humain) peut y préparer une
-- nouvelle publication. Une publication diffusée (ou peut-être diffusée) garde son créneau : l'historique reste exact.
-- 1) L'unicité publication ↔ occurrence ne porte plus que sur les publications actives (non archivées).
drop index if exists public.publications_occurrence_key;
create unique index publications_occurrence_key on public.publications(occurrence_id) where archived_at is null;

-- 2) Une occurrence peut être détachée de sa publication uniquement si celle-ci est archivée et n'a aucune diffusion
--    publiée, simulée, incertaine ou en cours.
create or replace function publications_private.guard_channel_occurrence_update()
returns trigger language plpgsql set search_path to 'pg_catalog' as $$
begin
 if (new.id,new.client_id,new.project_id,new.project_channel_id,new.schedule_id,new.schedule_slot_id,new.platform,new.local_date,new.local_time,new.timezone,new.scheduled_for,new.created_at)
    is distinct from (old.id,old.client_id,old.project_id,old.project_channel_id,old.schedule_id,old.schedule_slot_id,old.platform,old.local_date,old.local_time,old.timezone,old.scheduled_for,old.created_at) then
  raise exception 'Occurrence snapshot is immutable' using errcode='55000'; end if;
 if old.publication_id is not null and new.publication_id is distinct from old.publication_id then
  if new.publication_id is null and exists(select 1 from public.publications p where p.id=old.publication_id and p.archived_at is not null)
   and not exists(select 1 from public.publication_deliveries d where d.publication_id=old.publication_id and d.status in ('published','simulated','uncertain','processing')) then
   null;
  else raise exception 'Occurrence publication is immutable' using errcode='55000'; end if;
 end if;
 if old.skipped_at is not null and (new.skipped_at,new.skipped_reason) is distinct from (old.skipped_at,old.skipped_reason) then raise exception 'Occurrence skip is immutable' using errcode='55000'; end if;
 if old.publication_id is null and new.publication_id is not null and not exists(select 1 from public.publications p
   where p.id=new.publication_id and p.client_id=new.client_id and p.project_id=new.project_id and p.occurrence_id=new.id and p.archived_at is null) then
  raise exception 'Occurrence publication outside its project' using errcode='23514'; end if;
 return new;
end $$;

-- 3) publication_remove libère le créneau à venir d'une publication jamais diffusée.
create or replace function public.publication_remove(p_publication_id uuid, p_actor_id text)
returns integer language plpgsql set search_path to 'pg_catalog' as $$
declare pub public.publications; cancelled integer := 0; released boolean := false;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_publication_id is null then
  raise exception 'Invalid removal' using errcode='22023'; end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found then raise exception 'Invalid publication' using errcode='23514'; end if;
 if pub.archived_at is not null then raise exception 'Publication already archived' using errcode='55000'; end if;
 perform 1 from public.publication_deliveries where publication_id=pub.id for update;
 if exists(select 1 from public.publication_deliveries where publication_id=pub.id and status='processing') then
  raise exception 'Delivery in progress' using errcode='55000'; end if;
 update public.publication_jobs set status='cancelled',locked_at=null,locked_by=null,lease_expires_at=null
  where type='deliver' and status='pending' and delivery_id in (select id from public.publication_deliveries where publication_id=pub.id and status in ('scheduled','retryable_error','blocked'));
 with c as (update public.publication_deliveries set status='cancelled'
  where publication_id=pub.id and status in ('scheduled','retryable_error','blocked') returning 1)
 select count(*) into cancelled from c;
 update public.publications set archived_at=now(),archived_by=p_actor_id where id=pub.id;
 if pub.occurrence_id is not null and not exists(select 1 from public.publication_deliveries d where d.publication_id=pub.id and d.status in ('published','simulated','uncertain')) then
  update public.publication_channel_occurrences set publication_id=null
   where id=pub.occurrence_id and publication_id=pub.id and scheduled_for>now();
  released := found;
 end if;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.archived',pub.client_id,'publication',pub.id,
  jsonb_build_object('project_id',pub.project_id,'publication_id',pub.id,'platform',pub.platform,'occurrence_id',pub.occurrence_id,
   'editorial_group_id',pub.editorial_group_id,'status',pub.status,'cancelled_deliveries',cancelled,'released_occurrence',released,'mode','remove_any_state'));
 return cancelled;
end $$;
revoke all on function public.publication_remove(uuid,text) from public, anon, authenticated;
grant execute on function public.publication_remove(uuid,text) to service_role;
