-- Test-only minimal legacy fixture, not a production baseline or migration.
begin;
do $$ begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','p'))
  or exists(select 1 from pg_namespace where nspname in ('publications_private','agent_scope_private')) then raise exception 'Test database must be empty'; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
-- Baseline inserted here by the runner before the fictitious historical data.
insert into public.clients(id,name) values('10000000-0000-4000-8000-000000000001','Client fictif A'),('10000000-0000-4000-8000-000000000002','Autre client');
insert into public.agents(id,name,enabled,status,instructions) values('20000000-0000-4000-8000-000000000001','Agent historique',true,'Actif','Instructions privées');
insert into public.projects(id,client_id,name,type,status) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Social','Réseaux sociaux','En cours'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','GBP','Google Business Profile','En cours'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Autre Social','Réseaux sociaux','En cours'),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Social secondaire','Réseaux sociaux','En cours');
insert into public.agent_client_assignments(agent_id,client_id,enabled) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',true);
insert into public.agent_runs(id,agent_id,client_id,status) values('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','completed');
insert into public.recommendations(id,agent_id,client_id,title,payload) values('60000000-0000-4000-8000-000000000099','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic historical recommendation','{"fixture":true}');
insert into public.actions(id,agent_id,client_id,recommendation_id,status,executed_at,result) values('70000000-0000-4000-8000-000000000099','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000099','executed','2026-09-03T10:00:00Z','{"fixture":true}');
insert into public.agent_messages(id,agent_id,client_id,recommendation_id,sender_type,message) values('80000000-0000-4000-8000-000000000099','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000099','admin','Synthetic historical message');
-- Deliberately inconsistent historical task: migration must preserve, not invent a repair.
insert into public.tasks(id,client_id,project_id,status) values('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','Terminé');
grant usage on schema public to anon,authenticated,service_role;
grant select,insert,update on all tables in schema public to service_role;
