-- Executed only after all five migrations on the faithful local schema.
create temporary table historical_permissions(marker boolean);

do $$ declare item record; role_name text; permission text; begin
 for item in select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' loop
  perform pg_temp.replay_assert(item.relrowsecurity,'RLS retained: '||item.relname);
  foreach role_name in array array['anon','authenticated'] loop
   foreach permission in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    perform pg_temp.replay_assert(not has_table_privilege(role_name,'public.'||item.relname,permission),role_name||' denied '||permission||' on '||item.relname);
   end loop;
   perform pg_temp.replay_failure(format('set local role %I; select * from public.%I',role_name,item.relname),'42501','actual SELECT denial');
   perform pg_temp.replay_failure(format('set local role %I; insert into public.%I default values',role_name,item.relname),'42501','actual INSERT denial');
  end loop;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   perform pg_temp.replay_assert(not has_table_privilege(role_name,'public.'||item.relname,'TRUNCATE'),'TRUNCATE ACL denied: '||role_name||'/'||item.relname);
   perform pg_temp.replay_failure(format('set local role %I; truncate public.%I',role_name,item.relname),'42501','actual TRUNCATE denial: '||role_name||'/'||item.relname);
  end loop;
  perform pg_temp.replay_assert(has_table_privilege('service_role','public.'||item.relname,'SELECT'),'server can still read: '||item.relname);
  perform pg_temp.replay_assert(has_table_privilege('service_role','public.'||item.relname,'INSERT'),'server can still insert: '||item.relname);
 end loop;
 perform pg_temp.replay_assert((select count(*)=27 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),'all 27 business tables tested');
 perform pg_temp.replay_assert(not exists(select 1 from pg_policies where schemaname='public'),'no policy added');
end $$;
do $$ declare name text; begin
 foreach name in array array['clients','projects','tasks','agents','agent_client_assignments','client_services','client_connections','client_events'] loop
  perform pg_temp.replay_assert(has_table_privilege('service_role','public.'||name,'UPDATE'),'mutable backend UPDATE retained: '||name);
  perform pg_temp.replay_assert(has_table_privilege('service_role','public.'||name,'DELETE'),'mutable backend DELETE retained: '||name);
 end loop;
 foreach name in array array['agent_runs','recommendations','actions','agent_messages'] loop
  perform pg_temp.replay_assert(has_table_privilege('service_role','public.'||name,'UPDATE'),'history status UPDATE retained: '||name);
  perform pg_temp.replay_assert(not has_table_privilege('service_role','public.'||name,'DELETE'),'history DELETE revoked: '||name);
  perform pg_temp.replay_failure(format('set local role service_role; delete from public.%I',name),'42501','server historical DELETE denied');
  perform pg_temp.replay_failure(format('set local role postgres; delete from public.%I',name),'55000','owner historical DELETE guard');
 end loop;
 perform pg_temp.replay_assert(not has_table_privilege('service_role','public.audit_logs','UPDATE,DELETE'),'append-only audit ACL');
 perform pg_temp.replay_failure('set local role service_role; update public.audit_logs set metadata=''{}''','42501','server audit UPDATE ACL');
 perform pg_temp.replay_failure('set local role service_role; delete from public.audit_logs','42501','server audit DELETE ACL');
 perform pg_temp.replay_failure('set local role postgres; update public.audit_logs set metadata=''{}''','P0001','old audit UPDATE trigger retained');
 perform pg_temp.replay_failure('set local role postgres; delete from public.audit_logs','P0001','old audit DELETE trigger retained');
 perform pg_temp.replay_assert(exists(select 1 from pg_trigger where tgrelid='public.audit_logs'::regclass and tgname='audit_logs_no_update_delete' and tgenabled='O'),'original audit trigger enabled');
end $$;

-- Existing RPC execution and definitions must survive this ACL-only adjustment.
do $$ declare f record; count integer:=0; begin
 for f in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'publication\_%' escape '\' or p.proname like 'agent\_%' escape '\') loop
  count:=count+1;
  perform pg_temp.replay_assert(not f.prosecdef,'RPC stays invoker');
  perform pg_temp.replay_assert(f.proconfig @> array['search_path=pg_catalog'],'explicit RPC search_path retained');
  perform pg_temp.replay_assert(not has_function_privilege('anon',f.oid,'EXECUTE'),'anon RPC EXECUTE denied');
  perform pg_temp.replay_assert(not has_function_privilege('authenticated',f.oid,'EXECUTE'),'authenticated RPC EXECUTE denied');
  perform pg_temp.replay_assert(has_function_privilege('service_role',f.oid,'EXECUTE'),'server RPC EXECUTE retained');
 end loop;
 perform pg_temp.replay_assert(count=7,'all seven business RPCs checked');
 for f in select p.oid,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('agent_scope_private','publications_private') loop
  perform pg_temp.replay_assert(not has_function_privilege('anon',f.oid,'EXECUTE') and not has_function_privilege('authenticated',f.oid,'EXECUTE'),'private helper EXECUTE denied');
  perform pg_temp.replay_assert(has_function_privilege('service_role',f.oid,'EXECUTE'),'server helper access retained');
 end loop;
end $$;

-- Direct DELETE ACL is not enough to stop a parent ON DELETE CASCADE.
-- No project assignments or Publications reference these historical parents yet.
select pg_temp.replay_failure($sql$set local role service_role; delete from public.agents where id='20000000-0000-4000-8000-000000000001'$sql$,'55000','agent cascade cannot erase history');
select pg_temp.replay_failure($sql$set local role service_role; delete from public.clients where id='10000000-0000-4000-8000-000000000001'$sql$,'55000','client cascade cannot erase history');
select pg_temp.replay_failure($sql$set local role postgres; delete from public.recommendations where id='60000000-0000-4000-8000-000000000099'$sql$,'55000','recommendation history cannot be deleted');
select pg_temp.replay_assert((select count(*)=1 from public.agent_runs),'run history survived cascade tests');
select pg_temp.replay_assert((select count(*)=1 from public.recommendations),'recommendation history survived cascade tests');
select pg_temp.replay_assert((select count(*)=1 from public.actions),'action history survived cascade tests');
select pg_temp.replay_assert((select count(*)=1 from public.agent_messages),'message history survived cascade tests');
set local role service_role;
insert into public.audit_logs(actor_type,actor_id,action,resource_type,resource_id) values('admin','user_local_fixture','fixture.hardening_audit','fixture','non-uuid-text-still-supported');
select pg_temp.replay_assert(exists(select 1 from public.audit_logs where resource_id='non-uuid-text-still-supported'),'backend audit INSERT and SELECT still work');
update public.recommendations set status='rejected' where id='60000000-0000-4000-8000-000000000099';
update public.recommendations set status='archived' where id='60000000-0000-4000-8000-000000000099';
select pg_temp.replay_assert((select status='archived' from public.recommendations where id='60000000-0000-4000-8000-000000000099'),'recommendation rejected/archived retains row');
update public.actions set status='cancelled' where id='70000000-0000-4000-8000-000000000099';
update public.actions set status='failed' where id='70000000-0000-4000-8000-000000000099';
update public.actions set status='executed' where id='70000000-0000-4000-8000-000000000099';
select pg_temp.replay_assert((select status='executed' from public.actions where id='70000000-0000-4000-8000-000000000099'),'action terminal status writes remain possible');
update public.agent_runs set status='failed' where id='40000000-0000-4000-8000-000000000001';
update public.agent_runs set status='completed' where id='40000000-0000-4000-8000-000000000001';
select pg_temp.replay_assert((select status='completed' from public.agent_runs where id='40000000-0000-4000-8000-000000000001'),'run terminal status writes remain possible');
reset role;
