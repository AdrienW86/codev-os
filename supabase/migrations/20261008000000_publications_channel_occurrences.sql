-- Lot 4.3 P3: dated, idempotent and immutable occurrences generated from channel schedules (P2-a).
-- An occurrence means "this channel must have a publication at this exact local date/time"; it is not content.
-- Additive only: legacy publication_cadences / publication_calendar_slots are untouched. No publication, delivery,
-- job, agent or external call is created here.

-- Composite key so an occurrence can reference its slot together with the slot's schedule, channel, project, client.
alter table public.publication_channel_schedule_slots
 add constraint publication_channel_schedule_slots_scope_key unique(id,schedule_id,project_channel_id,project_id,client_id);

-- Local wall-clock time -> instant, DST-aware for any IANA zone. Returns NULL when the local time does not exist
-- (spring-forward gap); when it is ambiguous (fall-back overlap) the latest instant (standard time) is chosen.
-- Candidates are probed every 15 minutes over ±3 hours and kept only if they round-trip to the same local time.
create function publications_private.local_schedule_instant(p_date date,p_time time,p_timezone text) returns timestamptz
language sql stable security invoker set search_path=pg_catalog as $$
 select max(c.t) from (select ((p_date+p_time) at time zone p_timezone)+k*interval '15 minutes' t from generate_series(-12,12) k) c
 where (c.t at time zone p_timezone)=p_date+p_time;
$$;

create table public.publication_channel_occurrences(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null,
 project_id uuid not null,
 project_channel_id uuid not null,
 schedule_id uuid not null,
 schedule_slot_id uuid not null,
 platform text not null check(platform in('facebook','instagram','google_business_profile')),
 local_date date not null,
 local_time time not null check(local_time=date_trunc('minute',local_time)),
 timezone text not null check(length(timezone) between 1 and 64),
 scheduled_for timestamptz not null,
 publication_id uuid,
 skipped_at timestamptz,
 skipped_reason text check(skipped_reason is null or (length(btrim(skipped_reason)) between 1 and 500 and skipped_reason !~ '[\x00-\x1f]')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 -- Business identity: a schedule slot fires at most once per local date (slot = channel + weekday + time).
 -- Different platforms or projects at the same date/time are different slots, hence allowed.
 constraint publication_channel_occurrences_slot_date_key unique(schedule_slot_id,local_date),
 constraint publication_channel_occurrences_publication_key unique(publication_id),
 constraint publication_channel_occurrences_scope_key unique(id,client_id,project_id,platform),
 constraint publication_channel_occurrences_skip_pair check((skipped_at is null)=(skipped_reason is null)),
 constraint publication_channel_occurrences_skip_or_publication check(skipped_at is null or publication_id is null),
 constraint publication_channel_occurrences_slot_fk foreign key(schedule_slot_id,schedule_id,project_channel_id,project_id,client_id)
   references public.publication_channel_schedule_slots(id,schedule_id,project_channel_id,project_id,client_id) on delete restrict,
 constraint publication_channel_occurrences_schedule_fk foreign key(schedule_id,client_id,project_id,project_channel_id)
   references public.publication_channel_schedules(id,client_id,project_id,project_channel_id) on delete restrict,
 -- Platform snapshot must be the channel platform (channel platform is itself immutable).
 constraint publication_channel_occurrences_channel_fk foreign key(project_channel_id,project_id,client_id,platform)
   references public.publication_project_channels(id,project_id,client_id,platform) on delete restrict,
 constraint publication_channel_occurrences_publication_fk foreign key(publication_id,client_id)
   references public.publications(id,client_id) on delete restrict
);
create index publication_channel_occurrences_project_date_idx on public.publication_channel_occurrences(client_id,project_id,local_date,local_time);
create index publication_channel_occurrences_scheduled_idx on public.publication_channel_occurrences(project_id,scheduled_for);

-- Creation: snapshot must match the slot, its schedule timezone and the DST-aware instant; created clean.
create function publications_private.guard_channel_occurrence_insert() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare s public.publication_channel_schedule_slots;h public.publication_channel_schedules;instant timestamptz;
begin
 select * into s from public.publication_channel_schedule_slots where id=new.schedule_slot_id;
 select * into h from public.publication_channel_schedules where id=new.schedule_id;
 if s.id is null or h.id is null or extract(isodow from new.local_date)<>s.weekday or new.local_time<>s.local_time or new.timezone<>h.timezone then
  raise exception 'Occurrence does not match its schedule slot' using errcode='23514'; end if;
 instant:=publications_private.local_schedule_instant(new.local_date,new.local_time,new.timezone);
 if instant is null or new.scheduled_for<>instant then raise exception 'Occurrence instant invalid' using errcode='23514'; end if;
 if new.publication_id is not null or new.skipped_at is not null then raise exception 'Occurrence must be created open' using errcode='23514'; end if;
 return new;
end $$;
-- Updates: the snapshot is immutable. Only two one-way transitions: publication_id NULL -> publication of the same
-- client and project (once), or skipped NULL -> skipped (once). No reverse transition, no delete, no truncate.
create function publications_private.guard_channel_occurrence_update() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.id,new.client_id,new.project_id,new.project_channel_id,new.schedule_id,new.schedule_slot_id,new.platform,new.local_date,new.local_time,new.timezone,new.scheduled_for,new.created_at)
    is distinct from (old.id,old.client_id,old.project_id,old.project_channel_id,old.schedule_id,old.schedule_slot_id,old.platform,old.local_date,old.local_time,old.timezone,old.scheduled_for,old.created_at) then
  raise exception 'Occurrence snapshot is immutable' using errcode='55000'; end if;
 if old.publication_id is not null and new.publication_id is distinct from old.publication_id then raise exception 'Occurrence publication is immutable' using errcode='55000'; end if;
 if old.skipped_at is not null and (new.skipped_at,new.skipped_reason) is distinct from (old.skipped_at,old.skipped_reason) then raise exception 'Occurrence skip is immutable' using errcode='55000'; end if;
 if old.publication_id is null and new.publication_id is not null and not exists(select 1 from public.publications p
   where p.id=new.publication_id and p.client_id=new.client_id and p.project_id=new.project_id) then
  raise exception 'Occurrence publication outside its project' using errcode='23514'; end if;
 return new;
end $$;
create trigger channel_occurrence_timezone before insert on public.publication_channel_occurrences
 for each row execute function publications_private.check_timezone();
create trigger channel_occurrence_insert before insert on public.publication_channel_occurrences
 for each row execute function publications_private.guard_channel_occurrence_insert();
create trigger channel_occurrence_update before update on public.publication_channel_occurrences
 for each row execute function publications_private.guard_channel_occurrence_update();
create trigger channel_occurrence_updated before update on public.publication_channel_occurrences
 for each row execute function publications_private.touch_updated_at();
create trigger channel_occurrence_no_delete before delete on public.publication_channel_occurrences
 for each row execute function publications_private.prevent_history_change();
create trigger channel_occurrence_no_truncate before truncate on public.publication_channel_occurrences
 for each statement execute function publications_private.prevent_history_change();

-- Materializes the missing occurrences of a configured project over [start, end] (at most 12 weeks).
-- Only enabled channels, enabled schedules and enabled slots. Existing occurrences (open, linked or skipped)
-- are never moved, modified, recreated or deleted. Nonexistent local times (DST gap) are reported, not created.
-- One aggregated audit event per call. No publication, delivery or job is created.
create function public.publication_channel_occurrences_ensure(p_project_id uuid,p_start_date date,p_end_date date,p_actor_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare project public.projects;channels integer;candidates integer;created integer;conflicts jsonb;conflict_count integer;
begin
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_project_id is null or p_start_date is null or p_end_date is null
  or p_end_date<p_start_date or p_end_date-p_start_date>83 then
  raise exception 'Invalid occurrence period' using errcode='22023'; end if;
 -- Lock order (project, then channels) matches publication_channel_save; schedule saves lock the channel row.
 select * into project from public.projects where id=p_project_id for no key update;
 if not found then raise exception 'Invalid project' using errcode='23514'; end if;
 perform 1 from public.publication_project_channels where project_id=project.id and client_id=project.client_id order by id for no key update;
 if not found then raise exception 'Project channels not configured' using errcode='23514'; end if;
 -- One statement (data-modifying CTE): candidates, inserts and counters share a single snapshot; no temp table.
 with candidate as (
  select c.id project_channel_id,h.id schedule_id,s.id schedule_slot_id,c.platform,d::date local_date,s.local_time,h.timezone,
   publications_private.local_schedule_instant(d::date,s.local_time,h.timezone) scheduled_for
  from public.publication_project_channels c
  join public.publication_channel_schedules h on h.project_channel_id=c.id and h.client_id=c.client_id and h.project_id=c.project_id
  join public.publication_channel_schedule_slots s on s.schedule_id=h.id
  cross join generate_series(p_start_date,p_end_date,interval '1 day') d
  where c.project_id=project.id and c.client_id=project.client_id and c.enabled and h.enabled and s.enabled and extract(isodow from d)=s.weekday),
 inserted as (
  insert into public.publication_channel_occurrences(client_id,project_id,project_channel_id,schedule_id,schedule_slot_id,platform,local_date,local_time,timezone,scheduled_for)
  select project.client_id,project.id,x.project_channel_id,x.schedule_id,x.schedule_slot_id,x.platform,x.local_date,x.local_time,x.timezone,x.scheduled_for
  from candidate x where x.scheduled_for is not null
  on conflict(schedule_slot_id,local_date) do nothing returning 1),
 conflict as (select *,row_number() over(order by local_date,local_time,platform) rn from candidate where scheduled_for is null)
 select (select count(distinct project_channel_id) from candidate),(select count(*) from candidate),(select count(*) from inserted),(select count(*) from conflict),
  (select coalesce(jsonb_agg(jsonb_build_object('platform',platform,'local_date',local_date,'local_time',to_char(local_time,'HH24:MI'),'timezone',timezone)
    order by local_date,local_time,platform) filter(where rn<=50),'[]'::jsonb) from conflict)
 into channels,candidates,created,conflict_count,conflicts;
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,metadata)
 values('admin',p_actor_id,'publication.occurrences_ensured',project.client_id,'project',project.id,
  jsonb_build_object('project_id',project.id,'start_date',p_start_date,'end_date',p_end_date,'created',created,
   'existing',candidates-conflict_count-created,'dst_conflicts',conflict_count,'channels',channels));
 return jsonb_build_object('created',created,'existing',candidates-conflict_count-created,'dst_conflicts',conflict_count,'channels',channels,'conflicts',conflicts);
end $$;

alter table public.publication_channel_occurrences enable row level security;
revoke all on public.publication_channel_occurrences from public,anon,authenticated,service_role;
grant select,insert,update on public.publication_channel_occurrences to service_role;
revoke all on function publications_private.local_schedule_instant(date,time,text),publications_private.guard_channel_occurrence_insert(),
 publications_private.guard_channel_occurrence_update() from public,anon,authenticated,service_role;
grant execute on function publications_private.local_schedule_instant(date,time,text),publications_private.guard_channel_occurrence_insert(),
 publications_private.guard_channel_occurrence_update() to service_role;
revoke all on function public.publication_channel_occurrences_ensure(uuid,date,date,text) from public,anon,authenticated;
grant execute on function public.publication_channel_occurrences_ensure(uuid,date,date,text) to service_role;
