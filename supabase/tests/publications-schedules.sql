-- Synthetic PostgreSQL local test only (Lot 4.3 P2-a). Never execute on a remote project.
-- Runs after the P1 and P2-a migrations on a rebuilt local database. Fixtures use runtime UUIDs.
create temporary table p2_ids(name text primary key,id uuid not null);
grant select,insert,update on p2_ids to service_role;

-- 1. Structure, RLS, grants, functions.
do $$declare t text;r text;f text;begin
 foreach t in array array['publication_channel_schedules','publication_channel_schedule_slots'] loop
  perform pg_temp.replay_assert((select relrowsecurity from pg_class where oid=('public.'||t)::regclass),'RLS enabled '||t);
  perform pg_temp.replay_assert(not exists(select 1 from pg_policies where schemaname='public' and tablename=t),'no policy '||t);
  foreach r in array array['anon','authenticated'] loop
   perform pg_temp.replay_assert(not has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'browser privileges absent '||t);
  end loop;
  perform pg_temp.replay_assert(has_table_privilege('service_role','public.'||t,'SELECT,INSERT,UPDATE'),'server select/insert/update '||t);
  perform pg_temp.replay_assert(not has_table_privilege('service_role','public.'||t,'DELETE') and not has_table_privilege('service_role','public.'||t,'TRUNCATE'),'server delete/truncate denied '||t);
 end loop;
 foreach f in array array['public.publication_channel_schedule_save(uuid,text,boolean,jsonb,text)','publications_private.guard_channel_schedule()','publications_private.guard_channel_schedule_slot()'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
end $$;
select pg_temp.replay_assert(not exists(select 1 from information_schema.columns where table_schema='public' and table_name in('publication_channel_schedules','publication_channel_schedule_slots')
 and column_name in('posts_per_week','metadata')),'posts per week derived, never stored');
set local role anon;
select pg_temp.replay_failure('select * from public.publication_channel_schedules','42501','actual anon read denied');
set local role authenticated;
select pg_temp.replay_failure('select * from public.publication_channel_schedule_slots','42501','actual authenticated read denied');
select pg_temp.replay_failure('select public.publication_channel_schedule_save(null,''Europe/Paris'',true,''[]'',''user_local'')','42501','actual authenticated RPC denied');
set local role service_role;
select pg_temp.replay_failure('delete from public.publication_channel_schedules','42501','server delete denied at runtime');
select pg_temp.replay_failure('truncate public.publication_channel_schedule_slots','42501','server truncate denied at runtime');
reset role;

-- 2. Additive migration: legacy calendar, publications and P1 channels untouched; no schedule created.
select pg_temp.replay_assert((select v from p2_before)=jsonb_build_object(
 'cadences',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_cadences c),
 'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.publication_calendar_slots s),
 'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),
 'channels',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_project_channels c),
 'events',(select count(*) from public.publication_events)),'legacy data, channels and audit unchanged by the migration');
select pg_temp.replay_assert(not exists(select 1 from public.publication_channel_schedules) and not exists(select 1 from public.publication_channel_schedule_slots),'no schedule created by the migration');

-- Fixtures: explicit channels through the P1 RPC; one project stays on the legacy fallback.
do $$declare cl uuid:=gen_random_uuid();other uuid:=gen_random_uuid();begin
 insert into public.clients(id,name) values(cl,'P2 schedules fixture'),(other,'P2 other client');
 insert into p2_ids values('client',cl),('other_client',other),('social',gen_random_uuid()),('gbp',gen_random_uuid()),('legacy',gen_random_uuid()),('other_project',gen_random_uuid()),('atomic',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values
  ((select id from p2_ids where name='social'),cl,'P2 social','Réseaux sociaux'),((select id from p2_ids where name='gbp'),cl,'P2 GBP','Google Business Profile'),
  ((select id from p2_ids where name='legacy'),cl,'P2 legacy','Réseaux sociaux'),((select id from p2_ids where name='other_project'),other,'P2 other','Réseaux sociaux'),
  ((select id from p2_ids where name='atomic'),cl,'P2 atomic','Google Business Profile');
end $$;
set local role service_role;
do $$begin
 insert into p2_ids values
  ('fb',public.publication_channel_save((select id from p2_ids where name='social'),'facebook',true,null,null,'user_local')),
  ('gbp_channel',public.publication_channel_save((select id from p2_ids where name='gbp'),'google_business_profile',true,null,null,'user_local')),
  ('other_channel',public.publication_channel_save((select id from p2_ids where name='other_project'),'facebook',true,null,null,'user_local')),
  ('atomic_channel',public.publication_channel_save((select id from p2_ids where name='atomic'),'google_business_profile',true,null,null,'user_local'));
 insert into p2_ids select 'ig',id from public.publication_project_channels where project_id=(select id from p2_ids where name='social') and platform='instagram';
end $$;
reset role;

-- 3. Initial save, synchronisation, reactivation, timezone change (service_role).
set local role service_role;
do $$
declare fb uuid:=(select id from p2_ids where name='fb');cl uuid:=(select id from p2_ids where name='client');sched uuid;mon uuid;fri uuid;events bigint;e public.publication_events;
begin
 select count(*) into events from public.publication_events;
 sched:=public.publication_channel_schedule_save(fb,'Europe/Paris',true,'[{"weekday":1,"local_time":"12:00","enabled":true},{"weekday":5,"local_time":"12:00","enabled":true}]','user_local');
 insert into p2_ids values('fb_schedule',sched);
 perform pg_temp.replay_assert((select count(*) from public.publication_channel_schedules where project_channel_id=fb)=1
  and (select timezone='Europe/Paris' and enabled and client_id=cl and project_id=(select id from p2_ids where name='social') from public.publication_channel_schedules where id=sched),'initial schedule with channel scope');
 perform pg_temp.replay_assert((select array_agg(weekday||' '||to_char(local_time,'HH24:MI')||' '||enabled order by weekday,local_time) from public.publication_channel_schedule_slots where schedule_id=sched)
  =array['1 12:00 true','5 12:00 true'],'two enabled slots');
 perform pg_temp.replay_assert((select count(*) from public.publication_events)=events+1,'one audit event per save');
 select * into e from public.publication_events where resource_id=sched and action='publication.channel_schedule_configured';
 perform pg_temp.replay_assert(e.resource_type='project_channel_schedule' and e.actor_type='admin' and e.actor_id='user_local' and e.client_id=cl and e.before_data is null
  and e.after_data=jsonb_build_object('enabled',true,'timezone','Europe/Paris','active_slots',2,'stored_slots',2)
  and e.metadata->>'created'='true' and (e.metadata->>'slots_added')::int=2 and e.metadata->>'platform'='facebook' and e.metadata->>'project_channel_id'=fb::text,'initial audit');
 select id into mon from public.publication_channel_schedule_slots where schedule_id=sched and weekday=1;select id into fri from public.publication_channel_schedule_slots where schedule_id=sched and weekday=5;
 -- Monday kept, Friday absent -> disabled, Wednesday 18:00 added.
 perform public.publication_channel_schedule_save(fb,'Europe/Paris',true,'[{"weekday":1,"local_time":"12:00","enabled":true},{"weekday":3,"local_time":"18:00","enabled":true}]','user_local');
 perform pg_temp.replay_assert((select array_agg(weekday||' '||to_char(local_time,'HH24:MI')||' '||enabled order by weekday,local_time) from public.publication_channel_schedule_slots where schedule_id=sched)
  =array['1 12:00 true','3 18:00 true','5 12:00 false'],'sync: Monday kept, Wednesday added, Friday disabled (not deleted)');
 perform pg_temp.replay_assert((select id from public.publication_channel_schedule_slots where schedule_id=sched and weekday=1)=mon,'kept slot keeps its id');
 perform pg_temp.replay_assert((select count(*) from public.publication_events where resource_id=sched and metadata->>'slots_added'='1' and metadata->>'slots_disabled'='1' and metadata->>'slots_reactivated'='0'
  and before_data->>'active_slots'='2' and after_data->>'active_slots'='2' and after_data->>'stored_slots'='3')=1,'sync audit counters');
 -- Friday comes back -> same historical row re-enabled; Wednesday absent -> disabled.
 perform public.publication_channel_schedule_save(fb,'Europe/Paris',true,'[{"weekday":5,"local_time":"12:00","enabled":true},{"weekday":1,"local_time":"12:00","enabled":true}]','user_local');
 perform pg_temp.replay_assert((select id from public.publication_channel_schedule_slots where schedule_id=sched and weekday=5 and enabled)=fri,'historical slot re-enabled, same id');
 perform pg_temp.replay_assert((select count(*) from public.publication_channel_schedule_slots where schedule_id=sched)=3
  and not (select enabled from public.publication_channel_schedule_slots where schedule_id=sched and weekday=3),'Wednesday disabled, no new row');
 perform pg_temp.replay_assert((select count(*) from public.publication_events where resource_id=sched and metadata->>'slots_reactivated'='1' and metadata->>'slots_disabled'='1' and metadata->>'slots_added'='0')=1,'reactivation audited');
 -- Timezone change.
 perform public.publication_channel_schedule_save(fb,'America/New_York',true,'[{"weekday":5,"local_time":"12:00","enabled":true},{"weekday":1,"local_time":"12:00","enabled":true}]','user_local');
 perform pg_temp.replay_assert((select timezone from public.publication_channel_schedules where id=sched)='America/New_York','timezone updated');
 perform pg_temp.replay_assert((select count(*) from public.publication_events where resource_id=sched and before_data->>'timezone'='Europe/Paris' and after_data->>'timezone'='America/New_York')=1,'timezone change audited');
 perform pg_temp.replay_assert((select count(*) from public.publication_channel_schedules where project_channel_id=fb)=1,'still one schedule per channel');
end $$;

-- 4. Zero active slot, disabled schedule, disabled slot in payload, disabled channel keeps its schedule.
do $$
declare fb uuid:=(select id from p2_ids where name='fb');ig uuid:=(select id from p2_ids where name='ig');sched uuid:=(select id from p2_ids where name='fb_schedule');s2 uuid;snapshot jsonb;
begin
 perform public.publication_channel_schedule_save(fb,'America/New_York',true,'[]','user_local');
 perform pg_temp.replay_assert((select count(*) from public.publication_channel_schedule_slots where schedule_id=sched)=3 and not exists(select 1 from public.publication_channel_schedule_slots where schedule_id=sched and enabled)
  and (select enabled from public.publication_channel_schedules where id=sched),'0 active slot is valid; rows kept');
 perform public.publication_channel_schedule_save(fb,'Europe/Paris',false,'[{"weekday":2,"local_time":"09:30","enabled":false},{"weekday":1,"local_time":"12:00","enabled":true}]','user_local');
 perform pg_temp.replay_assert(not (select enabled from public.publication_channel_schedules where id=sched),'disabled schedule is valid');
 perform pg_temp.replay_assert(not (select enabled from public.publication_channel_schedule_slots where schedule_id=sched and weekday=2) and (select enabled from public.publication_channel_schedule_slots where schedule_id=sched and weekday=1),'a slot can be stored disabled');
 s2:=public.publication_channel_schedule_save(ig,'Europe/Paris',true,'[{"weekday":2,"local_time":"18:00","enabled":true},{"weekday":6,"local_time":"11:00","enabled":true}]','user_local');
 perform pg_temp.replay_assert(s2<>sched and (select project_channel_id from public.publication_channel_schedules where id=s2)=ig,'independent schedule per channel');
 select jsonb_build_object('s',(select to_jsonb(s) from public.publication_channel_schedules s where id=s2),'slots',(select jsonb_agg(to_jsonb(x) order by x.id) from public.publication_channel_schedule_slots x where schedule_id=s2)) into snapshot;
 perform public.publication_channel_save((select id from p2_ids where name='social'),'instagram',false,null,null,'user_local');
 perform pg_temp.replay_assert(snapshot=jsonb_build_object('s',(select to_jsonb(s) from public.publication_channel_schedules s where id=s2),'slots',(select jsonb_agg(to_jsonb(x) order by x.id) from public.publication_channel_schedule_slots x where schedule_id=s2)),'disabled channel keeps its schedule');
 perform public.publication_channel_schedule_save(ig,'Europe/Paris',true,'[{"weekday":2,"local_time":"18:00","enabled":true}]','user_local');
 perform pg_temp.replay_assert((select count(*) from public.publication_channel_schedule_slots where schedule_id=s2 and enabled)=1,'schedule of a disabled channel can still be stored');
 perform pg_temp.replay_assert((select count(*) from public.publication_channel_schedule_slots s join public.publication_project_channels c on c.id=s.project_channel_id
  join public.publication_channel_schedules h on h.id=s.schedule_id where s.project_channel_id=ig and c.enabled and h.enabled and s.enabled)=0,'disabled channel: not schedulable (generation rule)');
end $$;

-- 5. RPC validation (no write on refusal).
do $$
declare fb uuid:=(select id from p2_ids where name='fb');rows_before bigint;events_before bigint;
 ok text:='[{"weekday":1,"local_time":"12:00","enabled":true}]';
begin
 select count(*) into rows_before from public.publication_channel_schedule_slots;select count(*) into events_before from public.publication_events;
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Mars/Olympus'',true,%L,''user_local'')',fb,ok),'22023','invalid timezone');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,null,true,%L,''user_local'')',fb,ok),'22023','NULL timezone');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',null,%L,''user_local'')',fb,ok),'22023','NULL enabled');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''admin'')',fb,ok),'22023','invalid actor');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,null)',fb,ok),'22023','NULL actor');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,'{"weekday":1}'),'22023','slots not an array');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,null,''user_local'')',fb),'22023','NULL slots');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,(select jsonb_agg(jsonb_build_object('weekday',1+(i%7),'local_time',to_char(time '00:00'+i*interval '10 minutes','HH24:MI'),'enabled',true)) from generate_series(1,29) i)),'22023','more than 28 slots');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,'[{"weekday":0,"local_time":"12:00","enabled":true}]'),'22023','weekday 0');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,'[{"weekday":8,"local_time":"12:00","enabled":true}]'),'22023','weekday 8');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,'[{"weekday":1.5,"local_time":"12:00","enabled":true}]'),'22023','fractional weekday');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,'[{"weekday":"1","local_time":"12:00","enabled":true}]'),'22023','string weekday');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,'[{"weekday":1,"local_time":"24:00","enabled":true}]'),'22023','invalid time');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,'[{"weekday":1,"local_time":"12:00:30","enabled":true}]'),'22023','seconds refused');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,'[{"weekday":1,"local_time":"12:00","enabled":"yes"}]'),'22023','non-boolean enabled');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,'[{"weekday":1,"local_time":"12:00"}]'),'22023','missing key');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,'[{"weekday":1,"local_time":"12:00","enabled":true,"id":"x"}]'),'22023','extra key refused');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,'[1]'),'22023','scalar slot refused');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',fb,'[{"weekday":1,"local_time":"12:00","enabled":true},{"weekday":1,"local_time":"12:00","enabled":false}]'),'22023','duplicate weekday/time in payload');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',gen_random_uuid(),ok),'23514','unknown channel');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,%L,''user_local'')',(select id from p2_ids where name='legacy'),ok),'23514','legacy fallback project id is not a channel');
 perform pg_temp.replay_assert((select count(*) from public.publication_channel_schedule_slots)=rows_before and (select count(*) from public.publication_events)=events_before,'refusals wrote nothing');
end $$;
reset role;

-- 6. Direct writes (owner): scope, uniqueness, check constraints, immutability, no delete/truncate.
do $$
declare cl uuid:=(select id from p2_ids where name='client');other uuid:=(select id from p2_ids where name='other_client');social uuid:=(select id from p2_ids where name='social');
 gbp uuid:=(select id from p2_ids where name='gbp');legacy uuid:=(select id from p2_ids where name='legacy');fb uuid:=(select id from p2_ids where name='fb');
 gch uuid:=(select id from p2_ids where name='gbp_channel');sched uuid:=(select id from p2_ids where name='fb_schedule');slot uuid;
begin
 select id into slot from public.publication_channel_schedule_slots where schedule_id=sched and weekday=1;
 perform pg_temp.replay_failure(format('insert into public.publication_channel_schedules(client_id,project_id,project_channel_id) values(%L,%L,%L)',cl,social,fb),'23505','one schedule per channel');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_schedules(client_id,project_id,project_channel_id) values(%L,%L,%L)',other,gbp,gch),'23503','wrong client');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_schedules(client_id,project_id,project_channel_id) values(%L,%L,%L)',cl,social,gch),'23503','wrong project');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_schedules(client_id,project_id,project_channel_id) values(%L,%L,%L)',cl,legacy,gen_random_uuid()),'23503','legacy fallback: no channel row, no schedule');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_schedules(client_id,project_id,project_channel_id,timezone) values(%L,%L,%L,''Mars/Olympus'')',cl,gbp,gch),'23514','invalid timezone (direct)');
 perform pg_temp.replay_failure(format('update public.publication_channel_schedules set timezone=''Not/AZone'' where id=%L',sched),'23514','invalid timezone update (direct)');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_schedule_slots(client_id,project_id,project_channel_id,schedule_id,weekday,local_time) values(%L,%L,%L,%L,8,''12:00'')',cl,social,fb,sched),'23514','weekday 8 (direct)');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_schedule_slots(client_id,project_id,project_channel_id,schedule_id,weekday,local_time) values(%L,%L,%L,%L,2,''12:00:30'')',cl,social,fb,sched),'23514','seconds (direct)');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_schedule_slots(client_id,project_id,project_channel_id,schedule_id,weekday,local_time) values(%L,%L,%L,%L,1,''12:00'')',cl,social,fb,sched),'23505','duplicate weekday/time');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_schedule_slots(client_id,project_id,project_channel_id,schedule_id,weekday,local_time) values(%L,%L,%L,%L,4,''12:00'')',cl,social,gch,sched),'23503','slot of another channel');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_schedule_slots(client_id,project_id,project_channel_id,schedule_id,weekday,local_time) values(%L,%L,%L,%L,4,''12:00'')',other,social,fb,sched),'23503','slot of another client');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_schedule_slots(client_id,project_id,project_channel_id,schedule_id,weekday,local_time) values(%L,%L,%L,%L,4,''12:00'')',cl,gbp,fb,sched),'23503','slot of another project');
 perform pg_temp.replay_failure(format('update public.publication_channel_schedules set project_channel_id=%L where id=%L',gch,sched),'55000','schedule channel immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_schedules set client_id=%L where id=%L',other,sched),'55000','schedule client immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_schedules set project_id=%L where id=%L',gbp,sched),'55000','schedule project immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_schedules set created_at=now()-interval ''1 day'' where id=%L',sched),'55000','schedule created_at immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_schedules set id=gen_random_uuid() where id=%L',sched),'55000','schedule id immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_schedule_slots set weekday=4 where id=%L',slot),'55000','slot weekday immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_schedule_slots set local_time=''13:00'' where id=%L',slot),'55000','slot time immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_schedule_slots set schedule_id=gen_random_uuid() where id=%L',slot),'55000','slot schedule immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_schedule_slots set project_channel_id=%L where id=%L',gch,slot),'55000','slot channel immutable');
 perform pg_temp.replay_failure(format('delete from public.publication_channel_schedule_slots where id=%L',slot),'55000','slot delete refused for owner');
 perform pg_temp.replay_failure(format('delete from public.publication_channel_schedules where id=%L',sched),'55000','schedule delete refused for owner');
 perform pg_temp.replay_failure('truncate public.publication_channel_schedule_slots','55000','slot truncate refused for owner');
 -- Plain truncate is refused by PostgreSQL itself (table referenced by the slots FK); CASCADE reaches the triggers.
 perform pg_temp.replay_failure('truncate public.publication_channel_schedules','0A000','schedule truncate refused for owner (FK)');
 perform pg_temp.replay_failure('truncate public.publication_channel_schedules cascade','55000','schedule truncate cascade refused for owner');
 perform pg_temp.replay_failure(format('delete from public.publication_project_channels where id=%L',fb),'55000','channel with a schedule cannot be deleted');
end $$;

-- 7. Audit: typed events, bounded keys, no account identifiers, credentials, tokens or secrets.
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action='publication.channel_schedule_configured' and resource_type<>'project_channel_schedule'),'schedule events typed project_channel_schedule');
select pg_temp.replay_assert(not exists(select 1 from public.publication_events e where e.action='publication.channel_schedule_configured' and (
 exists(select 1 from jsonb_object_keys(e.metadata) k where k not in('project_id','project_channel_id','platform','created','slots_added','slots_reactivated','slots_disabled'))
 or exists(select 1 from jsonb_object_keys(coalesce(e.after_data,'{}')) k where k not in('enabled','timezone','active_slots','stored_slots'))
 or exists(select 1 from jsonb_object_keys(coalesce(e.before_data,'{}')) k where k not in('enabled','timezone','active_slots')))),'schedule audit keys bounded');
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action='publication.channel_schedule_configured' and (
 coalesce(before_data::text,'')||coalesce(after_data::text,'')||metadata::text) ~* '(external_account_id|credential|token|secret|publication_account)'),'schedule audit without secrets');

-- 8. Atomicity: failure injected on the final audit insert (after schedule upsert and slot sync). Test-only trigger.
create schema p2_test_injection;
create function p2_test_injection.fail_schedule_event() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Injected failure after schedule writes' using errcode='P0001'; end $$;
grant usage on schema p2_test_injection to service_role;grant execute on function p2_test_injection.fail_schedule_event() to service_role;
create trigger p2_inject_schedule before insert on public.publication_events for each row
 when (new.action='publication.channel_schedule_configured') execute function p2_test_injection.fail_schedule_event();
set local role service_role;
do $$
declare fb uuid:=(select id from p2_ids where name='fb');ac uuid:=(select id from p2_ids where name='atomic_channel');before_fb jsonb;events bigint;
begin
 select jsonb_build_object('s',(select to_jsonb(s) from public.publication_channel_schedules s where project_channel_id=fb),'slots',(select jsonb_agg(to_jsonb(x) order by x.id) from public.publication_channel_schedule_slots x where project_channel_id=fb)) into before_fb;
 select count(*) into events from public.publication_events;
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Asia/Tokyo'',true,''[{"weekday":7,"local_time":"08:00","enabled":true}]'',''user_local'')',fb),'P0001','injected failure on an existing schedule');
 perform pg_temp.replay_failure(format('select public.publication_channel_schedule_save(%L,''Europe/Paris'',true,''[{"weekday":3,"local_time":"12:00","enabled":true}]'',''user_local'')',ac),'P0001','injected failure on a new schedule');
 perform pg_temp.replay_assert(before_fb=jsonb_build_object('s',(select to_jsonb(s) from public.publication_channel_schedules s where project_channel_id=fb),'slots',(select jsonb_agg(to_jsonb(x) order by x.id) from public.publication_channel_schedule_slots x where project_channel_id=fb)),'existing schedule and slots rolled back');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_channel_schedules where project_channel_id=ac) and not exists(select 1 from public.publication_channel_schedule_slots where project_channel_id=ac),'no schedule or slot persisted for the new channel');
 perform pg_temp.replay_assert((select count(*) from public.publication_events)=events,'no event persisted');
end $$;
reset role;
drop trigger p2_inject_schedule on public.publication_events;
drop schema p2_test_injection cascade;
select pg_temp.replay_assert(not exists(select 1 from pg_trigger where tgname='p2_inject_schedule'),'injection removed');
set local role service_role;
select pg_temp.replay_assert(public.publication_channel_schedule_save((select id from p2_ids where name='atomic_channel'),'Europe/Paris',true,'[{"weekday":3,"local_time":"12:00","enabled":true}]','user_local') is not null,'control run succeeds');
reset role;

-- 9. Global safety: legacy calendar untouched by the whole suite; no delivery, job or settings change.
select pg_temp.replay_assert((select v->'cadences' from p2_before)=(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_cadences c)
 and (select v->'slots' from p2_before)=(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.publication_calendar_slots s),'legacy cadences and calendar slots untouched');
select pg_temp.replay_assert((select not generation_enabled and not automation_enabled and not publishing_enabled and emergency_stop from public.publication_settings),'global kill switch unchanged');
select pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries) and not exists(select 1 from public.publication_jobs),'no deliveries, no external jobs');
