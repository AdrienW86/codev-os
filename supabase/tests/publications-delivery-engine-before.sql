-- Synthetic PostgreSQL local test only (Lot 4.3 P10). Never execute on a remote project.
-- State built with P1 … P9 BEFORE the P10 migration: a configured project (FB / IG / GBP occurrences), active
-- connections with synced and assigned accounts, publication switches open, approved publications with media,
-- and a legacy delivery (historical model) that P10 must keep untouched. Runtime UUIDs, dates relative to today.
create temporary table p10_ids(name text primary key,id uuid not null);
grant select,insert,update on p10_ids to service_role;
do $$declare cl uuid:=gen_random_uuid();other uuid:=gen_random_uuid();begin
 insert into public.clients(id,name,activity) values(cl,'P10 fixture','Couverture'),(other,'P10 other client',null);
 insert into p10_ids values('client',cl),('other_client',other),('social',gen_random_uuid()),('legacy_account',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values((select id from p10_ids where name='social'),cl,'P10 social','Réseaux sociaux');
 insert into public.publication_accounts(id,client_id,platform,external_account_id,status,enabled,credential_reference,metadata)
 values((select id from p10_ids where name='legacy_account'),cl,'facebook','legacy-page-10','connected',true,'ref:legacy/page-10','{}');
 update public.publication_settings set emergency_stop=false,publishing_enabled=true;
 insert into public.publication_client_settings(client_id,publishing_enabled) values(cl,true);
end $$;
set local role service_role;
do $$declare s uuid:=(select id from p10_ids where name='social');cl uuid:=(select id from p10_ids where name='client');every_day text;meta uuid;gbp uuid;begin
 insert into p10_ids values('fb',public.publication_channel_save(s,'facebook',true,null,null,'user_local')),('gbp_channel',public.publication_channel_save(s,'google_business_profile',true,null,null,'user_local'));
 insert into p10_ids select 'ig',id from public.publication_project_channels where project_id=s and platform='instagram';
 for every_day in select unnest(array['fb:12:00','ig:18:00','gbp_channel:09:00']) loop
  perform public.publication_channel_schedule_save((select id from p10_ids where name=split_part(every_day,':',1)),'Europe/Paris',true,
   (select jsonb_agg(jsonb_build_object('weekday',d,'local_time',substr(every_day,length(split_part(every_day,':',1))+2),'enabled',true)) from generate_series(1,7) d),'user_local');
 end loop;
 perform public.publication_channel_occurrences_ensure(s,current_date+1,current_date+20,'user_local');
 meta:=(public.publication_connection_register(cl,'meta','vault:connection/'||gen_random_uuid()::text,'meta-user-10',null,null,'user_local')->>'connection_id')::uuid;
 gbp:=(public.publication_connection_register(cl,'google_business_profile','vault:connection/'||gen_random_uuid()::text,null,null,null,'user_local')->>'connection_id')::uuid;
 insert into p10_ids values('meta',meta),('gbp_connection',gbp);
 perform public.publication_accounts_sync(cl,meta,jsonb_build_array(
  jsonb_build_object('platform','facebook','external_account_id','page-10','display_name','Toitures P10','parent_external_id',null,'metadata','{}'::jsonb),
  jsonb_build_object('platform','instagram','external_account_id','ig-10','display_name','@toitures.p10','parent_external_id','page-10','metadata','{}'::jsonb)),'user_local');
 perform public.publication_accounts_sync(cl,gbp,jsonb_build_array(
  jsonb_build_object('platform','google_business_profile','external_account_id','accounts/10/locations/1','display_name','Toitures P10 — Lyon','parent_external_id','accounts/10','metadata','{}'::jsonb)),'user_local');
 insert into p10_ids select 'fb_account',id from public.publication_accounts where connection_id=meta and platform='facebook';
 insert into p10_ids select 'ig_account',id from public.publication_accounts where connection_id=meta and platform='instagram';
 insert into p10_ids select 'gbp_account',id from public.publication_accounts where connection_id=gbp;
 perform public.publication_channel_assign_account(s,'facebook',(select id from p10_ids where name='fb_account'),'user_local');
 perform public.publication_channel_assign_account(s,'instagram',(select id from p10_ids where name='ig_account'),'user_local');
 perform public.publication_channel_assign_account(s,'google_business_profile',(select id from p10_ids where name='gbp_account'),'user_local');
end $$;
reset role;
-- Helpers: next open occurrence; an approved publication with one private image (approval invariant P8).
create function pg_temp.p10_occ(p_platform text) returns uuid language sql as $$
 select id from public.publication_channel_occurrences where project_id=(select id from p10_ids where name='social') and platform=p_platform and scheduled_for>now()
  and publication_id is null and skipped_at is null order by scheduled_for limit 1 $$;
create function pg_temp.p10_publication(p_platform text,p_text text,p_approve boolean default true) returns uuid language plpgsql as $$
declare r jsonb;pub uuid;rev uuid;v uuid;cl uuid;asset uuid:=gen_random_uuid();
begin
 set local role service_role;
 r:=public.publication_create_from_occurrence(pg_temp.p10_occ(p_platform),null,null,'P10 '||p_platform,p_text,null,'user_local');pub:=(r->>'publication_id')::uuid;rev:=(r->>'revision_id')::uuid;
 reset role;
 select id,client_id into v,cl from public.publication_variants where revision_id=rev;
 insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,width,height,provenance,rights_confirmed)
 values(asset,cl,cl::text||'/'||pub::text||'/'||asset::text,md5(asset::text)||md5(pub::text),'image/jpeg',1080,1080,'Client',true);
 insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(v,asset,cl,0);
 if p_approve then
  set local role service_role;
  perform public.publication_submit_manual(pub,rev,'user_local');perform public.publication_review_manual(pub,rev,'approved',null,'user_local');
  reset role;
 end if;
 return pub;
end $$;
grant execute on function pg_temp.p10_occ(text),pg_temp.p10_publication(text,text,boolean) to service_role;
-- Legacy delivery (historical model: no snapshot, no job) on an approved publication and the legacy account.
do $$declare pub uuid:=pg_temp.p10_publication('facebook','Texte historique');begin
 insert into p10_ids values('legacy_pub',pub);
 insert into public.publication_deliveries(publication_id,client_id,publication_account_id,variant_id,platform,scheduled_for,idempotency_key)
 select pub,p.client_id,(select id from p10_ids where name='legacy_account'),v.id,'facebook',now()+interval '1 day','legacy:'||pub::text
  from public.publications p join public.publication_variants v on v.revision_id=p.current_revision_id where p.id=pub;
 insert into p10_ids select 'legacy_delivery',id from public.publication_deliveries where publication_id=pub;
end $$;
create temporary table p10_before as select jsonb_build_object(
 'deliveries',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]') from public.publication_deliveries d),
 'jobs',(select count(*) from public.publication_jobs),'attempts',(select count(*) from public.publication_attempts),
 'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),'events',(select count(*) from public.publication_events)) v;
