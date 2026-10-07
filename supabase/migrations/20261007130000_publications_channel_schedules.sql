-- Lot 4.3 P2-a: independent weekly schedule per explicit project channel (Facebook / Instagram / GBP).
-- Additive only: legacy publication_cadences / publication_calendar_slots are untouched until P3.
-- No occurrence, no generation, no worker. Posts per week are derived from enabled slots (never stored).

-- Composite key so a schedule can reference its channel together with the channel's project and client.
alter table public.publication_project_channels
 add constraint publication_project_channels_identity_key unique(id,project_id,client_id);

create table public.publication_channel_schedules(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null,
 project_id uuid not null,
 project_channel_id uuid not null,
 timezone text not null default 'Europe/Paris' check(length(timezone) between 1 and 64),
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint publication_channel_schedules_channel_key unique(project_channel_id),
 constraint publication_channel_schedules_scope_key unique(id,client_id,project_id,project_channel_id),
 -- A schedule only exists for an explicit channel row (never for a legacy-fallback project).
 constraint publication_channel_schedules_channel_fk foreign key(project_channel_id,project_id,client_id)
   references public.publication_project_channels(id,project_id,client_id) on delete restrict,
 constraint publication_channel_schedules_project_fk foreign key(project_id,client_id)
   references public.projects(id,client_id) on delete restrict
);
create index publication_channel_schedules_project_idx on public.publication_channel_schedules(client_id,project_id);

create table public.publication_channel_schedule_slots(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null,
 project_id uuid not null,
 project_channel_id uuid not null,
 schedule_id uuid not null,
 weekday smallint not null check(weekday between 1 and 7),               -- ISO: 1 = Monday ... 7 = Sunday
 local_time time not null check(local_time=date_trunc('minute',local_time)),
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint publication_channel_schedule_slots_time_key unique(schedule_id,weekday,local_time),
 constraint publication_channel_schedule_slots_schedule_fk foreign key(schedule_id,client_id,project_id,project_channel_id)
   references public.publication_channel_schedules(id,client_id,project_id,project_channel_id) on delete restrict
);
create index publication_channel_schedule_slots_channel_idx on public.publication_channel_schedule_slots(project_channel_id);

create function publications_private.guard_channel_schedule() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.id,new.client_id,new.project_id,new.project_channel_id,new.created_at)
    is distinct from (old.id,old.client_id,old.project_id,old.project_channel_id,old.created_at) then
  raise exception 'Schedule identity is immutable' using errcode='55000'; end if;
 return new;
end $$;
-- A slot is identified by its schedule, weekday and local time: only "enabled" may change.
create function publications_private.guard_channel_schedule_slot() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (new.id,new.client_id,new.project_id,new.project_channel_id,new.schedule_id,new.weekday,new.local_time,new.created_at)
    is distinct from (old.id,old.client_id,old.project_id,old.project_channel_id,old.schedule_id,old.weekday,old.local_time,old.created_at) then
  raise exception 'Schedule slot identity is immutable' using errcode='55000'; end if;
 return new;
end $$;
create trigger channel_schedule_timezone before insert or update on public.publication_channel_schedules
 for each row execute function publications_private.check_timezone();
create trigger channel_schedule_identity before update on public.publication_channel_schedules
 for each row execute function publications_private.guard_channel_schedule();
create trigger channel_schedule_updated before update on public.publication_channel_schedules
 for each row execute function publications_private.touch_updated_at();
create trigger channel_schedule_no_delete before delete on public.publication_channel_schedules
 for each row execute function publications_private.prevent_history_change();
create trigger channel_schedule_no_truncate before truncate on public.publication_channel_schedules
 for each statement execute function publications_private.prevent_history_change();
create trigger channel_schedule_slot_identity before update on public.publication_channel_schedule_slots
 for each row execute function publications_private.guard_channel_schedule_slot();
create trigger channel_schedule_slot_updated before update on public.publication_channel_schedule_slots
 for each row execute function publications_private.touch_updated_at();
create trigger channel_schedule_slot_no_delete before delete on public.publication_channel_schedule_slots
 for each row execute function publications_private.prevent_history_change();
create trigger channel_schedule_slot_no_truncate before truncate on public.publication_channel_schedule_slots
 for each statement execute function publications_private.prevent_history_change();

-- Saves the complete schedule of one channel atomically. Slots absent from the payload are disabled (never
-- deleted); a slot coming back (same weekday/time) is re-enabled. One audit event per call.
create function public.publication_channel_schedule_save(p_project_channel_id uuid,p_timezone text,p_enabled boolean,
 p_slots jsonb,p_actor_id text) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare ch public.publication_project_channels;previous public.publication_channel_schedules;existed boolean;saved uuid;
 item jsonb;keys text[]:=array[]::text[];enabled_keys text[]:=array[]::text[];key text;
 before_enabled text[];before_all text[];added integer;reactivated integer;disabled integer;active integer;total integer;
begin
 -- 1. Full validation before any write.
 if p_actor_id is null or p_actor_id !~ '^user_[a-zA-Z0-9_-]{1,200}$' or p_enabled is null or p_project_channel_id is null
  or p_timezone is null or length(p_timezone) not between 1 and 64
  or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone)
  or p_slots is null or jsonb_typeof(p_slots)<>'array' or jsonb_array_length(p_slots)>28 then
  raise exception 'Invalid schedule' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_slots) loop
  -- NULL-safe: every test is coalesced so a missing key can never make the condition NULL (fail closed).
  if jsonb_typeof(item) is distinct from 'object'
   or (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from array['enabled','local_time','weekday']
   or jsonb_typeof(item->'weekday') is distinct from 'number' or not coalesce((item->>'weekday') ~ '^[1-7]$',false)
   or jsonb_typeof(item->'local_time') is distinct from 'string' or not coalesce((item->>'local_time') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$',false)
   or jsonb_typeof(item->'enabled') is distinct from 'boolean' then
   raise exception 'Invalid schedule slot' using errcode='22023'; end if;
  key:=(item->>'weekday')||'|'||(item->>'local_time');
  if key=any(keys) then raise exception 'Duplicate schedule slot' using errcode='22023'; end if;
  keys:=keys||key;
  if (item->>'enabled')::boolean then enabled_keys:=enabled_keys||key; end if;
 end loop;
 -- 2-3. Lock the explicit channel (serializes saves) and check its scope.
 select * into ch from public.publication_project_channels where id=p_project_channel_id for no key update;
 if not found then raise exception 'Invalid channel' using errcode='23514'; end if;
 if not exists(select 1 from public.projects where id=ch.project_id and client_id=ch.client_id) then
  raise exception 'Invalid channel scope' using errcode='23514'; end if;
 -- 4. Create or update the schedule.
 select * into previous from public.publication_channel_schedules where project_channel_id=ch.id for update;
 existed:=found;
 insert into public.publication_channel_schedules(client_id,project_id,project_channel_id,timezone,enabled)
 values(ch.client_id,ch.project_id,ch.id,p_timezone,p_enabled)
 on conflict(project_channel_id) do update set timezone=excluded.timezone,enabled=excluded.enabled
 returning id into saved;
 select coalesce(array_agg(s.weekday||'|'||to_char(s.local_time,'HH24:MI')) filter(where s.enabled),array[]::text[]),
        coalesce(array_agg(s.weekday||'|'||to_char(s.local_time,'HH24:MI')),array[]::text[])
   into before_enabled,before_all from public.publication_channel_schedule_slots s where s.schedule_id=saved;
 -- 5-9. Synchronize slots: disable what is no longer enabled, insert new ones, re-enable returning ones.
 update public.publication_channel_schedule_slots s set enabled=false
  where s.schedule_id=saved and s.enabled and not ((s.weekday||'|'||to_char(s.local_time,'HH24:MI'))=any(enabled_keys));
 insert into public.publication_channel_schedule_slots(client_id,project_id,project_channel_id,schedule_id,weekday,local_time,enabled)
 select ch.client_id,ch.project_id,ch.id,saved,(e->>'weekday')::smallint,(e->>'local_time')::time,(e->>'enabled')::boolean
 from jsonb_array_elements(p_slots) e
 on conflict(schedule_id,weekday,local_time) do update set enabled=excluded.enabled
  where publication_channel_schedule_slots.enabled is distinct from excluded.enabled;
 added:=(select count(*) from unnest(keys) k where not (k=any(before_all)));
 reactivated:=(select count(*) from unnest(enabled_keys) k where k=any(before_all) and not (k=any(before_enabled)));
 disabled:=(select count(*) from unnest(before_enabled) k where not (k=any(enabled_keys)));
 select count(*) filter(where enabled),count(*) into active,total from public.publication_channel_schedule_slots where schedule_id=saved;
 -- 10. One audit event, configuration facts only (no account, credential or token data).
 insert into public.publication_events(actor_type,actor_id,action,client_id,resource_type,resource_id,before_data,after_data,metadata)
 values('admin',p_actor_id,'publication.channel_schedule_configured',ch.client_id,'project_channel_schedule',saved,
  case when existed then jsonb_build_object('enabled',previous.enabled,'timezone',previous.timezone,'active_slots',cardinality(before_enabled)) end,
  jsonb_build_object('enabled',p_enabled,'timezone',p_timezone,'active_slots',active,'stored_slots',total),
  jsonb_build_object('project_id',ch.project_id,'project_channel_id',ch.id,'platform',ch.platform,'created',not existed,
   'slots_added',added,'slots_reactivated',reactivated,'slots_disabled',disabled));
 return saved;
end $$;

alter table public.publication_channel_schedules enable row level security;
alter table public.publication_channel_schedule_slots enable row level security;
revoke all on public.publication_channel_schedules,public.publication_channel_schedule_slots from public,anon,authenticated,service_role;
grant select,insert,update on public.publication_channel_schedules,public.publication_channel_schedule_slots to service_role;
revoke all on function publications_private.guard_channel_schedule(),publications_private.guard_channel_schedule_slot()
 from public,anon,authenticated,service_role;
grant execute on function publications_private.guard_channel_schedule(),publications_private.guard_channel_schedule_slot() to service_role;
revoke all on function public.publication_channel_schedule_save(uuid,text,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.publication_channel_schedule_save(uuid,text,boolean,jsonb,text) to service_role;
