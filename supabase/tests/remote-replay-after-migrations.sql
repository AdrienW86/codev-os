-- Compare every historical row/column before introducing test projects.
do $$ declare item record; after_rows jsonb; remove_keys text[]; begin
 for item in select * from pg_temp.remote_history loop
  remove_keys:=case when item.table_name='agents' then array['agent_scope','scope_review_required']
   when item.table_name in ('agent_runs','recommendations','actions','agent_messages') then array['project_id']
   when item.table_name='tasks' then array['completed_at'] else array[]::text[] end;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)-$1 order by (to_jsonb(t)-$1)::text),''[]''::jsonb) from public.%I t',item.table_name) into after_rows using remove_keys;
  perform pg_temp.replay_assert(after_rows=item.rows_before,'historical rows/columns preserved: '||item.table_name);
 end loop;
 perform pg_temp.replay_assert((select count(*)=13 from pg_temp.remote_history),'all historical tables snapshotted');
 perform pg_temp.replay_assert((select count(*)=2 and bool_and(agent_scope='client' and scope_review_required) from public.agents),'both historical agents flagged client');
 perform pg_temp.replay_assert(not exists(select 1 from public.agent_project_assignments),'no invented project assignments');
 perform pg_temp.replay_assert(not exists(select 1 from public.projects),'zero historical projects preserved');
end $$;
do $$ declare name text; assigned bigint; begin
 foreach name in array array['agent_runs','recommendations','actions','agent_messages','publications','publication_revisions'] loop
  execute format('select count(*) from public.%I where project_id is not null',name) into assigned;
  perform pg_temp.replay_assert(assigned=0,'no invented project_id: '||name);
 end loop;
 perform pg_temp.replay_assert((select completed_at is null from public.tasks where id='50000000-0000-4000-8000-000000000001'),'no invented task completion');
 perform pg_temp.replay_assert((select count(*)=7 from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and x.contype='f' and not x.convalidated),'seven new project FKs remain NOT VALID');
end $$;

-- Historical ACLs deliberately left as observed, without hardening them.
do $$ declare name text; role_name text; permission text; unchanged boolean; begin
 foreach name in array array['clients','projects','tasks','agents','agent_client_assignments','agent_runs','recommendations','actions','agent_messages','audit_logs','client_services','client_connections','client_events'] loop
  unchanged:=name in ('clients','client_services','client_connections','client_events');
  perform pg_temp.replay_assert((select relrowsecurity from pg_class where oid=('public.'||name)::regclass),'historical RLS: '||name);
  foreach role_name in array array['anon','authenticated'] loop
   foreach permission in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    perform pg_temp.replay_assert(has_table_privilege(role_name,'public.'||name,permission)=unchanged,role_name||' '||permission||' '||name);
   end loop;
  end loop;
  foreach permission in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
   perform pg_temp.replay_assert(has_table_privilege('service_role','public.'||name,permission),'server historic privilege unchanged: '||name||' '||permission);
  end loop;
 end loop;
 perform pg_temp.replay_assert(not exists(select 1 from pg_policies where schemaname='public'),'no policy silently added');
end $$;

-- Test broad privileges against real statements, always undo successful damage.
set local role anon;
select pg_temp.replay_assert((select count(*)=0 from public.clients),'RLS still hides clients despite SELECT grant');
select pg_temp.replay_failure($sql$insert into public.clients(name) values('Synthetic forbidden insert')$sql$,'42501','RLS refuses client insert');
reset role;
select pg_temp.replay_failure('set local role anon; truncate public.audit_logs','42501','audit_logs anon TRUNCATE revoked');
select pg_temp.replay_failure('set local role authenticated; truncate public.audit_logs','42501','audit_logs authenticated TRUNCATE revoked');
select pg_temp.replay_failure('set local role anon; truncate public.agents','42501','agents anon TRUNCATE revoked');
select pg_temp.replay_success_rollback('set local role service_role; truncate public.audit_logs; reset role','select count(*)=0 from public.audit_logs','server audit_logs TRUNCATE still succeeds');
select pg_temp.replay_failure('set local role service_role; update public.audit_logs set metadata=''{}''','P0001','existing audit UPDATE trigger');
select pg_temp.replay_failure('set local role service_role; delete from public.audit_logs','P0001','existing audit DELETE trigger');

-- Nonempty seeds added after historical preservation, solely to prove TRUNCATE.
insert into public.client_services(client_id,service_type) values('10000000-0000-4000-8000-000000000001','fixture-service');
insert into public.client_connections(client_id,provider) values('10000000-0000-4000-8000-000000000001','fixture-provider');
insert into public.client_events(client_id,event_type,description) values('10000000-0000-4000-8000-000000000001','fixture.event','Synthetic only');
do $$ declare name text; role_name text; begin
 foreach name in array array['client_services','client_connections','client_events'] loop
  foreach role_name in array array['anon','authenticated'] loop
   perform pg_temp.replay_success_rollback(format('set local role %I; truncate public.%I; reset role',role_name,name),format('select count(*)=0 from public.%I',name),role_name||' TRUNCATE remains possible: '||name);
  end loop;
 end loop;
end $$;
-- clients has incoming FKs, so privilege alone does not guarantee success.
select pg_temp.replay_failure('set local role anon; truncate public.clients','0A000','clients TRUNCATE without CASCADE blocked by incoming FKs');
select pg_temp.replay_failure('set local role anon; truncate public.clients cascade','42501','clients TRUNCATE CASCADE blocked by revoked dependent table privileges');
select pg_temp.replay_failure('set local role authenticated; truncate public.clients cascade','42501','authenticated client CASCADE blocked by dependent ACLs');
select pg_temp.replay_failure('set local role postgres; truncate public.clients cascade','55000','owner client CASCADE blocked by immutable Publications journal');

-- Historical SET NULL now collides with immutable recommendation identity.
select pg_temp.replay_failure($sql$set local role service_role; delete from public.recommendations where id='60000000-0000-4000-8000-000000000099'$sql$,'55000','recommendation DELETE blocked by action link immutability');
select pg_temp.replay_assert((select recommendation_id='60000000-0000-4000-8000-000000000099' from public.actions where id='70000000-0000-4000-8000-000000000099'),'failed recommendation deletion leaves action intact');
select pg_temp.replay_assert(exists(select 1 from public.agent_messages where id='80000000-0000-4000-8000-000000000099'),'failed recommendation deletion rolls back message cascade');
select pg_temp.replay_success_rollback($sql$set local role service_role; delete from public.actions where id='70000000-0000-4000-8000-000000000099'; delete from public.recommendations where id='60000000-0000-4000-8000-000000000099'; reset role$sql$,
 $sql$select not exists(select 1 from public.actions where id='70000000-0000-4000-8000-000000000099') and not exists(select 1 from public.recommendations where id='60000000-0000-4000-8000-000000000099') and not exists(select 1 from public.agent_messages where id='80000000-0000-4000-8000-000000000099')$sql$,'explicit action deletion permits recommendation and cascading message deletion');

-- Project fixtures are introduced only after migration from zero projects.
insert into public.projects(id,client_id,name,type,status) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic Social','Réseaux sociaux','En cours'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Synthetic GBP','Google Business Profile','En cours'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Synthetic Foreign Social','Réseaux sociaux','En cours'),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Synthetic Secondary Social','Réseaux sociaux','En cours');
