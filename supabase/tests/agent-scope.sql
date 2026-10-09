-- These execute real database statements; JS mocks are not a substitute.
create function pg_temp.assert_true(condition boolean,label text) returns void language plpgsql as $$ begin if condition is distinct from true then raise exception 'Assertion failed: %',label; end if; update pg_temp.sql_validation_counts set passed=passed+1 where kind='assertions'; end $$;
create function pg_temp.expect_failure(statement text,label text,expected_state text default null) returns void language plpgsql as $$
declare failed boolean:=false;
begin begin execute statement; exception when others then failed:=true; if expected_state is not null and sqlstate<>expected_state then raise exception 'Expected %, got %: %',expected_state,sqlstate,sqlerrm; end if; end; if not failed then raise exception 'Expected rejection: %',label; end if; update pg_temp.sql_validation_counts set passed=passed+1 where kind='expected_rejections'; end $$;
do $$ begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema())); end $$;
grant execute on function pg_temp.assert_true(boolean,text),pg_temp.expect_failure(text,text,text) to service_role;
do $$ declare name text; begin
 foreach name in array array['clients','projects','agents','agent_client_assignments','agent_project_assignments','agent_runs','recommendations','actions','agent_messages','tasks','audit_logs'] loop
  perform pg_temp.assert_true((select relrowsecurity from pg_class where oid=('public.'||name)::regclass),'RLS '||name);
  if name='clients' and to_regclass('pg_temp.remote_replay') is not null and to_regclass('pg_temp.historical_permissions') is null then
   perform pg_temp.assert_true(has_table_privilege('anon','public.clients','SELECT'),'historical clients ACL remains unchanged');
   perform pg_temp.assert_true(has_table_privilege('authenticated','public.clients','SELECT'),'historical clients authenticated ACL remains unchanged');
  else
   perform pg_temp.assert_true(not has_table_privilege('anon','public.'||name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'anon denied '||name);
   perform pg_temp.assert_true(not has_table_privilege('authenticated','public.'||name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'authenticated denied '||name);
  end if;
  perform pg_temp.assert_true(has_table_privilege('service_role','public.'||name,'SELECT,INSERT'),'server permissions '||name);
 end loop;
end $$;
set local role anon;
select pg_temp.expect_failure('select * from public.agent_project_assignments','anon assignment read');
select pg_temp.expect_failure($sql$select public.agent_set_scope('20000000-0000-4000-8000-000000000001','project','user_admin')$sql$,'anon scope RPC');
reset role;
set local role authenticated;
select pg_temp.expect_failure('select * from public.agent_project_assignments','authenticated assignment read');
select pg_temp.expect_failure($sql$select public.agent_project_assignment_set('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',true,'user_admin')$sql$,'authenticated assignment RPC');
reset role;
select pg_temp.assert_true((select agent_scope='client' and scope_review_required from public.agents limit 1),'historic scope flagged');
select pg_temp.assert_true((select project_id is null from public.agent_runs limit 1),'historic run preserved');
select pg_temp.assert_true((select completed_at is null from public.tasks limit 1),'no invented completion date');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.agent_project_assignments','SELECT'),'no browser assignment access');
select pg_temp.assert_true(not has_function_privilege('anon','public.agent_set_scope(uuid,text,text)','EXECUTE'),'scope RPC restricted');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.publication_set_project(uuid,uuid,uuid,text)','EXECUTE'),'publication project RPC restricted');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.agent_project_assignments'::regclass),'assignment RLS');
set local role service_role;
select pg_temp.expect_failure($sql$insert into public.agent_runs(id,agent_id,client_id,project_id,status) values(gen_random_uuid(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','running')$sql$,'client run with project');
insert into public.agent_runs(id,agent_id,client_id,status) values('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','running');
select pg_temp.expect_failure($sql$select public.agent_set_scope('20000000-0000-4000-8000-000000000001','project','user_admin')$sql$,'running work blocks scope change');
update public.agent_runs set status='completed' where id='40000000-0000-4000-8000-000000000002';
select public.agent_set_scope('20000000-0000-4000-8000-000000000001','project','user_admin');
select pg_temp.expect_failure($sql$insert into public.agent_runs(id,agent_id,client_id,status) values(gen_random_uuid(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','running')$sql$,'project run without project');
select pg_temp.expect_failure($sql$select public.agent_project_assignment_set('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',true,'user_admin')$sql$,'foreign client assignment');
select pg_temp.expect_failure($sql$insert into public.agent_runs(id,agent_id,client_id,project_id,status) values(gen_random_uuid(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','running')$sql$,'unassigned project');
select public.agent_project_assignment_set('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',true,'user_admin');
insert into public.agent_runs(id,agent_id,client_id,project_id,status) values('40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','running');
insert into public.recommendations(id,agent_id,client_id,project_id,title) values('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Synthetic project recommendation');
insert into public.agent_messages(id,agent_id,client_id,project_id,recommendation_id,sender_type,message) values('80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','admin','Synthetic project message');
select pg_temp.assert_true((select project_id='30000000-0000-4000-8000-000000000001' from public.agent_messages where id='80000000-0000-4000-8000-000000000001'),'valid message project');
select pg_temp.expect_failure($sql$insert into public.agent_runs(id,agent_id,client_id,project_id,status) values(gen_random_uuid(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','running')$sql$,'cross-client run');
select pg_temp.expect_failure($sql$insert into public.recommendations(id,agent_id,client_id,project_id,title) values(gen_random_uuid(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','Synthetic invalid recommendation')$sql$,'cross-client recommendation','23514');
select pg_temp.expect_failure($sql$insert into public.actions(id,agent_id,client_id,project_id,recommendation_id,status,action_type) values(gen_random_uuid(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',null,'60000000-0000-4000-8000-000000000001','pending_approval','internal.test')$sql$,'action context mismatch','23514');
insert into public.actions(id,agent_id,client_id,project_id,recommendation_id,status,action_type) values('70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','approved','internal.test');
select pg_temp.expect_failure($sql$insert into public.agent_messages(id,agent_id,client_id,project_id,recommendation_id,sender_type,message) values(gen_random_uuid(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',null,'60000000-0000-4000-8000-000000000001','admin','Synthetic invalid message')$sql$,'message context mismatch','23514');
select public.agent_project_assignment_set('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',false,'user_admin');
select pg_temp.expect_failure($sql$update public.actions set status='executing' where id='70000000-0000-4000-8000-000000000001'$sql$,'revoked project blocks execution');
select pg_temp.assert_true((select count(*)=1 from public.agent_project_assignments),'logical removal preserves row');
select pg_temp.assert_true(not exists(select 1 from public.audit_logs where before_data::text like '%Instructions privées%' or after_data::text like '%Instructions privées%' or metadata::text like '%Instructions privées%'),'audit excludes instructions');
select pg_temp.expect_failure($sql$insert into public.tasks(id,client_id,project_id,status,title) values(gen_random_uuid(),'10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','En cours','Synthetic invalid task')$sql$,'new cross-client tasks rejected','23503');
do $$ declare publication uuid; previous_revision uuid; next_revision uuid; old_count integer;
begin
 publication:=public.publication_create_project_manual('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-10-05',1::smallint,'Social','[{"platform":"facebook","text_content":"Contenu","asset_ids":[]}]','user_admin');
 select current_revision_id into previous_revision from public.publications where id=publication;
 perform pg_temp.assert_true((select project_id='30000000-0000-4000-8000-000000000001' from public.publication_revisions where id=previous_revision),'revision project snapshot');
 perform pg_temp.expect_failure(format('select public.publication_set_project(%L,%L,%L,%L)',publication,previous_revision,'30000000-0000-4000-8000-000000000002','user_admin'),'facebook not GBP');
 perform pg_temp.expect_failure(format('select public.publication_set_project(%L,%L,%L,%L)',publication,previous_revision,'30000000-0000-4000-8000-000000000003','user_admin'),'publication wrong client');
 perform pg_temp.assert_true((select current_revision_id=previous_revision from public.publications where id=publication),'failed target change rolls back');
 perform public.publication_review(publication,previous_revision,(select id from public.publication_variants where revision_id=previous_revision),'approved',null,'user_admin');
 next_revision:=public.publication_set_project(publication,previous_revision,'30000000-0000-4000-8000-000000000004','user_admin');
 perform pg_temp.assert_true(next_revision<>previous_revision,'target change creates revision');
 perform pg_temp.assert_true((select status='pending_review' from public.publications where id=publication),'approval invalidated');
 perform pg_temp.assert_true((select count(*)=1 from public.publication_reviews where revision_id=previous_revision),'old review kept');
 perform pg_temp.assert_true(not exists(select 1 from public.publication_reviews where revision_id=next_revision),'new revision unreviewed');
 select count(*) into old_count from public.publications;
 perform pg_temp.expect_failure($sql$select public.publication_create_project_manual('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','2026-10-05',2::smallint,'Invalid GBP','[{"platform":"instagram","text_content":"Non"}]','user_admin')$sql$,'Instagram not GBP');
 perform pg_temp.assert_true((select count(*)=old_count from public.publications),'bad create rolls back');
 perform public.publication_create_project_manual('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','2026-10-05',2::smallint,'GBP','[{"platform":"google_business_profile","text_content":"GBP"}]','user_admin');
end $$;
set constraints all immediate;
select pg_temp.assert_true((select emergency_stop and not generation_enabled and not automation_enabled and not publishing_enabled from public.publication_settings),'no automation activated');
reset role;

-- Scope and assignment audits must be atomic as well as Publications audits.
insert into public.agents(id,name,enabled,status) values('20000000-0000-4000-8000-000000000002','Synthetic rollback agent',true,'Actif');
create function pg_temp.fail_scope_audit() returns trigger language plpgsql as $$ begin raise exception 'Injected scope audit failure' using errcode='55000'; end $$;
create trigger test_fail_scope_audit before insert on public.audit_logs for each row execute function pg_temp.fail_scope_audit();
set local role service_role;
select pg_temp.expect_failure($sql$select public.agent_set_scope('20000000-0000-4000-8000-000000000002','project','user_admin')$sql$,'scope audit rollback','55000');
select pg_temp.assert_true((select agent_scope='client' and scope_review_required from public.agents where id='20000000-0000-4000-8000-000000000002'),'scope change fully rolled back');
select pg_temp.expect_failure($sql$select public.agent_project_assignment_set('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',true,'user_admin')$sql$,'assignment audit rollback','55000');
select pg_temp.assert_true((select not enabled from public.agent_project_assignments where agent_id='20000000-0000-4000-8000-000000000001' and project_id='30000000-0000-4000-8000-000000000001'),'assignment update rolled back');
select pg_temp.expect_failure($sql$select public.agent_project_assignment_set('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004',true,'user_admin')$sql$,'new assignment audit rollback','55000');
select pg_temp.assert_true(not exists(select 1 from public.agent_project_assignments where agent_id='20000000-0000-4000-8000-000000000001' and project_id='30000000-0000-4000-8000-000000000004'),'assignment insert rolled back');
reset role;
drop trigger test_fail_scope_audit on public.audit_logs;

create trigger test_fail_project_publication_audit before insert on public.publication_events for each row execute function pg_temp.fail_scope_audit();
set local role service_role;
do $$ declare publication uuid; before_project uuid; before_revision uuid; revision_count bigint; event_count bigint; publication_count bigint;
begin
 select id,project_id,current_revision_id into publication,before_project,before_revision from public.publications where client_id='10000000-0000-4000-8000-000000000001' and editorial_week='2026-10-05' and slot=1;
 select count(*) into revision_count from public.publication_revisions;
 select count(*) into event_count from public.publication_events;
 select count(*) into publication_count from public.publications;
 perform pg_temp.expect_failure(format('select public.publication_set_project(%L,%L,%L,%L)',publication,before_revision,'30000000-0000-4000-8000-000000000001','user_admin'),'publication project audit rollback','55000');
 perform pg_temp.assert_true((select project_id=before_project and current_revision_id=before_revision from public.publications where id=publication),'project and revision rolled back');
 perform pg_temp.assert_true((select count(*)=revision_count from public.publication_revisions),'cloned revision rolled back');
 perform pg_temp.expect_failure($sql$select public.publication_create_project_manual('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-10-12',1::smallint,'Must rollback','[{"platform":"facebook","text_content":"Local only"}]','user_admin')$sql$,'project publication create audit rollback','55000');
 perform pg_temp.assert_true((select count(*)=publication_count from public.publications),'project publication create rolled back');
 perform pg_temp.assert_true((select count(*)=event_count from public.publication_events),'project audit left no partial events');
end $$;
reset role;
drop trigger test_fail_project_publication_audit on public.publication_events;

-- Regression: audited project changes work even in IMMEDIATE constraint mode.
set constraints all immediate;
set local role service_role;
do $$ declare publication uuid; previous_revision uuid; revision uuid;
begin
 select id,current_revision_id into publication,previous_revision from public.publications where client_id='10000000-0000-4000-8000-000000000001' and editorial_week='2026-10-05' and slot=1;
 revision:=public.publication_set_project(publication,previous_revision,'30000000-0000-4000-8000-000000000001','user_admin');
 perform pg_temp.assert_true(revision<>previous_revision,'IMMEDIATE change creates revision');
 perform pg_temp.assert_true((select project_id='30000000-0000-4000-8000-000000000001' and current_revision_id=revision and status='pending_review' from public.publications where id=publication),'IMMEDIATE root consistent');
 previous_revision:=revision;
 revision:=public.publication_set_project(publication,previous_revision,null,'user_admin');
 perform pg_temp.assert_true((select project_id is null and current_revision_id=revision from public.publications where id=publication),'IMMEDIATE nullable root consistent');
 perform pg_temp.assert_true((select project_id is null from public.publication_revisions where id=revision),'nullable target snapshot');
end $$;
reset role;
