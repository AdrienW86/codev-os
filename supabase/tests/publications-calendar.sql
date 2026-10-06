-- Synthetic local-only tests. Never execute on a remote project.
select pg_temp.replay_assert(not exists(select 1 from legacy_publication_snapshot old left join public.publications p on p.id=(old.value->>'id')::uuid where old.value is distinct from (to_jsonb(p)-'creation_origin')),'historical publications preserved');
select pg_temp.replay_assert((select bool_and(creation_origin='manual') from public.publications),'historical origin manual');
select pg_temp.replay_assert(not exists((select * from legacy_review_snapshot) except (select * from public.publication_reviews)) and (select count(*) from legacy_review_snapshot)=(select count(*) from public.publication_reviews),'old review rows unchanged');
insert into public.projects(id,client_id,name,type) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Social','Réseaux sociaux'),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','GBP','Google Business Profile'),
('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Foreign','Réseaux sociaux'),
('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Unsupported','Google Ads');
select pg_temp.replay_assert((select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in('publication_cadences','publication_calendar_slots','publication_planning_jobs') and relrowsecurity),'three new tables with RLS');
do $$declare t text;r text;begin
 foreach t in array array['publication_cadences','publication_calendar_slots','publication_planning_jobs'] loop
  foreach r in array array['anon','authenticated'] loop
   perform pg_temp.replay_assert(not has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'browser privileges absent');
  end loop;
  perform pg_temp.replay_assert(has_table_privilege('service_role','public.'||t,'SELECT,INSERT,UPDATE'),'server permissions');
  perform pg_temp.replay_assert(not has_table_privilege('service_role','public.'||t,'DELETE,TRUNCATE'),'history destruction denied');
 end loop;
 foreach r in array array['anon','authenticated'] loop
  perform pg_temp.replay_assert(not has_function_privilege(r,'public.publication_ensure_calendar(uuid,date,boolean,text)','EXECUTE'),'calendar RPC browser denied');
  perform pg_temp.replay_assert(not has_function_privilege(r,'public.publication_save_cadence(uuid,jsonb,text)','EXECUTE'),'cadence RPC browser denied');
 end loop;end $$;
set local role anon;
select pg_temp.replay_failure('select * from public.publication_calendar_slots','42501','anon read denied');
set local role authenticated;
select pg_temp.replay_failure('select * from public.publication_cadences','42501','authenticated read denied');
set local role service_role;
do $$declare client uuid:='10000000-0000-4000-8000-000000000001';project uuid:='30000000-0000-4000-8000-000000000001';gbp uuid:='30000000-0000-4000-8000-000000000002';c uuid;p uuid;r uuid;prior uuid;result jsonb;before_events bigint;
 config jsonb:='{"enabled":true,"posts_per_week":2,"preferred_weekdays":[1,5],"preferred_times":["12:00","12:00"],"timezone":"Europe/Paris","planning_horizon_weeks":4,"auto_create_slots":true,"require_manual_approval":true}';
begin
 perform pg_temp.replay_failure(format('select public.publication_ensure_calendar(%L,''2026-10-12'',true,''user_local'')',project),'55000','no implicit cadence');
 c:=public.publication_save_cadence(project,config,'user_local');
 perform pg_temp.replay_assert((select enabled and auto_create_slots from public.publication_cadences where id=c),'checked booleans persisted');
 perform public.publication_save_cadence(project,jsonb_set(jsonb_set(config,'{enabled}','false'),'{auto_create_slots}','false'),'user_local');
 perform pg_temp.replay_assert((select not enabled and not auto_create_slots from public.publication_cadences where id=c),'unchecked booleans persisted on update');
 perform pg_temp.replay_failure(format('select public.publication_ensure_calendar(%L,''2026-10-12'',true,''user_local'')',project),'55000','unchecked cadence blocks generation');
 perform public.publication_save_cadence(project,config,'user_local');
 perform pg_temp.replay_assert((select enabled and auto_create_slots from public.publication_cadences where id=c),'checked booleans persist after reactivation');
 perform pg_temp.replay_assert((select require_manual_approval and client_id=client from public.publication_cadences where id=c),'scope derived from project');
 perform pg_temp.replay_failure(format('select public.publication_save_cadence(%L,%L,''user_local'')',project,jsonb_set(config,'{require_manual_approval}','false')),'22023','approval cannot be disabled');
 perform pg_temp.replay_failure(format('select public.publication_save_cadence(%L,%L,''user_local'')','30000000-0000-4000-8000-000000000004',config),'23514','unsupported project denied');
 perform pg_temp.replay_failure(format('select public.publication_save_cadence(%L,%L,''user_local'')',project,jsonb_set(config,'{preferred_weekdays}','[1,1]')),'23514','duplicate cadence time denied');
 result:=public.publication_ensure_calendar(project,'2026-10-12',true,'user_local');
 perform pg_temp.replay_assert(result->>'slots_created'='8' and result->>'placeholders_created'='8','two slots four weeks');
 perform pg_temp.replay_assert((select count(*)=8 and bool_and(status='draft' and current_revision_id is null and creation_origin='system') from public.publications where project_id=project),'empty system placeholders');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_revisions where project_id=project) and not exists(select 1 from public.publication_variants v join public.publications p on p.id=v.publication_id where p.project_id=project),'no invented content');
 perform pg_temp.replay_assert((select scheduled_for='2026-10-12T10:00:00Z' from public.publication_calendar_slots where editorial_week='2026-10-12' and slot=1),'Paris summer offset');
 perform pg_temp.replay_assert((select scheduled_for='2026-10-26T11:00:00Z' from public.publication_calendar_slots where editorial_week='2026-10-26' and slot=1),'Paris winter offset');
 perform pg_temp.replay_assert((select count(*)=17 and count(*) filter(where status='blocked')=16 from public.publication_planning_jobs),'blocked preparation jobs');
 select count(*) into before_events from public.publication_events;
 result:=public.publication_ensure_calendar(project,'2026-10-12',true,'user_local');
 perform pg_temp.replay_assert(result->>'slots_created'='0' and result->>'placeholders_created'='0','idempotent repeat');
 perform pg_temp.replay_assert((select count(*)=before_events from public.publication_events),'no duplicate events');
 perform pg_temp.replay_assert((select count(*)=17 from public.publication_planning_jobs),'no duplicate jobs');
 perform pg_temp.replay_failure(format('select public.publication_ensure_calendar(%L,''2026-10-13'',true,''user_local'')',project),'22023','editorial Monday mandatory');
 select publication_id into p from public.publication_calendar_slots where project_id=project and editorial_week='2026-10-12' and slot=1;
 perform pg_temp.replay_failure(format('select public.publication_submit_manual(%L,null,''user_local'')',p),'23514','placeholder cannot be submitted');
 perform public.publication_save_draft(p,null,client,project,'Prepared by admin','Angle','Source','2026-10-12',null,null,'[{"platform":"facebook","text_content":"F"},{"platform":"instagram","text_content":"I"}]','user_local');
 select current_revision_id into r from public.publications where id=p;
 perform pg_temp.replay_assert((select revision_number=1 from public.publication_revisions where id=r),'placeholder first revision');
 perform pg_temp.replay_assert((select creation_origin='system' from public.publications where id=p),'root origin retained');
 perform public.publication_submit_manual(p,r,'user_local');perform public.publication_review_manual(p,r,'rejected','Needs revision','user_local');prior:=r;
 perform public.publication_save_draft(p,r,client,project,'New revision','Angle','Source','2026-10-12',null,null,'[{"platform":"facebook","text_content":"New"}]','user_local');
 select current_revision_id into r from public.publications where id=p;
 perform pg_temp.replay_assert(r<>prior and not exists(select 1 from public.publication_reviews where revision_id=r),'fresh human approval required');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_reviews where revision_id=prior),'refusal retained once');
 perform pg_temp.replay_failure(format('update public.publications set creation_origin=''agent'' where id=%L',p),'55000','origin immutable');
 perform pg_temp.replay_failure(format('update public.publication_calendar_slots set local_date=local_date+1 where publication_id=%L',p),'55000','reserved times immutable');
 perform pg_temp.replay_failure(format('insert into public.publications(client_id,project_id,editorial_week,slot,subject) values(%L,%L,''2026-10-12'',1,''Duplicate'')',client,project),'23505','unique publication project slot');
 perform pg_temp.replay_failure(format('insert into public.publications(client_id,project_id,editorial_week,slot,subject) values(%L,%L,''2026-10-12'',3,''Third'')',client,project),'23514','two slot cap');
 perform pg_temp.replay_failure(format('insert into public.publication_cadences(client_id,project_id) values(%L,%L)',client,'30000000-0000-4000-8000-000000000003'),'23503','cross-client cadence denied');
 perform pg_temp.replay_failure(format('insert into public.publication_planning_jobs(type,client_id,project_id,publication_id,idempotency_key) values(''prepare_publication'',%L,%L,%L,''cross-client'')','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003',p),'23503','cross-client job denied');
 perform pg_temp.replay_failure(format('delete from public.clients where id=%L',client),'55000','agent and publication history protected');
 perform public.publication_save_cadence('30000000-0000-4000-8000-000000000003',jsonb_set(config,'{planning_horizon_weeks}','1'),'user_local');
 perform public.publication_ensure_calendar('30000000-0000-4000-8000-000000000003','2026-10-12',true,'user_local');
 perform pg_temp.replay_failure('delete from public.clients where id=''10000000-0000-4000-8000-000000000002''','23503','publication history FK blocks client without agent history');
 perform public.publication_save_cadence(gbp,jsonb_set(jsonb_set(jsonb_set(config,'{posts_per_week}','1'),'{preferred_weekdays}','[3]'),'{preferred_times}','["09:00"]'),'user_local');
 result:=public.publication_ensure_calendar(gbp,'2026-10-12',false,'user_local');
 perform pg_temp.replay_assert(result->>'slots_created'='4' and result->>'placeholders_created'='0','independent GBP cadence reservations only');
 result:=public.publication_ensure_calendar(gbp,'2026-10-12',true,'user_local');
 perform pg_temp.replay_assert(result->>'slots_created'='0' and result->>'placeholders_created'='4','bind placeholders once');
 perform pg_temp.replay_assert((select bool_and(platforms=array['google_business_profile']) from public.publication_calendar_slots where project_id=gbp),'GBP platforms isolated');
 perform public.publication_save_cadence(project,jsonb_set(config,'{preferred_times}','["14:00","14:00"]'),'user_local');
 perform public.publication_ensure_calendar(project,'2026-10-12',true,'user_local');
 perform pg_temp.replay_assert((select local_time='12:00' from public.publication_calendar_slots where project_id=project and editorial_week='2026-10-12' and slot=1),'config cannot move existing slots');
 -- Restore for reproducible concurrency expectations.
 perform public.publication_save_cadence(project,config,'user_local');
 p:=public.publication_save_draft(null,null,client,project,'Manual existing','A','S','2026-11-10',null,null,'[{"platform":"facebook","text_content":"F"}]','user_local');
 result:=public.publication_ensure_calendar(project,'2026-11-09',false,'user_local');
 perform pg_temp.replay_assert(result->>'conflicts'='1','different manual date is a conflict');
 perform pg_temp.replay_assert((select target_date='2026-11-10' and creation_origin='manual' from public.publications where id=p),'manual publication unchanged');
 p:=public.publication_save_draft(null,null,client,gbp,'Manual GBP','A','S','2026-11-10',null,null,'[{"platform":"google_business_profile","text_content":"G"}]','user_local');
 perform pg_temp.replay_assert((select slot=1 from public.publications where id=p),'manual allocator project scoped');
 -- A manual draft consumes an already reserved compatible slot exactly once.
 p:=public.publication_save_draft(null,null,client,project,'Manual bound','A','S','2026-11-13',null,null,'[{"platform":"facebook","text_content":"F"}]','user_local');
 perform pg_temp.replay_assert((select publication_id=p from public.publication_calendar_slots where project_id=project and editorial_week='2026-11-09' and slot=2),'manual draft binds existing reservation');
 perform pg_temp.replay_failure(format('select public.publication_save_draft(%L,(select current_revision_id from public.publications where id=%L),%L,%L,''Moved'',''A'',''S'',''2026-11-14'',null,null,''[{"platform":"facebook","text_content":"F"}]'',''user_local'')',p,p,client,project),'55000','bound manual draft cannot silently move');
 perform pg_temp.replay_failure(format('update public.projects set type=''Google Business Profile'' where id=%L',project),'55000','planning project type immutable');
 perform pg_temp.replay_failure(format('insert into public.publication_planning_jobs(type,client_id,project_id,publication_id,slot_id,idempotency_key) select ''prepare_publication'',%L,%L,%L,id,''wrong-slot'' from public.publication_calendar_slots where project_id=%L and editorial_week=''2026-10-12'' and slot=1',client,project,p,project),'23514','job cannot target another slot publication');
 insert into public.publications(client_id,project_id,editorial_week,slot,subject,creation_origin) values(client,project,'2027-02-01',1,'Future agent placeholder','agent');
 perform pg_temp.replay_assert(exists(select 1 from public.publications where creation_origin='agent'),'agent creation origin supported');
 perform pg_temp.replay_assert(exists(select 1 from public.publication_events where action='publication.planning_job_created' and actor_id='user_local'),'job initiator recorded');
 perform pg_temp.replay_failure(format('insert into public.publication_cadences(client_id,project_id) values(%L,%L)',client,'30000000-0000-4000-8000-000000000004'),'23514','DB cadence rejects unsupported project');
 perform public.publication_save_cadence('30000000-0000-4000-8000-000000000003','{"enabled":true,"posts_per_week":1,"preferred_weekdays":[7],"preferred_times":["02:30"],"timezone":"Europe/Paris","planning_horizon_weeks":1,"auto_create_slots":true,"require_manual_approval":true}','user_local');
 result:=public.publication_ensure_calendar('30000000-0000-4000-8000-000000000003','2026-03-23',false,'user_local');
 perform pg_temp.replay_assert(result->>'conflicts'='1' and result->>'slots_created'='0','DST gap reported without silently shifting');
 perform public.publication_ensure_calendar('30000000-0000-4000-8000-000000000003','2026-10-19',false,'user_local');
 perform pg_temp.replay_assert((select scheduled_for='2026-10-25T01:30:00Z' from public.publication_calendar_slots where project_id='30000000-0000-4000-8000-000000000003' and editorial_week='2026-10-19'),'DST overlap matches pure engine later instant');
 perform pg_temp.replay_assert((select emergency_stop and not generation_enabled and not automation_enabled and not publishing_enabled from public.publication_settings),'kill switch unchanged');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_jobs) and not exists(select 1 from public.publication_deliveries),'no autonomous publishing work');
end $$;
reset role;
-- Inject failures into real RPC dependencies and prove complete rollback.
create temporary table planning_before as select (select count(*) from public.publication_events) events,(select count(*) from public.publication_planning_jobs) jobs;
grant select on planning_before to service_role;
create function pg_temp.fail_planning() returns trigger language plpgsql as $$begin raise exception 'Injected dependency failure' using errcode='P0001';end $$;
create trigger fail_audit before insert on public.publication_events for each row execute function pg_temp.fail_planning();
set local role service_role;
select pg_temp.replay_failure('select public.publication_ensure_calendar(''30000000-0000-4000-8000-000000000001'',''2026-12-07'',true,''user_local'')','P0001','audit failure');
select pg_temp.replay_assert(not exists(select 1 from public.publications where editorial_week between '2026-12-07' and '2027-01-03'),'audit rollback publication');
select pg_temp.replay_assert(not exists(select 1 from public.publication_calendar_slots where editorial_week between '2026-12-07' and '2027-01-03'),'audit rollback slots');
select pg_temp.replay_assert((select count(*) from public.publication_events)=(select events from planning_before) and (select count(*) from public.publication_planning_jobs)=(select jobs from planning_before),'audit rollback events and jobs');
reset role;drop trigger fail_audit on public.publication_events;
create trigger fail_job before insert on public.publication_planning_jobs for each row execute function pg_temp.fail_planning();
set local role service_role;
select pg_temp.replay_failure('select public.publication_ensure_calendar(''30000000-0000-4000-8000-000000000001'',''2026-12-07'',true,''user_local'')','P0001','job failure');
select pg_temp.replay_assert(not exists(select 1 from public.publications where editorial_week between '2026-12-07' and '2027-01-03'),'job rollback publication');
select pg_temp.replay_assert(not exists(select 1 from public.publication_calendar_slots where editorial_week between '2026-12-07' and '2027-01-03'),'job rollback slots');
select pg_temp.replay_assert(not exists(select 1 from public.publication_events e join public.publications p on e.resource_id=p.id where p.editorial_week between '2026-12-07' and '2027-01-03'),'job rollback audit');
select pg_temp.replay_assert((select count(*) from public.publication_events)=(select events from planning_before) and (select count(*) from public.publication_planning_jobs)=(select jobs from planning_before),'job rollback events and jobs');
reset role;drop trigger fail_job on public.publication_planning_jobs;
