-- Synthetic PostgreSQL local test only (Lot 4.3 P9). Never execute on a remote project.
-- State built with P1 … P8 BEFORE the P9 migration: clients, a configured project, a legacy publication account
-- (historical credential model) and a Google Ads connection that must keep working unchanged.
create temporary table p9_ids(name text primary key,id uuid not null);
grant select,insert,update on p9_ids to service_role;
do $$declare cl uuid:=gen_random_uuid();other uuid:=gen_random_uuid();begin
 insert into public.clients(id,name,activity) values(cl,'P9 fixture','Couverture'),(other,'P9 other client',null);
 insert into p9_ids values('client',cl),('other_client',other),('social',gen_random_uuid()),('other_project',gen_random_uuid()),
  ('legacy_account',gen_random_uuid()),('ads_connection',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values((select id from p9_ids where name='social'),cl,'P9 social','Réseaux sociaux'),
  ((select id from p9_ids where name='other_project'),other,'P9 other','Réseaux sociaux');
 insert into public.publication_accounts(id,client_id,platform,external_account_id,status,enabled,credential_reference,metadata)
 values((select id from p9_ids where name='legacy_account'),cl,'facebook','legacy-page-1','connected',true,'ref:legacy/page-1','{"label":"Page historique"}');
 insert into public.client_connections(id,client_id,provider,status,external_account_id,metadata)
 values((select id from p9_ids where name='ads_connection'),cl,'google_ads','connected','1234567890','{"auth_strategy":"single_user","connection_version":1}');
end $$;
set local role service_role;
do $$declare s uuid:=(select id from p9_ids where name='social');o uuid:=(select id from p9_ids where name='other_project');begin
 perform public.publication_channel_save(s,'facebook',true,null,null,'user_local');
 perform public.publication_channel_save(s,'google_business_profile',true,null,null,'user_local');
 perform public.publication_channel_save(o,'facebook',true,null,null,'user_local');
 -- Legacy link (historical model): kept as is by P9.
 perform public.publication_channel_save(s,'facebook',true,(select id from p9_ids where name='legacy_account'),null,'user_local');
end $$;
reset role;
create temporary table p9_before as select jsonb_build_object(
 'connections',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.client_connections c),
 'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.publication_accounts a),
 'channels',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_project_channels c),
 'publications',(select count(*) from public.publications),'deliveries',(select count(*) from public.publication_deliveries),
 'jobs',(select count(*) from public.publication_jobs),'events',(select count(*) from public.publication_events)) v;
