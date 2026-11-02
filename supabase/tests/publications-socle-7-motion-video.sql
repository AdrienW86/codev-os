-- Synthetic PostgreSQL local test only (vidéos TikTok + Studio vidéo). Never execute remotely. Runs on the full migration
-- chain; rolled back by the runner. Fixtures inserted without their triggers (replica), invariants tested with triggers.
create temporary table mv_ids(name text primary key,id uuid not null);
grant select on mv_ids to service_role;
create function pg_temp.mv(p_name text) returns uuid language sql as $$ select id from mv_ids where name=p_name $$;
grant execute on function pg_temp.mv(text) to service_role;

-- 1. Stockages privés (aucune politique) ; table Studio réservée au serveur, RLS active ; garde non exécutable par le navigateur.
do $$declare r text;begin
 foreach r in array array['publication-videos','studio-videos'] loop
  perform pg_temp.replay_assert((select not public and file_size_limit=67108864 and allowed_mime_types=array['video/mp4'] from storage.buckets where id=r),'private video bucket '||r);
 end loop;
 perform pg_temp.replay_assert((select relrowsecurity from pg_class where oid='public.studio_videos'::regclass),'studio RLS');
 foreach r in array array['anon','authenticated'] loop
  perform pg_temp.replay_assert(not has_table_privilege(r,'public.studio_videos','SELECT,INSERT,UPDATE,DELETE'),'browser denied studio_videos '||r);
  perform pg_temp.replay_assert(not has_function_privilege(r,'publications_private.guard_variant_video()','EXECUTE'),'browser denied guard '||r);
 end loop;
 perform pg_temp.replay_assert(has_table_privilege('service_role','public.studio_videos','SELECT,INSERT,UPDATE,DELETE'),'server studio_videos');
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

-- 4. Studio vidéo : chemin rangé sous le client, bornes, et lien de publication libéré si la publication disparaît.
set local role service_role;
do $$declare c uuid:=pg_temp.mv('client');v uuid:=gen_random_uuid();
 sql text:='insert into public.studio_videos(client_id,title,script,storage_path,duration_seconds,size_bytes,width,height,created_by) values(%L,%L,%L,%L,%s,%s,720,1280,%L)';begin
 execute format(sql,c,'Toiture',jsonb_build_object('headline','Toiture refaite'),c||'/'||v||'.mp4',14.5,1000,'user_local');
 perform pg_temp.replay_assert((select count(*)=1 from public.studio_videos where client_id=c and last_publication_id is null),'studio video saved');
 perform pg_temp.replay_failure(format(sql,c,'Autre client','{}',gen_random_uuid()||'/'||gen_random_uuid()||'.mp4',10,1000,'user_local'),'23514','path outside client folder refused');
 perform pg_temp.replay_failure(format(sql,c,'Chemin','{}',c||'/../x.mp4',10,1000,'user_local'),'23514','path shape checked');
 perform pg_temp.replay_failure(format(sql,c,' ','{}',c||'/'||gen_random_uuid()||'.mp4',10,1000,'user_local'),'23514','title required');
 perform pg_temp.replay_failure(format(sql,c,'Trop long','{}',c||'/'||gen_random_uuid()||'.mp4',121,1000,'user_local'),'23514','duration bounded');
 perform pg_temp.replay_failure(format(sql,c,'Trop lourd','{}',c||'/'||gen_random_uuid()||'.mp4',10,67108865,'user_local'),'23514','size bounded');
 perform pg_temp.replay_failure(format(sql,c,'Script','[]',c||'/'||gen_random_uuid()||'.mp4',10,1000,'user_local'),'23514','script is an object');
 perform pg_temp.replay_failure(format(sql,c,'Auteur','{}',c||'/'||gen_random_uuid()||'.mp4',10,1000,'not-a-user'),'23514','actor checked');
 perform pg_temp.replay_failure(format(sql,c,'Doublon','{}',c||'/'||v||'.mp4',10,1000,'user_local'),'23505','storage path unique');
 update public.studio_videos set last_publication_id=pg_temp.mv('tt') where client_id=c;
 perform pg_temp.replay_assert((select last_publication_id=pg_temp.mv('tt') from public.studio_videos where client_id=c),'linked to its TikTok draft');
end $$;
reset role;
