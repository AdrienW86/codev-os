-- Synthetic PostgreSQL local test only (photothèque, outils : recherche, reclassement, légende, historique d'utilisation,
-- garantie « jamais proposée à l'agent »). Never execute remotely. Runs on the full migration chain; rolled back by the runner.
-- Les fonctions de sélection de l'Agent v2 (#38) sont seulement appelées, jamais modifiées.
create temporary table mt_ids(name text primary key,id uuid not null);
grant select,insert,update on mt_ids to service_role;
create function pg_temp.mt_id(p_name text) returns uuid language sql as $$ select id from mt_ids where name=p_name $$;
create function pg_temp.mt_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate;end $$;
grant execute on function pg_temp.mt_id(text),pg_temp.mt_error(text) to service_role;

-- 1. New objects: server-only, invoker, fixed search_path; new tables with RLS and no browser privilege.
do $$declare r text;f text;t text;begin
 foreach f in array array['public.whatsapp_asset_reclassify(uuid,uuid,text,text,text)','public.whatsapp_asset_caption_save(uuid,uuid,text,text)',
  'public.whatsapp_asset_usage_history(uuid,uuid[])','public.whatsapp_library_search(uuid,jsonb,integer,integer)','codev_private.media_fold(text)',
  'codev_private.whatsapp_asset_decision_log()'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser denied '||f||' '||r);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker '||f);
 end loop;
 foreach t in array array['public.whatsapp_asset_decisions','public.client_media_drive_files','public.client_media_drive_sync'] loop
  foreach r in array array['anon','authenticated'] loop
   perform pg_temp.replay_assert(not has_table_privilege(r,t,'SELECT') and not has_table_privilege(r,t,'INSERT'),'browser denied '||t||' '||r);
  end loop;
  perform pg_temp.replay_assert((select relrowsecurity from pg_class where oid=t::regclass),'RLS on '||t);
 end loop;
 perform pg_temp.replay_assert(not has_table_privilege('service_role','public.whatsapp_asset_decisions','UPDATE') and not has_table_privilege('service_role','public.whatsapp_asset_decisions','DELETE'),'decisions append-only');
end $$;

-- 2. Fixtures (fictitious): Couverture Catalane with a configured agent and daily slots; JRenov as the other client.
do $$declare cl uuid:=gen_random_uuid();other uuid:=gen_random_uuid();begin
 insert into public.clients(id,name,activity) values(cl,'Couverture Catalane','Couvreur'),(other,'JRenov','Rénovation');
 insert into mt_ids values('client',cl),('other',other),('social',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values(pg_temp.mt_id('social'),cl,'Réseaux Couverture Catalane','Réseaux sociaux');
 update public.agents set max_monthly_budget_eur=50 where publication_specialist;
 insert into public.whatsapp_senders(sender,client_id,drive_folder_id,rights_confirmed,enabled,updated_by) values('33611111111',cl,'folder_mt_whatsapp01',true,true,'user_local');
end $$;
do $$declare cl uuid:=pg_temp.mt_id('client');n integer:=0;name text;begin
 foreach name in array array['valid','ai_relevant','ai_quarantined','confidential','to_reject','human_review','export_old','drive_photo','used_photo','purged','foreign'] loop
  n:=n+1;insert into mt_ids values(name,gen_random_uuid());
  insert into public.whatsapp_assets(id,client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size,media_kind,imported_at,library_status,status_changed_by,origin,captured_at,received_at,caption)
  values(pg_temp.mt_id(name),case when name='foreign' then pg_temp.mt_id('other') else cl end,case when name='foreign' then 'folder_mt_jrenov0001' when name='drive_photo' then 'folder00000001' else 'folder_mt_whatsapp01' end,
   lpad(to_hex(1000+n),64,'0'),lpad(to_hex(1000+n),32,'0'),'drive_file_mt_'||n,'image/jpeg',4000+n,'image',now()-make_interval(days=>n),
   case name when 'ai_relevant' then 'received' when 'ai_quarantined' then 'quarantined' when 'human_review' then 'to_review' when 'used_photo' then 'used' else 'validated' end,
   case name when 'ai_quarantined' then 'ai_classification' when 'ai_relevant' then null else 'user_local' end,
   case name when 'export_old' then 'whatsapp_export' when 'drive_photo' then 'drive' else 'whatsapp' end,
   case name when 'export_old' then timestamptz '2024-01-12 10:00+01' when 'drive_photo' then timestamptz '2025-06-01 10:00+02' else null end,
   case when name in ('export_old','drive_photo') then null else now()-make_interval(days=>n) end,
   case name when 'valid' then 'Réfection de la gouttière' when 'export_old' then 'Démoussage terminé' else null end);
 end loop;
 update public.whatsapp_assets set purged_at=now(),library_status='rejected' where id=pg_temp.mt_id('purged');
 insert into public.whatsapp_asset_assessments(asset_id,client_id,verdict,business_relevance,publishability,sensitive,confidential,description,topics,quality,quality_issues,profile_version,model,estimated_cost_eur,manual_verdict,reviewed_by,reviewed_at)
 values(pg_temp.mt_id('valid'),cl,'relevant',0.9,0.8,'{}',false,'Gouttière en zinc posée sous une toiture.','{Gouttière,zinguerie}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,'relevant','user_local',now()),
  (pg_temp.mt_id('ai_relevant'),cl,'relevant',0.9,0.8,'{}',false,'Toiture en tuiles canal refaite.','{toiture}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,null,null,null),
  (pg_temp.mt_id('ai_quarantined'),cl,'off_topic',0.1,0.5,'{}',false,'Échafaudage devant une façade.','{façade}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,null,null,null),
  (pg_temp.mt_id('confidential'),cl,'to_review',0.7,0.1,'{invoice}',true,'Document sur une table.','{}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,'relevant','user_local',now()),
  (pg_temp.mt_id('export_old'),cl,'relevant',0.8,0.8,'{}',false,'Toiture après démoussage.','{démoussage,toiture}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,null,null,null);
end $$;
set local role service_role;
do $$declare s uuid:=pg_temp.mt_id('social');every_day text;begin
 insert into mt_ids values('fb',public.publication_channel_save(s,'facebook',true,null,null,'user_local')),('gbp',public.publication_channel_save(s,'google_business_profile',true,null,null,'user_local'));
 insert into mt_ids select 'ig',id from public.publication_project_channels where project_id=s and platform='instagram';
 for every_day in select unnest(array['fb:12:00','ig:18:00','gbp:09:00']) loop
  perform public.publication_channel_schedule_save(pg_temp.mt_id(split_part(every_day,':',1)),'Europe/Paris',true,
   (select jsonb_agg(jsonb_build_object('weekday',d,'local_time',substr(every_day,length(split_part(every_day,':',1))+2),'enabled',true)) from generate_series(1,7) d),'user_local');
 end loop;
 perform public.publication_channel_occurrences_ensure(s,current_date+1,current_date+20,'user_local');
 perform public.publication_agent_configure(s,'folder00000001','["Couverture"]','Ton sobre',true,true,'user_local');
end $$;
reset role;
create function pg_temp.mt_occ(p_platform text) returns uuid language sql as $$
 select id from public.publication_channel_occurrences where project_id=pg_temp.mt_id('social') and platform=p_platform and scheduled_for>now()
  and publication_id is null and skipped_at is null order by scheduled_for limit 1 $$;
-- Agent v2 candidate check (#38, unchanged): a run finished with this photo. Null when accepted, else the refusal SQLSTATE.
create function pg_temp.mt_agent(p_media uuid) returns text language plpgsql as $$
declare o uuid:=pg_temp.mt_occ('facebook');run uuid;
begin
 run:=(public.publication_agent_v2_begin(pg_temp.mt_id('social'),array[o],1,'user_local')->>'run_id')::uuid;
 begin
  perform public.publication_agent_v2_finish(run,jsonb_build_object('idea',jsonb_build_object('subject','Essai '||run,'angle','Angle'),'publications',
   jsonb_build_array(jsonb_build_object('occurrence_id',o,'text','Texte essai '||run,'cta',null))),p_media,'{"input_tokens":1,"output_tokens":1,"estimated_cost_eur":0}','user_local');
 exception when others then perform public.publication_agent_v2_fail(run,'invalid_output','{"input_tokens":0,"output_tokens":0,"estimated_cost_eur":0}','user_local');return sqlstate;end;
 return null;
end $$;
create function pg_temp.mt_publishable(p_name text) returns boolean language sql as $$
 select publications_private.library_asset_publishable(a) from public.whatsapp_assets a where id=pg_temp.mt_id(p_name) $$;
grant execute on function pg_temp.mt_occ(text),pg_temp.mt_agent(uuid),pg_temp.mt_publishable(text) to service_role;
-- A manual publication of the client, used by 'used_photo' (history read model).
set local role service_role;
do $$declare r jsonb;begin
 r:=public.publication_create_from_occurrence(pg_temp.mt_occ('instagram'),null,null,'Chantier gouttière Perpignan','Texte manuel',null,'user_local');
 insert into mt_ids values('manual_pub',(r->>'publication_id')::uuid);
end $$;
reset role;
insert into public.whatsapp_asset_uses(asset_id,client_id,publication_id,platform,used_by,used_at)
values(pg_temp.mt_id('used_photo'),pg_temp.mt_id('client'),pg_temp.mt_id('manual_pub'),'instagram','user_local',now()-interval '3 days');

set local role service_role;
-- 3. Guarantee: quarantined, rejected or confidential photos are never offered to the agent (server check from #38).
do $$begin
 perform pg_temp.replay_assert(pg_temp.mt_publishable('valid') and pg_temp.mt_publishable('ai_relevant'),'control: publishable photos');
 perform pg_temp.replay_assert(not pg_temp.mt_publishable('ai_quarantined') and not pg_temp.mt_publishable('confidential') and not pg_temp.mt_publishable('purged'),'quarantined, confidential and purged never publishable');
 perform pg_temp.replay_assert(pg_temp.mt_agent(pg_temp.mt_id('ai_quarantined'))='22023','AI quarantine refused by the agent');
 perform pg_temp.replay_assert(pg_temp.mt_agent(pg_temp.mt_id('confidential'))='22023','confidential refused by the agent even after a human validation');
 -- Manual reclassification to quarantine / rejection: immediately refused by the agent.
 perform public.whatsapp_asset_reclassify(pg_temp.mt_id('client'),pg_temp.mt_id('ai_relevant'),'quarantined','Plaque d’immatriculation lisible au fond','user_admin');
 perform public.whatsapp_asset_reclassify(pg_temp.mt_id('client'),pg_temp.mt_id('to_reject'),'rejected','Photo d’un autre chantier','user_admin');
 perform pg_temp.replay_assert(not pg_temp.mt_publishable('ai_relevant') and not pg_temp.mt_publishable('to_reject'),'reclassified photos no longer publishable');
 perform pg_temp.replay_assert(pg_temp.mt_agent(pg_temp.mt_id('ai_relevant'))='22023' and pg_temp.mt_agent(pg_temp.mt_id('to_reject'))='22023','reclassified photos refused by the agent');
 perform pg_temp.replay_assert(pg_temp.mt_agent(pg_temp.mt_id('valid')) is null,'control: a validated photo is accepted by the same check');
 perform pg_temp.replay_assert(not exists(select 1 from public.whatsapp_library_search(pg_temp.mt_id('client'),'{"status":"publishable"}',60,0) s
  where s.asset_id in (pg_temp.mt_id('ai_relevant'),pg_temp.mt_id('to_reject'),pg_temp.mt_id('ai_quarantined'),pg_temp.mt_id('confidential'))),'publishable view excludes them');
end $$;

-- 4. Reclassification: audited, reason and author kept, reusing whatsapp_assets_review; human correction survives automatic classification.
do $$declare a public.whatsapp_assets;s public.whatsapp_asset_assessments;d public.whatsapp_asset_decisions;r jsonb;begin
 r:=public.whatsapp_asset_reclassify(pg_temp.mt_id('client'),pg_temp.mt_id('ai_quarantined'),'validated','Façade du client, chantier réel','user_admin');
 perform pg_temp.replay_assert(r->>'from_status'='quarantined' and r->>'to_status'='validated','reclassify result');
 select * into a from public.whatsapp_assets where id=pg_temp.mt_id('ai_quarantined');
 select * into s from public.whatsapp_asset_assessments where asset_id=a.id;
 select * into d from public.whatsapp_asset_decisions where asset_id=a.id order by created_at desc limit 1;
 perform pg_temp.replay_assert(a.library_status='validated' and a.status_changed_by='user_admin','status set by the human');
 perform pg_temp.replay_assert(s.manual_verdict='relevant' and s.reviewed_by='user_admin' and s.reviewed_at is not null,'manual verdict recorded by the existing review RPC');
 perform pg_temp.replay_assert(d.kind='reclassify' and d.from_status='quarantined' and d.to_status='validated' and d.reason='Façade du client, chantier réel' and d.actor_id='user_admin','decision with reason, author, date');
 perform pg_temp.replay_assert(exists(select 1 from public.audit_logs where action='whatsapp.library.reclassified' and actor_id='user_admin' and metadata->>'asset_id'=a.id::text and not (metadata ? 'reason')),'audited without the reason text');
 perform pg_temp.replay_assert(exists(select 1 from public.audit_logs where action='whatsapp.library.status' and actor_id='user_admin'),'existing review audit kept');
 -- A later automatic classification (off topic) never overwrites the human decision.
 perform public.whatsapp_asset_assessment_record(a.id,a.client_id,'{"verdict":"off_topic","business_relevance":0.1,"publishability":0.3,"sensitive":[],"confidential":false,"description":"Façade.","topics":[],"quality":"good","quality_issues":[],"profile_version":2}',
  '{"model":"gpt-4.1-mini-2025-04-14","input_tokens":1,"output_tokens":1,"estimated_cost_eur":0.001}');
 select * into a from public.whatsapp_assets where id=a.id;select * into s from public.whatsapp_asset_assessments where asset_id=a.id;
 perform pg_temp.replay_assert(a.library_status='validated' and a.status_changed_by='user_admin' and s.manual_verdict='relevant' and s.reviewed_by='user_admin','human correction persists after automatic classification');
 perform pg_temp.replay_assert(pg_temp.mt_publishable('ai_quarantined'),'still publishable (human validation prevails over the AI verdict)');
 -- A human « to review » is not turned into quarantine by the AI either.
 perform public.whatsapp_asset_assessment_record(pg_temp.mt_id('human_review'),pg_temp.mt_id('client'),'{"verdict":"off_topic","business_relevance":0.1,"publishability":0.3,"sensitive":[],"confidential":false,"description":"Autre.","topics":[],"quality":"good","quality_issues":[],"profile_version":2}',
  '{"model":"gpt-4.1-mini-2025-04-14","input_tokens":1,"output_tokens":1,"estimated_cost_eur":0.001}');
 perform pg_temp.replay_assert((select library_status='to_review' and status_changed_by='user_local' from public.whatsapp_assets where id=pg_temp.mt_id('human_review')),'human to_review untouched by the AI');
 -- The decision history is append-only and survives everything.
 perform pg_temp.replay_assert((select count(*)>=1 from public.whatsapp_asset_decisions where asset_id=pg_temp.mt_id('ai_quarantined')),'history kept');
end $$;
do $$begin
 perform pg_temp.replay_assert(pg_temp.mt_error(format('select public.whatsapp_asset_reclassify(%L,%L,%L,%L,%L)',pg_temp.mt_id('client'),pg_temp.mt_id('valid'),'archived','ok','user_admin'))='22023','reason required (3 characters minimum)');
 perform pg_temp.replay_assert(pg_temp.mt_error(format('select public.whatsapp_asset_reclassify(%L,%L,%L,%L,%L)',pg_temp.mt_id('client'),pg_temp.mt_id('valid'),'used','Motif valable','user_admin'))='22023','« used » never set by hand');
 perform pg_temp.replay_assert(pg_temp.mt_error(format('select public.whatsapp_asset_reclassify(%L,%L,%L,%L,%L)',pg_temp.mt_id('client'),pg_temp.mt_id('valid'),'archived','Motif valable','ai_classification'))='22023','human actor required');
 perform pg_temp.replay_assert(pg_temp.mt_error(format('select public.whatsapp_asset_reclassify(%L,%L,%L,%L,%L)',pg_temp.mt_id('client'),pg_temp.mt_id('valid'),'validated','Motif valable','user_admin'))='55000','same human status refused');
 perform pg_temp.replay_assert(pg_temp.mt_error(format('select public.whatsapp_asset_reclassify(%L,%L,%L,%L,%L)',pg_temp.mt_id('client'),pg_temp.mt_id('purged'),'validated','Motif valable','user_admin'))='55000','purged photo not reclassified');
 perform pg_temp.replay_assert(pg_temp.mt_error(format('select public.whatsapp_asset_reclassify(%L,%L,%L,%L,%L)',pg_temp.mt_id('client'),pg_temp.mt_id('foreign'),'rejected','Motif valable','user_admin'))='55000','another client''s photo refused');
 perform pg_temp.replay_assert((select library_status from public.whatsapp_assets where id=pg_temp.mt_id('foreign'))='validated','other client untouched');
end $$;
-- Confirming an automatic quarantine keeps the status, records the human decision.
reset role;
update public.whatsapp_assets set library_status='quarantined',status_changed_by='ai_classification' where id=pg_temp.mt_id('drive_photo');
set local role service_role;
do $$begin
 perform pg_temp.replay_assert((select count(*) from public.whatsapp_asset_decisions where asset_id=pg_temp.mt_id('drive_photo'))=0,'automatic status change not logged as a human decision');
 perform public.whatsapp_asset_reclassify(pg_temp.mt_id('client'),pg_temp.mt_id('drive_photo'),'quarantined','Écran de téléphone visible','user_admin');
 perform pg_temp.replay_assert((select status_changed_by='user_admin' from public.whatsapp_assets where id=pg_temp.mt_id('drive_photo'))
  and (select count(*)=1 from public.whatsapp_asset_decisions where asset_id=pg_temp.mt_id('drive_photo') and kind='reclassify' and reason='Écran de téléphone visible'),'confirmation recorded once');
 -- Bulk review (action bar) is logged too, without a reason.
 perform public.whatsapp_assets_review(pg_temp.mt_id('client'),array[pg_temp.mt_id('export_old')],'archived','user_admin');
 perform pg_temp.replay_assert((select count(*)=1 from public.whatsapp_asset_decisions where asset_id=pg_temp.mt_id('export_old') and kind='status' and reason is null and to_status='archived'),'bulk human status logged');
 perform public.whatsapp_assets_review(pg_temp.mt_id('client'),array[pg_temp.mt_id('export_old')],'validated','user_admin');
end $$;

-- 5. Caption edited by an admin: bounded, traced (no text in the history or audit), never on a purged photo.
do $$begin
 perform pg_temp.replay_assert(public.whatsapp_asset_caption_save(pg_temp.mt_id('client'),pg_temp.mt_id('valid'),'  Gouttière zinc, Perpignan  ','user_admin'),'caption saved');
 perform pg_temp.replay_assert((select caption='Gouttière zinc, Perpignan' and caption_edited_by='user_admin' and caption_edited_at is not null from public.whatsapp_assets where id=pg_temp.mt_id('valid')),'caption trimmed and edit traced');
 perform pg_temp.replay_assert((select count(*)=1 from public.whatsapp_asset_decisions where asset_id=pg_temp.mt_id('valid') and kind='caption' and reason is null),'caption decision without text');
 perform pg_temp.replay_assert((select metadata->>'length'='25' and not (metadata ? 'caption') from public.audit_logs where action='whatsapp.library.caption_edited' order by created_at desc limit 1),'audit keeps the length only');
 perform pg_temp.replay_assert(public.whatsapp_asset_caption_save(pg_temp.mt_id('client'),pg_temp.mt_id('valid'),'','user_admin'),'empty caption accepted');
 perform pg_temp.replay_assert((select caption is null from public.whatsapp_assets where id=pg_temp.mt_id('valid')),'empty caption erases it');
 perform pg_temp.replay_assert(not public.whatsapp_asset_caption_save(pg_temp.mt_id('client'),pg_temp.mt_id('purged'),'Texte','user_admin'),'purged photo untouched');
 perform pg_temp.replay_assert(not public.whatsapp_asset_caption_save(pg_temp.mt_id('client'),pg_temp.mt_id('foreign'),'Texte','user_admin'),'another client''s photo untouched');
 perform pg_temp.replay_assert(pg_temp.mt_error(format('select public.whatsapp_asset_caption_save(%L,%L,%L,%L)',pg_temp.mt_id('client'),pg_temp.mt_id('valid'),repeat('x',3001),'user_admin'))='22023','caption bounded');
 perform pg_temp.replay_assert(pg_temp.mt_error(format('select public.whatsapp_asset_caption_save(%L,%L,%L,%L)',pg_temp.mt_id('client'),pg_temp.mt_id('valid'),'a'||chr(7)||'b','user_admin'))='22023','control characters refused');
 perform public.whatsapp_asset_caption_save(pg_temp.mt_id('client'),pg_temp.mt_id('valid'),'Réfection de la gouttière','user_admin');
end $$;

-- 6. Usage history read model: publication, platform, date, publication state; strictly per client.
do $$declare h record;begin
 select * into h from public.whatsapp_asset_usage_history(pg_temp.mt_id('client'),array[pg_temp.mt_id('used_photo'),pg_temp.mt_id('valid')]);
 perform pg_temp.replay_assert(h.asset_id=pg_temp.mt_id('used_photo') and h.publication_id=pg_temp.mt_id('manual_pub') and h.platform='instagram' and h.subject='Chantier gouttière Perpignan'
  and h.used_by='user_local' and h.used_at<now()-interval '2 days' and h.publication_status is not null and h.archived=false,'history row');
 perform pg_temp.replay_assert((select count(*) from public.whatsapp_asset_usage_history(pg_temp.mt_id('client'),array[pg_temp.mt_id('used_photo'),pg_temp.mt_id('valid')]))=1,'never used photo has no row');
 perform pg_temp.replay_assert((select count(*) from public.whatsapp_asset_usage_history(pg_temp.mt_id('other'),array[pg_temp.mt_id('used_photo')]))=0,'other client sees nothing');
end $$;

-- 7. Server-side search: status views, origin, service/subject (accents folded), free text incl. publication subject,
--    used yes/no, origin date range (Paris days), pagination with total, strict filter validation.
create function pg_temp.mt_search(p_filters jsonb,p_limit integer default 60,p_offset integer default 0) returns uuid[] language sql as $$
 select coalesce(array_agg(asset_id),'{}') from public.whatsapp_library_search(pg_temp.mt_id('client'),p_filters,p_limit,p_offset) $$;
grant execute on function pg_temp.mt_search(jsonb,integer,integer) to service_role;
do $$declare ids uuid[];begin
 ids:=pg_temp.mt_search('{}');
 perform pg_temp.replay_assert(pg_temp.mt_id('valid')=any(ids) and pg_temp.mt_id('used_photo')=any(ids) and not pg_temp.mt_id('to_reject')=any(ids) and not pg_temp.mt_id('ai_relevant')=any(ids)
  and not pg_temp.mt_id('purged')=any(ids) and not pg_temp.mt_id('foreign')=any(ids),'default view: active photos of this client only');
 perform pg_temp.replay_assert(pg_temp.mt_search('{"status":"quarantined"}') @> array[pg_temp.mt_id('ai_relevant'),pg_temp.mt_id('drive_photo')],'quarantine view');
 perform pg_temp.replay_assert(pg_temp.mt_search('{"status":"rejected"}')=array[pg_temp.mt_id('to_reject')],'rejected view (purged excluded)');
 perform pg_temp.replay_assert(pg_temp.mt_search('{"status":"to_review"}')=array[pg_temp.mt_id('human_review')],'to review view');
 perform pg_temp.replay_assert(pg_temp.mt_search('{"status":"used"}')=array[pg_temp.mt_id('used_photo')],'used view');
 perform pg_temp.replay_assert(pg_temp.mt_search('{"status":"all","used":"yes"}')=array[pg_temp.mt_id('used_photo')] and not pg_temp.mt_id('used_photo')=any(pg_temp.mt_search('{"status":"all","used":"no"}')),'used filter');
 perform pg_temp.replay_assert(pg_temp.mt_search('{"status":"all","origin":"whatsapp_export"}')=array[pg_temp.mt_id('export_old')] and pg_temp.mt_search('{"status":"all","origin":"drive"}')=array[pg_temp.mt_id('drive_photo')],'origin filter');
 perform pg_temp.replay_assert(pg_temp.mt_search('{"service":"gouttiere"}')=array[pg_temp.mt_id('valid')],'service matches topics without accents');
 perform pg_temp.replay_assert(pg_temp.mt_search('{"service":"DÉMOUSSAGE"}')=array[pg_temp.mt_id('export_old')],'service matches case and accents folded');
 perform pg_temp.replay_assert(pg_temp.mt_search('{"q":"perpignan"}')=array[pg_temp.mt_id('used_photo')],'free text matches the subject of the publication that used it');
 perform pg_temp.replay_assert(pg_temp.mt_search('{"status":"all","from":"2024-01-12","to":"2024-01-12"}')=array[pg_temp.mt_id('export_old')],'origin date = capture date, Paris day');
 perform pg_temp.replay_assert(pg_temp.mt_search('{"status":"all","from":"2025-01-01","to":"2025-12-31"}')=array[pg_temp.mt_id('drive_photo')],'date range');
 perform pg_temp.replay_assert(cardinality(pg_temp.mt_search('{"status":"all"}',2,0))=2 and (select max(total) from public.whatsapp_library_search(pg_temp.mt_id('client'),'{"status":"all"}',2,0))=9,'page of 2, total of every non-purged photo');
 perform pg_temp.replay_assert(not (pg_temp.mt_search('{"status":"all"}',2,0) && pg_temp.mt_search('{"status":"all"}',2,2)),'pages do not overlap');
 perform pg_temp.replay_assert(pg_temp.mt_error($q$select pg_temp.mt_search('{"status":"published"}')$q$)='22023' and pg_temp.mt_error($q$select pg_temp.mt_search('{"sql":"1"}')$q$)='22023'
  and pg_temp.mt_error($q$select pg_temp.mt_search('{"from":"12/01/2024"}')$q$)='22023' and pg_temp.mt_error($q$select pg_temp.mt_search('{"origin":"email"}')$q$)='22023','filters strictly validated');
 perform pg_temp.replay_assert((select count(*) from public.whatsapp_library_search(pg_temp.mt_id('other'),'{"status":"all"}',60,0))=1,'other client: only its own photo');
end $$;

-- 8. A photo sent by an unknown number: never claimed nor attributed automatically; explicit assignment only.
do $$declare claimed integer;r public.whatsapp_inbox;begin
 insert into public.whatsapp_inbox(waba_id,phone_number_id,message_id,sender,media_id,mime_type,received_at,caption)
 values('waba_test','phone_test','wamid.unknown.1','33799999999','media_unknown_1','image/jpeg',now(),'Photo du chantier');
 select count(*) into claimed from public.whatsapp_claim(gen_random_uuid());
 perform pg_temp.replay_assert(claimed=0,'unknown number never claimed');
 perform pg_temp.replay_assert((select client_id is null and status='pending' from public.whatsapp_inbox where message_id='wamid.unknown.1'),'stays unassigned');
 perform pg_temp.replay_assert(exists(select 1 from public.admin_notifications where href='/settings/whatsapp' and category='media_received'),'assignment queue notified');
 perform pg_temp.replay_assert(pg_temp.mt_error(format('select public.whatsapp_assign(%L,%L,%L,%L)',(select id from public.whatsapp_inbox where message_id='wamid.unknown.1'),pg_temp.mt_id('other'),'folder_mt_jrenov0001','user_admin'))='23514','assignment only to a confirmed client folder');
 r:=public.whatsapp_assign((select id from public.whatsapp_inbox where message_id='wamid.unknown.1'),pg_temp.mt_id('client'),'folder_mt_whatsapp01','user_admin');
 perform pg_temp.replay_assert(r.client_id=pg_temp.mt_id('client') and r.assigned_by='user_admin','explicitly assigned');
 select * into r from public.whatsapp_claim(gen_random_uuid());
 perform pg_temp.replay_assert(r.message_id='wamid.unknown.1' and r.client_id=pg_temp.mt_id('client') and r.drive_folder_id='folder_mt_whatsapp01','claimed for the chosen client and folder');
end $$;

-- 9. Exactly once per client: same fingerprint never twice in a folder, a Drive file never twice; Drive sync memory bound to the client.
reset role;
do $$begin
 perform pg_temp.replay_assert(pg_temp.mt_error(format($q$insert into public.whatsapp_assets(client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size) select client_id,drive_folder_id,sha256,md5,'drive_file_mt_copy','image/jpeg',10 from public.whatsapp_assets where id=%L$q$,pg_temp.mt_id('valid')))='23505','same fingerprint, same folder refused');
 perform pg_temp.replay_assert(pg_temp.mt_error(format($q$insert into public.whatsapp_assets(client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size) values(%L,'folder_mt_whatsapp01',repeat('e',64),repeat('e',32),'drive_file_mt_1','image/jpeg',10)$q$,pg_temp.mt_id('client')))='23505','same Drive file refused');
 perform pg_temp.replay_assert(exists(select 1 from pg_indexes where indexname='whatsapp_assets_client_sha'),'client-wide fingerprint index');
end $$;
set local role service_role;
do $$begin
 insert into public.client_media_drive_files(client_id,drive_file_id,drive_folder_id,outcome,asset_id) values(pg_temp.mt_id('client'),'drive_copy_00000001','folder00000001','duplicate',pg_temp.mt_id('valid'));
 perform pg_temp.replay_assert(pg_temp.mt_error(format($q$insert into public.client_media_drive_files(client_id,drive_file_id,drive_folder_id,outcome,asset_id) values(%L,'drive_copy_00000002','folder00000001','duplicate',%L)$q$,pg_temp.mt_id('client'),pg_temp.mt_id('foreign')))='23503','memory cannot point to another client''s photo');
 perform pg_temp.replay_assert(pg_temp.mt_error(format($q$insert into public.client_media_drive_files(client_id,drive_file_id,drive_folder_id,outcome) values(%L,'drive_copy_00000003','folder00000001','duplicate')$q$,pg_temp.mt_id('client')))='23514','a duplicate names its photo');
 perform pg_temp.replay_assert(pg_temp.mt_error(format($q$delete from public.client_media_drive_files where client_id=%L$q$,pg_temp.mt_id('client'))) is not null,'memory never deleted by the server');
 insert into public.client_media_drive_sync(client_id,drive_folder_id,backfill_after,last_synced_at) values(pg_temp.mt_id('client'),'folder00000001',now()-interval '1 day',now());
 perform pg_temp.replay_assert((select count(*)=1 from public.client_media_drive_sync where client_id=pg_temp.mt_id('client')),'sync state recorded');
end $$;
