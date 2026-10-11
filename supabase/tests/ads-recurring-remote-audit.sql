-- READ ONLY: safe catalog/ID audit before and after EACH migration. No bodies or secrets.
select current_database() as database, current_setting('server_version') as postgres_version;
select relname,relrowsecurity,relforcerowsecurity,
 has_table_privilege('anon',c.oid,'SELECT') as anon_select,
 has_table_privilege('authenticated',c.oid,'UPDATE') as browser_update,
 has_table_privilege('service_role',c.oid,'SELECT') as server_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relname in
 ('reports','report_versions','whatsapp_senders','whatsapp_inbox','whatsapp_assets','client_ads_scopes','client_ads_campaigns','client_ads_context','ads_analysis_leases','report_deliveries','admin_notifications','admin_notification_reads','admin_notification_preferences','admin_push_subscriptions','admin_push_deliveries','client_ads_report_settings','ads_report_occurrences') order by relname;
select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns
where table_schema='public' and table_name in ('reports','report_versions','report_deliveries','client_ads_report_settings','ads_report_occurrences') order by table_name,ordinal_position;
select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('reports','report_versions','report_deliveries','client_ads_report_settings','ads_report_occurrences') order by tablename,indexname;
select c.conrelid::regclass as table_name,c.conname,pg_get_constraintdef(c.oid) as definition,c.convalidated
from pg_constraint c where c.connamespace='public'::regnamespace and c.conrelid::regclass::text in
 ('reports','report_versions','report_deliveries','client_ads_report_settings','ads_report_occurrences','admin_notifications') order by table_name,conname;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as browser_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') as server_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','codev_private') and p.proname in
 ('codev_claim_jobs','codev_save_ads_report_settings','codev_enqueue_ads_report','codev_store_ads_report','codev_claim_recurring_delivery','codev_record_ads_report_outcome','codev_claim_report_delivery','codev_finish_report_delivery','reports_scope_guard','report_delivery_guard','report_version_snapshot','ads_occurrence_guard') order by p.proname;
select tgrelid::regclass as table_name,tgname,pg_get_triggerdef(oid) from pg_trigger
where not tgisinternal and tgrelid::regclass::text in ('reports','report_deliveries','ads_report_occurrences') order by table_name,tgname;
-- Counts, not report text. Compare to the secured backup/copy, preserving existing rows.
select (select count(*) from public.clients) as clients,
 (select count(*) from public.reports) as reports,
 (select count(*) from public.report_versions) as versions,
 (select count(*) from public.jobs) as jobs;
-- Never infer the pilot ID or use the documented historical account without this live check.
select c.id as client_id,c.name,cc.id as connection_id,cc.external_account_id,cc.status,
 cc.metadata->>'timezone' as documented_account_timezone
from public.clients c left join public.client_connections cc on cc.client_id=c.id and cc.provider='google_ads'
where lower(trim(c.name))='protection nuisibles';
