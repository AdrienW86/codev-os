-- Retirer une publication du tableau quel que soit son état : les envois pas encore partis (programmés, en attente
-- de nouvelle tentative, bloqués) sont annulés, puis la publication est archivée (historique conservé, vue « Archivées »).
-- Rien n'est jamais supprimé chez Facebook, Instagram ou Google : un post déjà diffusé reste en ligne.
-- Seul un envoi en cours d'exécution (processing) bloque : il faut attendre son résultat (quelques secondes).
create or replace function public.publication_remove(p_publication_id uuid, p_actor_id text)
returns integer language plpgsql set search_path to 'pg_catalog' as $$
declare pub public.publications; cancelled integer := 0;
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
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.archived',pub.client_id,'publication',pub.id,
  jsonb_build_object('project_id',pub.project_id,'publication_id',pub.id,'platform',pub.platform,'occurrence_id',pub.occurrence_id,
   'editorial_group_id',pub.editorial_group_id,'status',pub.status,'cancelled_deliveries',cancelled,'mode','remove_any_state'));
 return cancelled;
end $$;
revoke all on function public.publication_remove(uuid,text) from public, anon, authenticated;
grant execute on function public.publication_remove(uuid,text) to service_role;
