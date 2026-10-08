-- Synthetic PostgreSQL local test only (Lot 4.3 P7). Never execute on a remote project.
-- Runs after P1 … P5 and P7 on a rebuilt local database. Fixtures use runtime UUIDs and dates relative to today.
create temporary table p7_ids(name text primary key,id uuid not null);
grant select,insert,update on p7_ids to service_role;

-- 1. Grants and function properties.
select pg_temp.replay_assert((select relrowsecurity from pg_class where oid='public.publication_agent_v2_runs'::regclass),'runs RLS enabled');
select pg_temp.replay_assert(not exists(select 1 from pg_policies where schemaname='public' and tablename='publication_agent_v2_runs'),'runs without policy');
do $$declare r text;f text;begin
 foreach r in array array['anon','authenticated'] loop
  perform pg_temp.replay_assert(not has_table_privilege(r,'public.publication_agent_v2_runs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'browser privileges absent');
 end loop;
 perform pg_temp.replay_assert(has_table_privilege('service_role','public.publication_agent_v2_runs','SELECT,INSERT,UPDATE') and not has_table_privilege('service_role','public.publication_agent_v2_runs','DELETE')
  and not has_table_privilege('service_role','public.publication_agent_v2_runs','TRUNCATE'),'server select/insert/update only');
 foreach f in array array['public.publication_agent_v2_begin(uuid,uuid[],integer,text)','public.publication_agent_v2_finish(uuid,jsonb,uuid,jsonb,text)','public.publication_agent_v2_fail(uuid,text,jsonb,text)',
  'publications_private.create_publication_from_occurrence(uuid,uuid,text,text,text,text,jsonb,text,text)','publications_private.agent_month_spend(uuid)','publications_private.guard_agent_v2_run()',
  'publications_private.guard_archived_variant_asset()','public.publication_create_from_occurrence(uuid,uuid,text,text,text,jsonb,text)','public.publication_register_image(uuid,uuid,uuid,text,text,text,text,text)'] loop
  foreach r in array array['public','anon','authenticated'] loop perform pg_temp.replay_assert(not has_function_privilege(r,f,'EXECUTE'),'browser function denied '||f);end loop;
  perform pg_temp.replay_assert(has_function_privilege('service_role',f,'EXECUTE'),'server function '||f);
  perform pg_temp.replay_assert((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid=f::regprocedure),'invoker + fixed search_path '||f);
 end loop;
end $$;
set local role anon;
select pg_temp.replay_failure('select * from public.publication_agent_v2_runs','42501','actual anon read denied');
set local role authenticated;
select pg_temp.replay_failure('select public.publication_agent_v2_begin(null,null,1,''user_local'')','42501','actual authenticated RPC denied');
reset role;

-- 2. Additive: no run created, publications and audit unchanged.
select pg_temp.replay_assert(not exists(select 1 from public.publication_agent_v2_runs),'no run created by the migration');
select pg_temp.replay_assert((select v from p7_before)=jsonb_build_object('publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),
 'events',(select count(*) from public.publication_events)),'publications and audit unchanged by the migration');

-- Fixtures: configured project (FB / IG / GBP every day), agent configured, two analysed photos; other projects.
do $$declare cl uuid:=gen_random_uuid();other uuid:=gen_random_uuid();begin
 insert into public.clients(id,name,activity) values(cl,'P7 fixture','Couverture'),(other,'P7 other client',null);
 insert into p7_ids values('client',cl),('other_client',other),('social',gen_random_uuid()),('second',gen_random_uuid()),('other_project',gen_random_uuid()),('noagent',gen_random_uuid()),
  ('media',gen_random_uuid()),('media_unusable',gen_random_uuid()),('media_other',gen_random_uuid());
 insert into public.projects(id,client_id,name,type) values((select id from p7_ids where name='social'),cl,'P7 social','Réseaux sociaux'),((select id from p7_ids where name='second'),cl,'P7 second','Google Business Profile'),
  ((select id from p7_ids where name='other_project'),other,'P7 other','Réseaux sociaux'),((select id from p7_ids where name='noagent'),cl,'P7 no agent','Réseaux sociaux');
 insert into public.publication_drive_media(id,client_id,drive_file_id,drive_folder_id,name,mime_type,modified_at,file_size,analysis) values
  ((select id from p7_ids where name='media'),cl,'file0000000001','folder00000001','a.jpg','image/jpeg',now(),1000,'{"scene":"roof","usable":true}'),
  ((select id from p7_ids where name='media_unusable'),cl,'file0000000002','folder00000001','b.jpg','image/jpeg',now(),1000,'{"scene":"roof","usable":false}'),
  ((select id from p7_ids where name='media_other'),other,'file0000000003','folder00000002','c.jpg','image/jpeg',now(),1000,'{"scene":"roof","usable":true}');
end $$;
set local role service_role;
do $$
declare s uuid:=(select id from p7_ids where name='social');sec uuid:=(select id from p7_ids where name='second');o uuid:=(select id from p7_ids where name='other_project');na uuid:=(select id from p7_ids where name='noagent');
 every_day text;start date:=current_date+1;
begin
 insert into p7_ids values('fb',public.publication_channel_save(s,'facebook',true,null,null,'user_local')),('gbp',public.publication_channel_save(s,'google_business_profile',true,null,null,'user_local')),
  ('sec_gbp',public.publication_channel_save(sec,'google_business_profile',true,null,null,'user_local')),('other_fb',public.publication_channel_save(o,'facebook',true,null,null,'user_local')),
  ('na_fb',public.publication_channel_save(na,'facebook',true,null,null,'user_local'));
 insert into p7_ids select 'ig',id from public.publication_project_channels where project_id=s and platform='instagram';
 for every_day in select unnest(array['fb:12:00','ig:18:00','gbp:09:00','sec_gbp:09:00','other_fb:12:00','na_fb:12:00']) loop
  perform public.publication_channel_schedule_save((select id from p7_ids where name=split_part(every_day,':',1)),'Europe/Paris',true,
   (select jsonb_agg(jsonb_build_object('weekday',d,'local_time',substr(every_day,length(split_part(every_day,':',1))+2),'enabled',true)) from generate_series(1,7) d),'user_local');
 end loop;
 perform public.publication_channel_occurrences_ensure(s,start,start+13,'user_local');
 perform public.publication_channel_occurrences_ensure(s,current_date-10,current_date-8,'user_local');
 perform public.publication_channel_occurrences_ensure(sec,start,start+6,'user_local');
 perform public.publication_channel_occurrences_ensure(o,start,start+6,'user_local');
 perform public.publication_channel_occurrences_ensure(na,start,start+6,'user_local');
 perform public.publication_agent_configure(s,'folder00000001','["Couverture"]','Ton sobre',true,true,'user_local');
 perform public.publication_agent_configure(sec,'folder00000001','["Couverture"]','',true,true,'user_local');
 perform public.publication_agent_configure(o,'folder00000002','["Couverture"]','',true,true,'user_local');
end $$;
reset role;
-- Helpers: the n-th future OPEN occurrence (unlinked, not skipped) of a platform in a project.
create function pg_temp.p7_occ(p_project text,p_platform text,p_rank integer) returns uuid language sql as $$
 select id from public.publication_channel_occurrences where project_id=(select id from p7_ids where name=p_project) and platform=p_platform and scheduled_for>now()
  and publication_id is null and skipped_at is null
  order by scheduled_for offset p_rank-1 limit 1 $$;
grant execute on function pg_temp.p7_occ(text,text,integer) to service_role;

-- 3. Archive hardening: no image, media link, review, delivery or AI run on an archived publication.
set local role service_role;
do $$declare r jsonb;begin
 r:=public.publication_create_from_occurrence(pg_temp.p7_occ('second','google_business_profile',1),null,null,'Manuel','Texte manuel',null,'user_local');
 insert into p7_ids values('manual_pub',(r->>'publication_id')::uuid),('manual_rev',(r->>'revision_id')::uuid);
 perform pg_temp.replay_assert((select creation_origin='manual' from public.publications where id=(r->>'publication_id')::uuid)
  and (select origin='manual' from public.publication_revisions where id=(r->>'revision_id')::uuid),'manual RPC unchanged: manual origin');
 perform public.publication_archive((r->>'publication_id')::uuid,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_register_image(%L,%L,%L,%L,%L,''image/jpeg'',''Client'',''user_local'')',(r->>'publication_id')::uuid,(r->>'revision_id')::uuid,
  gen_random_uuid(),(select client_id from public.publications where id=(r->>'publication_id')::uuid)::text||'/'||(r->>'publication_id')||'/x',repeat('a',64)),'55000','no image on an archived publication');
end $$;
reset role;
do $$declare pub uuid:=(select id from p7_ids where name='manual_pub');rev uuid:=(select id from p7_ids where name='manual_rev');v uuid;cl uuid;begin
 select id,client_id into v,cl from public.publication_variants where publication_id=pub;
 perform pg_temp.replay_failure(format('insert into public.publication_variant_assets(variant_id,asset_id,client_id,sort_order) values(%L,%L,%L,1)',v,gen_random_uuid(),cl),'55000','no media link on an archived publication');
 perform pg_temp.replay_failure(format('insert into public.publication_media_uses(media_id,asset_id,publication_id,revision_id,client_id,platform) values(%L,%L,%L,%L,%L,''google_business_profile'')',
  (select id from p7_ids where name='media'),gen_random_uuid(),pub,rev,cl),'55000','no media use on an archived publication');
 perform pg_temp.replay_failure(format('insert into public.publication_reviews(publication_id,revision_id,client_id,variant_id,decision,actor_id) values(%L,%L,%L,%L,''approved'',''user_local'')',pub,rev,cl,v),'55000','no review on an archived publication');
 perform pg_temp.replay_failure(format('insert into public.publication_deliveries(publication_id,client_id,publication_account_id,variant_id,platform,scheduled_for,idempotency_key) values(%L,%L,%L,%L,''google_business_profile'',now(),''k'')',pub,cl,gen_random_uuid(),v),'55000','no delivery on an archived publication');
 perform pg_temp.replay_failure(format('insert into public.publication_ai_runs(agent_run_id,agent_id,client_id,project_id,publication_id,idempotency_key,attempt) values(%L,%L,%L,%L,%L,%L,1)',
  gen_random_uuid(),gen_random_uuid(),cl,(select id from p7_ids where name='second'),pub,pub::text||':initial'),'55000','no AI run on an archived publication');
end $$;

-- 4. begin: validation, scope, availability, configuration.
set local role service_role;
do $$
declare s uuid:=(select id from p7_ids where name='social');fb1 uuid:=pg_temp.p7_occ('social','facebook',1);fb2 uuid:=pg_temp.p7_occ('social','facebook',2);
begin
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_begin(%L,%L,1,''user_local'')',s,'{}'),'22023','empty batch');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_begin(%L,%L,4,''user_local'')',s,array[fb1,fb2,pg_temp.p7_occ('social','instagram',1),pg_temp.p7_occ('social','google_business_profile',1)]),'22023','more than 3 occurrences');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_begin(%L,%L,2,''user_local'')',s,array[fb1,fb1]),'22023','duplicate occurrence');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_begin(%L,%L,0,''user_local'')',s,array[fb1]),'22023','considered lower than selected');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_begin(%L,%L,1,''admin'')',s,array[fb1]),'22023','invalid actor');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_begin(%L,%L,2,''user_local'')',s,array[fb1,fb2]),'23514','two occurrences of the same platform');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_begin(%L,%L,1,''user_local'')',s,array[pg_temp.p7_occ('other_project','facebook',1)]),'23514','occurrence of another project');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_begin(%L,%L,1,''user_local'')',s,array[(select id from public.publication_channel_occurrences where project_id=s and scheduled_for<now() limit 1)]),'23514','past occurrence');
 perform public.publication_occurrence_skip(pg_temp.p7_occ('social','instagram',2),'Fermé','user_local');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_begin(%L,%L,1,''user_local'')',s,array[(select id from public.publication_channel_occurrences where project_id=s and skipped_at is not null limit 1)]),'23514','skipped occurrence');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_begin(%L,%L,1,''user_local'')',(select id from p7_ids where name='noagent'),array[pg_temp.p7_occ('noagent','facebook',1)]),'55000','agent not configured for the project');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_agent_v2_runs),'refusals created no run');
end $$;

-- 5. Full batch FB + IG + GBP: begin, idempotent second begin, strict finish validation, atomic creation.
do $$
declare s uuid:=(select id from p7_ids where name='social');cl uuid:=(select id from p7_ids where name='client');fb uuid:=pg_temp.p7_occ('social','facebook',1);ig uuid:=pg_temp.p7_occ('social','instagram',1);
 gb uuid:=pg_temp.p7_occ('social','google_business_profile',1);r jsonb;run uuid;out jsonb;usage jsonb:='{"input_tokens":1200,"output_tokens":400,"estimated_cost_eur":0.0012}';g uuid;ids uuid[];e public.publication_events;
begin
 perform pg_temp.replay_assert(fb is not null and ig is not null and gb is not null,'batch occurrences exist');
 perform pg_temp.replay_assert((select count(*) from public.publication_channel_occurrences where id in(fb,ig,gb) and project_id=s and publication_id is null and skipped_at is null and scheduled_for>now())=3,'batch occurrences open and future');
 perform pg_temp.replay_assert((select count(distinct platform) from public.publication_channel_occurrences where id in(fb,ig,gb))=3,'batch occurrences on three platforms');
 r:=public.publication_agent_v2_begin(s,array[fb,ig,gb],12,'user_local');run:=(r->>'run_id')::uuid;insert into p7_ids values('run_full',run);
 perform pg_temp.replay_assert(r->>'reused'='false' and (select status='processing' and considered_count=12 and cardinality(occurrence_ids)=3 from public.publication_agent_v2_runs where id=run),'run started');
 perform pg_temp.replay_assert((select status='running' and project_id=s and metadata->>'agent_v2'='true' from public.agent_runs where id=(select agent_run_id from public.publication_agent_v2_runs where id=run)),'agent_run started');
 perform pg_temp.replay_assert(public.publication_agent_v2_begin(s,array[fb,ig,gb],12,'user_local')=jsonb_build_object('run_id',run,'reused',true),'double click: same run reused');
 out:=jsonb_build_object('idea',jsonb_build_object('subject','Entretien de toiture','angle','Prévenir les fuites'),'publications',jsonb_build_array(
  jsonb_build_object('occurrence_id',fb,'text','Texte Facebook','cta','Contactez-nous'),jsonb_build_object('occurrence_id',ig,'text','Texte Instagram','cta',null),jsonb_build_object('occurrence_id',gb,'text','Texte GBP','cta',null)));
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,null,%L,''user_local'')',run,out||'{"extra":1}',usage),'22023','unexpected output key');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,null,%L,''user_local'')',run,jsonb_set(out,'{publications}',(out->'publications')-2),usage),'22023','missing publication');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,null,%L,''user_local'')',run,jsonb_set(out,'{publications,2,occurrence_id}',to_jsonb(fb)),usage),'22023','duplicate occurrence');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,null,%L,''user_local'')',run,jsonb_set(out,'{publications,2,occurrence_id}',to_jsonb(pg_temp.p7_occ('social','google_business_profile',3))),usage),'22023','occurrence outside the run');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,null,%L,''user_local'')',run,out,'{"input_tokens":1,"output_tokens":1,"estimated_cost_eur":0.5}'),'22023','cost above the reservation');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,%L,%L,''user_local'')',run,out,(select id from p7_ids where name='media_other'),usage),'22023','media of another client');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,%L,%L,''user_local'')',run,out,(select id from p7_ids where name='media_unusable'),usage),'22023','unusable media');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,null,%L,''user_local'')',run,jsonb_set(out,'{publications,0,text}','" "'),usage),'22023','blank text');
 perform pg_temp.replay_assert((select status='processing' from public.publication_agent_v2_runs where id=run) and not exists(select 1 from public.publications where occurrence_id in(fb,ig,gb)),'invalid outputs created nothing');
 r:=public.publication_agent_v2_finish(run,out,(select id from p7_ids where name='media'),usage,'user_local');
 select array_agg(x::uuid) into ids from jsonb_array_elements_text(r->'publication_ids') x;g:=(r->>'editorial_group_id')::uuid;
 perform pg_temp.replay_assert(cardinality(ids)=3 and g is not null,'three drafts and one group');
 perform pg_temp.replay_assert((select count(*) from public.publications where id=any(ids) and status='draft' and creation_origin='agent' and editorial_group_id=g and platform is not null)=3,'drafts, agent origin, same group');
 perform pg_temp.replay_assert((select bool_and(p.platform=o.platform and o.publication_id=p.id) from public.publications p join public.publication_channel_occurrences o on o.id=p.occurrence_id where p.id=any(ids)),'platform of the occurrence, mirror linked');
 perform pg_temp.replay_assert((select count(*) from public.publication_variants v join public.publications p on p.current_revision_id=v.revision_id where p.id=any(ids))=3
  and (select bool_and(r.origin='generated' and r.angle='Prévenir les fuites') from public.publication_revisions r where r.publication_id=any(ids)),'one generated revision with one variant each');
 perform pg_temp.replay_assert((select subject='Entretien de toiture' and origin='agent' and project_id=s from public.publication_editorial_groups where id=g),'agent group with the idea subject');
 perform pg_temp.replay_assert((select status='completed' and publication_ids=ids and editorial_group_id=g and selected_media_id=(select id from p7_ids where name='media') and input_tokens=1200 and estimated_cost_eur=0.0012
  from public.publication_agent_v2_runs where id=run),'run completed');
 perform pg_temp.replay_assert((select status='completed' and input_tokens=1200 and estimated_cost_eur=0.0012 from public.agent_runs where id=(select agent_run_id from public.publication_agent_v2_runs where id=run)),'agent_run completed');
 select * into e from public.publication_events where action='publication.agent_v2_completed' and metadata->>'run_id'=run::text;
 perform pg_temp.replay_assert(e.resource_id=s and e.metadata=jsonb_build_object('run_id',run,'project_id',s,'occurrence_ids',to_jsonb(array[fb,ig,gb]),'publication_ids',to_jsonb(ids),'editorial_group_id',g,'with_media',true),'completion audited (ids only, no text)');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,null,%L,''user_local'')',run,out,usage),'55000','finish twice refused');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_begin(%L,%L,12,''user_local'')',s,array[fb,ig,gb]),'23514','second run on the same (now linked) occurrences refused');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries) and not exists(select 1 from public.publication_jobs) and not exists(select 1 from public.publications where id=any(ids) and status<>'draft'),'no delivery, no job, drafts only');
end $$;

-- 6. Single-platform batch: no group. Occurrence linked between begin and finish: whole batch refused, then failed run.
do $$
declare s uuid:=(select id from p7_ids where name='social');fb uuid:=pg_temp.p7_occ('social','facebook',1);gb uuid:=pg_temp.p7_occ('social','google_business_profile',1);run uuid;r jsonb;pubs bigint;
 usage jsonb:='{"input_tokens":10,"output_tokens":10,"estimated_cost_eur":0.0001}';
begin
 run:=(public.publication_agent_v2_begin(s,array[gb],5,'user_local')->>'run_id')::uuid;
 r:=public.publication_agent_v2_finish(run,jsonb_build_object('idea',jsonb_build_object('subject','Sujet GBP','angle','Angle'),'publications',jsonb_build_array(jsonb_build_object('occurrence_id',gb,'text','Texte seul','cta',null))),null,usage,'user_local');
 perform pg_temp.replay_assert(jsonb_array_length(r->'publication_ids')=1 and r->>'editorial_group_id' is null,'one publication, no group');
 run:=(public.publication_agent_v2_begin(s,array[fb],5,'user_local')->>'run_id')::uuid;insert into p7_ids values('run_race',run);
 perform public.publication_create_from_occurrence(fb,null,null,'Manuel concurrent','Texte',null,'user_local');
 select count(*) into pubs from public.publications;
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,null,%L,''user_local'')',run,jsonb_build_object('idea',jsonb_build_object('subject','S','angle','A'),
  'publications',jsonb_build_array(jsonb_build_object('occurrence_id',fb,'text','T','cta',null))),usage),'23505','occurrence linked meanwhile: batch refused');
 perform pg_temp.replay_assert((select count(*) from public.publications)=pubs and (select status='processing' from public.publication_agent_v2_runs where id=run),'nothing created, run still processing');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_fail(%L,''unknown'',''{}'',''user_local'')',run),'22023','unknown failure code');
 perform public.publication_agent_v2_fail(run,'occurrence_unavailable','{"input_tokens":10,"output_tokens":10,"estimated_cost_eur":0.0001}','user_local');
 perform pg_temp.replay_assert((select status='failed' and error_code='occurrence_unavailable' and completed_at is not null from public.publication_agent_v2_runs where id=run)
  and (select status='failed' from public.agent_runs where id=(select agent_run_id from public.publication_agent_v2_runs where id=run))
  and exists(select 1 from public.publication_events where action='publication.agent_v2_failed' and metadata->>'run_id'=run::text and metadata->>'code'='occurrence_unavailable'),'failure recorded and audited');
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_fail(%L,''generation_failed'',''{}'',''user_local'')',run),'55000','failed run is final');
end $$;

-- 7. Lease expiry and budget.
do $$
declare s uuid:=(select id from p7_ids where name='social');ig uuid:=pg_temp.p7_occ('social','instagram',1);run uuid;run2 uuid;
begin
 run:=(public.publication_agent_v2_begin(s,array[ig],5,'user_local')->>'run_id')::uuid;
 reset role;update public.publication_agent_v2_runs set lease_until=now()-interval '1 minute' where id=run;set local role service_role;
 run2:=(public.publication_agent_v2_begin(s,array[ig],5,'user_local')->>'run_id')::uuid;
 perform pg_temp.replay_assert(run2<>run and (select status='failed' and error_code='lease_expired' and estimated_cost_eur=.1 from public.publication_agent_v2_runs where id=run),'expired run failed conservatively, new run started');
 perform public.publication_agent_v2_fail(run2,'generation_failed','{"estimated_cost_eur":0.1}','user_local');
 reset role;update public.agents set max_monthly_budget_eur=publications_private.agent_month_spend(id)+.05 where publication_specialist;set local role service_role;
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_begin(%L,%L,5,''user_local'')',s,array[ig]),'55000','monthly budget enforced');
 reset role;update public.agents set max_monthly_budget_eur=5 where publication_specialist;set local role service_role;
end $$;
reset role;

-- 8. Runs are immutable once finished; never deleted.
do $$declare run uuid:=(select id from p7_ids where name='run_full');begin
 perform pg_temp.replay_failure(format('update public.publication_agent_v2_runs set estimated_cost_eur=0 where id=%L',run),'55000','completed run immutable');
 perform pg_temp.replay_failure(format('delete from public.publication_agent_v2_runs where id=%L',run),'55000','runs never deleted');
 perform pg_temp.replay_failure('truncate public.publication_agent_v2_runs cascade','55000','runs never truncated (cascade: the guard still fires first)');
end $$;

-- 9. Atomicity: failure injected on the completion audit, after every creation.
create schema p7_test_injection;
create function p7_test_injection.fail_completion() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Injected failure after batch writes' using errcode='P0001'; end $$;
grant usage on schema p7_test_injection to service_role;grant execute on function p7_test_injection.fail_completion() to service_role;
create trigger p7_inject before insert on public.publication_events for each row when (new.action='publication.agent_v2_completed') execute function p7_test_injection.fail_completion();
set local role service_role;
do $$declare s uuid:=(select id from p7_ids where name='social');fb uuid:=pg_temp.p7_occ('social','facebook',1);ig uuid:=pg_temp.p7_occ('social','instagram',1);run uuid;pubs bigint;groups bigint;begin
 run:=(public.publication_agent_v2_begin(s,array[fb,ig],5,'user_local')->>'run_id')::uuid;select count(*) into pubs from public.publications;
 perform pg_temp.replay_failure(format('update public.publication_agent_v2_runs set considered_count=considered_count+1 where id=%L',run),'55000','run identity immutable');select count(*) into groups from public.publication_editorial_groups;
 perform pg_temp.replay_failure(format('select public.publication_agent_v2_finish(%L,%L,null,''{"input_tokens":1,"output_tokens":1,"estimated_cost_eur":0}'',''user_local'')',run,
  jsonb_build_object('idea',jsonb_build_object('subject','S','angle','A'),'publications',jsonb_build_array(jsonb_build_object('occurrence_id',fb,'text','F','cta',null),jsonb_build_object('occurrence_id',ig,'text','I','cta',null)))),'P0001','injected failure');
 perform pg_temp.replay_assert((select count(*) from public.publications)=pubs and (select count(*) from public.publication_editorial_groups)=groups
  and (select publication_id is null from public.publication_channel_occurrences where id=fb) and (select status='processing' from public.publication_agent_v2_runs where id=run),'no half batch: nothing persisted');
end $$;
reset role;
drop trigger p7_inject on public.publication_events;
drop schema p7_test_injection cascade;

-- 10. Audit and safety.
select pg_temp.replay_assert(not exists(select 1 from public.publication_events where action like 'publication.agent_v2_%'
 and (coalesce(before_data::text,'')||coalesce(after_data::text,'')||metadata::text) ~* '(texte|text_content|prompt|token|secret|credential)'),'agent audit without text, prompt or secret');
select pg_temp.replay_assert((select not generation_enabled and not automation_enabled and not publishing_enabled and emergency_stop from public.publication_settings),'global kill switch unchanged');
select pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries) and not exists(select 1 from public.publication_jobs),'no delivery, no job');
