-- Synthetic PostgreSQL local test only (socle Publications, lot 6). Never execute remotely.
-- Appended after publications-delivery-engine.sql on the full migration chain (same transaction, rolled back):
-- every delivery that ended failed or uncertain produced exactly one notification towards its publication.
reset role;
do $$declare rec record;n integer;begin
 perform pg_temp.replay_assert((select count(*) from public.publication_deliveries where status in('failed','uncertain'))>0,'the delivery suite produced failures');
 for rec in select id,publication_id,status from public.publication_deliveries where status in('failed','uncertain') loop
  select count(*) into n from public.admin_notifications where event_key='publication-delivery:'||rec.id||':'||rec.status and category='delivery_failed' and href='/publications/'||rec.publication_id;
  perform pg_temp.replay_assert(n=1,'one notification for delivery '||rec.id||' '||rec.status);
 end loop;
 perform pg_temp.replay_assert(not exists(select 1 from public.admin_notifications n where n.event_key like 'publication-delivery:%'
  and not exists(select 1 from public.publication_deliveries d where n.event_key like 'publication-delivery:'||d.id||':%')),'no notification without a delivery');
 perform pg_temp.replay_assert(not exists(select 1 from public.admin_notifications where event_key like 'publication-delivery:%:published' or event_key like 'publication-delivery:%:scheduled'),'success never notified as a failure');
end $$;
-- A refused publication is never prepared for delivery; a submitted one waits for an explicit human approval.
do $$declare pub uuid;rev uuid;begin
 pub:=pg_temp.p10_publication('facebook','Lot 6 refusée',false);select current_revision_id into rev from public.publications where id=pub;
 set local role service_role;
 perform public.publication_submit_manual(pub,rev,'user_local');
 perform pg_temp.replay_assert((select status from public.publications where id=pub)='pending_review','submitted: à valider');
 perform pg_temp.replay_failure(format('select public.publication_prepare_delivery(%L,%L)',pub,'user_local'),'55000','pending review never prepared');
 perform public.publication_review_manual(pub,rev,'rejected','Hors sujet','user_local');
 perform pg_temp.replay_failure(format('select public.publication_prepare_delivery(%L,%L)',pub,'user_local'),'55000','rejected never prepared');
 reset role;
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_deliveries where publication_id=pub),'no delivery for a refused publication');
end $$;

-- Blocages (connexion, authentification, canal) notifiés une fois ; jamais un blocage causé par un humain.
reset role;
do $$declare rec record;begin
 perform pg_temp.replay_assert((select count(*) from public.publication_events where action='publication.delivery_blocked')>0,'the delivery suite produced blocks');
 for rec in select id,publication_id,blocked_reason from public.publication_deliveries where status='blocked' and blocked_reason is not null and blocked_reason not in('publication_changed','content_changed','archived') loop
  perform pg_temp.replay_assert((select count(*) from public.admin_notifications where event_key='publication-delivery:'||rec.id||':blocked' and category='delivery_failed' and href='/publications/'||rec.publication_id)=1,'one notification for blocked delivery '||rec.blocked_reason);
 end loop;
end $$;

-- Helpers du lot 6 : état de candidate vu à une heure donnée (horloge simulée par p_late_before = maintenant - tolérance),
-- tâche rendue due depuis un certain temps, résultat d'un envoi simulé par le planificateur (claim à l'heure).
create function pg_temp.sf_candidate(p_pub uuid,p_late_before timestamptz default now()-interval '2 hours') returns text language sql as $$
 select state from public.publication_scheduled_delivery_candidates(p_late_before,100) where publication_id=p_pub $$;
create function pg_temp.sf_overdue(p_delivery uuid,p_age interval) returns void language plpgsql as $$
begin reset role;update public.publication_jobs set run_at=now()-p_age where delivery_id=p_delivery and type='deliver' and status in('pending','processing');set local role service_role;end $$;
create function pg_temp.sf_send(p_worker text,p_outcome jsonb) returns jsonb language plpgsql as $$
declare c jsonb;job uuid;n integer;
begin
 c:=public.publication_job_claim_on_time(p_worker,60,7200);
 if c is null then return null; end if;
 job:=(c->>'job_id')::uuid;n:=(c->>'attempt')::integer;
 perform public.publication_job_context(job,p_worker,n);perform public.publication_job_dispatch(job,p_worker,n);
 return public.publication_job_complete(job,p_worker,n,p_outcome)||jsonb_build_object('job_id',job,'delivery_id',c->>'delivery_id');
end $$;
grant execute on function pg_temp.sf_candidate(uuid,timestamptz),pg_temp.sf_overdue(uuid,interval),pg_temp.sf_send(text,jsonb) to service_role;

-- 1. Candidates filtrées en base (#1, #6) : approuvée, à venir, sans diffusion pour sa révision courante.
set local role service_role;
do $$declare pub uuid;draft uuid;d uuid;at timestamptz;begin
 pub:=pg_temp.p10_publication('google_business_profile','Lot 6 candidate');insert into p10_ids values('sf_pub',pub);
 draft:=pg_temp.p10_publication('google_business_profile','Lot 6 brouillon',false);
 select o.scheduled_for into at from public.publication_channel_occurrences o join public.publications p on p.occurrence_id=o.id where p.id=pub;
 perform pg_temp.replay_assert(pg_temp.sf_candidate(pub)='ready','approved upcoming publication is a candidate');
 perform pg_temp.replay_assert(pg_temp.sf_candidate(draft) is null,'a draft is never a candidate');
 perform pg_temp.replay_assert(pg_temp.sf_candidate(pub,at+interval '1 minute')='missed','slot passed beyond the tolerance: missed, never ready');
 perform pg_temp.replay_assert(pg_temp.sf_candidate(pub,at+interval '8 days') is null,'older than seven days: no longer reported');
 reset role;
 insert into public.admin_notifications(event_key,category,href) select 'publication-missed:'||pub||':'||current_revision_id,'delivery_failed','/publications/'||pub from public.publications where id=pub;
 set local role service_role;
 perform pg_temp.replay_assert(pg_temp.sf_candidate(pub,at+interval '1 minute') is null,'missed slot reported once, then no longer returned');
 perform pg_temp.replay_assert(pg_temp.sf_candidate(pub)='ready','still ready on time');
 perform pg_temp.replay_assert((select count(*) from public.publication_scheduled_delivery_candidates(now()+interval '30 days',5000))<=100,'candidate list bounded');
 perform pg_temp.replay_assert(not exists(select 1 from public.publication_scheduled_delivery_candidates(now()-interval '2 hours',100) c join public.publications p on p.id=c.publication_id
  where p.status<>'approved' or p.archived_at is not null or exists(select 1 from public.publication_deliveries x where x.publication_id=p.id and x.revision_id=p.current_revision_id)),'only approved, live publications without a delivery for their revision');
 d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;insert into p10_ids values('sf_delivery',d);
 perform pg_temp.replay_assert(pg_temp.sf_candidate(pub) is null,'a prepared delivery removes the candidate (whatever its later status)');
end $$;

-- 2. Photo de la photothèque devenue non publiable (#9) : la publication n'est plus prête, signalée une fois.
reset role;
do $$declare pub uuid;cl uuid:=(select id from p10_ids where name='client');lib uuid:=gen_random_uuid();asset uuid;begin
 pub:=pg_temp.p10_publication('google_business_profile','Lot 6 photothèque');insert into p10_ids values('sf_lib_pub',pub),('sf_lib_asset',lib);
 select va.asset_id into asset from public.publications p join public.publication_variants v on v.revision_id=p.current_revision_id join public.publication_variant_assets va on va.variant_id=v.id where p.id=pub;
 insert into public.whatsapp_assets(id,client_id,drive_folder_id,sha256,md5,drive_file_id,mime_type,size,media_kind,imported_at,library_status,status_changed_by,origin)
 values(lib,cl,'folder_sf_'||left(cl::text,8),encode(sha256(lib::text::bytea),'hex'),md5(lib::text),'drive_file_sf_'||lib,'image/jpeg',2048,'image',now(),'used','user_local','whatsapp');
 insert into public.whatsapp_asset_uses(asset_id,client_id,publication_id,platform,publication_asset_id,used_by) values(lib,cl,pub,'google_business_profile',asset,'user_local');
 perform pg_temp.replay_assert(pg_temp.sf_candidate(pub)='ready','publishable library photo: ready');
 insert into public.whatsapp_asset_assessments(asset_id,client_id,verdict,business_relevance,publishability,sensitive,confidential,description,topics,quality,quality_issues,profile_version,model,estimated_cost_eur,manual_verdict)
 values(lib,cl,'to_review',0.7,0.1,'{invoice}',true,'Document.','{}','good','{}',1,'gpt-4.1-mini-2025-04-14',0.001,null);
 perform pg_temp.replay_assert(pg_temp.sf_candidate(pub)='photo_unpublishable','confidential assessment: never prepared');
 delete from public.whatsapp_asset_assessments where asset_id=lib;
 update public.whatsapp_assets set library_status='quarantined' where id=lib;
 perform pg_temp.replay_assert(pg_temp.sf_candidate(pub)='photo_unpublishable','quarantined photo: never prepared');
 insert into public.admin_notifications(event_key,category,href) select 'publication-photo-unpublishable:'||pub||':'||current_revision_id,'delivery_failed','/publications/'||pub from public.publications where id=pub;
 perform pg_temp.replay_assert(pg_temp.sf_candidate(pub) is null,'reported once, then no longer returned');
end $$;

-- 3. Envoi à l'heure (#5) : une tâche due depuis plus que la tolérance n'est jamais envoyée par le planificateur.
set local role service_role;
do $$declare pub uuid;d uuid:=(select id from p10_ids where name='sf_delivery');r jsonb;begin
 perform pg_temp.replay_failure('select public.publication_job_claim_on_time(''sched'',60,10)','22023','tolerance below bound refused');
 perform pg_temp.sf_overdue(d,interval '3 hours');
 perform pg_temp.replay_assert(public.publication_job_claim_on_time('sched',60,7200) is null,'overdue job never claimed by the scheduler');
 perform pg_temp.replay_assert((select status='blocked' and blocked_reason='late_schedule' from public.publication_deliveries where id=d)
  and not exists(select 1 from public.publication_jobs where delivery_id=d and status in('pending','processing'))
  and not exists(select 1 from public.publication_attempts where delivery_id=d),'blocked with a clear reason, nothing attempted');
 reset role;
 perform pg_temp.replay_assert((select count(*) from public.admin_notifications where event_key='publication-delivery:'||d||':blocked' and href='/publications/'||(select id from p10_ids where name='sf_pub'))=1,'late block notified (#7)');
 set local role service_role;
 -- Un humain relance : la tâche est due maintenant, le planificateur l'envoie (dans la tolérance).
 perform public.publication_delivery_retry(d,'user_local');
 r:=pg_temp.sf_send('sched',pg_temp.p10_ok('simulated','simulated-sf-1'));
 perform pg_temp.replay_assert(r->>'delivery_status'='simulated' and r->>'delivery_id'=d::text,'relaunched by a human: sent on time');
 -- Dans la tolérance : envoyé normalement.
 pub:=pg_temp.p10_publication('google_business_profile','Lot 6 dans la tolérance');d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;
 perform pg_temp.sf_overdue(d,interval '90 minutes');
 r:=pg_temp.sf_send('sched',pg_temp.p10_ok('simulated','simulated-sf-2'));
 perform pg_temp.replay_assert(r->>'delivery_id'=d::text and r->>'delivery_status'='simulated','due within the tolerance: sent');
end $$;

-- 4. Scénario D : modification après approbation. L'ancienne approbation ne permet plus de publier.
do $$declare pub uuid;old_rev uuid;new_rev uuid;d uuid;p public.publications;asset uuid;begin
 pub:=pg_temp.p10_publication('google_business_profile','Lot 6 texte approuvé');
 d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;
 select * into p from public.publications where id=pub;old_rev:=p.current_revision_id;
 select va.asset_id into asset from public.publication_variants v join public.publication_variant_assets va on va.variant_id=v.id where v.revision_id=old_rev;
 perform public.publication_save_draft(pub,old_rev,p.client_id,p.project_id,'Lot 6 modifiée','Angle','Source',p.target_date,null,null,
  jsonb_build_array(jsonb_build_object('platform','google_business_profile','text_content','Texte modifié après approbation','asset_ids',jsonb_build_array(asset))),'user_local');
 select current_revision_id into new_rev from public.publications where id=pub;
 perform pg_temp.replay_assert(new_rev<>old_rev and (select status='draft' from public.publications where id=pub),'edit after approval: new revision, back to draft');
 perform pg_temp.replay_assert((select status in('blocked','cancelled') from public.publication_deliveries where id=d)
  and not exists(select 1 from public.publication_jobs where delivery_id=d and status in('pending','processing')),'prepared delivery blocked, job cancelled');
 perform pg_temp.replay_assert(pg_temp.sf_candidate(pub) is null,'no longer a candidate');
 perform pg_temp.replay_failure(format('select public.publication_review_manual(%L,%L,''approved'',null,''user_local'')',pub,old_rev),'40001','stale approval on the old revision refused');
 perform pg_temp.replay_failure(format('select public.publication_submit_manual(%L,%L,''user_local'')',pub,old_rev),'40001','stale submission on the old revision refused');
 perform pg_temp.replay_failure(format('select public.publication_prepare_delivery(%L,''user_local'')',pub),'55000','never prepared without a new approval');
 perform pg_temp.replay_assert(pg_temp.sf_send('sched',pg_temp.p10_ok('simulated','simulated-never')) is null,'nothing sent');
 reset role;
 perform pg_temp.replay_assert(not exists(select 1 from public.admin_notifications where event_key like 'publication-delivery:'||d||':%'),'a human edit is not notified as a failure');
 set local role service_role;
end $$;

-- 5. Scénario E : deux préparations concurrentes (rejeu séquentiel) ne dupliquent rien.
do $$declare occ uuid:=pg_temp.p10_occ('google_business_profile');pub uuid;r1 jsonb;r2 jsonb;n integer;run uuid;begin
 r1:=public.publication_create_from_occurrence(occ,null,null,'Lot 6 E','Texte E',null,'user_local');
 perform pg_temp.replay_failure(format('select public.publication_create_from_occurrence(%L,null,null,''Lot 6 E bis'',''Texte E bis'',null,''user_local'')',occ),'23505','second publication on the same occurrence refused');
 perform pg_temp.replay_assert((select count(*) from public.publications where occurrence_id=occ)=1,'one publication per occurrence');
 pub:=pg_temp.p10_publication('google_business_profile','Lot 6 E diffusion');
 r1:=public.publication_prepare_delivery(pub,'user_local');r2:=public.publication_prepare_delivery(pub,'user_local');
 perform pg_temp.replay_assert(r1->>'delivery_id'=r2->>'delivery_id' and r2->>'created'='false'
  and (select count(*) from public.publication_deliveries where publication_id=pub)=1 and (select count(*) from public.publication_jobs where publication_id=pub and type='deliver')=1,'same delivery, same job');
 reset role;
 perform pg_temp.replay_failure(format('insert into public.publication_deliveries(publication_id,client_id,publication_account_id,variant_id,platform,scheduled_for,idempotency_key) select publication_id,client_id,publication_account_id,variant_id,platform,scheduled_for,idempotency_key||''x'' from public.publication_deliveries where id=%L',r1->>'delivery_id'),'23505','one live delivery per publication and account');
 select id into run from public.publication_agent_v2_runs limit 1;
 if run is not null then
  insert into public.publication_scheduled_runs(run_id,client_id) select id,client_id from public.publication_agent_v2_runs where id=run;
  perform pg_temp.replay_failure(format('insert into public.publication_scheduled_runs(run_id,client_id) select id,client_id from public.publication_agent_v2_runs where id=%L',run),'23505','one follow-up per run');
 end if;
 set local role service_role;
 perform pg_temp.sf_overdue((r1->>'delivery_id')::uuid,interval '1 minute');
 perform pg_temp.replay_assert(public.publication_job_claim_on_time('sched-a',60,7200)->>'delivery_id'=r1->>'delivery_id','first worker claims');
 perform pg_temp.replay_assert(public.publication_job_claim_on_time('sched-b',60,7200) is null,'second worker gets nothing (leased)');
 -- Le premier envoi se termine pour ne pas gêner la suite.
 perform public.publication_job_dispatch((select id from public.publication_jobs where delivery_id=(r1->>'delivery_id')::uuid and status='processing'),'sched-a',1);
 perform public.publication_job_complete((select id from public.publication_jobs where delivery_id=(r1->>'delivery_id')::uuid and status='processing'),'sched-a',1,pg_temp.p10_ok('simulated','simulated-sf-e'));
end $$;

-- 6. Scénario G : le réseau refuse (erreur permanente, connexion expirée, plateforme indisponible).
do $$declare pub uuid;d uuid;r jsonb;n integer;begin
 pub:=pg_temp.p10_publication('google_business_profile','Lot 6 refus permanent');d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;
 perform pg_temp.sf_overdue(d,interval '1 minute');
 r:=pg_temp.sf_send('sched',pg_temp.p10_ok('permanent',null,'{"error_code":"content_rejected"}'));
 perform pg_temp.replay_assert(r->>'delivery_status'='failed' and r->>'job_status'='failed','permanent refusal: failed, no retry');
 perform pg_temp.replay_assert((select status='failed' and remote_id is null and published_at is null from public.publication_deliveries where id=d)
  and (select count(*) from public.publication_attempts where delivery_id=d and result='failed')=1,'failure recorded, never a success');
 pub:=pg_temp.p10_publication('google_business_profile','Lot 6 connexion expirée');d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;
 perform pg_temp.sf_overdue(d,interval '1 minute');
 r:=pg_temp.sf_send('sched',pg_temp.p10_ok('auth',null,'{"error_code":"token_expired"}'));
 perform pg_temp.replay_assert(r->>'delivery_status'='blocked' and (select blocked_reason='auth' from public.publication_deliveries where id=d),'expired connection: blocked');
 insert into p10_ids values('sf_auth_delivery',d);
 pub:=pg_temp.p10_publication('google_business_profile','Lot 6 indisponible');d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;insert into p10_ids values('sf_5xx_delivery',d);
 for n in 1..5 loop
  perform pg_temp.sf_overdue(d,interval '1 minute');
  r:=pg_temp.sf_send('sched',pg_temp.p10_ok('provider_unavailable',null,'{"error_code":"http_503"}'));
  perform pg_temp.replay_assert(r->>'delivery_status'=case when n<5 then 'retryable_error' else 'failed' end,'5xx attempt '||n);
 end loop;
 perform pg_temp.sf_overdue(d,interval '1 minute');
 perform pg_temp.replay_assert(pg_temp.sf_send('sched',pg_temp.p10_ok('simulated','simulated-never')) is null,'retries bounded: nothing more after max attempts');
 perform pg_temp.replay_assert((select count(*) from public.publication_attempts where delivery_id=d)=5 and not exists(select 1 from public.publication_attempts where delivery_id=d and result='succeeded'),'five attempts, none counted as a success');
end $$;
reset role;
do $$declare d record;begin
 for d in select x.id,x.publication_id,x.status from public.publication_deliveries x join public.publications p on p.id=x.publication_id
  join public.publication_variants v on v.id=x.variant_id where v.text_content in('Lot 6 refus permanent','Lot 6 connexion expirée','Lot 6 indisponible') loop
  perform pg_temp.replay_assert((select count(*) from public.admin_notifications where event_key='publication-delivery:'||d.id||':'||d.status and category='delivery_failed' and href='/publications/'||d.publication_id)=1,'refusal notified once: '||d.status);
 end loop;
end $$;

-- 7. Scénario H : reprise après une interruption (bails expirés) sans renvoi ni doublon.
set local role service_role;
do $$declare pub uuid;d uuid;job uuid;c jsonb;sent uuid:=(select id from p10_ids where name='sf_delivery');begin
 -- Avant l'envoi : la tâche est reprise (nouvelle tentative), un seul envoi au total.
 pub:=pg_temp.p10_publication('google_business_profile','Lot 6 reprise avant envoi');d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;
 perform pg_temp.sf_overdue(d,interval '1 minute');c:=public.publication_job_claim_on_time('sched-1',60,7200);job:=(c->>'job_id')::uuid;
 reset role;update public.publication_jobs set lease_expires_at=now()-interval '1 second' where id=job;set local role service_role;
 c:=public.publication_job_claim_on_time('sched-2',60,7200);
 perform pg_temp.replay_assert(c->>'job_id'=job::text and (c->>'attempt')::int=2,'restart before dispatch: same job reclaimed');
 perform public.publication_job_dispatch(job,'sched-2',2);perform public.publication_job_complete(job,'sched-2',2,pg_temp.p10_ok('simulated','simulated-sf-h1'));
 perform pg_temp.replay_assert((select count(*) from public.publication_attempts where delivery_id=d)=1,'one send only');
 -- Après l'envoi : jamais renvoyée (à vérifier), notifiée.
 pub:=pg_temp.p10_publication('google_business_profile','Lot 6 reprise après envoi');d:=(public.publication_prepare_delivery(pub,'user_local')->>'delivery_id')::uuid;
 perform pg_temp.sf_overdue(d,interval '1 minute');c:=public.publication_job_claim_on_time('sched-1',60,7200);job:=(c->>'job_id')::uuid;
 perform public.publication_job_dispatch(job,'sched-1',1);
 reset role;update public.publication_jobs set lease_expires_at=now()-interval '1 second' where id=job;set local role service_role;
 perform pg_temp.replay_assert(public.publication_job_claim_on_time('sched-2',60,7200) is null,'restart after dispatch: nothing re-sent');
 perform pg_temp.replay_assert((select status='uncertain' from public.publication_deliveries where id=d),'outcome to verify');
 -- Retard après une longue coupure, mais déjà envoyé : rien n'est bloqué ni renvoyé.
 perform pg_temp.sf_overdue(d,interval '5 hours');
 perform pg_temp.replay_assert(public.publication_job_claim_on_time('sched-2',60,7200) is null and (select status='uncertain' from public.publication_deliveries where id=d),'uncertain stays uncertain');
 -- Une publication déjà diffusée n'est jamais redevenue candidate.
 perform pg_temp.replay_assert(pg_temp.sf_candidate((select publication_id from public.publication_deliveries where id=sent)) is null,'published publication never prepared again');
 perform pg_temp.replay_assert(public.publication_prepare_delivery((select publication_id from public.publication_deliveries where id=sent),'user_local')->>'created'='false','prepare again: same delivery, nothing re-sent');
end $$;
reset role;
select pg_temp.replay_assert((select count(*) from public.admin_notifications where event_key='publication-delivery:'||d.id||':uncertain')=1,'restart uncertainty notified')
 from public.publication_deliveries d join public.publication_variants v on v.id=d.variant_id where v.text_content='Lot 6 reprise après envoi';
