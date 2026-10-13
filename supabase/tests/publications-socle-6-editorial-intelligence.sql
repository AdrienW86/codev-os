-- Synthetic PostgreSQL local test only (socle Publications, PR #42 : intelligence éditoriale de l'Agent v2).
-- Never execute remotely. Runs on the full migration chain; every statement is rolled back by the runner.
create temporary table ei_ids(name text primary key,id uuid not null);
grant select,insert,update on ei_ids to service_role;
create function pg_temp.ei_id(p_name text) returns uuid language sql as $$ select id from ei_ids where name=p_name $$;
create function pg_temp.ei_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate;end $$;
grant execute on function pg_temp.ei_id(text),pg_temp.ei_error(text) to service_role;

-- 1. Grants and shape: server-only RPC, invoker functions with a fixed search_path, nullable bounded column, read index.
do $$declare r text;f text;begin
 foreach f in array array['public.publication_editorial_justification_record(uuid,jsonb,text)','publications_private.guard_agent_v2_justification()'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser denied '||f||' '||r);end loop;
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker '||f);
 end loop;
 perform pg_temp.replay_assert(has_function_privilege('service_role','public.publication_editorial_justification_record(uuid,jsonb,text)','EXECUTE'),'server may record');
 perform pg_temp.replay_assert((select not attnotnull and atthasdef=false from pg_attribute where attrelid='public.publication_agent_v2_runs'::regclass and attname='editorial_justification'),'nullable, no default');
 perform pg_temp.replay_assert(exists(select 1 from pg_constraint where conname='publication_agent_v2_runs_justification_shape'),'shape constraint');
 perform pg_temp.replay_assert(exists(select 1 from pg_indexes where indexname='publication_agent_v2_runs_publications' and indexdef ilike '%gin%'),'run lookup by publication');
 perform pg_temp.replay_assert(exists(select 1 from pg_trigger where tgname='agent_v2_run_justification_guard' and tgrelid='public.publication_agent_v2_runs'::regclass),'immutability trigger');
 foreach r in array array['anon','authenticated'] loop perform pg_temp.replay_assert(not has_table_privilege(r,'public.publication_agent_v2_runs','SELECT'),'runs hidden from '||r);end loop;
end $$;

-- 2. Fixtures: a roofer (fictitious) with a configured agent and a daily Facebook slot.
do $$declare cl uuid:=gen_random_uuid();begin
 insert into public.clients(id,name,activity,geographic_area) values(cl,'Couverture Catalane','Couvreur','Perpignan');
 insert into ei_ids values('client',cl),('social',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values(pg_temp.ei_id('social'),cl,'Réseaux Couverture Catalane','Réseaux sociaux');
 update public.agents set max_monthly_budget_eur=50 where publication_specialist;
end $$;
set local role service_role;
do $$declare s uuid:=pg_temp.ei_id('social');begin
 insert into ei_ids values('fb',public.publication_channel_save(s,'facebook',true,null,null,'user_local'));
 perform public.publication_channel_schedule_save(pg_temp.ei_id('fb'),'Europe/Paris',true,
  (select jsonb_agg(jsonb_build_object('weekday',d,'local_time','12:00','enabled',true)) from generate_series(1,7) d),'user_local');
 perform public.publication_channel_occurrences_ensure(s,current_date+1,current_date+20,'user_local');
 perform public.publication_agent_configure(s,'folder00000042','["Démoussage","Zinguerie"]','Ton sobre',true,true,'user_local');
end $$;
reset role;
create function pg_temp.ei_occ() returns uuid language sql as $$
 select id from public.publication_channel_occurrences where project_id=pg_temp.ei_id('social') and platform='facebook' and scheduled_for>now()
  and publication_id is null and skipped_at is null order by scheduled_for limit 1 $$;
create function pg_temp.ei_begin() returns uuid language sql as $$
 select (public.publication_agent_v2_begin(pg_temp.ei_id('social'),array[pg_temp.ei_occ()],1,'user_local')->>'run_id')::uuid $$;
create function pg_temp.ei_record(p_run uuid,p_value jsonb) returns text language sql as $$
 select pg_temp.ei_error(format('select public.publication_editorial_justification_record(%L,%L,%L)',p_run,p_value,'user_local')) $$;
grant execute on function pg_temp.ei_occ(),pg_temp.ei_begin(),pg_temp.ei_record(uuid,jsonb) to service_role;

set local role service_role;
-- 3. Recording during the preparation: once, validated, bounded.
do $$declare run uuid:=pg_temp.ei_begin();j jsonb:='{"version":1,"outcome":"prepared","subject":"Zinguerie avant l’hiver","services":["Zinguerie"],"deprioritised":[{"service":"Démoussage","reason":"mise en avant par la dernière publication"}]}';begin
 insert into ei_ids values('run',run);
 perform pg_temp.replay_assert(pg_temp.ei_record(run,'[]')='22023','array refused');
 perform pg_temp.replay_assert(pg_temp.ei_record(run,'{"version":1}')='22023','outcome required');
 perform pg_temp.replay_assert(pg_temp.ei_record(run,'{"version":"1","outcome":"prepared"}')='22023','numeric version');
 perform pg_temp.replay_assert(pg_temp.ei_record(run,'{"version":1,"outcome":"published"}')='22023','unknown outcome');
 perform pg_temp.replay_assert(pg_temp.ei_record(run,jsonb_build_object('version',1,'outcome','prepared','pad',repeat('x',16100)))='22023','bounded size');
 perform pg_temp.replay_assert(pg_temp.ei_record(gen_random_uuid(),j)='22023','unknown run');
 perform pg_temp.replay_assert(pg_temp.ei_error(format('select public.publication_editorial_justification_record(%L,%L,%L)',run,j,'robot'))='22023','actor required');
 perform pg_temp.replay_assert((select editorial_justification is null from public.publication_agent_v2_runs where id=run),'nothing written by refusals');
 perform pg_temp.replay_assert(pg_temp.ei_record(run,j) is null,'recorded while processing');
 perform pg_temp.replay_assert((select editorial_justification->>'subject' from public.publication_agent_v2_runs where id=run)='Zinguerie avant l’hiver','stored as given');
 perform pg_temp.replay_assert(pg_temp.ei_record(run,j)='55000','recorded once');
 perform pg_temp.replay_assert(pg_temp.ei_error(format('update public.publication_agent_v2_runs set editorial_justification=%L where id=%L','{"version":1,"outcome":"refused"}',run))='55000','direct rewrite refused');
 perform pg_temp.replay_assert(pg_temp.ei_error(format('update public.publication_agent_v2_runs set editorial_justification=null where id=%L',run))='55000','direct erase refused');
end $$;

-- 4. The run finishes normally (same RPC, same signature): justification kept, frozen afterwards; drafts only.
do $$declare run uuid:=pg_temp.ei_id('run');o uuid;r jsonb;pub uuid;begin
 select occurrence_ids[1] into o from public.publication_agent_v2_runs where id=run;
 r:=public.publication_agent_v2_finish(run,jsonb_build_object('idea',jsonb_build_object('subject','Zinguerie avant l’hiver','angle','Gouttières'),'publications',
  jsonb_build_array(jsonb_build_object('occurrence_id',o,'text','Des gouttières dégagées évacuent l’eau loin des murs.','cta',null))),null,
  '{"input_tokens":10,"output_tokens":10,"estimated_cost_eur":0.0001}','user_local');
 pub:=(r->'publication_ids'->>0)::uuid;insert into ei_ids values('pub',pub);
 perform pg_temp.replay_assert((select status='completed' and editorial_justification->>'outcome'='prepared' from public.publication_agent_v2_runs where id=run),'kept after finish');
 perform pg_temp.replay_assert(pg_temp.ei_record(run,'{"version":1,"outcome":"prepared"}')='55000','not after completion');
 perform pg_temp.replay_assert(pg_temp.ei_error(format('update public.publication_agent_v2_runs set editorial_justification=%L where id=%L','{"version":1,"outcome":"prepared"}',run))='55000','frozen after completion');
 -- Lecture du panneau : run de la publication par publication_ids.
 perform pg_temp.replay_assert((select count(*) from public.publication_agent_v2_runs where publication_ids @> array[pub] and editorial_justification is not null)=1,'drawer lookup');
 perform pg_temp.replay_assert((select status from public.publications where id=pub)='draft','draft only: human approval still required');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries where publication_id=pub),'no delivery prepared');
end $$;

-- 5. A refused generation: the refusal reason is recorded, then the run fails (existing RPC); frozen afterwards.
do $$declare run uuid:=pg_temp.ei_begin();begin
 perform pg_temp.replay_assert(pg_temp.ei_record(run,'{"version":1,"outcome":"refused","refusal":{"reason":"place_not_allowed","detail":"lieu absent des données du client : Narbonne"}}') is null,'refusal recorded');
 perform public.publication_agent_v2_fail(run,'invalid_output','{"input_tokens":5,"output_tokens":5,"estimated_cost_eur":0.0001}','user_local');
 perform pg_temp.replay_assert((select status='failed' and editorial_justification->'refusal'->>'reason'='place_not_allowed' from public.publication_agent_v2_runs where id=run),'kept after failure');
 perform pg_temp.replay_assert(pg_temp.ei_record(run,'{"version":1,"outcome":"refused"}')='55000','not after failure');
end $$;

-- 6. Without a justification (older code path), the run behaves exactly as before.
do $$declare run uuid:=pg_temp.ei_begin();begin
 perform public.publication_agent_v2_fail(run,'generation_failed','{"input_tokens":0,"output_tokens":0,"estimated_cost_eur":0.1}','user_local');
 perform pg_temp.replay_assert((select status='failed' and editorial_justification is null from public.publication_agent_v2_runs where id=run),'optional justification');
end $$;
reset role;
