-- Synthetic PostgreSQL local test only (vidéos motion design TikTok). Never execute remotely. Runs on the full migration
-- chain; rolled back by the runner. Fixtures inserted without their triggers (replica), invariants tested with triggers.
create temporary table mv_ids(name text primary key,id uuid not null);
grant select on mv_ids to service_role;
create function pg_temp.mv(p_name text) returns uuid language sql as $$ select id from mv_ids where name=p_name $$;
grant execute on function pg_temp.mv(text) to service_role;

-- 1. Objets serveur uniquement, invoker, search_path fixe ; stockage privé.
do $$declare r text;f text;begin
 foreach f in array array['public.publication_motion_video_save(uuid,boolean,text)','public.publication_motion_video_candidates(timestamptz,integer)',
  'public.publication_motion_video_failed(uuid,uuid,text,text)'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser denied '||f||' '||r);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker '||f);
 end loop;
 perform pg_temp.replay_assert((select not public and file_size_limit=67108864 and allowed_mime_types=array['video/mp4'] from storage.buckets where id='publication-videos'),'private video bucket');
end $$;

-- 2. Fixtures fictives : un client, une publication TikTok préparée par l'agent (2 photos) et une publication Facebook.
insert into mv_ids values('client',gen_random_uuid()),('project',gen_random_uuid()),('tt',gen_random_uuid()),('fb',gen_random_uuid()),
 ('tt_rev',gen_random_uuid()),('fb_rev',gen_random_uuid()),('tt_var',gen_random_uuid()),('fb_var',gen_random_uuid()),('occ',gen_random_uuid()),
 ('tt_rev2',gen_random_uuid()),('tt_var2',gen_random_uuid()),('img1',gen_random_uuid()),('img2',gen_random_uuid()),('video',gen_random_uuid()),('video2',gen_random_uuid());
insert into public.clients(id,name,activity) values(pg_temp.mv('client'),'Toiture Fictive','Couvreur');
insert into public.publication_client_settings(client_id) values(pg_temp.mv('client'));
set local session_replication_role=replica;
insert into public.projects(id,client_id,name,type) values(pg_temp.mv('project'),pg_temp.mv('client'),'Réseaux','Réseaux sociaux');
insert into public.publication_channel_occurrences(id,client_id,project_id,project_channel_id,schedule_id,schedule_slot_id,platform,local_date,local_time,timezone,scheduled_for,publication_id)
 values(pg_temp.mv('occ'),pg_temp.mv('client'),pg_temp.mv('project'),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'tiktok',(now()+interval '3 days')::date,'09:00','Europe/Paris',now()+interval '3 days',pg_temp.mv('tt'));
insert into public.publications(id,client_id,editorial_week,subject,status,project_id,platform,current_revision_id,occurrence_id) values
 (pg_temp.mv('tt'),pg_temp.mv('client'),date_trunc('week',now())::date,'Toiture','pending_review',pg_temp.mv('project'),'tiktok',pg_temp.mv('tt_rev'),pg_temp.mv('occ')),
 (pg_temp.mv('fb'),pg_temp.mv('client'),date_trunc('week',now())::date,'Toiture','pending_review',pg_temp.mv('project'),'facebook',pg_temp.mv('fb_rev'),null);
insert into public.publication_revisions(id,publication_id,client_id,revision_number,origin) values
 (pg_temp.mv('tt_rev'),pg_temp.mv('tt'),pg_temp.mv('client'),1,'generated'),(pg_temp.mv('tt_rev2'),pg_temp.mv('tt'),pg_temp.mv('client'),2,'manual'),(pg_temp.mv('fb_rev'),pg_temp.mv('fb'),pg_temp.mv('client'),1,'generated');
insert into public.publication_variants(id,revision_id,publication_id,client_id,platform,text_content) values
 (pg_temp.mv('tt_var'),pg_temp.mv('tt_rev'),pg_temp.mv('tt'),pg_temp.mv('client'),'tiktok','Toiture refaite.'),
 (pg_temp.mv('tt_var2'),pg_temp.mv('tt_rev2'),pg_temp.mv('tt'),pg_temp.mv('client'),'tiktok','Toiture refaite.'),
 (pg_temp.mv('fb_var'),pg_temp.mv('fb_rev'),pg_temp.mv('fb'),pg_temp.mv('client'),'facebook','Toiture refaite.');
reset session_replication_role;
insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,provenance,rights_confirmed)
 select pg_temp.mv(n),pg_temp.mv('client'),pg_temp.mv('client')||'/x/'||pg_temp.mv(n),lpad(to_hex(k),64,'0'),case when n like 'video%' then 'video/mp4' else 'image/jpeg' end,'Test',true
 from (values('img1',1),('img2',2),('video',3),('video2',4)) v(n,k);
insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values
 (pg_temp.mv('tt_var'),pg_temp.mv('img1'),pg_temp.mv('client'),0),(pg_temp.mv('tt_var'),pg_temp.mv('img2'),pg_temp.mv('client'),1);

-- 3. Invariant : vidéo seulement sur TikTok, et seule ; jamais mélangée à des photos.
do $$begin
 perform pg_temp.replay_failure(format('insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(%L,%L,%L,0)',pg_temp.mv('fb_var'),pg_temp.mv('video'),pg_temp.mv('client')),'23514','video refused on Facebook');
 perform pg_temp.replay_failure(format('insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(%L,%L,%L,2)',pg_temp.mv('tt_var'),pg_temp.mv('video'),pg_temp.mv('client')),'23514','video refused next to photos');
 insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(pg_temp.mv('tt_var2'),pg_temp.mv('video'),pg_temp.mv('client'),0);
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_variant_assets where variant_id=pg_temp.mv('tt_var2')),'video alone on TikTok accepted');
 perform pg_temp.replay_failure(format('insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(%L,%L,%L,1)',pg_temp.mv('tt_var2'),pg_temp.mv('img1'),pg_temp.mv('client')),'23514','photo refused after a video');
 perform pg_temp.replay_failure(format('insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(%L,%L,%L,1)',pg_temp.mv('tt_var2'),pg_temp.mv('video2'),pg_temp.mv('client')),'23514','one video only');
 perform pg_temp.replay_failure(format('insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,provenance) values(gen_random_uuid(),%L,''p'',%L,''video/quicktime'',''x'')',pg_temp.mv('client'),lpad('f',64,'0')),'23514','only MP4');
end $$;

-- 4. Réglage client (journalisé) et sélection automatique.
set local role service_role;
do $$declare n integer;begin
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_motion_video_candidates(now(),5)),'setting off: no candidate');
 perform public.publication_motion_video_save(pg_temp.mv('client'),true,'user_local');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_events where action='publication.motion_video_setting_saved' and resource_id=pg_temp.mv('client')),'setting audited');
 perform public.publication_motion_video_save(pg_temp.mv('client'),true,'user_local');
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_events where action='publication.motion_video_setting_saved' and resource_id=pg_temp.mv('client')),'unchanged setting not re-audited');
 select count(*) into n from public.publication_motion_video_candidates(now(),5) c where c.publication_id=pg_temp.mv('tt');
 perform pg_temp.replay_assert(n=1,'TikTok agent publication with photos is a candidate');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_motion_video_candidates(now(),5) c where c.publication_id=pg_temp.mv('fb')),'never Facebook');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_motion_video_candidates(now()+interval '4 days',5)),'past slot: not a candidate');
 perform public.publication_motion_video_failed(pg_temp.mv('tt'),pg_temp.mv('tt_rev'),'render_engine',null);
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_motion_video_candidates(now(),5)),'failed revision not retried automatically');
 perform pg_temp.replay_failure(format('select public.publication_motion_video_failed(%L,%L,%L,null)',pg_temp.mv('tt'),pg_temp.mv('tt_rev'),'Bad Code!'),'22023','failure code closed');
 perform pg_temp.replay_failure(format('select public.publication_motion_video_save(%L,true,%L)',pg_temp.mv('client'),'not-a-user'),'22023','actor checked');
end $$;
