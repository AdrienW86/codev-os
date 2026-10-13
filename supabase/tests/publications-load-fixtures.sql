-- Synthetic PostgreSQL local test only (phase 8, #47). Never execute remotely.
-- Fixtures de charge partagées par les suites publications-load-<n>-*.sql et par les essais à deux sessions de
-- tests/publications-load-db.test.mjs : clients fictifs complets, publications approuvées par un humain, envoi simulé.
reset role;
create temporary table load_ids(name text,n integer,id uuid not null,primary key(name,n));
grant select,insert,update on load_ids to service_role;
update public.publication_settings set emergency_stop=false,publishing_enabled=true;

-- Un client fictif complet : projet social, canaux Facebook / Instagram / GBP (créneaux quotidiens 12:00 / 18:00 / 09:00),
-- connexions Meta et GBP, comptes synchronisés et assignés, occurrences des 5 prochains jours.
create function pg_temp.load_client(p_n integer) returns uuid language plpgsql as $$
declare cl uuid:=gen_random_uuid();s uuid:=gen_random_uuid();meta uuid;gbp uuid;ch text;
begin
 reset role;
 insert into public.clients(id,name,activity) values(cl,'Client charge '||p_n,'Couverture');
 insert into public.projects(id,client_id,name,type) values(s,cl,'Réseaux sociaux '||p_n,'Réseaux sociaux');
 insert into public.publication_client_settings(client_id,publishing_enabled) values(cl,true);
 insert into load_ids values('client',p_n,cl),('project',p_n,s);
 set local role service_role;
 perform public.publication_channel_save(s,'facebook',true,null,null,'user_local');perform public.publication_channel_save(s,'google_business_profile',true,null,null,'user_local');
 for ch in select unnest(array['facebook:12:00','instagram:18:00','google_business_profile:09:00']) loop
  perform public.publication_channel_schedule_save((select id from public.publication_project_channels where project_id=s and platform=split_part(ch,':',1)),'Europe/Paris',true,
   (select jsonb_agg(jsonb_build_object('weekday',d,'local_time',substr(ch,length(split_part(ch,':',1))+2),'enabled',true)) from generate_series(1,7) d),'user_local');
 end loop;
 perform public.publication_channel_occurrences_ensure(s,current_date+1,current_date+5,'user_local');
 meta:=(public.publication_connection_register(cl,'meta','vault:connection/'||gen_random_uuid()::text,'meta-user-l'||p_n,null,null,'user_local')->>'connection_id')::uuid;
 gbp:=(public.publication_connection_register(cl,'google_business_profile','vault:connection/'||gen_random_uuid()::text,null,null,null,'user_local')->>'connection_id')::uuid;
 perform public.publication_accounts_sync(cl,meta,jsonb_build_array(
  jsonb_build_object('platform','facebook','external_account_id','page-l'||p_n,'display_name','Page '||p_n,'parent_external_id',null,'metadata','{}'::jsonb),
  jsonb_build_object('platform','instagram','external_account_id','ig-l'||p_n,'display_name','@client'||p_n,'parent_external_id','page-l'||p_n,'metadata','{}'::jsonb)),'user_local');
 perform public.publication_accounts_sync(cl,gbp,jsonb_build_array(
  jsonb_build_object('platform','google_business_profile','external_account_id','accounts/l'||p_n||'/locations/1','display_name','Fiche '||p_n,'parent_external_id','accounts/l'||p_n,'metadata','{}'::jsonb)),'user_local');
 perform public.publication_channel_assign_account(s,'facebook',(select id from public.publication_accounts where connection_id=meta and platform='facebook'),'user_local');
 perform public.publication_channel_assign_account(s,'instagram',(select id from public.publication_accounts where connection_id=meta and platform='instagram'),'user_local');
 perform public.publication_channel_assign_account(s,'google_business_profile',(select id from public.publication_accounts where connection_id=gbp),'user_local');
 reset role;
 return cl;
end $$;
-- Une publication approuvée par un humain (avec une image privée) sur la prochaine occurrence libre d'une plateforme.
create function pg_temp.load_publication(p_n integer,p_platform text,p_text text) returns uuid language plpgsql as $$
declare r jsonb;pub uuid;rev uuid;v uuid;cl uuid;asset uuid:=gen_random_uuid();occ uuid;
begin
 reset role;
 select id into occ from public.publication_channel_occurrences where project_id=(select id from load_ids where name='project' and n=p_n) and platform=p_platform
  and scheduled_for>now() and publication_id is null and skipped_at is null order by scheduled_for limit 1;
 set local role service_role;
 r:=public.publication_create_from_occurrence(occ,null,null,'Charge '||p_platform,p_text,null,'user_local');pub:=(r->>'publication_id')::uuid;rev:=(r->>'revision_id')::uuid;
 reset role;
 select id,client_id into v,cl from public.publication_variants where revision_id=rev;
 insert into public.publication_assets(id,client_id,storage_path,file_hash,mime_type,width,height,provenance,rights_confirmed)
 values(asset,cl,cl::text||'/'||pub::text||'/'||asset::text,md5(asset::text)||md5(pub::text),'image/jpeg',1080,1080,'Client',true);
 insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(v,asset,cl,0);
 set local role service_role;
 perform public.publication_submit_manual(pub,rev,'user_local');perform public.publication_review_manual(pub,rev,'approved',null,'user_local');
 reset role;
 return pub;
end $$;
-- Un envoi complet du planificateur (réservation à l'heure, contexte, marqueur, résultat simulé). Null si rien n'est dû.
create function pg_temp.load_send(p_worker text,p_platforms text[],p_outcome jsonb) returns jsonb language plpgsql as $$
declare c jsonb;job uuid;n integer;
begin
 set local role service_role;
 c:=public.publication_job_claim_scheduled(p_worker,60,7200,p_platforms);
 if c is null then reset role;return null; end if;
 job:=(c->>'job_id')::uuid;n:=(c->>'attempt')::integer;
 perform public.publication_job_context(job,p_worker,n);perform public.publication_job_dispatch(job,p_worker,n);
 c:=public.publication_job_complete(job,p_worker,n,p_outcome)||jsonb_build_object('job_id',job,'platform',c->>'platform');
 reset role;return c;
end $$;
create function pg_temp.load_ok(p_result text,p_extra jsonb default '{}') returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('result',p_result,'remote_id',case when p_result in('simulated','published') then 'simulated-'||md5(random()::text) end,'duration_ms',7))||p_extra $$;
grant execute on function pg_temp.load_client(integer),pg_temp.load_publication(integer,text,text),pg_temp.load_send(text,text[],jsonb),pg_temp.load_ok(text,jsonb) to service_role;

