-- Synthetic PostgreSQL local test only (Lot 4.3 P3). Never execute on a remote project.
-- Runs after P1, P2-a and P3 on a rebuilt local database. Fixtures use runtime UUIDs.
create temporary table p3_ids(name text primary key,id uuid not null);
grant select,insert,update on p3_ids to service_role;

-- 1. Structure, RLS, grants, functions.
select pg_temp.replay_assert((select relrowsecurity from pg_class where oid='public.publication_channel_occurrences'::regclass),'occurrences RLS enabled');
select pg_temp.replay_assert(not exists(select 1 from pg_policies where schemaname='public' and tablename='publication_channel_occurrences'),'occurrences without policy');
do $$declare r text;f text;begin
 foreach r in array array['anon','authenticated'] loop
  perform pg_temp.replay_assert(not has_table_privilege(r,'public.publication_channel_occurrences','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'browser privileges absent');
 end loop;
 perform pg_temp.replay_assert(has_table_privilege('service_role','public.publication_channel_occurrences','SELECT,INSERT,UPDATE'),'server select/insert/update');
 perform pg_temp.replay_assert(not has_table_privilege('service_role','public.publication_channel_occurrences','DELETE') and not has_table_privilege('service_role','public.publication_channel_occurrences','TRUNCATE'),'server delete/truncate denied');
 foreach f in array array['public.publication_channel_occurrences_ensure(uuid,date,date,text)','publications_private.local_schedule_instant(date,time,text)',
  'publications_private.guard_channel_occurrence_insert()','publications_private.guard_channel_occurrence_update()'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
end $$;
set local role anon;
select pg_temp.replay_failure('select * from public.publication_channel_occurrences','42501','actual anon read denied');
set local role authenticated;
select pg_temp.replay_failure('select public.publication_channel_occurrences_ensure(null,null,null,''user_local'')','42501','actual authenticated RPC denied');
set local role service_role;
select pg_temp.replay_failure('delete from public.publication_channel_occurrences','42501','server delete denied at runtime');
select pg_temp.replay_failure('truncate public.publication_channel_occurrences','42501','server truncate denied at runtime');
reset role;

-- 2. Additive migration: nothing generated, legacy calendar / publications / channels / schedules untouched.
select pg_temp.replay_assert(not exists(select 1 from public.publication_channel_occurrences),'no occurrence created by the migration');
select pg_temp.replay_assert((select v from p3_before)=jsonb_build_object(
 'cadences',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_cadences c),
 'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.publication_calendar_slots s),
 'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),
 'channels',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_project_channels c),
 'schedule_slots',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_channel_schedule_slots c),
 'events',(select count(*) from public.publication_events)),'existing data unchanged by the migration');

-- 3. DST-aware local -> instant conversion.
select pg_temp.replay_assert(publications_private.local_schedule_instant('2026-07-01','12:00','Europe/Paris')='2026-07-01 10:00:00+00','summer time (CEST)');
select pg_temp.replay_assert(publications_private.local_schedule_instant('2026-12-01','12:00','Europe/Paris')='2026-12-01 11:00:00+00','winter time (CET)');
select pg_temp.replay_assert(publications_private.local_schedule_instant('2026-03-29','02:30','Europe/Paris') is null,'spring-forward gap: nonexistent local time');
select pg_temp.replay_assert(publications_private.local_schedule_instant('2026-03-29','03:00','Europe/Paris')='2026-03-29 01:00:00+00','first valid time after the gap');
select pg_temp.replay_assert(publications_private.local_schedule_instant('2026-10-25','02:30','Europe/Paris')='2026-10-25 01:30:00+00','fall-back overlap: latest (standard) instant');
select pg_temp.replay_assert(publications_private.local_schedule_instant('2026-03-08','02:30','America/New_York') is null,'other IANA zone gap');
select pg_temp.replay_assert(publications_private.local_schedule_instant('2026-11-01','01:30','America/New_York')='2026-11-01 06:30:00+00','other IANA zone overlap: standard');

-- Fixtures: configured project with FB + IG + GBP schedules; legacy project; other client; DST project.
do $$declare cl uuid:=gen_random_uuid();other uuid:=gen_random_uuid();begin
 insert into public.clients(id,name) values(cl,'P3 occurrences fixture'),(other,'P3 other client');
 insert into p3_ids values('client',cl),('other_client',other),('social',gen_random_uuid()),('legacy',gen_random_uuid()),('dst',gen_random_uuid()),('other_project',gen_random_uuid()),('atomic',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values
  ((select id from p3_ids where name='social'),cl,'P3 social','Réseaux sociaux'),((select id from p3_ids where name='legacy'),cl,'P3 legacy','Réseaux sociaux'),
  ((select id from p3_ids where name='dst'),cl,'P3 dst','Google Business Profile'),((select id from p3_ids where name='other_project'),other,'P3 other','Réseaux sociaux'),
  ((select id from p3_ids where name='atomic'),cl,'P3 atomic','Google Business Profile');
end $$;
set local role service_role;
do $$
declare s uuid:=(select id from p3_ids where name='social');d uuid:=(select id from p3_ids where name='dst');o uuid:=(select id from p3_ids where name='other_project');a uuid:=(select id from p3_ids where name='atomic');
begin
 insert into p3_ids values('fb',public.publication_channel_save(s,'facebook',true,null,null,'user_local')),('gbp',public.publication_channel_save(s,'google_business_profile',true,null,null,'user_local')),
  ('dst_gbp',public.publication_channel_save(d,'google_business_profile',true,null,null,'user_local')),('other_fb',public.publication_channel_save(o,'facebook',true,null,null,'user_local')),
  ('atomic_gbp',public.publication_channel_save(a,'google_business_profile',true,null,null,'user_local'));
 insert into p3_ids select 'ig',id from public.publication_project_channels where project_id=s and platform='instagram';
 insert into p3_ids values
  ('fb_schedule',public.publication_channel_schedule_save((select id from p3_ids where name='fb'),'Europe/Paris',true,'[{"weekday":1,"local_time":"12:00","enabled":true},{"weekday":5,"local_time":"12:00","enabled":true}]','user_local')),
  ('ig_schedule',public.publication_channel_schedule_save((select id from p3_ids where name='ig'),'Europe/Paris',true,'[{"weekday":2,"local_time":"18:00","enabled":true},{"weekday":6,"local_time":"11:00","enabled":true}]','user_local')),
  ('gbp_schedule',public.publication_channel_schedule_save((select id from p3_ids where name='gbp'),'Europe/Paris',true,'[{"weekday":3,"local_time":"12:00","enabled":true}]','user_local')),
  ('dst_schedule',public.publication_channel_schedule_save((select id from p3_ids where name='dst_gbp'),'Europe/Paris',true,'[{"weekday":7,"local_time":"02:30","enabled":true}]','user_local')),
  ('other_schedule',public.publication_channel_schedule_save((select id from p3_ids where name='other_fb'),'Europe/Paris',true,'[{"weekday":1,"local_time":"12:00","enabled":true}]','user_local')),
  ('atomic_schedule',public.publication_channel_schedule_save((select id from p3_ids where name='atomic_gbp'),'Europe/Paris',true,'[{"weekday":1,"local_time":"09:00","enabled":true}]','user_local'));
end $$;

-- 4. One week, FB + IG + GBP independent; idempotence; several weeks; audit; no publication/delivery/job.
do $$
declare s uuid:=(select id from p3_ids where name='social');cl uuid:=(select id from p3_ids where name='client');r jsonb;events bigint;pubs bigint;e public.publication_events;
begin
 select count(*) into events from public.publication_events;select count(*) into pubs from public.publications;
 r:=public.publication_channel_occurrences_ensure(s,'2026-10-12','2026-10-18','user_local');
 perform pg_temp.replay_assert(r=jsonb_build_object('created',5,'existing',0,'dst_conflicts',0,'channels',3,'conflicts','[]'::jsonb),'one week: 5 occurrences over 3 channels');
 perform pg_temp.replay_assert((select array_agg(local_date||' '||to_char(local_time,'HH24:MI')||' '||platform||' '||to_char(scheduled_for at time zone 'UTC','HH24:MI') order by local_date,local_time,platform)
  from public.publication_channel_occurrences where project_id=s)=array['2026-10-12 12:00 facebook 10:00','2026-10-13 18:00 instagram 16:00','2026-10-14 12:00 google_business_profile 10:00',
  '2026-10-16 12:00 facebook 10:00','2026-10-17 11:00 instagram 09:00'],'expected dated occurrences with Paris summer offset');
 perform pg_temp.replay_assert((select bool_and(client_id=cl and timezone='Europe/Paris' and publication_id is null and skipped_at is null) from public.publication_channel_occurrences where project_id=s),'scope and open state');
 perform pg_temp.replay_assert((select count(*) from public.publication_events)=events+1,'one aggregated audit event');
 select * into e from public.publication_events where action='publication.occurrences_ensured' and resource_id=s;
 perform pg_temp.replay_assert(e.actor_type='admin' and e.actor_id='user_local' and e.resource_type='project' and e.client_id=cl
  and e.metadata=jsonb_build_object('project_id',s,'start_date','2026-10-12','end_date','2026-10-18','created',5,'existing',0,'dst_conflicts',0,'channels',3),'audit content');
 r:=public.publication_channel_occurrences_ensure(s,'2026-10-12','2026-10-18','user_local');
 perform pg_temp.replay_assert(r->>'created'='0' and r->>'existing'='5','idempotent: second run creates nothing');
 perform pg_temp.replay_assert((select count(*) from public.publication_channel_occurrences where project_id=s)=5,'still 5 occurrences');
 r:=public.publication_channel_occurrences_ensure(s,'2026-10-12','2026-11-08','user_local');
 perform pg_temp.replay_assert(r->>'created'='15' and r->>'existing'='5' and r->>'channels'='3','four weeks: 15 new, 5 kept');
 perform pg_temp.replay_assert((select to_char(scheduled_for at time zone 'UTC','HH24:MI') from public.publication_channel_occurrences where project_id=s and local_date='2026-10-26' and platform='facebook')='11:00','after fall-back: winter offset');
 perform pg_temp.replay_assert((select count(*) from public.publications)=pubs and not exists(select 1 from public.publication_deliveries) and not exists(select 1 from public.publication_jobs),'no publication, delivery or job created');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_channel_occurrences where project_id=(select id from p3_ids where name='other_project')),'other project untouched');
end $$;

-- 5. Disabled channel / schedule / slot ignored; existing occurrences kept; schedule change never moves an occurrence.
do $$
declare s uuid:=(select id from p3_ids where name='social');r jsonb;before jsonb;
begin
 select jsonb_agg(to_jsonb(o) order by o.id) into before from public.publication_channel_occurrences o where project_id=s;
 perform public.publication_channel_save(s,'instagram',false,null,null,'user_local');
 perform public.publication_channel_schedule_save((select id from p3_ids where name='gbp'),'Europe/Paris',false,'[{"weekday":3,"local_time":"12:00","enabled":true}]','user_local');
 perform public.publication_channel_schedule_save((select id from p3_ids where name='fb'),'Europe/Paris',true,'[{"weekday":1,"local_time":"13:00","enabled":true}]','user_local');
 r:=public.publication_channel_occurrences_ensure(s,'2026-10-12','2026-11-15','user_local');
 perform pg_temp.replay_assert(r->>'created'='5' and r->>'channels'='1','only the enabled FB Monday 13:00 slot generates (5 Mondays)');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_channel_occurrences where project_id=s and local_date>'2026-11-08' and platform in('instagram','google_business_profile')),'disabled channel and disabled schedule ignored');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_channel_occurrences where project_id=s and local_date='2026-11-13'),'disabled Friday slot ignored');
 perform pg_temp.replay_assert(before=(select jsonb_agg(to_jsonb(o) order by o.id) from public.publication_channel_occurrences o where project_id=s and o.id in(select (x->>'id')::uuid from jsonb_array_elements(before) x)),'existing occurrences unchanged (never moved)');
 perform pg_temp.replay_assert((select count(*) from public.publication_channel_occurrences where project_id=s and local_date='2026-10-12' and platform='facebook')=2,'old 12:00 kept, new 13:00 added on the same Monday');
end $$;
reset role;

-- 6. Linked and skipped occurrences: one-way transitions only; ensure never recreates or modifies them.
do $$
declare s uuid:=(select id from p3_ids where name='social');cl uuid:=(select id from p3_ids where name='client');pub uuid;other_pub uuid;linked uuid;skipped uuid;snapshot jsonb;n bigint;
begin
 set local role service_role;
 pub:=public.publication_save_draft(null,null,cl,s,'P3 linked','A','S','2027-01-04',null,null,'[{"platform":"facebook","text_content":"F"}]','user_local');
 other_pub:=public.publication_save_draft(null,null,cl,(select id from p3_ids where name='legacy'),'P3 other project','A','S','2027-01-11',null,null,'[{"platform":"facebook","text_content":"F"}]','user_local');
 reset role;
 select id into linked from public.publication_channel_occurrences where project_id=s and local_date='2026-10-12' and local_time='12:00';
 select id into skipped from public.publication_channel_occurrences where project_id=s and local_date='2026-10-16';
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set publication_id=%L where id=%L',other_pub,linked),'23514','publication of another project refused');
 update public.publication_channel_occurrences set publication_id=pub where id=linked;
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set publication_id=null where id=%L',linked),'55000','link cannot be removed');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set publication_id=%L where id=%L',other_pub,linked),'55000','link cannot be changed');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set publication_id=%L where id=%L',pub,skipped),'23505','one occurrence per publication');
 update public.publication_channel_occurrences set skipped_at=now(),skipped_reason='Jour férié' where id=skipped;
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set skipped_at=null,skipped_reason=null where id=%L',skipped),'55000','skip cannot be undone');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set skipped_reason=''Autre'' where id=%L',skipped),'55000','skip reason immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set skipped_at=now() where id=%L',linked),'23514','skip requires a reason');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set skipped_at=now(),skipped_reason=''x'' where id=%L',linked),'23514','a linked occurrence cannot be skipped');
 select jsonb_agg(to_jsonb(o) order by o.id) into snapshot from public.publication_channel_occurrences o where id in(linked,skipped);select count(*) into n from public.publication_channel_occurrences;
 set local role service_role;
 perform public.publication_channel_occurrences_ensure(s,'2026-10-12','2026-10-18','user_local');
 reset role;
 perform pg_temp.replay_assert(snapshot=(select jsonb_agg(to_jsonb(o) order by o.id) from public.publication_channel_occurrences o where id in(linked,skipped)) and (select count(*) from public.publication_channel_occurrences)=n,'linked and skipped occurrences kept, never recreated');
end $$;

-- 7. Direct writes (owner): snapshot consistency, scopes, immutability, no delete / truncate.
do $$
declare s uuid:=(select id from p3_ids where name='social');cl uuid:=(select id from p3_ids where name='client');other uuid:=(select id from p3_ids where name='other_client');
 fb uuid:=(select id from p3_ids where name='fb');fbs uuid:=(select id from p3_ids where name='fb_schedule');igs uuid:=(select id from p3_ids where name='ig_schedule');
 slot uuid;igslot uuid;occ uuid;
begin
 select id into slot from public.publication_channel_schedule_slots where schedule_id=fbs and weekday=1 and local_time='13:00';
 select id into igslot from public.publication_channel_schedule_slots where schedule_id=igs and weekday=2;
 select id into occ from public.publication_channel_occurrences where project_id=s and local_date='2026-10-19' and platform='facebook' and local_time='12:00';
 perform pg_temp.replay_failure(format('insert into public.publication_channel_occurrences(client_id,project_id,project_channel_id,schedule_id,schedule_slot_id,platform,local_date,local_time,timezone,scheduled_for) values(%L,%L,%L,%L,%L,''facebook'',''2027-02-02'',''13:00'',''Europe/Paris'',''2027-02-02 12:00+00'')',cl,s,fb,fbs,slot),'23514','weekday mismatch');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_occurrences(client_id,project_id,project_channel_id,schedule_id,schedule_slot_id,platform,local_date,local_time,timezone,scheduled_for) values(%L,%L,%L,%L,%L,''facebook'',''2027-02-01'',''13:00'',''Europe/Paris'',''2027-02-01 13:00+00'')',cl,s,fb,fbs,slot),'23514','wrong instant');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_occurrences(client_id,project_id,project_channel_id,schedule_id,schedule_slot_id,platform,local_date,local_time,timezone,scheduled_for) values(%L,%L,%L,%L,%L,''facebook'',''2027-02-01'',''13:00'',''Europe/London'',''2027-02-01 13:00+00'')',cl,s,fb,fbs,slot),'23514','timezone snapshot mismatch');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_occurrences(client_id,project_id,project_channel_id,schedule_id,schedule_slot_id,platform,local_date,local_time,timezone,scheduled_for) values(%L,%L,%L,%L,%L,''instagram'',''2027-02-01'',''13:00'',''Europe/Paris'',''2027-02-01 12:00+00'')',cl,s,fb,fbs,slot),'23503','platform snapshot must be the channel platform');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_occurrences(client_id,project_id,project_channel_id,schedule_id,schedule_slot_id,platform,local_date,local_time,timezone,scheduled_for) values(%L,%L,%L,%L,%L,''facebook'',''2027-02-01'',''13:00'',''Europe/Paris'',''2027-02-01 12:00+00'')',other,s,fb,fbs,slot),'23503','wrong client');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_occurrences(client_id,project_id,project_channel_id,schedule_id,schedule_slot_id,platform,local_date,local_time,timezone,scheduled_for) values(%L,%L,%L,%L,%L,''facebook'',''2027-02-01'',''13:00'',''Europe/Paris'',''2027-02-01 12:00+00'')',cl,s,fb,igs,slot),'23503','schedule of another channel');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_occurrences(client_id,project_id,project_channel_id,schedule_id,schedule_slot_id,platform,local_date,local_time,timezone,scheduled_for) values(%L,%L,%L,%L,%L,''facebook'',''2027-02-02'',''18:00'',''Europe/Paris'',''2027-02-02 17:00+00'')',cl,s,fb,fbs,igslot),'23503','slot of another schedule');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_occurrences(client_id,project_id,project_channel_id,schedule_id,schedule_slot_id,platform,local_date,local_time,timezone,scheduled_for,skipped_at,skipped_reason) values(%L,%L,%L,%L,%L,''facebook'',''2027-02-01'',''13:00'',''Europe/Paris'',''2027-02-01 12:00+00'',now(),''x'')',cl,s,fb,fbs,slot),'23514','created open only');
 perform pg_temp.replay_failure(format('insert into public.publication_channel_occurrences(client_id,project_id,project_channel_id,schedule_id,schedule_slot_id,platform,local_date,local_time,timezone,scheduled_for) values(%L,%L,%L,%L,%L,''facebook'',''2026-10-19'',''13:00'',''Europe/Paris'',''2026-10-19 11:00+00'')',cl,s,fb,fbs,slot),'23505','slot/date identity unique');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set local_date=local_date+7 where id=%L',occ),'55000','date immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set scheduled_for=scheduled_for+interval ''1 hour'' where id=%L',occ),'55000','instant immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set local_time=''14:00'' where id=%L',occ),'55000','time immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set timezone=''Europe/London'' where id=%L',occ),'55000','timezone immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set platform=''instagram'' where id=%L',occ),'55000','platform immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set schedule_slot_id=%L where id=%L',slot,occ),'55000','slot immutable');
 perform pg_temp.replay_failure(format('update public.publication_channel_occurrences set created_at=now()-interval ''1 day'' where id=%L',occ),'55000','created_at immutable');
 perform pg_temp.replay_failure(format('delete from public.publication_channel_occurrences where id=%L',occ),'55000','delete refused for owner');
 perform pg_temp.replay_failure('truncate public.publication_channel_occurrences','55000','truncate refused for owner');
 perform pg_temp.replay_failure(format('delete from public.publication_channel_schedule_slots where id=%L',slot),'55000','slot with occurrences cannot be deleted');
end $$;

-- 8. DST through the RPC: spring gap reported (not created), autumn overlap resolved to standard time.
set local role service_role;
do $$
declare d uuid:=(select id from p3_ids where name='dst');r jsonb;
begin
 r:=public.publication_channel_occurrences_ensure(d,'2026-03-23','2026-03-29','user_local');
 perform pg_temp.replay_assert(r->>'created'='0' and r->>'dst_conflicts'='1' and r->'conflicts'=jsonb_build_array(jsonb_build_object('platform','google_business_profile','local_date','2026-03-29','local_time','02:30','timezone','Europe/Paris')),'spring gap: deterministic conflict');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_channel_occurrences where project_id=d),'no wrong occurrence created in the gap');
 perform pg_temp.replay_assert((select (metadata->>'dst_conflicts')::int from public.publication_events where action='publication.occurrences_ensured' and resource_id=d)=1,'conflict counted in audit');
 r:=public.publication_channel_occurrences_ensure(d,'2026-03-23','2026-04-05','user_local');
 perform pg_temp.replay_assert(r->>'created'='1' and r->>'dst_conflicts'='1','next Sunday created, gap still reported, never created');
 perform pg_temp.replay_assert((select scheduled_for from public.publication_channel_occurrences where project_id=d and local_date='2026-04-05')='2026-04-05 00:30:00+00','summer Sunday 02:30 CEST');
 r:=public.publication_channel_occurrences_ensure(d,'2026-10-19','2026-10-25','user_local');
 perform pg_temp.replay_assert(r->>'created'='1' and r->>'dst_conflicts'='0','autumn overlap created once');
 perform pg_temp.replay_assert((select scheduled_for from public.publication_channel_occurrences where project_id=d and local_date='2026-10-25')='2026-10-25 01:30:00+00','autumn overlap: standard (latest) instant');
end $$;

-- 9. RPC validation.
do $$
declare s uuid:=(select id from p3_ids where name='social');events bigint;
begin
 select count(*) into events from public.publication_events;
 perform pg_temp.replay_failure(format('select public.publication_channel_occurrences_ensure(%L,''2026-10-12'',''2026-10-18'',''admin'')',s),'22023','invalid actor');
 perform pg_temp.replay_failure(format('select public.publication_channel_occurrences_ensure(%L,''2026-10-12'',''2026-10-18'',null)',s),'22023','NULL actor');
 perform pg_temp.replay_failure(format('select public.publication_channel_occurrences_ensure(%L,''2026-10-18'',''2026-10-12'',''user_local'')',s),'22023','end before start');
 perform pg_temp.replay_failure(format('select public.publication_channel_occurrences_ensure(%L,''2026-10-12'',''2027-01-04'',''user_local'')',s),'22023','more than 12 weeks');
 perform pg_temp.replay_failure(format('select public.publication_channel_occurrences_ensure(%L,null,''2026-10-18'',''user_local'')',s),'22023','NULL start');
 perform pg_temp.replay_failure('select public.publication_channel_occurrences_ensure(null,''2026-10-12'',''2026-10-18'',''user_local'')','22023','NULL project');
 perform pg_temp.replay_failure(format('select public.publication_channel_occurrences_ensure(%L,''2026-10-12'',''2026-10-18'',''user_local'')',gen_random_uuid()),'23514','unknown project');
 perform pg_temp.replay_failure(format('select public.publication_channel_occurrences_ensure(%L,''2026-10-12'',''2026-10-18'',''user_local'')',(select id from p3_ids where name='legacy')),'23514','legacy project (no explicit channel) refused');
 perform pg_temp.replay_assert((select count(*) from public.publication_events)=events,'refusals wrote no audit');
 perform pg_temp.replay_assert(public.publication_channel_occurrences_ensure(s,'2026-10-12','2027-01-03','user_local') is not null,'12 weeks accepted');
end $$;
reset role;

-- 10. Audit: bounded keys, no secrets, no business text.
select pg_temp.replay_assert(not exists(select 1 from public.publication_events e where e.action='publication.occurrences_ensured' and (e.resource_type<>'project' or e.before_data is not null or e.after_data is not null
 or exists(select 1 from jsonb_object_keys(e.metadata) k where k not in('project_id','start_date','end_date','created','existing','dst_conflicts','channels')))),'audit keys bounded');
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action='publication.occurrences_ensured' and metadata::text ~* '(external_account_id|credential|token|secret|subject|text_content)'),'audit without secrets or business text');

-- 11. Atomicity: failure injected on the aggregated audit insert (after occurrence inserts). Test-only trigger.
create schema p3_test_injection;
create function p3_test_injection.fail_occurrence_event() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Injected failure after occurrence inserts' using errcode='P0001'; end $$;
grant usage on schema p3_test_injection to service_role;grant execute on function p3_test_injection.fail_occurrence_event() to service_role;
create trigger p3_inject_occurrence before insert on public.publication_events for each row
 when (new.action='publication.occurrences_ensured') execute function p3_test_injection.fail_occurrence_event();
set local role service_role;
do $$declare a uuid:=(select id from p3_ids where name='atomic');events bigint;begin
 select count(*) into events from public.publication_events;
 perform pg_temp.replay_failure(format('select public.publication_channel_occurrences_ensure(%L,''2026-10-12'',''2026-11-08'',''user_local'')',a),'P0001','injected failure after inserts');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_channel_occurrences where project_id=a) and (select count(*) from public.publication_events)=events,'no occurrence and no event persisted');
end $$;
reset role;
drop trigger p3_inject_occurrence on public.publication_events;
drop schema p3_test_injection cascade;
select pg_temp.replay_assert(not exists(select 1 from pg_trigger where tgname='p3_inject_occurrence'),'injection removed');
set local role service_role;
select pg_temp.replay_assert((public.publication_channel_occurrences_ensure((select id from p3_ids where name='atomic'),'2026-10-12','2026-11-08','user_local')->>'created')='4','control run: 4 Mondays');
reset role;

-- 12. Global safety: legacy calendar untouched; no delivery, job or settings change.
select pg_temp.replay_assert((select v->'cadences' from p3_before)=(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_cadences c)
 and (select v->'slots' from p3_before)=(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.publication_calendar_slots s),'legacy cadences and calendar slots untouched');
select pg_temp.replay_assert((select not generation_enabled and not automation_enabled and not publishing_enabled and emergency_stop from public.publication_settings),'global kill switch unchanged');
select pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries) and not exists(select 1 from public.publication_jobs),'no deliveries, no external jobs');
