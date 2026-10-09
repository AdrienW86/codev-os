-- Scope suites have invoked both new agent RPCs: UUIDs really reach TEXT audits.
select pg_temp.replay_assert((select format_type(atttypid,atttypmod)='text' from pg_attribute where attrelid='public.audit_logs'::regclass and attname='resource_id'),'audit resource_id stays TEXT');
select pg_temp.replay_assert(exists(select 1 from public.audit_logs where action='agent.scope_changed' and resource_id='20000000-0000-4000-8000-000000000001' and after_data->>'agent_scope'='project'),'scope RPC UUID written to TEXT exactly');
select pg_temp.replay_assert(exists(select 1 from public.audit_logs where action='agent.project_assigned' and resource_id='30000000-0000-4000-8000-000000000001' and metadata->>'project_id'=resource_id),'assignment RPC UUID written to TEXT exactly');
select pg_temp.replay_assert((select count(*)=15 from public.audit_logs where resource_id like 'fixture-text-resource-%'),'non-UUID historical audit identifiers preserved');
select pg_temp.replay_assert((select project_id='30000000-0000-4000-8000-000000000001' from public.agent_runs where id='40000000-0000-4000-8000-000000000003'),'project run context');
select pg_temp.replay_assert((select project_id='30000000-0000-4000-8000-000000000001' from public.recommendations where id='60000000-0000-4000-8000-000000000001'),'project recommendation context');
select pg_temp.replay_assert((select project_id='30000000-0000-4000-8000-000000000001' from public.actions where id='70000000-0000-4000-8000-000000000001'),'project action context');
select pg_temp.replay_assert((select project_id='30000000-0000-4000-8000-000000000001' from public.agent_messages where id='80000000-0000-4000-8000-000000000001'),'project message context');
-- Revoking a project permission leaves its row/history; FK still blocks deletion.
select pg_temp.replay_failure($sql$set local role service_role; delete from public.projects where id='30000000-0000-4000-8000-000000000001'$sql$,'23503','assigned project deletion blocked');
select pg_temp.replay_success_rollback($sql$set local role service_role; delete from public.projects where id='30000000-0000-4000-8000-000000000003'; reset role$sql$,
 $sql$select not exists(select 1 from public.projects where id='30000000-0000-4000-8000-000000000003')$sql$,'unreferenced foreign project deletion allowed');
-- Probe actual cascade order with new context triggers, recording SQLSTATE only.
select pg_temp.replay_observe($sql$set local role service_role; delete from public.agents where id='20000000-0000-4000-8000-000000000001'$sql$,'assigned_agent_delete');
select pg_temp.replay_observe($sql$set local role service_role; delete from public.clients where id='10000000-0000-4000-8000-000000000001'$sql$,'client_with_publications_delete');
select pg_temp.replay_success_rollback($sql$set local role service_role; delete from public.agents where id='20000000-0000-4000-8000-00000000000a'; reset role$sql$,
 $sql$select not exists(select 1 from public.agents where id='20000000-0000-4000-8000-00000000000a')$sql$,'unassigned agent deletion allowed');
select pg_temp.replay_success_rollback($sql$set local role service_role; delete from public.clients where id='10000000-0000-4000-8000-000000000002'; reset role$sql$,
 $sql$select not exists(select 1 from public.clients where id='10000000-0000-4000-8000-000000000002') and not exists(select 1 from public.projects where id='30000000-0000-4000-8000-000000000003')$sql$,'client without Publications still cascades unreferenced project');
-- Isolate the old tasks SET NULL / new composite RESTRICT interaction.
insert into public.projects(id,client_id,name,type) values('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','Synthetic task-only project','Réseaux sociaux');
insert into public.tasks(id,client_id,project_id,title) values('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000005','Synthetic project task');
select pg_temp.replay_observe($sql$set local role service_role; delete from public.projects where id='30000000-0000-4000-8000-000000000005'$sql$,'task_only_project_delete');
-- Broad server TRUNCATE on legacy agent history is not removed by 00002.
select pg_temp.replay_observe('set local role service_role; truncate public.agents cascade','server_agents_truncate_cascade');
select pg_temp.replay_assert((select result='23503' from pg_temp.remote_observations where label='assigned_agent_delete'),'agent deletion blocked by retained project assignment FK');
select pg_temp.replay_assert((select result='23503' from pg_temp.remote_observations where label='client_with_publications_delete'),'client deletion with history blocked by FK');
select pg_temp.replay_assert((select result='success' from pg_temp.remote_observations where label='task_only_project_delete'),'historical task SET NULL permits project deletion');
select pg_temp.replay_assert((select result='42501' from pg_temp.remote_observations where label='server_agents_truncate_cascade'),'new assignment ACL blocks server agent CASCADE');
select pg_temp.replay_success_rollback($sql$set local role service_role; delete from public.projects where id='30000000-0000-4000-8000-000000000005'; reset role$sql$,
 $sql$select (select project_id is null from public.tasks where id='50000000-0000-4000-8000-000000000002') and not exists(select 1 from public.projects where id='30000000-0000-4000-8000-000000000005')$sql$,'task survives project deletion with NULL context');
select pg_temp.replay_success_rollback('set local role service_role; truncate public.agent_runs; reset role','select not exists(select 1 from public.agent_runs)','server can still TRUNCATE historical runs');
select pg_temp.replay_success_rollback('set local role service_role; truncate public.recommendations cascade; reset role',
 'select not exists(select 1 from public.recommendations) and not exists(select 1 from public.actions) and not exists(select 1 from public.agent_messages)','server recommendation TRUNCATE CASCADE bypasses row guards');
select pg_temp.replay_success_rollback('set local role postgres; truncate public.agents cascade; reset role',
 'select not exists(select 1 from public.agents) and not exists(select 1 from public.agent_project_assignments) and not exists(select 1 from public.agent_runs)','owner agent TRUNCATE CASCADE still destroys history');
select pg_temp.replay_assert((select emergency_stop and not generation_enabled and not automation_enabled and not publishing_enabled from public.publication_settings),'final kill switch still active');
select pg_temp.replay_assert((select count(*)=15 from public.audit_logs where resource_id like 'fixture-text-resource-%'),'destructive probes all rolled back');
