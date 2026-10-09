-- Synthetic data only; exact representative counts from the read-only inspection.
insert into public.clients(id,name) values
 ('10000000-0000-4000-8000-000000000001','Fictitious replay client A'),
 ('10000000-0000-4000-8000-000000000002','Fictitious replay client B');
insert into public.agents(id,name,status,enabled,instructions) values
 ('20000000-0000-4000-8000-000000000001','Fictitious historical assigned agent','Actif',true,'Instructions privées'),
 ('20000000-0000-4000-8000-00000000000a','Fictitious historical unassigned agent','Actif',true,'Synthetic instructions only');
insert into public.tasks(id,client_id,title,status) values
 ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic historical task','À faire');
insert into public.agent_client_assignments(agent_id,client_id,enabled) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',true);
insert into public.agent_runs(id,agent_id,client_id,status,completed_at) values
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','completed','2026-09-03T10:00:00Z');
insert into public.recommendations(id,agent_id,client_id,title,payload) values
 ('60000000-0000-4000-8000-000000000099','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic historical recommendation','{"fixture":true}');
insert into public.actions(id,agent_id,client_id,recommendation_id,action_type,status,executed_at,result) values
 ('70000000-0000-4000-8000-000000000099','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000099','internal.test','executed','2026-09-03T10:00:00Z','{"fixture":true}');
insert into public.agent_messages(id,agent_id,client_id,recommendation_id,sender_type,message) values
 ('80000000-0000-4000-8000-000000000099','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000099','admin','Synthetic historical message');
insert into public.audit_logs(actor_type,actor_id,action,resource_type,resource_id,metadata)
 select 'admin','user_local_fixture','fixture.historical','fixture','fixture-text-resource-'||i,'{"fixture":true}'::jsonb from generate_series(1,15) i;

create temporary table remote_history(table_name text primary key,rows_before jsonb not null);
do $$ declare t record; begin
 for t in select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' loop
  execute format('insert into pg_temp.remote_history select %L,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',t.relname,t.relname);
 end loop;
end $$;
