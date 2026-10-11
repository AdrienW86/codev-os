-- Local disposable database only. Sequential PostgreSQL assertions; no claim of multi-connection validation.
begin;
create or replace function pg_temp.check_true(value boolean,label text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'Check failed: %',label; end if; end $$;
select pg_temp.check_true((select relrowsecurity from pg_class where oid='public.client_ads_report_settings'::regclass),'settings RLS');
select pg_temp.check_true((select relrowsecurity from pg_class where oid='public.ads_report_occurrences'::regclass),'occurrences RLS');
select pg_temp.check_true(not has_table_privilege('anon','public.client_ads_report_settings','SELECT'),'anon cannot read settings');
select pg_temp.check_true(not has_table_privilege('authenticated','public.ads_report_occurrences','UPDATE'),'browser cannot change snapshots');
select pg_temp.check_true(not has_function_privilege('anon','public.codev_claim_recurring_delivery(uuid,uuid,text,uuid,integer,uuid,text,text,text,jsonb)','EXECUTE'),'anon cannot reserve sends');
create temporary table fixture as select '11111111-1111-4111-8111-111111111111'::uuid client,
 '{"enabled":true,"frequency":"weekly","weekday":5,"monthDay":1,"time":"18:00","timezone":"Europe/Paris","recipient":"reports@example.invalid","recipientConfirmed":true,"campaignIds":["123"],"types":["SEARCH"],"mode":"deterministic","transport":"approved_auto","leadHours":6,"lateMinutes":5,"accountId":"1234567890"}'::jsonb config,
 now()-interval '1 minute' due, now()-interval '6 hours' prepare;
select pg_temp.check_true(codev_save_ads_report_settings(client,0,config,due,prepare)=1,'save first revision') from fixture;
do $$ begin
 perform public.codev_save_ads_report_settings(client,0,config,due,prepare) from fixture;
 raise exception 'expected stale revision failure';
 exception when serialization_failure then null;
end $$;
create temporary table occurrence as select public.codev_enqueue_ads_report(client,1,due,jsonb_build_object('dueAt',due,'prepareAt',prepare,'start','2026-10-02','end','2026-10-08','timezone','Europe/Paris','cutoff','2026-10-09 00:00 exclusive'),due+interval '7 days',prepare+interval '7 days') id from fixture;
select pg_temp.check_true((select count(*) from public.jobs where run_type in ('ads.report.prepare','ads.report.send'))=2,'one prepare and send job');
select pg_temp.check_true(public.codev_enqueue_ads_report(client,1,due,'{}'::jsonb,due+interval '7 days',prepare+interval '7 days') is null,'old due cannot enqueue again') from fixture;
select pg_temp.check_true((select count(*) from public.ads_report_occurrences)=1,'one occurrence');
do $$ begin
 update public.ads_report_occurrences set config=config||'{"recipient":"other@example.invalid"}'::jsonb;
 raise exception 'expected immutable recipient';
 exception when object_not_in_prerequisite_state then null;
end $$;
update public.jobs set status='running',worker_id='worker-A',lease_expires_at=now()+interval '5 minutes' where run_type in ('ads.report.prepare','ads.report.send');
create temporary table content as select '{"title":"Rapport de test","summary":"Résumé de test","internal_content":{"summary":"Résumé interne","sections":[],"highlights":[],"empty":false},"client_content":{"summary":"Résumé de test","sections":[],"highlights":[],"empty":false},"scope":{"start":"2026-10-02","end":"2026-10-08","days":7,"timezone":"Europe/Paris","currency":"EUR","accountId":"1234567890","status":"all","types":["SEARCH"],"campaignIds":["123"],"campaignNames":{"123":"Search"}}}'::jsonb body;

select pg_temp.check_true(not public.codev_record_ads_report_outcome(o.id,j.id,'stale-worker','prepare','failed','preparation_failed'),'stale worker cannot mark failure') from occurrence o,public.jobs j where j.run_type='ads.report.prepare';
select pg_temp.check_true(public.codev_record_ads_report_outcome(o.id,j.id,'worker-A','prepare','failed','preparation_failed'),'leased worker can record preparation failure') from occurrence o,public.jobs j where j.run_type='ads.report.prepare';
select pg_temp.check_true((select count(*) from public.admin_notifications where href='/notifications' and event_key like 'ads-report:%:preparation_failed')=1,'failed preparation creates a valid notification without a report');
select pg_temp.check_true(public.codev_record_ads_report_outcome(o.id,j.id,'worker-A','send','blocked','approval_required'),'missing report blocks without constraint failure') from occurrence o,public.jobs j where j.run_type='ads.report.send';
select pg_temp.check_true((select count(*) from public.admin_notifications where href='/notifications' and event_key like 'ads-report:%:blocked')=1,'blocked missing report notification');
select pg_temp.check_true(public.codev_store_ads_report(o.id,j.id,'worker-A',c.body),'retry publishes prepared snapshot') from occurrence o,public.jobs j,content c where j.run_type='ads.report.prepare';
update public.reports set status='approved',approved_version=version,approved_at=now(),approved_by='local-test' where id in(select report_id from public.ads_report_occurrences);
select pg_temp.check_true(not public.codev_claim_report_delivery(r.id,r.version,gen_random_uuid(),'other@example.invalid',r.title,'Résumé',r.client_content),'manual send cannot change frozen recipient') from public.reports r where r.id in(select report_id from public.ads_report_occurrences);
-- Content edit requires a new version and revokes approval.
update public.reports set version=version+1,summary='Revised',client_content=jsonb_set(client_content,'{summary}','"Revised"'::jsonb) where id in(select report_id from public.ads_report_occurrences);
select pg_temp.check_true((select status='ready_for_review' and approved_version is null and version=2 from public.reports where id in(select report_id from public.ads_report_occurrences)),'content edit revokes approval');
update public.reports set status='approved',approved_version=version,approved_at=now(),approved_by='local-test' where id in(select report_id from public.ads_report_occurrences);
select public.codev_save_ads_report_settings(client,1,config||'{"recipient":"new@example.invalid"}'::jsonb,due+interval '7 days',prepare+interval '7 days') from fixture;
select pg_temp.check_true((select status='ready_for_review' and approved_version is null and version=3 from public.reports where id in(select report_id from public.ads_report_occurrences)),'recipient configuration edit revokes old approval');
select pg_temp.check_true((select config->>'recipient' from public.ads_report_occurrences)='reports@example.invalid','old recipient remains frozen');
update public.reports set status='approved',approved_version=version,approved_at=now(),approved_by='local-test' where id in(select report_id from public.ads_report_occurrences);
select public.codev_save_ads_report_settings(client,2,config||'{"campaignIds":["456"]}'::jsonb,due+interval '7 days',prepare+interval '7 days') from fixture;
select pg_temp.check_true((select status='ready_for_review' and approved_version is null and version=4 from public.reports where id in(select report_id from public.ads_report_occurrences)),'campaign configuration edit revokes old approval');
do $$ begin
 update public.reports set scope=jsonb_set(scope,'{campaignIds}','["456"]'::jsonb) where id in(select report_id from public.ads_report_occurrences);
 raise exception 'Expected immutable Ads scope';
 exception when object_not_in_prerequisite_state then null;
end $$;
select pg_temp.check_true(not has_function_privilege('authenticated','public.codev_record_ads_report_outcome(uuid,uuid,text,text,text,text)','EXECUTE'),'browser cannot record worker outcomes');
rollback;
