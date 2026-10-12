-- Synthetic PostgreSQL local test only (socle Publications, lot 1). Never execute on a remote project.
-- Runs on the full migration chain; every statement is rolled back by the runner.
create function pg_temp.cs_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate;end $$;
grant execute on function pg_temp.cs_error(text) to service_role;
insert into public.clients(id,name) values('c5000000-0000-4000-8000-000000000001','Protection Nuisibles'),('c5000000-0000-4000-8000-000000000002','Autre client');

-- 1. Grants and function properties.
do $$declare r text;f text;begin
 foreach f in array array['public.publication_client_settings_save(uuid,jsonb,text)','public.publication_client_project_ensure(uuid,text)'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser denied '||f||' '||r);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server granted '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
end $$;

set local role service_role;
-- 2. Ensure creates one project with three explicit, disabled channels; a second call returns the same project.
do $$declare a jsonb;b jsonb;p uuid;begin
 a:=public.publication_client_project_ensure('c5000000-0000-4000-8000-000000000001','user_local');
 b:=public.publication_client_project_ensure('c5000000-0000-4000-8000-000000000001','user_local');
 p:=(a->>'project_id')::uuid;
 perform pg_temp.replay_assert((a->>'created')::boolean and not (b->>'created')::boolean and (b->>'project_id')::uuid=p,'idempotent ensure');
 perform pg_temp.replay_assert((select type='Réseaux sociaux' and client_id='c5000000-0000-4000-8000-000000000001' and name='Publications — Protection Nuisibles' from public.projects where id=p),'project created for the client');
 perform pg_temp.replay_assert((select count(*)=3 and bool_and(not enabled) and bool_and(publication_account_id is null) from public.publication_project_channels where project_id=p),'three channels, all disabled, no account');
 perform pg_temp.replay_assert((select count(*) from public.projects where client_id='c5000000-0000-4000-8000-000000000001')=1,'no duplicate project');
 perform pg_temp.replay_assert(exists(select 1 from public.publication_events where resource_id=p and action='publication.client_project_created'),'creation audited');
end $$;
-- 3. An existing eligible project is reused (the oldest one); a non-eligible project is ignored.
reset role;
insert into public.projects(id,client_id,name,type,created_at) values
 ('a5000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000002','Site','Site web','2026-01-01'),
 ('a5000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000002','Fiche GBP','Google Business Profile','2026-02-01'),
 ('a5000000-0000-4000-8000-000000000003','c5000000-0000-4000-8000-000000000002','Réseaux','Réseaux sociaux','2026-03-01');
set local role service_role;
do $$declare a jsonb;begin
 a:=public.publication_client_project_ensure('c5000000-0000-4000-8000-000000000002','user_local');
 perform pg_temp.replay_assert(not (a->>'created')::boolean and (a->>'project_id')::uuid='a5000000-0000-4000-8000-000000000002','oldest eligible project reused');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_project_channels where project_id='a5000000-0000-4000-8000-000000000002'),'reusing a project never writes its channels');
 perform pg_temp.replay_assert(pg_temp.cs_error('select public.publication_client_project_ensure(''c5000000-0000-4000-8000-0000000000ff'',''user_local'')')='23514','unknown client refused');
 perform pg_temp.replay_assert(pg_temp.cs_error('select public.publication_client_project_ensure(''c5000000-0000-4000-8000-000000000002'',''system'')')='22023','invalid actor refused');
end $$;

-- 4. Client settings: created on first save, partial updates keep other fields, audit without the brief text.
do $$declare id1 uuid;id2 uuid;s public.publication_client_settings;begin
 id1:=public.publication_client_settings_save('c5000000-0000-4000-8000-000000000001','{"auto_prepare_enabled":true,"prepare_lead_days":5,"editorial_brief":"  Ton direct, pas de promesse.  ","timezone":"Europe/Paris"}','user_local');
 id2:=public.publication_client_settings_save('c5000000-0000-4000-8000-000000000001','{"publishing_enabled":true}','user_local');
 select * into s from public.publication_client_settings where client_id='c5000000-0000-4000-8000-000000000001';
 perform pg_temp.replay_assert(id1=id2 and s.auto_prepare_enabled and s.prepare_lead_days=5 and s.publishing_enabled and s.editorial_brief='Ton direct, pas de promesse.' and not s.generation_enabled,'partial updates merge');
 perform pg_temp.replay_assert(s.require_human_approval and not s.media_reuse_allowed and s.media_reuse_after_days=180,'defaults: approval required, no reuse');
 perform pg_temp.replay_assert((select count(*)=2 and bool_and(not (after_data::text like '%promesse%')) from public.publication_events where action='publication.client_settings_saved' and client_id='c5000000-0000-4000-8000-000000000001'),'two audited saves, brief text never copied');
 perform pg_temp.replay_assert(pg_temp.cs_error($q$select public.publication_client_settings_save('c5000000-0000-4000-8000-000000000001','{"require_human_approval":false}','user_local')$q$)='22023','human approval cannot be lifted');
 perform pg_temp.replay_assert(pg_temp.cs_error($q$select public.publication_client_settings_save('c5000000-0000-4000-8000-000000000001','{"prepare_lead_days":30}','user_local')$q$)='23514','lead days bounded');
 perform pg_temp.replay_assert(pg_temp.cs_error($q$select public.publication_client_settings_save('c5000000-0000-4000-8000-000000000001','{"timezone":"Mars/Olympus"}','user_local')$q$)='23514','invalid timezone refused');
 perform pg_temp.replay_assert(pg_temp.cs_error($q$select public.publication_client_settings_save('c5000000-0000-4000-8000-000000000001','{"publishing_enabled":"yes"}','user_local')$q$)='22023','typed values only');
 perform pg_temp.replay_assert(pg_temp.cs_error($q$select public.publication_client_settings_save('c5000000-0000-4000-8000-000000000001','{"credential":"x"}','user_local')$q$)='22023','unknown key refused');
end $$;
-- 5. Global kill switches are untouched by a client save; publishability still blocked by the emergency stop.
do $$begin
 perform pg_temp.replay_assert((select emergency_stop and not publishing_enabled from public.publication_settings),'global emergency stop unchanged');
 perform pg_temp.replay_assert(update_direct_denied,'browser roles have no table access') from (select not has_table_privilege('authenticated','public.publication_client_settings','SELECT') as update_direct_denied) x;
end $$;
