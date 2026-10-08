-- Synthetic PostgreSQL local test only. No remote credentials or external calls.
select pg_temp.replay_assert((select count(*)=1 from public.agents where publication_specialist and agent_scope='project' and not enabled and not scope_review_required),'specialist default disabled project scope');
select pg_temp.replay_failure('select public.agent_set_scope((select id from public.agents where publication_specialist),''client'',''user_local'')','23514','specialist project scope immutable even without assignments');
select pg_temp.replay_assert((select count(*)=5 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity and c.relname in('publication_agent_projects','publication_ai_runs','publication_drive_media','publication_media_uses','publication_generation_details')),'five RLS tables');
select pg_temp.replay_assert((select not public and file_size_limit=8388608 from storage.buckets where id='publication-originals'),'private originals');
do $$declare t text;r text;f text;begin
 foreach t in array array['publication_agent_projects','publication_ai_runs','publication_drive_media','publication_media_uses','publication_generation_details'] loop
  foreach r in array array['anon','authenticated'] loop
   perform pg_temp.replay_assert(not has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'browser permissions absent');
  end loop;
  perform pg_temp.replay_assert(has_table_privilege('service_role','public.'||t,'SELECT,INSERT'),'server select/insert');
  perform pg_temp.replay_assert(not has_table_privilege('service_role','public.'||t,'DELETE,TRUNCATE'),'history deletion denied');
 end loop;
 foreach f in array array['publication_agent_configure(uuid,text,jsonb,text,boolean,boolean,text)','publication_ai_begin(uuid,uuid,text)','publication_ai_catalog(uuid,jsonb)','publication_ai_claim_media(uuid,uuid,text,jsonb)','publication_ai_fail(uuid,text,numeric,integer,integer)','publication_ai_finish(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb,text)'] loop
  foreach r in array array['anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,'public.'||f,'EXECUTE'),'browser RPC denied');end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role','public.'||f,'EXECUTE'),'server RPC permission');
 end loop;
end $$;
set local role anon;
select pg_temp.replay_failure('select * from public.publication_ai_runs','42501','actual anon denied');
set local role authenticated;
select pg_temp.replay_failure('select public.publication_ai_begin(null,null,''user_local'')','42501','actual authenticated RPC denied');
reset role;
insert into public.projects(id,client_id,name,type) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Social local','Réseaux sociaux'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','GBP local','Google Business Profile'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Unsupported','Google Ads');
create temporary table ai_test_state(pub uuid,run uuid,media uuid,revision uuid,content jsonb,opportunity jsonb,derivatives jsonb);
grant select,insert,update on ai_test_state to service_role;
set local role service_role;
do $$declare p uuid:='30000000-0000-4000-8000-000000000001';a uuid;root uuid;run uuid;m uuid;rev uuid;oldrev uuid;asset uuid:=gen_random_uuid();data jsonb;catalog jsonb;content jsonb;opportunity jsonb;derivatives jsonb;events bigint;config jsonb:='{"enabled":true,"posts_per_week":2,"preferred_weekdays":[1,5],"preferred_times":["12:00","12:00"],"timezone":"Europe/Paris","planning_horizon_weeks":4,"auto_create_slots":true,"require_manual_approval":true}';
begin
 perform pg_temp.replay_failure(format('select public.publication_agent_configure(%L,''folder00000001'',''["Couverture"]'','''',true,true,''user_local'')','30000000-0000-4000-8000-000000000003'),'23514','wrong project type');
 perform pg_temp.replay_failure(format('select public.publication_agent_configure(%L,''folder00000001'',''["Couverture"]'','''',true,false,''user_local'')',p),'22023','rights required');
 a:=public.publication_agent_configure(p,'folder00000001','["Couverture"]','Entretien prudent',true,true,'user_local');
 perform pg_temp.replay_assert(agent_scope_private.context_allowed(a,'10000000-0000-4000-8000-000000000001',p),'explicit assigned context');
 perform pg_temp.replay_assert(not agent_scope_private.context_allowed(a,'10000000-0000-4000-8000-000000000002',p),'cross-client scope denied');
 perform pg_temp.replay_assert(not agent_scope_private.context_allowed(a,'10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002'),'unassigned project denied');
 perform pg_temp.replay_assert((select count(*)=1 from public.agent_project_assignments where agent_id=a and project_id=p and enabled),'assignment exists');
 perform public.publication_save_cadence(p,config,'user_local');perform public.publication_ensure_calendar(p,'2026-11-02',true,'user_local');
 select publication_id into root from public.publication_calendar_slots where project_id=p order by local_date limit 1;
 data:=public.publication_ai_begin(root,null,'user_local');run:=(data->>'run_id')::uuid;
 perform pg_temp.replay_assert((public.publication_ai_begin(root,null,'user_local')->>'reused')::boolean,'idempotent start');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_ai_runs where publication_id=root),'one ledger');
 perform pg_temp.replay_assert((select count(*)=1 from public.agent_runs where id=(select agent_run_id from public.publication_ai_runs where id=run) and status='running' and project_id=p),'one scoped agent_run');
 catalog:=public.publication_ai_catalog(run,'[{"drive_file_id":"drivefile00001","name":"Synthetic photo","mime_type":"image/png","modified_at":"2026-10-01T00:00:00Z","width":800,"height":400,"size":1000}]');m:=(catalog->0->>'id')::uuid;
 perform public.publication_ai_claim_media(run,m,repeat('a',64),'{"scene":"roof","confidence":0.95,"usable":true}');
 opportunity:='{"id":"seasonality:Couverture","subject":"Couverture : les points à vérifier","score":90,"reasons":["Photo compatible"]}';
 content:=jsonb_build_object('internal_title','Préparation locale','subject','Couverture : les points à vérifier','source_content','Chaque situation mérite une analyse adaptée.','selected_asset_id',m,'selected_opportunity',opportunity->>'id','facebook',jsonb_build_object('text','Chaque situation mérite une analyse adaptée.','title',null,'cta',null),'instagram',jsonb_build_object('text','Contactez-nous pour parler de votre besoin.','title',null,'cta',null),'google_business_profile',null,'factual_basis',jsonb_build_array('Chaque situation mérite une analyse adaptée.'),'generation_summary','Sujet et photo compatibles ; validation humaine requise.');
 derivatives:=jsonb_build_array(jsonb_build_object('platform','facebook','asset_id',asset,'path','10000000-0000-4000-8000-000000000001/'||root||'/'||asset,'hash',repeat('b',64),'width',1080,'height',1080),jsonb_build_object('platform','instagram','asset_id',asset,'path','10000000-0000-4000-8000-000000000001/'||root||'/'||asset,'hash',repeat('b',64),'width',1080,'height',1080));
 perform pg_temp.replay_failure(format('select public.publication_ai_finish(%L,%L,%L,%L,%L,''foreign/path'',''{"estimated_cost_eur":0.01,"input_tokens":100,"output_tokens":20}'',''user_local'')',run,m,content,opportunity,derivatives),'23514','invalid original path rolls everything back');
 perform pg_temp.replay_assert((select current_revision_id is null and status='draft' from public.publications where id=root),'failed finish leaves placeholder untouched');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_revisions where publication_id=root),'no partial revision');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_variant_assets where asset_id=asset),'no partial image links');
 perform pg_temp.replay_failure(format('select public.publication_ai_finish(%L,%L,%L,%L,%L,%L,''{"estimated_cost_eur":0.01,"input_tokens":100,"output_tokens":20}'',''user_local'')',run,m,content-'selected_asset_id',opportunity,derivatives,'10000000-0000-4000-8000-000000000001/'||root||'/original'),'40001','missing selected media rejected');
 rev:=public.publication_ai_finish(run,m,content,opportunity,derivatives,'10000000-0000-4000-8000-000000000001/'||root||'/original','{"estimated_cost_eur":0.01,"input_tokens":100,"output_tokens":20}','user_local');
 perform pg_temp.replay_assert((select status='pending_review' and current_revision_id=rev and target_date='2026-11-02' from public.publications where id=root),'pending_review existing date unchanged');
 perform pg_temp.replay_assert((select origin='generated' and model='gpt-4.1-mini-2025-04-14' and estimated_cost=.01 from public.publication_revisions where id=rev),'generated immutable costed revision');
 perform pg_temp.replay_assert((select count(*)=2 from public.publication_variants where revision_id=rev),'two social variants');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_assets where id=asset),'one shared square asset');
 perform pg_temp.replay_assert((select count(*)=2 from public.publication_media_uses where revision_id=rev),'two platform media histories');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_generation_details where revision_id=rev),'generation evidence one row');
 select count(*) into events from public.publication_events where resource_id=root and action='publication.ai_prepared';
 perform pg_temp.replay_assert(public.publication_ai_finish(run,m,content,opportunity,derivatives,'unused','{}','user_local')=rev,'finish idempotent');
 perform pg_temp.replay_assert((select count(*)=events from public.publication_events where resource_id=root and action='publication.ai_prepared'),'one finish event');
 perform public.publication_review_manual(root,rev,'rejected','Changer la photo','user_local');oldrev:=rev;
 data:=public.publication_ai_begin(root,oldrev,'user_local');run:=(data->>'run_id')::uuid;
 perform pg_temp.replay_failure(format('select public.publication_ai_claim_media(%L,%L,%L,''{}'')',run,m,repeat('a',64)),'23514','used original blocked');
 catalog:=public.publication_ai_catalog(run,'[{"drive_file_id":"drivefile00002","name":"Second local photo","mime_type":"image/png","modified_at":"2026-10-01T00:00:00Z","size":1000}]');m:=(catalog->0->>'id')::uuid;
 perform pg_temp.replay_failure(format('select public.publication_ai_claim_media(%L,%L,%L,''{}'')',run,m,repeat('a',64)),'23505','copied source hash blocked');
 perform public.publication_ai_claim_media(run,m,repeat('c',64),'{"scene":"roof","confidence":0.95,"usable":true}');
 content:=jsonb_set(content,'{selected_asset_id}',to_jsonb(m));asset:=gen_random_uuid();derivatives:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(derivatives,'{0,asset_id}',to_jsonb(asset)),'{1,asset_id}',to_jsonb(asset)),'{0,hash}',to_jsonb(repeat('d',64))),'{1,hash}',to_jsonb(repeat('d',64)));
 derivatives:=jsonb_set(jsonb_set(derivatives,'{0,path}',to_jsonb('10000000-0000-4000-8000-000000000001/'||root||'/'||asset)),'{1,path}',to_jsonb('10000000-0000-4000-8000-000000000001/'||root||'/'||asset));
 rev:=public.publication_ai_finish(run,m,content,opportunity,derivatives,'10000000-0000-4000-8000-000000000001/'||root||'/original-new','{"estimated_cost_eur":0.01,"input_tokens":100,"output_tokens":20}','user_local');
 perform pg_temp.replay_assert((select revision_number=2 and origin='regenerated' and parent_revision_id=oldrev and regeneration_reason='Changer la photo' from public.publication_revisions where id=rev),'new regenerated revision preserves refusal');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_reviews where revision_id=rev),'new revision never inherits approval');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_reviews where revision_id=oldrev and decision='rejected'),'historical refusal intact');
 perform pg_temp.replay_assert((select status='pending_review' from public.publications where id=root),'regenerated pending review');
 perform pg_temp.replay_assert((select status='completed' and input_tokens=100 and output_tokens=20 and estimated_cost_eur=.01 from public.agent_runs where id=(select agent_run_id from public.publication_ai_runs where id=run)),'completed metered agent_run');
 insert into pg_temp.ai_test_state values(root,run,m,rev,content,opportunity,derivatives);
end $$;
reset role;
-- Failure injection must roll back revision, variants, media usage, agent_run and root together.
create function pg_temp.reject_ai_audit() returns trigger language plpgsql as $$begin if new.action='publication.ai_prepared' then raise exception 'synthetic audit unavailable' using errcode='P0001';end if;return new;end $$;
create trigger synthetic_ai_audit_failure before insert on public.publication_events for each row execute function pg_temp.reject_ai_audit();
set local role service_role;
do $$declare root uuid;run uuid;m uuid;asset uuid:=gen_random_uuid();content jsonb;opportunity jsonb;derivatives jsonb;a uuid;begin
 select publication_id into root from public.publication_calendar_slots where project_id='30000000-0000-4000-8000-000000000001' order by local_date offset 1 limit 1;
 run:=(public.publication_ai_begin(root,null,'user_local')->>'run_id')::uuid;
 m:=(public.publication_ai_catalog(run,'[{"drive_file_id":"drivefile00003","name":"Rollback photo","mime_type":"image/png","modified_at":"2026-10-01T00:00:00Z","size":1000}]')->0->>'id')::uuid;
 perform public.publication_ai_claim_media(run,m,repeat('e',64),'{"scene":"roof","confidence":0.95,"usable":true}');
 select jsonb_set(s.content,'{selected_asset_id}',to_jsonb(m)),s.opportunity into content,opportunity from pg_temp.ai_test_state s;
 derivatives:=jsonb_build_array(jsonb_build_object('platform','facebook','asset_id',asset,'path','10000000-0000-4000-8000-000000000001/'||root||'/'||asset,'hash',repeat('f',64),'width',1080,'height',1080),jsonb_build_object('platform','instagram','asset_id',asset,'path','10000000-0000-4000-8000-000000000001/'||root||'/'||asset,'hash',repeat('f',64),'width',1080,'height',1080));
 perform pg_temp.replay_failure(format('select public.publication_ai_finish(%L,%L,%L,%L,%L,%L,''{"estimated_cost_eur":0.01,"input_tokens":100,"output_tokens":20}'',''user_local'')',run,m,content,opportunity,derivatives,'10000000-0000-4000-8000-000000000001/'||root||'/original'),'P0001','audit failure forces full rollback');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_revisions where publication_id=root),'audit rollback revisions');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_assets where id=asset),'audit rollback assets');
 perform pg_temp.replay_assert((select status='draft' and current_revision_id is null from public.publications where id=root),'audit rollback root');
 perform pg_temp.replay_assert((select status='processing' and revision_id is null from public.publication_ai_runs where id=run),'audit rollback ledger');
 perform public.publication_ai_fail(run,'preparation_failed',.1,100,20);
 perform pg_temp.replay_assert((select status='failed' and estimated_cost_eur=.1 from public.publication_ai_runs where id=run),'sanitized failed run conservative billing');
 perform pg_temp.replay_assert((select claimed_run_id is null from public.publication_drive_media where id=m),'failed claim released');
 -- Same logical request retries are bounded to three; a successful completion is never repeated.
 run:=(public.publication_ai_begin(root,null,'user_local')->>'run_id')::uuid;perform public.publication_ai_fail(run,'media_required',0,0,0);
 run:=(public.publication_ai_begin(root,null,'user_local')->>'run_id')::uuid;perform public.publication_ai_fail(run,'needs_review',0,0,0);
 perform pg_temp.replay_failure(format('select public.publication_ai_begin(%L,null,''user_local'')',root),'55000','bounded retry limit');
end $$;
reset role;
drop trigger synthetic_ai_audit_failure on public.publication_events;
-- Independently exercise the GBP project and foreign media guard.
set local role service_role;
do $$declare p uuid:='30000000-0000-4000-8000-000000000002';root uuid;run uuid;m uuid;foreign_media uuid;asset uuid:=gen_random_uuid();content jsonb;opportunity jsonb;derivatives jsonb;revision uuid;begin
 perform public.publication_agent_configure(p,'folder00000002','["Couverture"]','',true,true,'user_local');
 perform public.publication_save_cadence(p,'{"enabled":true,"posts_per_week":1,"preferred_weekdays":[1],"preferred_times":["12:00"],"timezone":"Europe/Paris","planning_horizon_weeks":4,"auto_create_slots":true,"require_manual_approval":true}','user_local');
 perform public.publication_ensure_calendar(p,'2026-11-02',true,'user_local');
 select publication_id into root from public.publication_calendar_slots where project_id=p order by local_date limit 1;
 run:=(public.publication_ai_begin(root,null,'user_local')->>'run_id')::uuid;
 select id into foreign_media from public.publication_drive_media where client_id='10000000-0000-4000-8000-000000000001' limit 1;
 perform pg_temp.replay_failure(format('select public.publication_ai_claim_media(%L,%L,%L,''{}'')',run,foreign_media,repeat('7',64)),'23514','foreign client media refused');
 m:=(public.publication_ai_catalog(run,'[{"drive_file_id":"drivefile00004","name":"GBP photo","mime_type":"image/png","modified_at":"2026-10-01T00:00:00Z","size":1000}]')->0->>'id')::uuid;
 perform public.publication_ai_claim_media(run,m,repeat('7',64),'{"scene":"roof","confidence":0.95,"usable":true}');
 select jsonb_set(jsonb_set(jsonb_set(s.content,'{selected_asset_id}',to_jsonb(m)),'{google_business_profile}',s.content->'facebook'),'{facebook}','null')-'instagram',s.opportunity into content,opportunity from pg_temp.ai_test_state s;
 content:=content||'{"instagram":null}';
 derivatives:=jsonb_build_array(jsonb_build_object('platform','google_business_profile','asset_id',asset,'path','10000000-0000-4000-8000-000000000002/'||root||'/'||asset,'hash',repeat('8',64),'width',1200,'height',900));
 revision:=public.publication_ai_finish(run,m,content,opportunity,derivatives,'10000000-0000-4000-8000-000000000002/'||root||'/original','{"estimated_cost_eur":0.01,"input_tokens":100,"output_tokens":20}','user_local');
 perform pg_temp.replay_assert((select count(*)=1 and bool_and(platform='google_business_profile') from public.publication_variants where revision_id=revision),'GBP one correct platform');
 perform pg_temp.replay_assert((select width=1200 and height=900 from public.publication_assets where id=asset),'GBP compatible derivative');
 perform pg_temp.replay_assert((select status='pending_review' from public.publications where id=root),'GBP human review mandatory');
end $$;
reset role;
do $$declare a uuid;root uuid;before_count bigint;begin
 select id into a from public.agents where publication_specialist;
 select publication_id into root from public.publication_calendar_slots where project_id='30000000-0000-4000-8000-000000000001' order by local_date offset 2 limit 1;
 update public.agents set max_monthly_budget_eur=.15 where id=a;
 perform pg_temp.replay_failure(format('select public.publication_ai_begin(%L,null,''user_local'')',root),'55000','monthly budget includes failed calls');
 update public.agents set max_monthly_budget_eur=5 where id=a;
 update public.agent_project_assignments set enabled=false where agent_id=a;
 perform pg_temp.replay_failure(format('select public.publication_ai_begin(%L,null,''user_local'')',root),'23514','disabled assignment blocks execution');
 update public.agent_project_assignments set enabled=true where agent_id=a;
 select count(*) into before_count from public.publication_reviews;
 perform pg_temp.replay_failure('delete from public.publication_media_uses','55000','media history append-only');
 -- Blocked either by a history guard reached through a cascade (55000) or by a restricting FK (23503): which
 -- referential trigger fires first follows trigger OIDs, which vary with concurrent work on the cluster.
 begin
  delete from public.clients where id='10000000-0000-4000-8000-000000000001';
  raise exception 'client with agent/publications history was deleted' using errcode='P0001';
 exception when sqlstate '55000' or sqlstate '23503' then
  perform pg_temp.replay_assert(true,'client with agent/publications history deletion blocked');
 end;
 perform pg_temp.replay_assert(exists(select 1 from public.clients where id='10000000-0000-4000-8000-000000000001'),'client with history kept');
 perform pg_temp.replay_assert((select count(*)=before_count from public.publication_reviews),'reviews preserved');
end $$;
do $$declare root uuid;run uuid;replacement uuid;begin
 select publication_id into root from public.publication_calendar_slots where project_id='30000000-0000-4000-8000-000000000001' order by local_date offset 3 limit 1;
 run:=(public.publication_ai_begin(root,null,'user_local')->>'run_id')::uuid;
 update public.publication_ai_runs set lease_until=now()-interval '1 minute' where id=run;
 replacement:=(public.publication_ai_begin(root,null,'user_local')->>'run_id')::uuid;
 perform pg_temp.replay_assert(run<>replacement,'expired lease retry new attempt');
 perform pg_temp.replay_assert((select status='failed' and error_code='lease_expired' and estimated_cost_eur=.1 from public.publication_ai_runs where id=run),'expired reservation billed conservatively');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_events where action='publication.preparation_failed' and metadata->>'run_id'=run::text),'expiry audited once');
 perform public.publication_ai_fail(replacement,'media_required',0,0,0);
 perform pg_temp.replay_failure('update public.publication_generation_details set generation_summary=''changed''','55000','generation evidence immutable');
 perform pg_temp.replay_failure('update public.publication_media_uses set used_at=now()','55000','usage immutable');
end $$;
select pg_temp.replay_assert((select not generation_enabled and not automation_enabled and not publishing_enabled and emergency_stop from public.publication_settings),'global kill switch unchanged');
select pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries),'no deliveries');
select pg_temp.replay_assert(not exists(select 1 from public.publication_jobs),'no external jobs');
select pg_temp.replay_assert(not exists(select 1 from public.publication_planning_jobs where status='prepared'),'no executable worker jobs');
