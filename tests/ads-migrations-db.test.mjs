import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { executeLocalSql } from './helpers/local-postgres.mjs';
const databaseUrl=process.env.CODEV_CORE_TEST_DATABASE_URL;
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const targets=[
 ['20261016000000_google_ads_reports.sql',[],['reports_scope_guard']],
 ['20261016000001_whatsapp_drive_ingestion.sql',['whatsapp_senders','whatsapp_inbox','whatsapp_assets'],['whatsapp_claim']],
 ['20261017000000_google_ads_campaign_tracking.sql',['client_ads_scopes','client_ads_campaigns'],['codev_set_ads_campaigns']],
 ['20261018000000_google_ads_client_context.sql',['client_ads_context','ads_analysis_leases'],['codev_claim_ads_analysis']],
 ['20261019000000_report_delivery_claims.sql',['report_deliveries'],['codev_claim_report_delivery','codev_finish_report_delivery','report_version_snapshot']],
 ['20261020000000_notifications_web_push.sql',['admin_notifications','admin_notification_reads','admin_notification_preferences','admin_push_subscriptions','admin_push_deliveries'],['codev_claim_push']],
 ['20261020000001_ads_recurring_reports.sql',['client_ads_report_settings','ads_report_occurrences'],['codev_enqueue_ads_report','codev_store_ads_report','codev_claim_recurring_delivery']],
 ['20261021000000_ads_recurring_hardening.sql',[],['codev_record_ads_report_outcome']],
];
test('native PostgreSQL: migrate one file at a time, inspect catalog, RLS, grants and preserved rows', {skip:databaseUrl?false:'Dedicated disposable loopback PostgreSQL absent'},()=>{
 const url=new URL(databaseUrl);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/codev_core_test(?:_[a-z0-9_]+)?$/);
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:'codev_core_test_ads_migrations',PGCONNECT_TIMEOUT:'5'};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const bin=process.env.CODEV_CORE_TEST_PSQL??'psql';
 const sql=(source,target=env)=>{const r=executeLocalSql(bin,target,source);assert.equal(r.status,0,r.stderr);return r;};
 const query=source=>{const r=spawnSync(bin,['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-c',source],{env,encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 sql('drop database if exists codev_core_test_ads_migrations;create database codev_core_test_ads_migrations;',{...env,PGDATABASE:'postgres'});
 const historical=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')&&f<targets[0][0]).sort();
 sql(`do $$ begin
 perform pg_advisory_xact_lock(761616);
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
 end $$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);${read('supabase/local/remote-schema.sql')}${historical.map(f=>read(`supabase/migrations/${f}`)).join('\n')}${read('e2e/harness/seed.sql')}
 insert into public.reports(client_id,kind,period_start,period_end,title,summary,status) values('11111111-1111-4111-8111-111111111111','weekly','2026-09-01','2026-09-07','Historical weekly','Preserved','ready_for_review');`);
 const fingerprints=`select json_build_array(
 (select md5(coalesce(json_agg(row(id,name,email) order by id)::text,'')) from public.clients),
 (select md5(coalesce(json_agg(row(id,title,status) order by id)::text,'')) from public.tasks),
 (select md5(coalesce(json_agg(row(id,client_id,kind,period_start,period_end,title,summary,status,version) order by id)::text,'')) from public.reports),
 (select md5(coalesce(json_agg(row(id,client_id,external_account_id,metadata) order by id)::text,'')) from public.client_connections))`;
 const original=query(fingerprints),seen=[];
 for(const [file,tables,functions] of targets){
  const source=read(`supabase/migrations/${file}`);
  assert.doesNotMatch(source,/\bdrop\s+(?:table|schema|column|database)\b|\btruncate\b/i,'no destructive DDL');
  sql(`begin;${source}\ncommit;`);
  assert.equal(query(fingerprints),original,`${file}: existing rows preserved`);
  seen.push(...tables);
  for(const table of seen){
   assert.equal(query(`select relrowsecurity and not has_table_privilege('anon',oid,'SELECT') and not has_table_privilege('authenticated',oid,'UPDATE') and has_table_privilege('service_role',oid,'SELECT') from pg_class where oid='public.${table}'::regclass`),'t',`${file}: ${table} RLS/grants`);
  }
  for(const name of functions){
   assert.equal(query(`select bool_and(not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE') and has_function_privilege('service_role',p.oid,'EXECUTE') and not p.prosecdef) from pg_proc p where p.proname='${name}'`),'t',`${file}: ${name} grants/invoker`);
  }
  const catalog=query("select json_build_object('tables',(select count(*) from pg_tables where schemaname='public'),'columns',(select count(*) from information_schema.columns where table_schema='public'),'indexes',(select count(*) from pg_indexes where schemaname='public'),'constraints',(select count(*) from pg_constraint where connamespace='public'::regnamespace),'functions',(select count(*) from pg_proc where pronamespace in ('public'::regnamespace,'codev_private'::regnamespace)))");
  const summary=JSON.parse(catalog);assert.ok(Object.values(summary).every(value=>value>0));
  console.log(`${file}: catalog=${catalog}; existing row fingerprints unchanged; RLS/grants verified`);
 }
 assert.equal(query("select count(*) from information_schema.columns where table_schema='public' and table_name in ('reports','report_versions') and column_name='scope'"),'2');
 assert.equal(query("select count(*) from pg_indexes where schemaname='public' and indexname in ('reports_unique_recurring_period','ads_report_settings_due','ads_report_occurrences_client')"),'3');
 assert.equal(query("select count(*) from pg_constraint where conrelid='public.reports'::regclass and conname in ('reports_kind_check','reports_google_ads_scope_check','reports_scope_check')"),'3');
});
