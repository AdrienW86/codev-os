begin;
create temporary table workspace_checks(passed integer not null);
insert into workspace_checks values (0);
create function pg_temp.ok(condition boolean, label text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'Workspace check failed: %', label; end if;
  update pg_temp.workspace_checks set passed = passed + 1;
end $$;
create function pg_temp.fails(statement text, expected text, label text) returns void language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute statement; exception when others then
    rejected := true;
    if sqlstate <> expected then raise exception 'Workspace check %: expected %, got % (%)', label, expected, sqlstate, sqlerrm; end if;
  end;
  perform pg_temp.ok(rejected, label);
end $$;

insert into public.clients(id,name) values ('aaaaaaaa-0000-4000-8000-0000000000a1','Test Ads A'), ('aaaaaaaa-0000-4000-8000-0000000000b1','Test Ads B');
insert into public.client_connections(id,client_id,provider,status,external_account_id) values
  ('cccccccc-0000-4000-8000-0000000000a1','aaaaaaaa-0000-4000-8000-0000000000a1','google_ads','connected','1234567890'),
  ('cccccccc-0000-4000-8000-0000000000b1','aaaaaaaa-0000-4000-8000-0000000000b1','google_ads','connected','1234567890');

select pg_temp.ok(not has_table_privilege('anon','public.client_ads_scopes','select'), 'anon cannot read scope');
select pg_temp.ok(not has_table_privilege('authenticated','public.client_ads_campaigns','insert'), 'authenticated cannot assign campaigns');
select pg_temp.ok(not has_function_privilege('anon','public.codev_set_ads_campaigns(uuid,uuid,text,text[],integer)','execute'), 'anon cannot invoke RPC');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.client_ads_scopes'::regclass), 'scope RLS');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.client_ads_campaigns'::regclass), 'campaign RLS');
select pg_temp.ok(has_function_privilege('service_role','public.codev_set_ads_campaigns(uuid,uuid,text,text[],integer)','execute'), 'server can invoke RPC');

select pg_temp.ok(public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000a1','cccccccc-0000-4000-8000-0000000000a1','1234567890',array['123'],0) = 1, 'initial revision');
select pg_temp.fails($$select public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000b1','cccccccc-0000-4000-8000-0000000000b1','1234567890',array['123'],0)$$,'23505','contradictory assignment refused');
select pg_temp.ok(not exists(select 1 from public.client_ads_scopes where client_id='aaaaaaaa-0000-4000-8000-0000000000b1'),'failed transaction creates no scope');
select pg_temp.fails($$select public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000a1','cccccccc-0000-4000-8000-0000000000a1','1234567890',array['456'],0)$$,'40001','stale revision refused');
select pg_temp.ok((select campaign_id='123' from public.client_ads_campaigns where client_id='aaaaaaaa-0000-4000-8000-0000000000a1'),'stale save preserves selection');
select pg_temp.fails($$select public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000a1','cccccccc-0000-4000-8000-0000000000b1','1234567890',array['456'],1)$$,'55000','cross-client connection refused');
select pg_temp.fails($$select public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000a1','cccccccc-0000-4000-8000-0000000000a1','0000000000',array['456'],1)$$,'55000','cross-account refused');
select pg_temp.fails($$select public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000a1','cccccccc-0000-4000-8000-0000000000a1','1234567890',array['123','123'],1)$$,'22023','duplicates refused');
select pg_temp.fails($$update public.client_connections set external_account_id='0000000000' where id='cccccccc-0000-4000-8000-0000000000a1'$$,'23503','association cannot silently change');
select pg_temp.ok(public.codev_set_ads_campaigns('aaaaaaaa-0000-4000-8000-0000000000a1','cccccccc-0000-4000-8000-0000000000a1','1234567890','{}'::text[],1) = 2,'empty selection persists');
select pg_temp.ok(exists(select 1 from public.client_ads_scopes where client_id='aaaaaaaa-0000-4000-8000-0000000000a1') and not exists(select 1 from public.client_ads_campaigns where client_id='aaaaaaaa-0000-4000-8000-0000000000a1'),'empty is configured, not legacy default');

select pg_temp.ok(not has_table_privilege('authenticated','public.client_ads_context','select'), 'business context server only');
select pg_temp.ok(not has_function_privilege('anon','public.codev_claim_ads_analysis(uuid,uuid)','execute'), 'analysis reservation server only');
select pg_temp.ok(public.codev_save_ads_context('aaaaaaaa-0000-4000-8000-0000000000a1','{"objectives":"test"}'::jsonb,0)=1, 'context initial revision');
select pg_temp.fails($$select public.codev_save_ads_context('aaaaaaaa-0000-4000-8000-0000000000a1','{}'::jsonb,0)$$,'40001','context stale update');
select pg_temp.ok(public.codev_claim_ads_analysis('aaaaaaaa-0000-4000-8000-0000000000a1','11111111-1111-4111-8111-111111111111'), 'first analysis reserved');
select pg_temp.ok(not public.codev_claim_ads_analysis('aaaaaaaa-0000-4000-8000-0000000000a1','22222222-2222-4222-8222-222222222222'), 'simultaneous analysis blocked');
update public.ads_analysis_leases set expires_at=now() where client_id='aaaaaaaa-0000-4000-8000-0000000000a1';
select pg_temp.ok(not public.codev_claim_ads_analysis('aaaaaaaa-0000-4000-8000-0000000000a1','22222222-2222-4222-8222-222222222222'), 'minute cooldown remains after release');

insert into public.reports(id,client_id,kind,period_start,period_end,status,title,client_content) values
('ffffffff-0000-4000-8000-0000000000d1','aaaaaaaa-0000-4000-8000-0000000000a1','weekly','2026-10-01','2026-10-07','ready_for_review','Test client','{"summary":"Client only","sections":[]}');
select pg_temp.ok(exists(select 1 from public.report_versions where report_id='ffffffff-0000-4000-8000-0000000000d1' and version=1),'initial version atomic');
select pg_temp.ok(not has_table_privilege('authenticated','public.report_deliveries','select'),'delivery protected');
select pg_temp.ok(not public.codev_claim_report_delivery('ffffffff-0000-4000-8000-0000000000d1',1,'11111111-1111-4111-8111-111111111111','client@example.test','Test client','Client only','{"summary":"Client only","sections":[]}'),'unapproved send refused');
update public.reports set status='approved',approved_version=null where id='ffffffff-0000-4000-8000-0000000000d1';
select pg_temp.ok(not public.codev_claim_report_delivery('ffffffff-0000-4000-8000-0000000000d1',1,'11111111-1111-4111-8111-111111111111','client@example.test','Test client','Client only','{"summary":"Client only","sections":[]}'),'missing approved version refused');
update public.reports set status='approved',approved_version=1 where id='ffffffff-0000-4000-8000-0000000000d1';
select pg_temp.ok(public.codev_claim_report_delivery('ffffffff-0000-4000-8000-0000000000d1',1,'11111111-1111-4111-8111-111111111111','client@example.test','Test client','Client only','{"summary":"Client only","sections":[]}'),'approved send claimed');
select pg_temp.ok(not public.codev_claim_report_delivery('ffffffff-0000-4000-8000-0000000000d1',1,'22222222-2222-4222-8222-222222222222','other@example.test','Test client','Client only','{"summary":"Client only","sections":[]}'),'second sender refused');
select pg_temp.fails($$update public.reports set title='Changed',version=2 where id='ffffffff-0000-4000-8000-0000000000d1'$$,'55000','edit during sending refused');
select pg_temp.ok(not public.codev_finish_report_delivery('ffffffff-0000-4000-8000-0000000000d1',1,'22222222-2222-4222-8222-222222222222','accepted','fake'),'wrong send token refused');
select pg_temp.ok(public.codev_finish_report_delivery('ffffffff-0000-4000-8000-0000000000d1',1,'11111111-1111-4111-8111-111111111111','accepted','fake'),'provider acceptance atomic');
select pg_temp.ok((select status='sent' and delivery->>'state'='accepted' from public.reports where id='ffffffff-0000-4000-8000-0000000000d1'),'accepted is persisted separately from delivery');
select pg_temp.fails($$update public.reports set title='Changed',version=2 where id='ffffffff-0000-4000-8000-0000000000d1'$$,'55000','sent subject frozen');
select pg_temp.ok(not has_table_privilege('authenticated','public.admin_notifications','select'),'notifications server only');
select pg_temp.ok(not has_table_privilege('anon','public.admin_push_subscriptions','select'),'push endpoint private');
select pg_temp.ok((select count(*)=1 from public.admin_notifications where event_key='report:ffffffff-0000-4000-8000-0000000000d1:v1'),'report event once');
select pg_temp.ok(public.codev_unread_notifications('test_admin')=1,'unread persists');
insert into public.admin_notification_reads(notification_id,user_id) select id,'test_admin' from public.admin_notifications;
select pg_temp.ok(public.codev_unread_notifications('test_admin')=0,'read count persists');
select pg_temp.ok(public.codev_unread_notifications('other_admin')=1,'read status user isolated');
insert into public.admin_notification_preferences(user_id,push_enabled,push_categories) values('test_admin',true,array['incident']);
select public.codev_subscribe_push('test_admin','11111111-1111-4111-8111-111111111111','https://fcm.googleapis.com/fake','{}');
insert into public.admin_notifications(event_key,category,href) values('test:incident','incident','/work?kind=incident');
insert into public.admin_notifications(event_key,category,href) values('test:incident','incident','/work?kind=incident') on conflict do nothing;
select pg_temp.ok((select count(*)=1 from public.admin_push_deliveries),'push opt in dedupe');
select pg_temp.ok((select count(*)=1 from public.codev_claim_push('11111111-1111-4111-8111-111111111111',10)),'push reserved');
select pg_temp.ok((select count(*)=0 from public.codev_claim_push('22222222-2222-4222-8222-222222222222',10)),'push concurrent reserve refused');
delete from public.admin_push_subscriptions where user_id='test_admin';
select pg_temp.ok(not exists(select 1 from public.admin_push_deliveries),'revocation drops queued device sends');
select 'ADS_WORKSPACE_CHECKS=' || passed from workspace_checks;
rollback;
