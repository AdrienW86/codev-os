-- Both agent RPCs and all Publications RPCs have now been exercised by suites.
select pg_temp.replay_assert(exists(select 1 from public.audit_logs where action='agent.scope_changed' and resource_id='20000000-0000-4000-8000-000000000001'),'scope RPC still audits exact UUID into TEXT');
select pg_temp.replay_assert(exists(select 1 from public.audit_logs where action='agent.project_assigned' and resource_id='30000000-0000-4000-8000-000000000001'),'assignment RPC still audits');
select pg_temp.replay_assert(exists(select 1 from public.publication_events where action='publication.created'),'Publications create audit survives hardening');
select pg_temp.replay_assert((select count(*)=15 from public.audit_logs where resource_id like 'fixture-text-resource-%'),'original TEXT audit history retained');
select pg_temp.replay_assert((select count(*)=1 from public.recommendations where id='60000000-0000-4000-8000-000000000099'),'original recommendation retained');
select pg_temp.replay_assert((select count(*)=1 from public.actions where id='70000000-0000-4000-8000-000000000099'),'original action retained');
select pg_temp.replay_assert((select count(*)=1 from public.agent_messages where id='80000000-0000-4000-8000-000000000099'),'original message retained');
select pg_temp.replay_assert((select count(*)=1 from public.agent_runs where id='40000000-0000-4000-8000-000000000001'),'original run retained');
select pg_temp.replay_failure('set local role service_role; truncate public.recommendations cascade','42501','server historical CASCADE TRUNCATE removed');
select pg_temp.replay_failure('set local role service_role; truncate public.audit_logs','42501','server audit TRUNCATE removed');
select pg_temp.replay_failure('set local role service_role; update public.publication_events set action=''fixture.changed''','42501','server publication event UPDATE denied');
select pg_temp.replay_failure('set local role service_role; delete from public.publication_events','42501','server publication event DELETE denied');
select pg_temp.replay_failure('set local role postgres; update public.publication_events set action=''fixture.changed''','55000','owner publication event UPDATE guard');
select pg_temp.replay_failure('set local role postgres; delete from public.publication_events','55000','owner publication event DELETE guard');
select pg_temp.replay_failure('set local role postgres; truncate public.publication_events','55000','existing owner publication event TRUNCATE guard');

-- Existing mutable services keep real CRUD, including parent deletion when
-- there is no retained history. No network or app provider is invoked.
set local role service_role;
do $$
declare client uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); agent uuid:=gen_random_uuid(); task uuid:=gen_random_uuid();
begin
 insert into public.clients(id,name) values(client,'Synthetic mutable CRUD client');
 insert into public.projects(id,client_id,name,type) values(project,client,'Synthetic mutable CRUD project','Réseaux sociaux');
 insert into public.tasks(id,client_id,project_id,title) values(task,client,project,'Synthetic mutable CRUD task');
 insert into public.agents(id,name,enabled,status) values(agent,'Synthetic mutable CRUD agent',true,'Actif');
 insert into public.agent_client_assignments(agent_id,client_id) values(agent,client);
 insert into public.client_services(client_id,service_type) values(client,'fixture-service');
 insert into public.client_connections(client_id,provider) values(client,'fixture-provider');
 insert into public.client_events(client_id,event_type,description) values(client,'fixture.event','Synthetic mutable event');
 update public.clients set notes='Synthetic update' where id=client;
 update public.projects set progress=50 where id=project;
 update public.tasks set title='Synthetic updated task' where id=task;
 update public.agents set description='Synthetic update' where id=agent;
 update public.agent_client_assignments set enabled=false where agent_id=agent and client_id=client;
 update public.client_services set notes='Synthetic update' where client_id=client;
 update public.client_connections set status='error' where client_id=client;
 update public.client_events set description='Synthetic updated event' where client_id=client;
 perform pg_temp.replay_assert((select notes='Synthetic update' from public.clients where id=client),'backend client CRUD');
 perform pg_temp.replay_assert((select progress=50 from public.projects where id=project),'backend project CRUD');
 perform pg_temp.replay_assert((select title='Synthetic updated task' from public.tasks where id=task),'backend task CRUD');
 perform pg_temp.replay_assert((select description='Synthetic update' from public.agents where id=agent),'backend agent CRUD');
 perform pg_temp.replay_assert((select not enabled from public.agent_client_assignments where agent_id=agent and client_id=client),'backend client assignment CRUD');
 perform pg_temp.replay_assert((select notes='Synthetic update' from public.client_services where client_id=client),'backend client service CRUD');
 perform pg_temp.replay_assert((select status='error' from public.client_connections where client_id=client),'backend client connection CRUD');
 perform pg_temp.replay_assert((select description='Synthetic updated event' from public.client_events where client_id=client),'backend client event CRUD');
 delete from public.tasks where id=task;
 delete from public.client_services where client_id=client;
 delete from public.client_connections where client_id=client;
 delete from public.client_events where client_id=client;
 delete from public.agent_client_assignments where agent_id=agent and client_id=client;
 delete from public.projects where id=project;
 delete from public.agents where id=agent;
 delete from public.clients where id=client;
 perform pg_temp.replay_assert(not exists(select 1 from public.clients where id=client) and not exists(select 1 from public.projects where id=project) and not exists(select 1 from public.tasks where id=task) and not exists(select 1 from public.agents where id=agent),'mutable backend DELETE works without history');
end $$;
select pg_temp.replay_assert((select emergency_stop and not generation_enabled and not automation_enabled and not publishing_enabled from public.publication_settings),'kill switch unchanged');
reset role;
