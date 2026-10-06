-- One manual decision per revision. Historical per-variant reviews stay append-only.
alter table public.publication_reviews alter column variant_id drop not null;
alter table public.publication_reviews add constraint publication_reviews_revision_fk
 foreign key (revision_id,publication_id,client_id)
 references public.publication_revisions(id,publication_id,client_id) on delete restrict;
create unique index publication_reviews_revision_decision_idx
 on public.publication_reviews(revision_id) where variant_id is null;

create or replace function publications_private.check_publication_state() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' and (new.client_id,new.editorial_week,new.slot) is distinct from (old.client_id,old.editorial_week,old.slot) then
  raise exception 'Editorial identity is immutable' using errcode='55000';
 end if;
 if tg_op='UPDATE' and (new.subject,new.target_date) is distinct from (old.subject,old.target_date) and
  (nullif(current_setting('codev.publication_editorial',true),'') is null or not exists(
   select 1 from public.publication_revisions r where r.id=new.current_revision_id
    and r.internal_title=new.subject and r.target_date is not distinct from new.target_date)) then
  raise exception 'Editorial changes require an audited new revision' using errcode='55000';
 end if;
 if new.status<>'draft' and not exists(select 1 from public.publication_variants where revision_id=new.current_revision_id) then
  raise exception 'A submitted revision needs variants' using errcode='23514';
 end if;
 if new.status='approved' and exists(select 1 from public.publication_variants v where v.revision_id=new.current_revision_id
  and not exists(select 1 from public.publication_reviews r where r.revision_id=v.revision_id
   and r.publication_id=v.publication_id and r.client_id=v.client_id
   and (r.variant_id=v.id or r.variant_id is null) and r.decision='approved')) then
  raise exception 'Current revision is not approved' using errcode='23514';
 end if;
 if new.status='rejected' and not exists(select 1 from public.publication_reviews where revision_id=new.current_revision_id and decision='rejected') then
  raise exception 'Missing rejection' using errcode='23514';
 end if;
 return new;
end $$;

create or replace function publications_private.check_review() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare publication public.publications;
begin
 select * into publication from public.publications where id=new.publication_id for update;
 if not found or publication.current_revision_id is distinct from new.revision_id or publication.status<>'pending_review' then
  raise exception 'Only the pending current revision can be reviewed' using errcode='23514';
 end if;
 if exists(select 1 from public.publication_reviews r where r.revision_id=new.revision_id
  and (new.variant_id is null or r.variant_id is null)) then
  raise exception 'Revision decision already exists; mixed scopes are forbidden' using errcode='23505';
 end if;
 return new;
end $$;

create or replace function publications_private.check_delivery() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare publication public.publications;
begin
 select p.* into publication from public.publications p where p.id=new.publication_id for update;
 if tg_op='UPDATE' and (new.publication_id,new.publication_account_id,new.client_id,new.platform,new.idempotency_key)
  is distinct from (old.publication_id,old.publication_account_id,old.client_id,old.platform,old.idempotency_key) then
  raise exception 'Delivery identity is immutable' using errcode='55000';
 end if;
 if new.status not in ('blocked','cancelled') and (publication.status<>'approved' or not exists(
  select 1 from public.publication_variants v join public.publication_reviews r
   on r.revision_id=v.revision_id and r.publication_id=v.publication_id and r.client_id=v.client_id
    and (r.variant_id=v.id or r.variant_id is null)
  where v.id=new.variant_id and v.revision_id=publication.current_revision_id and r.decision='approved')) then
  raise exception 'Delivery requires the approved current variant' using errcode='23514';
 end if;
 return new;
end $$;

create or replace function public.publication_review_manual(p_publication_id uuid,p_revision_id uuid,p_decision text,p_reason text,p_actor_id text)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications; review uuid; normalized_reason text:=nullif(btrim(p_reason),'');
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_decision is null or p_decision not in('approved','rejected') or(p_decision='rejected' and normalized_reason is null) then
  raise exception 'Invalid review' using errcode='22023';
 end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found or pub.current_revision_id is distinct from p_revision_id or pub.project_id is null then
  raise exception 'Stale review' using errcode='40001';
 end if;
 if pub.status<>'pending_review' then
  if pub.status=p_decision and exists(select 1 from public.publication_reviews r
   where r.publication_id=pub.id and r.revision_id=p_revision_id and r.variant_id is null
    and r.decision=p_decision and r.actor_id=p_actor_id and r.reason is not distinct from normalized_reason) then return; end if;
  raise exception 'Stale or conflicting review' using errcode='40001';
 end if;
 if not exists(select 1 from public.publication_variants where revision_id=p_revision_id) then
  raise exception 'Missing variants' using errcode='23514';
 end if;
 insert into public.publication_reviews(publication_id,revision_id,variant_id,client_id,decision,reason,actor_id)
 values(pub.id,p_revision_id,null,pub.client_id,p_decision,normalized_reason,p_actor_id) returning id into review;
 update public.publications set status=p_decision where id=pub.id;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.reviewed',pub.client_id,'publication',pub.id,
  jsonb_build_object('revision_id',p_revision_id,'review_id',review,'decision',p_decision,'decision_scope','revision'));
end $$;
revoke all on function public.publication_review_manual(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.publication_review_manual(uuid,uuid,text,text,text) to service_role;
