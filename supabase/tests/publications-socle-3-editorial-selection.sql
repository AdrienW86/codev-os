-- Synthetic PostgreSQL local test only (socle Publications, lots 4-5 : sélection conjointe sujet + photo).
-- Never execute remotely. Runs on the full migration chain; every statement is rolled back by the runner.
create temporary table es_ids(name text primary key,id uuid not null);
grant select,insert,update on es_ids to service_role;
create function pg_temp.es_id(p_name text) returns uuid language sql as $$ select id from es_ids where name=p_name $$;
create function pg_temp.es_error(statement text) returns text language plpgsql as $$
begin execute statement;return null;exception when others then return sqlstate;end $$;
-- Derivatives built for a claimed attempt (deterministic ids, path client/publication/asset).
create function pg_temp.es_assets(p_claim jsonb,p_salt text) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('publication_id',t->>'publication_id','asset_id',md5(p_salt||(t->>'publication_id'))::uuid,
  'storage_path',(p_claim->>'client_id')||'/'||(t->>'publication_id')||'/'||md5(p_salt||(t->>'publication_id'))::uuid,
  'file_hash',md5(p_salt)||md5(p_salt),'mime_type','image/jpeg','width',1080,'height',1080) order by t->>'publication_id')
 from jsonb_array_elements(p_claim->'targets') t $$;
grant execute on function pg_temp.es_id(text),pg_temp.es_error(text),pg_temp.es_assets(jsonb,text) to service_role;

-- 1. Grants: new guards are server-only, invoker, fixed search_path; redefined RPCs keep their grants.
do $$declare r text;f text;begin
 foreach f in array array['publications_private.library_asset_publishable(public.whatsapp_assets)','publications_private.library_asset_reusable(public.whatsapp_assets)',
  'publications_private.agent_v2_library_available(public.publication_agent_v2_runs,public.whatsapp_assets)',
  'public.publication_agent_v2_finish(uuid,jsonb,uuid,jsonb,text)','public.publication_agent_v2_media_claim(uuid,text)',
  'public.publication_agent_v2_media_attach(uuid,integer,text,jsonb,text)','public.publication_agent_v2_media_fail(uuid,integer,text,text)','publications_private.guard_agent_v2_run()',
  'publications_private.agent_v2_media_target(public.publication_agent_v2_runs,public.publications)'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser denied '||f||' '||r);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker '||f);
 end loop;
end $$;

-- 2. Fixtures: one client with a configured agent, three channels with daily slots, a photothèque covering every case.
do $$declare cl uuid:=gen_random_uuid();other uuid:=gen_random_uuid();begin
 insert into public.clients(id,name,activity) values(cl,'Couverture Martin','Couverture'),(other,'Autre client',null);
 insert into es_ids values('client',cl),('other',other),('social',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values(pg_temp.es_id('social'),cl,'Réseaux Martin','Réseaux sociaux');
 update public.agents set max_monthly_budget_eur=50 where publication_specialist;
 insert into public.publication_drive_media(id,client_id,drive_file_id,drive_folder_id,name,mime_type,modified_at,file_size,analysis)
 values(gen_random_uuid(),cl,'catalogfile0001','folder00000001','toit.jpg','image/jpeg',now(),2048,'{"scene":"roof","usable":true}');
end $$;
insert into es_ids select 'catalog',id from public.publication_drive_media where drive_file_id='catalogfile0001';
do $$declare cl uuid:=pg_temp.es_id('client');n integer:=0;name text;begin
 foreach name in array array['valid','ai_relevant','ai_face','confidential','quarantined','rejected','archived','video','foreign','used_recent','used_old','manual_off','purged','spare'] loop
  n:=n+1;
  insert into es_ids values(name,gen_random_uuid());
  insert into public.whatsapp_assets(id,client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size,media_kind,imported_at,library_status,status_changed_by,origin)
  values(pg_temp.es_id(name),case when name='foreign' then pg_temp.es_id('other') else cl end,'folder_wa_'||left(cl::text,8),lpad(to_hex(n),64,'0'),lpad(to_hex(n),32,'0'),
   'drive_file_es_'||n,case when name='video' then 'video/mp4' else 'image/jpeg' end,2000+n,case when name='video' then 'video' else 'image' end,now(),
   case name when 'quarantined' then 'quarantined' when 'rejected' then 'rejected' when 'archived' then 'archived' when 'ai_relevant' then 'received' when 'ai_face' then 'received' else 'validated' end,
   'user_local',case when name='spare' then 'drive' else 'whatsapp' end);
 end loop;
 update public.whatsapp_assets set purged_at=now(),library_status='rejected' where id=pg_temp.es_id('purged');
 insert into public.whatsapp_asset_assessments(asset_id,client_id,verdict,business_relevance,publishability,sensitive,confidential,description,topics,quality,quality_issues,profile_version,model,estimated_cost_eur,manual_verdict)
 values(pg_temp.es_id('ai_relevant'),cl,'relevant',0.9,0.8,'{}',false,'Toiture en ardoise refaite.','{toiture}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,null),
  (pg_temp.es_id('ai_face'),cl,'relevant',0.9,0.8,'{face}',false,'Couvreur sur un toit.','{toiture}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,null),
  (pg_temp.es_id('confidential'),cl,'to_review',0.7,0.1,'{invoice}',true,'Document sur une table.','{}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,'relevant'),
  (pg_temp.es_id('manual_off'),cl,'relevant',0.9,0.8,'{}',false,'Gouttière.','{}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,'off_topic');
end $$;
set local role service_role;
do $$declare s uuid:=pg_temp.es_id('social');every_day text;begin
 insert into es_ids values('fb',public.publication_channel_save(s,'facebook',true,null,null,'user_local')),('gbp',public.publication_channel_save(s,'google_business_profile',true,null,null,'user_local'));
 insert into es_ids select 'ig',id from public.publication_project_channels where project_id=s and platform='instagram';
 for every_day in select unnest(array['fb:12:00','ig:18:00','gbp:09:00']) loop
  perform public.publication_channel_schedule_save(pg_temp.es_id(split_part(every_day,':',1)),'Europe/Paris',true,
   (select jsonb_agg(jsonb_build_object('weekday',d,'local_time',substr(every_day,length(split_part(every_day,':',1))+2),'enabled',true)) from generate_series(1,7) d),'user_local');
 end loop;
 perform public.publication_channel_occurrences_ensure(s,current_date+1,current_date+20,'user_local');
 perform public.publication_agent_configure(s,'folder00000001','["Couverture"]','Ton sobre',true,true,'user_local');
end $$;
reset role;
create function pg_temp.es_occ(p_platform text) returns uuid language sql as $$
 select id from public.publication_channel_occurrences where project_id=pg_temp.es_id('social') and platform=p_platform and scheduled_for>now()
  and publication_id is null and skipped_at is null order by scheduled_for limit 1 $$;
grant execute on function pg_temp.es_occ(text) to service_role;
-- Uses in the past (one recent, one old), recorded on a manual draft.
set local role service_role;
do $$declare r jsonb;begin
 r:=public.publication_create_from_occurrence(pg_temp.es_occ('facebook'),null,null,'Manuel','Texte manuel',null,'user_local');
 insert into es_ids values('manual_pub',(r->>'publication_id')::uuid);
end $$;
reset role;
insert into public.whatsapp_asset_uses(asset_id,client_id,publication_id,platform,used_by,used_at) values
 (pg_temp.es_id('used_recent'),pg_temp.es_id('client'),pg_temp.es_id('manual_pub'),'facebook','user_local',now()-interval '10 days'),
 (pg_temp.es_id('used_old'),pg_temp.es_id('client'),pg_temp.es_id('manual_pub'),'facebook','user_local',now()-interval '40 days');
-- One Agent v2 run on the next open occurrences of the given platforms, finished with the given media (or null).
create function pg_temp.es_run(p_media uuid,p_platforms text[]) returns uuid language plpgsql as $$
declare occ uuid[]:=array[]::uuid[];pubs jsonb:='[]'::jsonb;o uuid;pl text;run uuid;
begin
 foreach pl in array p_platforms loop o:=pg_temp.es_occ(pl);occ:=occ||o;pubs:=pubs||jsonb_build_array(jsonb_build_object('occurrence_id',o,'text','Texte '||pl||' '||o,'cta',null));end loop;
 run:=(public.publication_agent_v2_begin(pg_temp.es_id('social'),occ,cardinality(occ),'user_local')->>'run_id')::uuid;
 perform public.publication_agent_v2_finish(run,jsonb_build_object('idea',jsonb_build_object('subject','Sujet '||run,'angle','Angle'),'publications',pubs),p_media,
  '{"input_tokens":10,"output_tokens":10,"estimated_cost_eur":0.0001}','user_local');
 return run;
end $$;
-- A run whose finish is attempted with a media; returns the SQLSTATE of the refusal (null when accepted).
create function pg_temp.es_refused(p_media uuid) returns text language plpgsql as $$
declare o uuid:=pg_temp.es_occ('facebook');run uuid;
begin
 run:=(public.publication_agent_v2_begin(pg_temp.es_id('social'),array[o],1,'user_local')->>'run_id')::uuid;
 begin
  perform public.publication_agent_v2_finish(run,jsonb_build_object('idea',jsonb_build_object('subject','Essai','angle','Angle'),'publications',
   jsonb_build_array(jsonb_build_object('occurrence_id',o,'text','Texte essai','cta',null))),p_media,'{"input_tokens":1,"output_tokens":1,"estimated_cost_eur":0}','user_local');
 exception when others then perform public.publication_agent_v2_fail(run,'invalid_output','{"input_tokens":0,"output_tokens":0,"estimated_cost_eur":0}','user_local');return sqlstate;end;
 raise exception 'accepted' using errcode='P0001';
end $$;
grant execute on function pg_temp.es_run(uuid,text[]),pg_temp.es_refused(uuid) to service_role;

set local role service_role;
-- 3. The photothèque rules are the server's: every unsafe, foreign, unpublishable or recently used photo is refused.
do $$declare name text;begin
 foreach name in array array['ai_face','confidential','quarantined','rejected','archived','video','foreign','used_recent','manual_off','purged'] loop
  perform pg_temp.replay_assert(pg_temp.es_refused(pg_temp.es_id(name))='22023','refused at finish: '||name);
 end loop;
 perform pg_temp.replay_assert(pg_temp.es_refused(gen_random_uuid())='22023','unknown media refused');
end $$;

-- 4. A validated photo: run reserves it (library source), the catalogue stays untouched.
do $$declare run uuid;r public.publication_agent_v2_runs;a public.whatsapp_assets;begin
 run:=pg_temp.es_run(pg_temp.es_id('valid'),array['facebook','instagram','google_business_profile']);insert into es_ids values('run_valid',run);
 select * into r from public.publication_agent_v2_runs where id=run;select * into a from public.whatsapp_assets where id=pg_temp.es_id('valid');
 perform pg_temp.replay_assert(r.status='completed' and r.selected_library_asset_id=pg_temp.es_id('valid') and r.selected_media_id is null and r.media_status='pending','library selection recorded');
 perform pg_temp.replay_assert(a.claimed_agent_v2_run_id=run and a.library_status='validated','photo reserved, status unchanged before attach');
 perform pg_temp.replay_assert(pg_temp.es_refused(pg_temp.es_id('valid'))='22023','a reserved photo cannot be chosen by another run');
 perform pg_temp.replay_assert((select metadata->>'media_source' from public.publication_events where action='publication.agent_v2_completed' and metadata->>'run_id'=run::text)='library','completion event names the source');
end $$;

-- 5. Claim returns a server-side library descriptor; attach refuses a different original, then links every draft.
do $$declare run uuid:=pg_temp.es_id('run_valid');claim jsonb;res jsonb;a public.whatsapp_assets;n integer;begin
 claim:=public.publication_agent_v2_media_claim(run,'user_local');select * into a from public.whatsapp_assets where id=pg_temp.es_id('valid');
 perform pg_temp.replay_assert(claim->'media'->>'source'='library' and claim->'media'->>'origin'='whatsapp' and claim->'media'->>'md5'=a.md5
  and (claim->'media'->>'file_size')::integer=a.size and claim->'media'->>'drive_file_id'=a.drive_file_id and jsonb_array_length(claim->'targets')=3,'library descriptor');
 perform pg_temp.replay_assert(pg_temp.es_error(format('select public.publication_agent_v2_media_attach(%L,%s,%L,%L,%L)',run,claim->>'attempt',repeat('f',64),pg_temp.es_assets(claim,'x'),'user_local'))='23514','different original refused');
 res:=public.publication_agent_v2_media_attach(run,(claim->>'attempt')::integer,a.sha256,pg_temp.es_assets(claim,'valid'),'user_local');
 perform pg_temp.replay_assert(res->>'media_status'='attached','attached');
 select * into a from public.whatsapp_assets where id=pg_temp.es_id('valid');
 perform pg_temp.replay_assert(a.library_status='used' and a.claimed_agent_v2_run_id is null and a.status_changed_by='user_local','photo used, reservation released');
 select count(*) into n from public.whatsapp_asset_uses where asset_id=a.id and publication_id in (select unnest(publication_ids) from public.publication_agent_v2_runs where id=run);
 perform pg_temp.replay_assert(n=3,'one photothèque use per draft');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_media_uses where publication_id in (select unnest(publication_ids) from public.publication_agent_v2_runs where id=run)),'no catalogue use');
 perform pg_temp.replay_assert((select count(*) from public.publication_assets pa join public.publication_variant_assets va on va.asset_id=pa.id where pa.client_id=a.client_id and pa.provenance like 'Photothèque client%' and pa.rights_confirmed)=3,'assets linked to variants');
 perform pg_temp.replay_assert((public.publication_agent_v2_media_attach(run,(claim->>'attempt')::integer,a.sha256,pg_temp.es_assets(claim,'valid'),'user_local'))->>'replayed'='true','attach idempotent');
 -- Used without reuse permission: never chosen again.
 perform pg_temp.replay_assert(pg_temp.es_refused(a.id)='22023','used photo not reused by default');
end $$;

-- 6. A failed attempt releases the photo (needs_media); a retry claims it again. AI-relevant photos are eligible.
do $$declare run uuid;claim jsonb;begin
 run:=pg_temp.es_run(pg_temp.es_id('ai_relevant'),array['facebook']);
 claim:=public.publication_agent_v2_media_claim(run,'user_local');
 perform public.publication_agent_v2_media_fail(run,(claim->>'attempt')::integer,'fetch_failed','user_local');
 perform pg_temp.replay_assert((select media_status from public.publication_agent_v2_runs where id=run)='needs_media','needs_media');
 perform pg_temp.replay_assert((select claimed_agent_v2_run_id from public.whatsapp_assets where id=pg_temp.es_id('ai_relevant')) is null,'reservation released on failure');
 claim:=public.publication_agent_v2_media_claim(run,'user_local');
 perform pg_temp.replay_assert((claim->>'attempt')::integer=2 and (select claimed_agent_v2_run_id from public.whatsapp_assets where id=pg_temp.es_id('ai_relevant'))=run,'retry claims again');
end $$;

-- 7. Reuse follows the client's setting and delay.
reset role;
insert into public.publication_client_settings(client_id,media_reuse_allowed,media_reuse_after_days) values(pg_temp.es_id('client'),true,30)
 on conflict(client_id) do update set media_reuse_allowed=true,media_reuse_after_days=30;
set local role service_role;
do $$declare run uuid;begin
 perform pg_temp.replay_assert(pg_temp.es_refused(pg_temp.es_id('used_recent'))='22023','used 10 days ago: still too recent');
 run:=pg_temp.es_run(pg_temp.es_id('used_old'),array['facebook']);
 perform pg_temp.replay_assert((select selected_library_asset_id from public.publication_agent_v2_runs where id=run)=pg_temp.es_id('used_old'),'used 40 days ago: reusable');
end $$;

-- 8. The Drive catalogue path is unchanged; a closed run stays immutable; a run never carries two sources.
do $$declare run uuid;claim jsonb;begin
 run:=pg_temp.es_run(pg_temp.es_id('catalog'),array['facebook']);
 perform pg_temp.replay_assert((select selected_media_id is not null and selected_library_asset_id is null from public.publication_agent_v2_runs where id=run),'catalogue selection');
 claim:=public.publication_agent_v2_media_claim(run,'user_local');
 perform pg_temp.replay_assert(claim->'media'->>'source'='catalog' and not (claim->'media' ? 'md5'),'catalogue descriptor');
 perform pg_temp.replay_assert(pg_temp.es_error(format('update public.publication_agent_v2_runs set selected_library_asset_id=%L where id=%L',pg_temp.es_id('spare'),pg_temp.es_id('run_valid'))) is not null,'closed run immutable');
end $$;
reset role;
do $$begin
 perform pg_temp.replay_assert((select count(*) from pg_constraint where conname='publication_agent_v2_runs_single_source')=1,'single source constraint');
 perform pg_temp.replay_assert(pg_temp.es_error(format('delete from public.whatsapp_assets where id=%L',pg_temp.es_id('valid')))='23503','a selected photo cannot be deleted');
end $$;

-- 9. « Photo manquante » notification category, towards the client's photothèque only.
do $$begin
 perform pg_temp.replay_assert(pg_temp.es_error(format('insert into public.admin_notifications(event_key,category,href) values(%L,%L,%L)','es-missing-1','media_missing','/clients/'||pg_temp.es_id('client')||'?tab=media')) is null,'media_missing accepted');
 perform pg_temp.replay_assert(pg_temp.es_error($q$insert into public.admin_notifications(event_key,category,href) values('es-missing-2','media_missing','https://evil.test')$q$)='23514','external href refused');
 perform pg_temp.replay_assert(pg_temp.es_error($q$insert into public.admin_notifications(event_key,category,href) values('es-missing-3','photo_missing','/notifications')$q$)='23514','unknown category refused');
 perform pg_temp.replay_assert((select column_default from information_schema.columns where table_schema='public' and table_name='admin_notification_preferences' and column_name='categories') like '%media_missing%','visible by default');
end $$;

-- 10. Scénario A (couvreur, cinq photos) : trois photos de toiture publiables, une facture jugée confidentielle et une
-- photo hors sujet en quarantaine. La garde serveur n'offre jamais les deux dernières ; une photo publiable est retenue.
reset role;
do $$declare cl uuid:=pg_temp.es_id('client');n integer:=100;name text;begin
 foreach name in array array['roof_1','roof_2','roof_3','invoice','off_topic'] loop
  n:=n+1;insert into es_ids values(name,gen_random_uuid());
  insert into public.whatsapp_assets(id,client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size,media_kind,imported_at,library_status,status_changed_by,origin)
  values(pg_temp.es_id(name),cl,'folder_wa_'||left(cl::text,8),lpad(to_hex(n),64,'0'),lpad(to_hex(n),32,'0'),'drive_file_es_'||n,'image/jpeg',3000+n,'image',now(),
   case name when 'off_topic' then 'quarantined' when 'roof_3' then 'validated' else 'received' end,'user_local','whatsapp');
 end loop;
 insert into public.whatsapp_asset_assessments(asset_id,client_id,verdict,business_relevance,publishability,sensitive,confidential,description,topics,quality,quality_issues,profile_version,model,estimated_cost_eur,manual_verdict)
 values(pg_temp.es_id('roof_1'),cl,'relevant',0.9,0.9,'{}',false,'Toiture en tuiles après démoussage.','{toiture}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,null),
  (pg_temp.es_id('roof_2'),cl,'relevant',0.8,0.8,'{}',false,'Faîtage de toiture en tuiles.','{toiture}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,null),
  (pg_temp.es_id('invoice'),cl,'to_review',0.6,0.1,'{invoice}',true,'Devis 2 500 € – garantie 10 ans.','{}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,null),
  (pg_temp.es_id('off_topic'),cl,'off_topic',0.1,0.1,'{}',false,'Plat cuisiné.','{}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,null);
end $$;
do $$declare name text;begin
 foreach name in array array['roof_1','roof_2','roof_3'] loop
  perform pg_temp.replay_assert((select publications_private.library_asset_publishable(a) from public.whatsapp_assets a where id=pg_temp.es_id(name)),'scénario A publishable: '||name);end loop;
 foreach name in array array['invoice','off_topic'] loop
  perform pg_temp.replay_assert(not (select publications_private.library_asset_publishable(a) from public.whatsapp_assets a where id=pg_temp.es_id(name)),'scénario A never offered: '||name);end loop;
end $$;
set local role service_role;
do $$declare run uuid;begin
 perform pg_temp.replay_assert(pg_temp.es_refused(pg_temp.es_id('invoice'))='22023' and pg_temp.es_refused(pg_temp.es_id('off_topic'))='22023','scénario A: invoice and off-topic refused at finish');
 run:=pg_temp.es_run(pg_temp.es_id('roof_1'),array['facebook']);
 perform pg_temp.replay_assert((select selected_library_asset_id=pg_temp.es_id('roof_1') and media_status='pending' from public.publication_agent_v2_runs where id=run),'scénario A: a publishable roof photo is chosen');
end $$;

-- 11. Course photo / relecture : une photo n'est jamais attachée à une publication « à valider » (révision en relecture).
do $$declare run uuid;claim jsonb;pub uuid;rev uuid;a public.whatsapp_assets;begin
 run:=pg_temp.es_run(pg_temp.es_id('roof_2'),array['facebook','instagram']);
 select * into a from public.whatsapp_assets where id=pg_temp.es_id('roof_2');
 -- Réservée pendant le brouillon, puis soumise avant l'attache : l'attache est refusée en bloc, aucun lien créé.
 claim:=public.publication_agent_v2_media_claim(run,'user_local');
 select id,current_revision_id into pub,rev from public.publications where id=(select publication_ids[1] from public.publication_agent_v2_runs where id=run);
 perform public.publication_submit_manual(pub,rev,'user_local');
 perform pg_temp.replay_assert(pg_temp.es_error(format('select public.publication_agent_v2_media_attach(%L,%s,%L,%L,%L)',run,claim->>'attempt',a.sha256,pg_temp.es_assets(claim,'race'),'user_local'))='23514','attach refused once a target is under review');
 perform pg_temp.replay_assert(not exists(select 1 from public.whatsapp_asset_uses where asset_id=a.id) and not exists(select 1 from public.publication_variant_assets va join public.publication_variants v on v.id=va.variant_id where v.publication_id=pub),'nothing linked');
 perform pg_temp.replay_assert(public.publication_agent_v2_media_fail(run,(claim->>'attempt')::integer,'attach_failed','user_local')->>'media_status'='needs_media','explicit needs_media');
 -- Nouvelle tentative pendant la relecture : refusée dès la réservation.
 perform pg_temp.replay_assert(pg_temp.es_error(format('select public.publication_agent_v2_media_claim(%L,''user_local'')',run))='23514','claim refused while a target is under review');
 perform pg_temp.replay_assert((select status from public.publications where id=pub)='pending_review' and (select claimed_agent_v2_run_id is null from public.whatsapp_assets where id=a.id),'review untouched, photo released');
end $$;

-- 12. Scénario C : Facebook, Instagram et Google Business Profile — une idée, trois brouillons, UNE photo autorisée
-- (même photo de la photothèque, un dérivé par plateforme) ; la photo d'un autre client est refusée par le serveur.
do $$declare run uuid;claim jsonb;r public.publication_agent_v2_runs;a public.whatsapp_assets;foreign_asset public.whatsapp_assets;begin
 perform pg_temp.replay_assert(pg_temp.es_refused(pg_temp.es_id('foreign'))='22023','scénario C: photo of another client refused at finish');
 run:=pg_temp.es_run(pg_temp.es_id('roof_3'),array['facebook','instagram','google_business_profile']);
 select * into r from public.publication_agent_v2_runs where id=run;select * into foreign_asset from public.whatsapp_assets where id=pg_temp.es_id('foreign');
 perform pg_temp.replay_assert(not publications_private.agent_v2_library_available(r,foreign_asset),'scénario C: wrong client/photo association never available');
 perform pg_temp.replay_assert((select count(distinct p.platform)=3 and count(distinct p.editorial_group_id)=1 from public.publications p where p.id=any(r.publication_ids)),'one idea, three platforms');
 claim:=public.publication_agent_v2_media_claim(run,'user_local');select * into a from public.whatsapp_assets where id=pg_temp.es_id('roof_3');
 perform public.publication_agent_v2_media_attach(run,(claim->>'attempt')::integer,a.sha256,pg_temp.es_assets(claim,'scenario_c'),'user_local');
 perform pg_temp.replay_assert((select count(*)=3 and count(distinct publication_asset_id)=3 and count(distinct platform)=3 from public.whatsapp_asset_uses where asset_id=a.id),'same photo, one derivative per platform');
 perform pg_temp.replay_assert((select count(*) from public.publication_assets pa join public.publication_variant_assets va on va.asset_id=pa.id join public.publication_variants v on v.id=va.variant_id
  where v.publication_id=any(r.publication_ids) and pa.client_id=r.client_id)=3,'each draft linked to its own derivative of the client photo');
end $$;
