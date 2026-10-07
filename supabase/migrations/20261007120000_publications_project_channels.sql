-- Lot 4.3 P1: explicit publication channels per project.
-- Final model: publication_project_channels -> platforms. projects.type only gates (transitionally) eligibility.
-- No change to publication_events, accounts, cadences, slots, deliveries, settings or client_connections.

-- TRANSITIONAL (debt D-P1-ELIG): projects.type -> "is this a Publications project?" (yes/no only).
-- Never decides platforms. Remove once eligibility is explicit (P2) and type-based SQL guards are migrated.
create function publications_private.project_publications_eligible(p_type text) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $$
 select coalesce(p_type in('Réseaux sociaux','Google Business Profile'),false);
$$;

-- TRANSITIONAL (debt D-P1-LEGACY): historical channel set of a type. Used ONLY by (1) the fallback of
-- never-configured projects, (2) first-save materialization, (3) the backfill. Never limits configuration.
create function publications_private.legacy_type_platforms(p_type text) returns text[]
language sql immutable security invoker set search_path=pg_catalog as $$
 select case p_type when 'Réseaux sociaux' then array['facebook','instagram']
                    when 'Google Business Profile' then array['google_business_profile']
                    else array[]::text[] end;
$$;

create table public.publication_project_channels(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null,
 project_id uuid not null,
 platform text not null check(platform in('facebook','instagram','google_business_profile')),
 enabled boolean not null default true,
 publication_account_id uuid,
 editorial_rules text check(editorial_rules is null or (length(btrim(editorial_rules)) between 1 and 4000
   and editorial_rules !~ '[\x00-\x08\x0b\x0c\x0e-\x1f]')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint publication_project_channels_project_platform_key unique(project_id,platform),
 constraint publication_project_channels_scope_key unique(id,project_id,client_id,platform),
 constraint publication_project_channels_project_fk foreign key(project_id,client_id)
   references public.projects(id,client_id) on delete restrict,
 -- MATCH SIMPLE: NULL account allowed; a non-NULL account must match the same client and platform.
 constraint publication_project_channels_account_fk foreign key(publication_account_id,client_id,platform)
   references public.publication_accounts(id,client_id,platform) on delete restrict
);
create index publication_project_channels_client_idx on public.publication_project_channels(client_id,project_id);
create index publication_project_channels_account_idx on public.publication_project_channels(publication_account_id)
 where publication_account_id is not null;

create function publications_private.guard_project_channel() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.id,new.client_id,new.project_id,new.platform,new.created_at)
    is distinct from (old.id,old.client_id,old.project_id,old.platform,old.created_at) then
  raise exception 'Channel identity is immutable' using errcode='55000'; end if;
 return new;
end $$;
create trigger project_channel_identity before update on public.publication_project_channels
 for each row execute function publications_private.guard_project_channel();
create trigger project_channel_updated before update on public.publication_project_channels
 for each row execute function publications_private.touch_updated_at();
create trigger project_channel_no_delete before delete on public.publication_project_channels
 for each row execute function publications_private.prevent_history_change();
create trigger project_channel_no_truncate before truncate on public.publication_project_channels
 for each statement execute function publications_private.prevent_history_change();

-- >=1 row (even all disabled) => configured: only enabled rows count; legacy never applies again.
-- 0 row => TRANSITIONAL legacy fallback. NULL project => historical unscoped content (unchanged).
create or replace function publications_private.project_platform_allowed(p_project uuid,p_client uuid,p_platform text)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
 select p_project is null or case
  when exists(select 1 from public.publication_project_channels c where c.project_id=p_project)
   then exists(select 1 from public.publication_project_channels c
               where c.project_id=p_project and c.client_id=p_client and c.platform=p_platform and c.enabled)
  else exists(select 1 from public.projects p where p.id=p_project and p.client_id=p_client
               and p_platform=any(publications_private.legacy_type_platforms(p.type)))
 end;
$$;

-- Materializes the legacy set of the given projects in ONE statement (rows + audit through data-modifying CTEs;
-- no dependency on the visibility of rows inserted by the same statement). No ON CONFLICT: callers guarantee
-- the projects have zero rows (project lock / table lock); any unexpected row aborts with 23505 (fail closed).
create function publications_private.materialize_legacy_channels(p_projects uuid[],p_actor_type text,p_actor_id text,p_source text)
returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare n integer;
begin
 -- Only two provenances exist; anything else (NULLs included) is refused, even for an empty project set.
 if p_projects is null or not coalesce(
   (p_actor_type='admin' and p_source='legacy_materialized' and p_actor_id ~ '^user_[a-zA-Z0-9_-]{1,200}$')
   or (p_actor_type='system' and p_source='legacy_backfill' and p_actor_id is null),false) then
  raise exception 'Invalid materialization' using errcode='22023'; end if;
 with inserted as (
  insert into public.publication_project_channels(client_id,project_id,platform,enabled)
  select p.client_id,p.id,l.platform,true from public.projects p
  cross join lateral unnest(publications_private.legacy_type_platforms(p.type)) as l(platform)
  where p.id=any(p_projects)
  returning id,client_id,project_id,platform),
 audited as (
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,after_data,metadata)
  select p_actor_type,p_actor_id,'publication.channel_configured',i.client_id,'project_channel',i.id,
   jsonb_build_object('enabled',true,'has_account',false,'has_rules',false),
   jsonb_build_object('project_id',i.project_id,'platform',i.platform,'created',true,'source',p_source)
  from inserted i returning 1)
 select count(*) into n from audited;
 return n;
end $$;

create function public.publication_channel_save(p_project_id uuid,p_platform text,p_enabled boolean,
 p_publication_account_id uuid,p_editorial_rules text,p_actor_id text) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare project public.projects;previous public.publication_project_channels;existed boolean;saved uuid;
 rules text:=nullif(btrim(p_editorial_rules),'');
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_enabled is null
  or p_platform is null or p_platform not in('facebook','instagram','google_business_profile')
  or (rules is not null and (length(rules)>4000 or rules ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]')) then
  raise exception 'Invalid channel' using errcode='22023'; end if;
 -- A. Lock: serializes every channel save of this project (materialization + upsert).
 select * into project from public.projects where id=p_project_id for no key update;
 if not found then raise exception 'Invalid project' using errcode='23514'; end if;
 -- B. TRANSITIONAL eligibility only (D-P1-ELIG). The platform is NOT checked against the type.
 if not publications_private.project_publications_eligible(project.type) then
  raise exception 'Project not eligible for Publications' using errcode='23514'; end if;
 if p_publication_account_id is not null and not exists(select 1 from public.publication_accounts a
   where a.id=p_publication_account_id and a.client_id=project.client_id and a.platform=p_platform) then
  raise exception 'Invalid account' using errcode='23514'; end if;
 -- C. First configuration: keep the historical channels before the fallback is cut.
 if not exists(select 1 from public.publication_project_channels where project_id=project.id) then
  perform publications_private.materialize_legacy_channels(array[project.id],'admin',p_actor_id,'legacy_materialized');
 end if;
 -- D. Upsert of the requested channel, any of the three platforms.
 select * into previous from public.publication_project_channels
  where project_id=project.id and platform=p_platform for update;
 existed:=found;
 insert into public.publication_project_channels(client_id,project_id,platform,enabled,publication_account_id,editorial_rules)
 values(project.client_id,project.id,p_platform,p_enabled,p_publication_account_id,rules)
 on conflict(project_id,platform) do update
  set enabled=excluded.enabled,publication_account_id=excluded.publication_account_id,editorial_rules=excluded.editorial_rules
 returning id into saved;
 -- Zero enabled channel is valid (Publications suspended). Never re-enabled automatically.
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data,metadata)
 values('admin',p_actor_id,'publication.channel_configured',project.client_id,'project_channel',saved,
  case when existed then jsonb_build_object('enabled',previous.enabled,'has_account',previous.publication_account_id is not null,
   'has_rules',previous.editorial_rules is not null) end,
  jsonb_build_object('enabled',p_enabled,'has_account',p_publication_account_id is not null,'has_rules',rules is not null),
  jsonb_build_object('project_id',project.id,'platform',p_platform,'created',not existed,'source','admin'));
 return saved;
end $$;

-- Idempotent backfill on an explicitly captured candidate set. Owner-only maintenance function.
create function publications_private.backfill_legacy_channels() returns integer
language plpgsql security invoker set search_path=pg_catalog as $$
declare candidates uuid[];expected integer;created integer;
begin
 -- SHARE ROW EXCLUSIVE: self-conflicting (backfills serialize) and conflicts with ROW EXCLUSIVE (RPC writes);
 -- plain reads (ACCESS SHARE) stay allowed.
 lock table public.publication_project_channels in share row exclusive mode;
 -- Candidates captured ONCE, before any insert: eligible projects with zero channel row.
 select coalesce(array_agg(p.id order by p.id),array[]::uuid[]) into candidates from public.projects p
  where publications_private.project_publications_eligible(p.type)
    and not exists(select 1 from public.publication_project_channels c where c.project_id=p.id);
 -- Every check below is driven by unnest(candidates): projects outside the set are never read.
 select count(*) into expected from unnest(candidates) as k(project_id)
  join public.projects p on p.id=k.project_id
  cross join lateral unnest(publications_private.legacy_type_platforms(p.type)) as l(platform);
 created:=publications_private.materialize_legacy_channels(candidates,'system',null,'legacy_backfill');
 if created is distinct from expected then raise exception 'Backfill mismatch' using errcode='P0001'; end if;
 if exists(
  select 1 from unnest(candidates) as k(project_id)
  left join public.projects p on p.id=k.project_id
  where p.id is null                                         -- candidate vanished: fail closed
     or (
      (select coalesce(array_agg(c.platform order by c.platform),array[]::text[])
         from public.publication_project_channels c
        where c.project_id=k.project_id and c.client_id=p.client_id and c.enabled
          and c.publication_account_id is null and c.editorial_rules is null)
      is distinct from
      (select coalesce(array_agg(x order by x),array[]::text[])
         from unnest(publications_private.legacy_type_platforms(p.type)) as x)
      or
      (select count(*) from public.publication_project_channels c where c.project_id=k.project_id)
      <> cardinality(publications_private.legacy_type_platforms(p.type))
     ))
 then raise exception 'Backfill post-condition failed' using errcode='P0001'; end if;
 return created;
end $$;

alter table public.publication_project_channels enable row level security;
revoke all on public.publication_project_channels from public,anon,authenticated,service_role;
grant select,insert,update on public.publication_project_channels to service_role;
revoke all on function publications_private.project_publications_eligible(text),publications_private.legacy_type_platforms(text),
 publications_private.guard_project_channel(),publications_private.materialize_legacy_channels(uuid[],text,text,text),
 publications_private.backfill_legacy_channels() from public,anon,authenticated,service_role;
grant execute on function publications_private.project_publications_eligible(text),publications_private.legacy_type_platforms(text),
 publications_private.guard_project_channel(),publications_private.materialize_legacy_channels(uuid[],text,text,text)
 to service_role;
-- backfill_legacy_channels: owner only (migrations / local tests), never callable by the server.
revoke all on function public.publication_channel_save(uuid,text,boolean,uuid,text,text) from public,anon,authenticated;
grant execute on function public.publication_channel_save(uuid,text,boolean,uuid,text,text) to service_role;

-- Initial backfill (option A): every eligible project without channel gets its legacy set, audited as system.
select publications_private.backfill_legacy_channels();
