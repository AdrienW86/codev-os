-- Representative counts, before any feature migration or project fixture.
select pg_temp.replay_assert((select count(*)=2 from public.clients),'two fictitious clients');
select pg_temp.replay_assert((select count(*)=2 and bool_and(status='Actif' and enabled) from public.agents),'two fictitious active agents');
select pg_temp.replay_assert((select count(*)=0 from public.projects),'zero historical projects');
select pg_temp.replay_assert((select count(*)=1 from public.tasks),'one historical task');
select pg_temp.replay_assert((select count(*)=1 and bool_and(enabled) from public.agent_client_assignments),'one enabled client assignment');
select pg_temp.replay_assert((select count(*)=1 and bool_and(status='completed') from public.agent_runs),'one completed run');
select pg_temp.replay_assert((select count(*)=1 from public.recommendations),'one recommendation');
select pg_temp.replay_assert((select count(*)=1 and bool_and(status='executed') from public.actions),'one executed action');
select pg_temp.replay_assert((select count(*)=1 from public.agent_messages),'one message');
select pg_temp.replay_assert((select count(*)=15 from public.audit_logs),'15 fictitious historical audits');
select pg_temp.replay_success_rollback('set local role anon; truncate public.audit_logs; reset role','select count(*)=0 from public.audit_logs','historical anon audit TRUNCATE succeeds despite append-only trigger');
select pg_temp.replay_success_rollback('set local role authenticated; truncate public.audit_logs; reset role','select count(*)=0 from public.audit_logs','historical authenticated audit TRUNCATE succeeds');
select pg_temp.replay_success_rollback('set local role anon; truncate public.clients cascade; reset role',
 'select not exists(select 1 from public.clients) and not exists(select 1 from public.actions) and not exists(select 1 from public.agent_messages)','historical anon client TRUNCATE CASCADE bypasses RLS');
select pg_temp.replay_success_rollback($sql$set local role service_role; delete from public.recommendations where id='60000000-0000-4000-8000-000000000099'; reset role$sql$,
 $sql$select (select recommendation_id is null from public.actions where id='70000000-0000-4000-8000-000000000099') and not exists(select 1 from public.agent_messages where id='80000000-0000-4000-8000-000000000099')$sql$,
 'historical recommendation deletion SET NULL action and CASCADE message succeeds');
select pg_temp.replay_success_rollback($sql$set local role service_role; delete from public.agents where id='20000000-0000-4000-8000-000000000001'; reset role$sql$,
 'select not exists(select 1 from public.actions) and not exists(select 1 from public.recommendations) and not exists(select 1 from public.agent_runs) and not exists(select 1 from public.agent_messages)',
 'historical agent deletion cascades history');
select pg_temp.replay_success_rollback($sql$set local role service_role; update public.clients set updated_at='2000-01-01T00:00:00Z' where id='10000000-0000-4000-8000-000000000001'; reset role$sql$,
 $sql$select updated_at=now() from public.clients where id='10000000-0000-4000-8000-000000000001'$sql$,'historical updated_at trigger remains operational');
