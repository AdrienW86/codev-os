-- Lot 3: manual deterministic planning only; never change global safety settings.
create function publications_private.valid_cadence(n integer,days jsonb,times jsonb,zone text) returns boolean
language sql stable set search_path=pg_catalog as $$
 select n between 1 and 2 and jsonb_typeof(days)='array' and jsonb_typeof(times)='array'
 and jsonb_array_length(days)=n and jsonb_array_length(times)=n
 and not exists(select 1 from jsonb_array_elements(days) d where d::text !~ '^[1-7]$')
 and not exists(select 1 from jsonb_array_elements_text(times) t where t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
 and (n=1 or (days->0,times->0) is distinct from (days->1,times->1))
 and exists(select 1 from pg_timezone_names where name=zone);
$$;
revoke all on function publications_private.valid_cadence(integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function publications_private.valid_cadence(integer,jsonb,jsonb,text) to service_role;
create table public.publication_cadences(
 id uuid primary key default gen_random_uuid(),client_id uuid not null,project_id uuid not null unique,
 enabled boolean not null default false,posts_per_week smallint not null default 2,
 preferred_weekdays jsonb not null default '[1,5]',preferred_times jsonb not null default '["12:00","12:00"]',
 timezone text not null default 'Europe/Paris',planning_horizon_weeks smallint not null default 4 check(planning_horizon_weeks between 1 and 12),
 auto_create_slots boolean not null default false,require_manual_approval boolean not null default true check(require_manual_approval),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(project_id,client_id) references public.projects(id,client_id) on delete restrict,
 unique(id,project_id,client_id),check(publications_private.valid_cadence(posts_per_week,preferred_weekdays,preferred_times,timezone))
);
create function publications_private.guard_cadence_project() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' and (new.id,new.client_id,new.project_id,new.created_at) is distinct from (old.id,old.client_id,old.project_id,old.created_at) then
  raise exception 'Cadence scope is immutable' using errcode='55000';end if;
 if not exists(select 1 from public.projects where id=new.project_id and type in('Réseaux sociaux','Google Business Profile')) then
  raise exception 'Unsupported cadence project' using errcode='23514';end if;return new;
end $$;
create trigger cadence_project_guard before insert or update on public.publication_cadences for each row execute function publications_private.guard_cadence_project();
-- Independent project cadences replace the historical client-wide cap. Keep
-- the two-slot bound, and preserve uniqueness for historical unscoped content.
alter table public.publications drop constraint publications_client_id_editorial_week_slot_key;
create unique index publications_project_week_slot_key on public.publications(client_id,project_id,editorial_week,slot) where project_id is not null;
create unique index publications_legacy_week_slot_key on public.publications(client_id,editorial_week,slot) where project_id is null;
alter table public.publications add constraint publications_id_project_client_key unique(id,project_id,client_id);
alter table public.publications add column creation_origin text not null default 'manual' check(creation_origin in('manual','system','agent'));
create table public.publication_calendar_slots(
 id uuid primary key default gen_random_uuid(),cadence_id uuid not null,client_id uuid not null,project_id uuid not null,
 editorial_week date not null check(extract(isodow from editorial_week)=1),slot smallint not null check(slot in(1,2)),
 local_date date not null,local_time time not null,timezone text not null,scheduled_for timestamptz not null,
 platforms text[] not null,publication_id uuid unique,
 created_at timestamptz not null default now(),
 unique(project_id,editorial_week,slot),unique(project_id,scheduled_for),unique(id,project_id,client_id),
 foreign key(cadence_id,project_id,client_id) references public.publication_cadences(id,project_id,client_id) on delete restrict,
 foreign key(publication_id,project_id,client_id) references public.publications(id,project_id,client_id) on delete restrict,
 check(local_date>=editorial_week and local_date<editorial_week+7),
 check(platforms=array['facebook','instagram']::text[] or platforms=array['google_business_profile']::text[])
);
create index publication_calendar_period_idx on public.publication_calendar_slots(scheduled_for,client_id,project_id);
create table public.publication_planning_jobs(
 id uuid primary key default gen_random_uuid(),type text not null check(type in('ensure_calendar_slots','prepare_publication','submit_for_review')),
 client_id uuid not null,project_id uuid not null,publication_id uuid,slot_id uuid,revision_id uuid,
 idempotency_key text not null unique check(length(idempotency_key) between 1 and 256),
 status text not null default 'blocked' check(status in('blocked','prepared','succeeded','failed')),
 attempts integer not null default 0 check(attempts>=0),max_attempts integer not null default 3 check(max_attempts between 1 and 10),
 run_after timestamptz not null default now(),last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(attempts<=max_attempts),check(type='ensure_calendar_slots' or publication_id is not null),check(revision_id is null or publication_id is not null),
 foreign key(project_id,client_id) references public.projects(id,client_id) on delete restrict,
 foreign key(publication_id,project_id,client_id) references public.publications(id,project_id,client_id) on delete restrict,
 foreign key(slot_id,project_id,client_id) references public.publication_calendar_slots(id,project_id,client_id) on delete restrict,
 foreign key(revision_id,publication_id,client_id) references public.publication_revisions(id,publication_id,client_id) on delete restrict
);
create index publication_planning_jobs_retry_idx on public.publication_planning_jobs(status,run_after);
create index publication_planning_jobs_scope_idx on public.publication_planning_jobs(client_id,project_id,publication_id);
create function publications_private.guard_calendar_slot() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' and (to_jsonb(new)-'publication_id') is distinct from (to_jsonb(old)-'publication_id') then
  raise exception 'Reserved calendar time is immutable' using errcode='55000';end if;
 if tg_op='UPDATE' and old.publication_id is not null and new.publication_id is distinct from old.publication_id then
  raise exception 'Reserved publication is immutable' using errcode='55000';end if;
 if new.publication_id is not null and not exists(select 1 from public.publications p where p.id=new.publication_id
  and p.client_id=new.client_id and p.project_id=new.project_id and p.editorial_week=new.editorial_week and p.slot=new.slot
  and (p.target_date is null or p.target_date=new.local_date)) then raise exception 'Calendar publication mismatch' using errcode='23514';end if;
 if not publications_private.project_platform_allowed(new.project_id,new.client_id,new.platforms[1]) then
  raise exception 'Calendar platforms incompatible' using errcode='23514';end if;
 if new.scheduled_for at time zone new.timezone <> new.local_date+new.local_time then
  raise exception 'Calendar timezone mismatch' using errcode='23514';end if;
 return new;
end $$;
create trigger calendar_slot_guard before insert or update on public.publication_calendar_slots for each row execute function publications_private.guard_calendar_slot();
create function publications_private.guard_planned_publication() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if new.creation_origin is distinct from old.creation_origin then raise exception 'Creation origin is immutable' using errcode='55000';end if;
 if exists(select 1 from public.publication_calendar_slots s where s.publication_id=new.id and
  (new.project_id is distinct from s.project_id or new.target_date is not null and new.target_date<>s.local_date)) then
  raise exception 'Explicit rescheduling required' using errcode='55000';end if;return new;
end $$;
create trigger planned_publication_guard before update on public.publications for each row execute function publications_private.guard_planned_publication();
create function publications_private.bind_manual_calendar_slot() returns trigger language plpgsql set search_path=pg_catalog as $$
declare reserved uuid;
begin
 select id into reserved from public.publication_calendar_slots where project_id=new.project_id and editorial_week=new.editorial_week and slot=new.slot and publication_id is null for update;
 if reserved is not null then
  update public.publication_calendar_slots set publication_id=new.id where id=reserved;
  insert into public.publication_events(actor_type,action,client_id,resource_type,resource_id,metadata)
  values('system','publication.slot_bound',new.client_id,'calendar_slot',reserved,jsonb_build_object('project_id',new.project_id,'publication_id',new.id));
 end if;return new;
end $$;
create trigger bind_publication_calendar_slot after insert on public.publications for each row execute function publications_private.bind_manual_calendar_slot();
create or replace function agent_scope_private.protect_project_identity() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if new.client_id is distinct from old.client_id then raise exception 'Project client is immutable' using errcode='55000';end if;
 if new.type is distinct from old.type and (exists(select 1 from public.publication_revisions where project_id=old.id)
 or exists(select 1 from public.publication_cadences where project_id=old.id)) then
  raise exception 'Project type has editorial history' using errcode='55000';end if;return new;
end $$;

create function publications_private.guard_planning_job() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' and (new.type,new.client_id,new.project_id,new.publication_id,new.slot_id,new.revision_id,new.idempotency_key)
 is distinct from (old.type,old.client_id,old.project_id,old.publication_id,old.slot_id,old.revision_id,old.idempotency_key) then
  raise exception 'Planning job identity is immutable' using errcode='55000';end if;
 if new.slot_id is not null and new.publication_id is not null and not exists(select 1 from public.publication_calendar_slots s where s.id=new.slot_id and s.publication_id=new.publication_id) then
  raise exception 'Planning job slot mismatch' using errcode='23514';end if;
 return new;
end $$;
create trigger planning_job_guard before insert or update on public.publication_planning_jobs for each row execute function publications_private.guard_planning_job();
create function publications_private.audit_planning_job() returns trigger language plpgsql set search_path=pg_catalog as $$
declare actor text:=nullif(current_setting('codev.publication_planning_actor',true),'');
begin
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values(case when actor is null then 'system' else 'admin' end,actor,case when tg_op='INSERT' then 'publication.planning_job_created' else 'publication.planning_job_updated' end,new.client_id,'planning_job',new.id,
 jsonb_build_object('project_id',new.project_id,'publication_id',new.publication_id,'type',new.type,'status',new.status,'attempts',new.attempts));return new;
end $$;
create trigger planning_job_audit after insert or update on public.publication_planning_jobs for each row execute function publications_private.audit_planning_job();
do $$declare name text;begin
 foreach name in array array['publication_cadences','publication_calendar_slots','publication_planning_jobs'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  execute format('grant select,insert,update on public.%I to service_role',name);
  execute format('create trigger %I before delete on public.%I for each row execute function publications_private.prevent_history_change()',name||'_no_delete',name);
  execute format('create trigger %I before truncate on public.%I for each statement execute function publications_private.prevent_history_change()',name||'_no_truncate',name);
 end loop;
end $$;
create function public.publication_save_cadence(p_project_id uuid,p_config jsonb,p_actor_id text) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare project public.projects;result uuid;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or jsonb_typeof(p_config)<>'object'
 or p_config-'enabled'-'posts_per_week'-'preferred_weekdays'-'preferred_times'-'timezone'-'planning_horizon_weeks'-'auto_create_slots'-'require_manual_approval'<>'{}'::jsonb
 or (p_config->>'require_manual_approval')::boolean is distinct from true then raise exception 'Invalid cadence' using errcode='22023';end if;
 select * into project from public.projects where id=p_project_id for no key update;
 if not found or project.type not in('Réseaux sociaux','Google Business Profile') then raise exception 'Invalid planning project' using errcode='23514';end if;
 insert into public.publication_cadences(client_id,project_id,enabled,posts_per_week,preferred_weekdays,preferred_times,timezone,planning_horizon_weeks,auto_create_slots)
 values(project.client_id,project.id,(p_config->>'enabled')::boolean,(p_config->>'posts_per_week')::smallint,p_config->'preferred_weekdays',p_config->'preferred_times',p_config->>'timezone',(p_config->>'planning_horizon_weeks')::smallint,(p_config->>'auto_create_slots')::boolean)
 on conflict(project_id) do update set enabled=excluded.enabled,posts_per_week=excluded.posts_per_week,preferred_weekdays=excluded.preferred_weekdays,preferred_times=excluded.preferred_times,timezone=excluded.timezone,planning_horizon_weeks=excluded.planning_horizon_weeks,auto_create_slots=excluded.auto_create_slots,updated_at=now() returning id into result;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.cadence_saved',project.client_id,'project',project.id,jsonb_build_object('cadence_id',result,'config',p_config));return result;
end $$;
create function public.publication_ensure_calendar(p_project_id uuid,p_start_week date,p_placeholders boolean,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare cadence public.publication_cadences;project public.projects;week date;day date;instant timestamptz;clock time;ordinal smallint;
 s public.publication_calendar_slots;pub public.publications;publication uuid;slot_id uuid;channels text[];added integer:=0;drafts integer:=0;conflicts integer:=0;job_key text;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_start_week is null or extract(isodow from p_start_week)<>1 or p_placeholders is null then raise exception 'Invalid planning request' using errcode='22023';end if;
 select * into project from public.projects where id=p_project_id for no key update;
 if not found or project.type not in('Réseaux sociaux','Google Business Profile') then raise exception 'Invalid planning project' using errcode='23514';end if;
 select * into cadence from public.publication_cadences where project_id=project.id and client_id=project.client_id for update;
 if not found or not cadence.enabled or not cadence.auto_create_slots then raise exception 'Cadence is disabled' using errcode='55000';end if;
 perform set_config('codev.publication_planning_actor',p_actor_id,true);
 channels:=case when project.type='Réseaux sociaux' then array['facebook','instagram'] else array['google_business_profile'] end;
 for week in select p_start_week+7*g from generate_series(0,cadence.planning_horizon_weeks-1) g loop
  perform pg_advisory_xact_lock(hashtextextended(project.client_id::text||week::text,0));
  for ordinal in 1..cadence.posts_per_week loop
   select * into s from public.publication_calendar_slots where project_id=project.id and editorial_week=week and slot=ordinal for update;
   if found then
    if s.publication_id is not null or not p_placeholders then continue;end if;
    day:=s.local_date;clock:=s.local_time;instant:=s.scheduled_for;slot_id:=s.id;
   else
    day:=week+(cadence.preferred_weekdays->>(ordinal-1))::integer-1;clock:=(cadence.preferred_times->>(ordinal-1))::time;
    instant:=(day+clock) at time zone cadence.timezone;slot_id:=null;
    if instant at time zone cadence.timezone <> day+clock then conflicts:=conflicts+1;continue;end if;
   end if;
   select * into pub from public.publications where client_id=project.client_id and project_id=project.id and editorial_week=week and slot=ordinal for update;
   publication:=pub.id;
   if publication is not null and pub.target_date is not null and pub.target_date<>day then conflicts:=conflicts+1;continue;end if;
   if publication is null and p_placeholders then
    insert into public.publications(client_id,project_id,editorial_week,slot,subject,target_date,creation_origin)
    values(project.client_id,project.id,week,ordinal,'Contenu à préparer',day,'system') returning id into publication;drafts:=drafts+1;
    insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
    values('admin',p_actor_id,'publication.placeholder_created',project.client_id,'publication',publication,jsonb_build_object('project_id',project.id,'origin','system'));
   end if;
   if slot_id is null then
    insert into public.publication_calendar_slots(cadence_id,client_id,project_id,editorial_week,slot,local_date,local_time,timezone,scheduled_for,platforms,publication_id)
    values(cadence.id,project.client_id,project.id,week,ordinal,day,clock,cadence.timezone,instant,channels,publication) returning id into slot_id;added:=added+1;
    insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
    values('admin',p_actor_id,'publication.slot_reserved',project.client_id,'calendar_slot',slot_id,jsonb_build_object('project_id',project.id,'week',week,'slot',ordinal));
   elsif publication is not null then
    update public.publication_calendar_slots set publication_id=publication where id=slot_id and publication_id is null;
    if found then
     insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id)
     values('admin',p_actor_id,'publication.slot_bound',project.client_id,'calendar_slot',slot_id);end if;
   end if;
   if publication is not null then
    insert into public.publication_planning_jobs(type,client_id,project_id,publication_id,slot_id,idempotency_key,last_error)
    values('prepare_publication',project.client_id,project.id,publication,slot_id,'prepare:'||publication,'Content preparation unavailable in Lot 3'),
     ('submit_for_review',project.client_id,project.id,publication,slot_id,'submit:'||publication,'Content and current revision required') on conflict(idempotency_key) do nothing;
   end if;
  end loop;
 end loop;
 job_key:='ensure:'||project.id||':'||p_start_week||':'||cadence.planning_horizon_weeks||':'||md5((to_jsonb(cadence)-'id'-'created_at'-'updated_at')::text)||':'||p_placeholders;
 insert into public.publication_planning_jobs(type,client_id,project_id,idempotency_key,status,last_error)
 values('ensure_calendar_slots',project.client_id,project.id,job_key,'succeeded',case when conflicts>0 then 'Some slots require manual review' end) on conflict(idempotency_key) do nothing;
 perform set_config('codev.publication_planning_actor','',true);
 return jsonb_build_object('slots_created',added,'placeholders_created',drafts,'conflicts',conflicts);
end $$;
revoke all on function public.publication_save_cadence(uuid,jsonb,text),public.publication_ensure_calendar(uuid,date,boolean,text) from public,anon,authenticated;
grant execute on function public.publication_save_cadence(uuid,jsonb,text),public.publication_ensure_calendar(uuid,date,boolean,text) to service_role;

-- Keep the manual allocator consistent with project cadences.
create or replace function public.publication_save_draft(p_publication_id uuid,p_expected_revision_id uuid,p_client_id uuid,p_project_id uuid,p_title text,p_angle text,p_source text,p_target_date date,p_week date,p_slot smallint,p_variants jsonb,p_actor_id text)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare pub public.publications;saved_id uuid;revision uuid;slot smallint;week date;old_project uuid;old_revision uuid;item public.publication_variants;asset uuid;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or coalesce(length(btrim(p_title)),0) not between 1 and 300 or coalesce(length(btrim(p_angle)),0) not between 1 and 3000 or coalesce(length(btrim(p_source)),0) not between 1 and 20000 then raise exception 'Invalid draft' using errcode='22023';end if;
 if p_project_id is null or not exists(select 1 from public.projects where projects.id=p_project_id and client_id=p_client_id and type in('Réseaux sociaux','Google Business Profile')) then raise exception 'Invalid client/project' using errcode='23514';end if;
 perform set_config('codev.publication_editorial',jsonb_build_object('title',btrim(p_title),'angle',btrim(p_angle),'source',btrim(p_source),'target_date',p_target_date,'actor',p_actor_id,'project',p_project_id)::text,true);
 if p_publication_id is null then
  week:=coalesce(p_week,date_trunc('week',coalesce(p_target_date,current_date)::timestamp)::date);
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text||week::text,0));
  slot:=p_slot;
  if slot is null then select s::smallint into slot from generate_series(1,2) s where not exists(select 1 from public.publications where client_id=p_client_id and project_id=p_project_id and editorial_week=week and publications.slot=s)
   and not exists(select 1 from public.publication_calendar_slots c where c.project_id=p_project_id and c.editorial_week=week and c.slot=s and p_target_date is not null and p_target_date<>c.local_date) order by s limit 1;end if;
  if slot is null then raise exception 'Both editorial slots occupied' using errcode='23505';end if;
  saved_id:=public.publication_create_project_manual(p_client_id,p_project_id,week,slot,p_title,p_variants,p_actor_id);
 else
  select * into pub from public.publications where publications.id=p_publication_id for update;
  if not found or pub.client_id<>p_client_id or pub.current_revision_id is distinct from p_expected_revision_id then raise exception 'Stale draft' using errcode='40001';end if;
  old_project:=pub.project_id;
  old_revision:=pub.current_revision_id;
  perform set_config('codev.publication_actor',p_actor_id,true);
  if exists(select 1 from public.publication_deliveries where publication_id=pub.id and status in('processing','published','uncertain')) then raise exception 'Resolve deliveries first' using errcode='55000';end if;
  revision:=publications_private.add_manual_revision(pub.id,pub.client_id,pub.current_revision_id,p_variants);
  update public.publication_deliveries set status='blocked' where publication_id=pub.id and status<>'cancelled';
  update public.publication_jobs set status='cancelled',locked_at=null,locked_by=null where publication_id=pub.id and status in('pending','processing');
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data)
   values('admin',p_actor_id,'publication.revised',p_client_id,'publication',pub.id,jsonb_build_object('revision_id',pub.current_revision_id),jsonb_build_object('revision_id',revision,'status','draft'));
  saved_id:=pub.id;
  if old_project is distinct from p_project_id then
   insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data)
   values('admin',p_actor_id,'publication.project_changed',p_client_id,'publication',saved_id,jsonb_build_object('project_id',old_project),jsonb_build_object('project_id',p_project_id,'revision_id',revision));
  end if;
 end if;
 update public.publications set subject=btrim(p_title),target_date=p_target_date,status='draft',project_id=p_project_id,current_revision_id=coalesce(revision,current_revision_id) where publications.id=saved_id;
 select current_revision_id into revision from public.publications where publications.id=saved_id;
 for item in select * from public.publication_variants where revision_id=revision loop
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
   values('admin',p_actor_id,'publication.variant_saved',p_client_id,'publication',saved_id,jsonb_build_object('revision_id',revision,'variant_id',item.id,'platform',item.platform));
 end loop;
 for asset in select distinct l.asset_id from public.publication_variant_assets l join public.publication_variants v on v.id=l.variant_id where v.revision_id=revision loop
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
   values('admin',p_actor_id,'publication.media_attached',p_client_id,'publication',saved_id,jsonb_build_object('revision_id',revision,'asset_id',asset));
 end loop;
 for asset in select distinct l.asset_id from public.publication_variant_assets l join public.publication_variants v on v.id=l.variant_id where v.revision_id=old_revision
  and not exists(select 1 from public.publication_variant_assets ll join public.publication_variants vv on vv.id=ll.variant_id where vv.revision_id=revision and ll.asset_id=l.asset_id) loop
  insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
   values('admin',p_actor_id,'publication.media_detached',p_client_id,'publication',saved_id,jsonb_build_object('revision_id',revision,'asset_id',asset));
 end loop;
 perform set_config('codev.publication_editorial','',true);
 perform set_config('codev.publication_actor','',true);
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.draft_saved',p_client_id,'publication',saved_id,jsonb_build_object('revision_id',(select current_revision_id from public.publications where publications.id=saved_id)));
 return saved_id;
end $$;

