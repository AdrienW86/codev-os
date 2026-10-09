-- Lot 4.3 P5: one-way archiving of publications (never a delete). An archived publication stays readable with its
-- revisions, reviews, history, occurrence link and editorial group; it only leaves the active board.
-- No restore yet. Editorial groups and occurrences are not archived (occurrences keep their own history).

alter table public.publications
 add column archived_at timestamptz,
 add column archived_by text check(archived_by ~ '^user_[a-zA-Z0-9_-]{1,200}$'),
 add constraint publications_archive_pair check((archived_at is null)=(archived_by is null));
create index publications_archived_idx on public.publications(client_id,archived_at) where archived_at is not null;

-- Archiving is one-way and freezes the publication row; only the archive transition itself is allowed.
create function publications_private.guard_publication_archive() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if old.archived_at is not null and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
  raise exception 'Archived publication is immutable' using errcode='55000'; end if;
 if old.archived_at is null and new.archived_at is not null
  and (to_jsonb(new)-'updated_at'-'archived_at'-'archived_by') is distinct from (to_jsonb(old)-'updated_at'-'archived_at'-'archived_by') then
  raise exception 'Archiving changes nothing else' using errcode='55000'; end if;
 return new;
end $$;
create trigger publications_archive before update on public.publications
 for each row execute function publications_private.guard_publication_archive();
-- No new revision or variant on an archived publication (manual save, regeneration, agent).
create function publications_private.guard_archived_publication_child() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.publications where id=new.publication_id and archived_at is not null) then
  raise exception 'Archived publication is immutable' using errcode='55000'; end if;
 return new;
end $$;
create trigger publication_revision_archived before insert on public.publication_revisions
 for each row execute function publications_private.guard_archived_publication_child();
create trigger publication_variant_archived before insert on public.publication_variants
 for each row execute function publications_private.guard_archived_publication_child();

-- Explicit admin archive, audited. Refused while a delivery is still active (only cancelled / published allowed).
create function public.publication_archive(p_publication_id uuid,p_actor_id text) returns timestamptz
language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;archived timestamptz;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_publication_id is null then
  raise exception 'Invalid archive' using errcode='22023'; end if;
 select * into pub from public.publications where id=p_publication_id for update;
 if not found then raise exception 'Invalid publication' using errcode='23514'; end if;
 if pub.archived_at is not null then raise exception 'Publication already archived' using errcode='55000'; end if;
 if exists(select 1 from public.publication_deliveries where publication_id=pub.id and status not in('cancelled','published')) then
  raise exception 'Resolve deliveries first' using errcode='55000'; end if;
 update public.publications set archived_at=now(),archived_by=p_actor_id where id=pub.id returning archived_at into archived;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.archived',pub.client_id,'publication',pub.id,
  jsonb_build_object('project_id',pub.project_id,'publication_id',pub.id,'platform',pub.platform,'occurrence_id',pub.occurrence_id,
   'editorial_group_id',pub.editorial_group_id,'status',pub.status));
 return archived;
end $$;

revoke all on function publications_private.guard_publication_archive(),publications_private.guard_archived_publication_child() from public,anon,authenticated,service_role;
grant execute on function publications_private.guard_publication_archive(),publications_private.guard_archived_publication_child() to service_role;
revoke all on function public.publication_archive(uuid,text) from public,anon,authenticated;
grant execute on function public.publication_archive(uuid,text) to service_role;
