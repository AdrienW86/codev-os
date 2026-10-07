-- Lot 4.3 P4-a: editorial groups (one shared idea) and mono-platform publications bound to channel occurrences.
-- Additive and compatible: existing (legacy, multi-variant) publications keep NULL in every new column and stay
-- valid and readable. No data is converted, split or rewritten. No creation RPC yet (P4-b), no agent, no publisher.

create table public.publication_editorial_groups(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null,
 project_id uuid not null,
 subject text not null check(length(btrim(subject)) between 1 and 300 and subject !~ '[\x00-\x1f]'),
 origin text not null default 'manual' check(origin in('manual','agent')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint publication_editorial_groups_scope_key unique(id,client_id,project_id),
 constraint publication_editorial_groups_project_fk foreign key(project_id,client_id) references public.projects(id,client_id) on delete restrict
);
create index publication_editorial_groups_project_idx on public.publication_editorial_groups(client_id,project_id);

create function publications_private.guard_editorial_group() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.id,new.client_id,new.project_id,new.origin,new.created_at) is distinct from (old.id,old.client_id,old.project_id,old.origin,old.created_at) then
  raise exception 'Editorial group identity is immutable' using errcode='55000'; end if;
 return new;
end $$;
create trigger editorial_group_identity before update on public.publication_editorial_groups
 for each row execute function publications_private.guard_editorial_group();
create trigger editorial_group_updated before update on public.publication_editorial_groups
 for each row execute function publications_private.touch_updated_at();
create trigger editorial_group_no_delete before delete on public.publication_editorial_groups
 for each row execute function publications_private.prevent_history_change();
create trigger editorial_group_no_truncate before truncate on public.publication_editorial_groups
 for each statement execute function publications_private.prevent_history_change();

-- Target model: 1 publication = 1 platform. NULL platform = legacy multi-variant publication (unchanged).
alter table public.publications
 add column editorial_group_id uuid,
 add column occurrence_id uuid,
 add column platform text check(platform is null or platform in('facebook','instagram','google_business_profile'));
alter table public.publications
 -- Composite FKs are MATCH SIMPLE: the checks below make a NULL project impossible once a group/occurrence is set.
 add constraint publications_group_requires_scope check(editorial_group_id is null or (project_id is not null and platform is not null)),
 add constraint publications_occurrence_requires_scope check(occurrence_id is null or (project_id is not null and platform is not null)),
 add constraint publications_editorial_group_fk foreign key(editorial_group_id,client_id,project_id)
   references public.publication_editorial_groups(id,client_id,project_id) on delete restrict,
 -- Same client, same project and same platform as the occurrence.
 add constraint publications_occurrence_fk foreign key(occurrence_id,client_id,project_id,platform)
   references public.publication_channel_occurrences(id,client_id,project_id,platform) on delete restrict,
 add constraint publications_occurrence_key unique(occurrence_id);
-- Sister publications of one editorial idea: at most one per platform.
create unique index publications_group_platform_key on public.publications(editorial_group_id,platform) where editorial_group_id is not null;
-- The historical two-slots-per-week bound stays identical for every publication not bound to an occurrence
-- (all legacy rows). Occurrence-bound publications follow their channel schedules instead (independent platforms).
drop index public.publications_project_week_slot_key;
create unique index publications_project_week_slot_key on public.publications(client_id,project_id,editorial_week,slot)
 where project_id is not null and occurrence_id is null;

-- One-way bindings: group, occurrence and platform go NULL -> value once and never change afterwards.
-- Setting a platform requires every existing variant of the publication to be on that platform.
create function publications_private.guard_publication_binding() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' and ((old.editorial_group_id is not null and new.editorial_group_id is distinct from old.editorial_group_id)
   or (old.occurrence_id is not null and new.occurrence_id is distinct from old.occurrence_id)
   or (old.platform is not null and new.platform is distinct from old.platform)) then
  raise exception 'Publication binding is immutable' using errcode='55000'; end if;
 if new.platform is not null and (tg_op='INSERT' or old.platform is null) and exists(select 1 from public.publication_variants v
   where v.publication_id=new.id and v.platform<>new.platform) then
  raise exception 'Mono-platform publication has other variants' using errcode='23514'; end if;
 return new;
end $$;
create trigger publications_binding before insert or update on public.publications
 for each row execute function publications_private.guard_publication_binding();
-- The occurrence mirror (occurrence.publication_id) is maintained from the publication side only.
create function publications_private.link_publication_occurrence() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if new.occurrence_id is not null and (tg_op='INSERT' or old.occurrence_id is null) then
  update public.publication_channel_occurrences set publication_id=new.id
   where id=new.occurrence_id and publication_id is null and skipped_at is null;
  if not found then raise exception 'Occurrence unavailable' using errcode='23514'; end if;
 end if;
 return null;
end $$;
create trigger publications_occurrence_link after insert or update of occurrence_id on public.publications
 for each row execute function publications_private.link_publication_occurrence();
-- Mono-platform publication: every new variant must be on its platform.
create function publications_private.guard_variant_platform() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.publications p where p.id=new.publication_id and p.platform is not null and p.platform<>new.platform) then
  raise exception 'Variant platform differs from the publication platform' using errcode='23514'; end if;
 return new;
end $$;
create trigger publication_variant_platform before insert on public.publication_variants
 for each row execute function publications_private.guard_variant_platform();

-- P3 guard, extended: an occurrence can only be linked to the publication bound to it (publications.occurrence_id),
-- which keeps one source of truth. Every P3 rule is unchanged.
create or replace function publications_private.guard_channel_occurrence_update() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.id,new.client_id,new.project_id,new.project_channel_id,new.schedule_id,new.schedule_slot_id,new.platform,new.local_date,new.local_time,new.timezone,new.scheduled_for,new.created_at)
    is distinct from (old.id,old.client_id,old.project_id,old.project_channel_id,old.schedule_id,old.schedule_slot_id,old.platform,old.local_date,old.local_time,old.timezone,old.scheduled_for,old.created_at) then
  raise exception 'Occurrence snapshot is immutable' using errcode='55000'; end if;
 if old.publication_id is not null and new.publication_id is distinct from old.publication_id then raise exception 'Occurrence publication is immutable' using errcode='55000'; end if;
 if old.skipped_at is not null and (new.skipped_at,new.skipped_reason) is distinct from (old.skipped_at,old.skipped_reason) then raise exception 'Occurrence skip is immutable' using errcode='55000'; end if;
 if old.publication_id is null and new.publication_id is not null and not exists(select 1 from public.publications p
   where p.id=new.publication_id and p.client_id=new.client_id and p.project_id=new.project_id and p.occurrence_id=new.id) then
  raise exception 'Occurrence publication outside its project' using errcode='23514'; end if;
 return new;
end $$;

alter table public.publication_editorial_groups enable row level security;
revoke all on public.publication_editorial_groups from public,anon,authenticated,service_role;
grant select,insert,update on public.publication_editorial_groups to service_role;
revoke all on function publications_private.guard_editorial_group(),publications_private.guard_publication_binding(),
 publications_private.link_publication_occurrence(),publications_private.guard_variant_platform() from public,anon,authenticated,service_role;
grant execute on function publications_private.guard_editorial_group(),publications_private.guard_publication_binding(),
 publications_private.link_publication_occurrence(),publications_private.guard_variant_platform() to service_role;
