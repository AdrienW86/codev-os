-- Synthetic PostgreSQL local test only (Snapchat, cinquième réseau). Never execute remotely. Runs on the full migration
-- chain; rolled back by the runner. Fixtures inserted without their triggers (replica), invariants tested with triggers.
create temporary table sc_ids(name text primary key,id uuid not null);
create function pg_temp.sc(p_name text) returns uuid language sql as $$ select id from sc_ids where name=p_name $$;

-- 1. Plateforme et fournisseur reconnus ; Snapchat exige un média ; les autres plateformes inconnues restent refusées.
do $$begin
 perform pg_temp.replay_assert(publications_private.connection_provider('snapchat') and publications_private.connection_provider_platform('snapchat','snapchat')
  and not publications_private.connection_provider_platform('snapchat','tiktok') and not publications_private.connection_provider_platform('meta','snapchat'),'snapchat provider ↔ platform');
 perform pg_temp.replay_assert(publications_private.platform_requires_media('snapchat') and not publications_private.platform_requires_media('pinterest'),'snapchat requires a media');
 perform pg_temp.replay_assert(position('''snapchat''' in pg_get_functiondef('public.publication_job_claim_scheduled(text,integer,integer,text[])'::regprocedure))>0,'scheduled claim accepts snapchat');
 perform pg_temp.replay_assert(position('''snapchat''' in pg_get_functiondef('public.publication_connections_list(uuid)'::regprocedure))>0,'connections list counts snapchat');
 perform pg_temp.replay_assert(position('''snapchat''' in pg_get_functiondef('public.publication_delivery_reconcile_checked(uuid,uuid,text,text,text)'::regprocedure))>0,'reconcile accepts snapchat ids');
end $$;

-- 2. Fixtures fictives : une publication Snapchat (révisions 1 et 2) et une photo, deux vidéos.
insert into sc_ids values('client',gen_random_uuid()),('project',gen_random_uuid()),('sc',gen_random_uuid()),('rev1',gen_random_uuid()),('rev2',gen_random_uuid()),
 ('var1',gen_random_uuid()),('var2',gen_random_uuid()),('img1',gen_random_uuid()),('img2',gen_random_uuid()),('video',gen_random_uuid()),('video2',gen_random_uuid());
insert into public.clients(id,name,activity) values(pg_temp.sc('client'),'Peinture Fictive','Peintre');
insert into public.publication_client_settings(client_id) values(pg_temp.sc('client'));
set local session_replication_role=replica;
insert into public.projects(id,client_id,name,type) values(pg_temp.sc('project'),pg_temp.sc('client'),'Réseaux','Réseaux sociaux');
insert into public.publications(id,client_id,editorial_week,subject,status,project_id,platform,current_revision_id) values
 (pg_temp.sc('sc'),pg_temp.sc('client'),date_trunc('week',now())::date,'Façade','draft',pg_temp.sc('project'),'snapchat',pg_temp.sc('rev2'));
insert into public.publication_revisions(id,publication_id,client_id,revision_number,origin) values
 (pg_temp.sc('rev1'),pg_temp.sc('sc'),pg_temp.sc('client'),1,'manual'),(pg_temp.sc('rev2'),pg_temp.sc('sc'),pg_temp.sc('client'),2,'manual');
insert into public.publication_variants(id,revision_id,publication_id,client_id,platform,text_content) values
 (pg_temp.sc('var1'),pg_temp.sc('rev1'),pg_temp.sc('sc'),pg_temp.sc('client'),'snapchat','Façade repeinte.'),
 (pg_temp.sc('var2'),pg_temp.sc('rev2'),pg_temp.sc('sc'),pg_temp.sc('client'),'snapchat','Façade repeinte.');
reset session_replication_role;
insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,provenance,rights_confirmed)
 select pg_temp.sc(n),pg_temp.sc('client'),pg_temp.sc('client')||'/x/'||pg_temp.sc(n),lpad(to_hex(k+16),64,'0'),case when n like 'video%' then 'video/mp4' else 'image/jpeg' end,'Test',true
 from (values('img1',1),('img2',2),('video',3),('video2',4)) v(n,k);

-- 3. Un seul média par variante Snapchat : une photo (Story) ou une vidéo (Spotlight), jamais deux.
do $$begin
 insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(pg_temp.sc('var1'),pg_temp.sc('img1'),pg_temp.sc('client'),0);
 perform pg_temp.replay_failure(format('insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(%L,%L,%L,1)',pg_temp.sc('var1'),pg_temp.sc('img2'),pg_temp.sc('client')),'23514','one photo only on Snapchat');
 perform pg_temp.replay_failure(format('insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(%L,%L,%L,1)',pg_temp.sc('var1'),pg_temp.sc('video'),pg_temp.sc('client')),'23514','video refused next to a photo');
 insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(pg_temp.sc('var2'),pg_temp.sc('video'),pg_temp.sc('client'),0);
 perform pg_temp.replay_assert((select count(*)=1 from public.publication_variant_assets where variant_id=pg_temp.sc('var2')),'video alone on Snapchat accepted (Spotlight)');
 perform pg_temp.replay_failure(format('insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(%L,%L,%L,1)',pg_temp.sc('var2'),pg_temp.sc('video2'),pg_temp.sc('client')),'23514','one video only');
end $$;

-- 4. Canal Snapchat : enregistrable, et créé (désactivé) avec les autres pour un nouveau projet client.
do $$declare cl uuid:=gen_random_uuid();p uuid;begin
 insert into public.clients(id,name,activity) values(cl,'Client Snap','Couvreur');
 p:=(public.publication_client_project_ensure(cl,'user_local')->>'project_id')::uuid;
 perform pg_temp.replay_assert((select count(*)=1 and bool_and(not enabled) from public.publication_project_channels where project_id=p and platform='snapchat'),'snapchat channel created, disabled');
 perform public.publication_channel_save(p,'snapchat',true,null,'Ton spontané','user_local');
 perform pg_temp.replay_assert((select enabled from public.publication_project_channels where project_id=p and platform='snapchat'),'snapchat channel enabled');
 perform pg_temp.replay_failure(format('select public.publication_channel_save(%L,''pinterest'',true,null,null,''user_local'')',p),'22023','unknown platform still refused');
end $$;
