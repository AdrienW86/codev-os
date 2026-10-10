-- Local disposable database only. Sequential PostgreSQL assertions; no claim of multi-connection validation.
begin;
create function pg_temp.check_true(value boolean,label text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'Check failed: %',label; end if; end $$;
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
select pg_temp.check_true(not public.codev_store_ads_report(o.id,j.id,'lost-worker',c.body),'lost worker cannot publish') from occurrence o,public.jobs j,content c where j.run_type='ads.report.prepare';
select pg_temp.check_true(public.codev_store_ads_report(o.id,j.id,'worker-A',c.body),'publish complete snapshot') from occurrence o,public.jobs j,content c where j.run_type='ads.report.prepare';
select pg_temp.check_true(public.codev_store_ads_report(o.id,j.id,'worker-A',c.body),'replay retains same report') from occurrence o,public.jobs j,content c where j.run_type='ads.report.prepare';
select pg_temp.check_true((select count(*) from public.report_versions where report_id in(select report_id from public.ads_report_occurrences))=1,'one transactional version');
select pg_temp.check_true(not public.codev_claim_recurring_delivery(o.id,j.id,'worker-A',r.id,1,gen_random_uuid(),'reports@example.invalid',r.title,'Résumé de test',r.client_content),'unapproved cannot send') from public.ads_report_occurrences o,public.jobs j,public.reports r where j.run_type='ads.report.send' and r.id=o.report_id;
update public.reports set status='approved',approved_version=version,approved_at=now(),approved_by='local-test' where id in(select report_id from public.ads_report_occurrences);
select pg_temp.check_true(not public.codev_claim_recurring_delivery(o.id,j.id,'worker-A',r.id,1,gen_random_uuid(),'changed@example.invalid',r.title,'Résumé de test',r.client_content),'recipient mutation cannot send') from public.ads_report_occurrences o,public.jobs j,public.reports r where j.run_type='ads.report.send' and r.id=o.report_id;
select pg_temp.check_true(not public.codev_claim_recurring_delivery(o.id,j.id,'worker-B',r.id,1,gen_random_uuid(),'reports@example.invalid',r.title,'Résumé de test',r.client_content),'lost send worker cannot reserve') from public.ads_report_occurrences o,public.jobs j,public.reports r where j.run_type='ads.report.send' and r.id=o.report_id;
create temporary table reservation as select gen_random_uuid() token;
select pg_temp.check_true(public.codev_claim_recurring_delivery(o.id,j.id,'worker-A',r.id,1,t.token,'reports@example.invalid',r.title,'Résumé de test',r.client_content),'approved scheduled transport reserves once') from public.ads_report_occurrences o,public.jobs j,public.reports r,reservation t where j.run_type='ads.report.send' and r.id=o.report_id;
select pg_temp.check_true(not public.codev_claim_recurring_delivery(o.id,j.id,'worker-A',r.id,1,gen_random_uuid(),'reports@example.invalid',r.title,'Résumé de test',r.client_content),'second send reservation refused') from public.ads_report_occurrences o,public.jobs j,public.reports r where j.run_type='ads.report.send' and r.id=o.report_id;
select pg_temp.check_true((select count(*) from public.report_deliveries)=1,'one provider attempt');
select pg_temp.check_true(public.codev_finish_report_delivery(r.id,1,t.token,'uncertain',null),'uncertain result persisted') from public.reports r,reservation t where r.id in(select report_id from public.ads_report_occurrences);
select pg_temp.check_true(not public.codev_claim_recurring_delivery(o.id,j.id,'worker-A',r.id,1,gen_random_uuid(),'reports@example.invalid',r.title,'Résumé de test',r.client_content),'uncertain never blindly retried') from public.ads_report_occurrences o,public.jobs j,public.reports r where j.run_type='ads.report.send' and r.id=o.report_id;
update public.ads_report_occurrences set transport='blocked',reason='approval_required';
select pg_temp.check_true((select count(*) from public.admin_notifications where event_key like 'ads-report:%:blocked')=1,'discreet notification for blocked send');
update public.ads_report_occurrences set transport='blocked';
select pg_temp.check_true((select count(*) from public.admin_notifications where event_key like 'ads-report:%:blocked')=1,'notification deduplicated');
select pg_temp.check_true(public.codev_save_ads_report_settings(client,1,config||'{"enabled":false}'::jsonb,due+interval '7 days',prepare+interval '7 days')=2,'pause increments revision') from fixture;
select pg_temp.check_true((select config->>'recipient' from public.ads_report_occurrences)='reports@example.invalid','pause preserves recipient snapshot');
-- Changing cadence/resuming carries the last finalized day forward under the same account lock.
select pg_temp.check_true(public.codev_save_ads_report_settings(client,2,config,due+interval '7 days',prepare+interval '7 days')=3,'resume revision') from fixture;
select public.codev_enqueue_ads_report(client,3,due+interval '7 days',jsonb_build_object('dueAt',due+interval '7 days','prepareAt',prepare+interval '7 days','start','2026-09-01','end','2026-10-15','timezone','Europe/Paris','cutoff','2026-10-16 00:00 exclusive'),due+interval '14 days',prepare+interval '14 days') from fixture;
select pg_temp.check_true((select period_window->>'start' from public.ads_report_occurrences where revision=3)='2026-10-09','configuration change cannot overlap finalized period');
select pg_temp.check_true(public.codev_enqueue_ads_report(client,3,due+interval '14 days',jsonb_build_object('dueAt',due+interval '14 days','prepareAt',prepare+interval '14 days','start','2026-10-02','end','2026-10-08','timezone','Europe/Paris','cutoff','2026-10-09 00:00 exclusive'),due+interval '21 days',prepare+interval '21 days') is null,'already covered window skipped') from fixture;
select pg_temp.check_true((select next_due_at from public.client_ads_report_settings)=(select due+interval '21 days' from fixture),'covered window still advances schedule');
select pg_temp.check_true(public.codev_save_ads_report_settings(client,3,config||'{"enabled":false}'::jsonb,due+interval '21 days',prepare+interval '21 days')=4,'pause cancels queued preparations') from fixture;
select pg_temp.check_true((select preparation from public.ads_report_occurrences where revision=3)='cancelled','cancelled preparation not shown queued');
rollback;
