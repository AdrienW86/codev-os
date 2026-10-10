// Optional native PostgreSQL validation. The PGlite replay is single-connection, not a substitute for this race.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';
const databaseUrl=process.env.CODEV_CORE_TEST_DATABASE_URL;
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
test('native PostgreSQL: full recurring assertions and four independent reservations yield exactly one send', {skip:databaseUrl?false:'Dedicated disposable loopback PostgreSQL absent'},async()=>{
 const url=new URL(databaseUrl);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/codev_core_test(?:_[a-z0-9_]+)?$/);
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:'codev_core_test_recurring',PGCONNECT_TIMEOUT:'5'};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const sql=(target,source)=>executeLocalSql(process.env.CODEV_CORE_TEST_PSQL??'psql',target,source);
 let result=sql({...env,PGDATABASE:'postgres'},'drop database if exists codev_core_test_recurring;create database codev_core_test_recurring;');assert.equal(result.status,0,result.stderr);
 const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 result=sql(env,`create schema if not exists storage;create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);${read('supabase/local/remote-schema.sql')}${migrations.map(f=>read(`supabase/migrations/${f}`)).join('\n')}${read('e2e/harness/seed.sql')}${read('supabase/tests/ads-recurring-reports.sql')}`);assert.equal(result.status,0,result.stderr);
 const fixture=read('supabase/tests/ads-recurring-reports.sql');
 // Reuse the valid fixture through publication/approval, before the sequential reservation checks.
 const start=fixture.slice(fixture.indexOf('create temporary table fixture'),fixture.indexOf("select pg_temp.check_true(not public.codev_claim_recurring_delivery(o.id,j.id,'worker-A',r.id,1,gen_random_uuid(),'changed"));
 result=sql(env,`begin;create function pg_temp.check_true(v boolean,l text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Check failed: %',l;end if;end$$;${start}commit;`);assert.equal(result.status,0,result.stderr);
 const race=()=>new Promise((resolve,reject)=>{
  const source=`begin;select public.codev_claim_recurring_delivery(o.id,j.id,'worker-A',r.id,1,gen_random_uuid(),'reports@example.invalid',r.title,'Résumé de test',r.client_content) from public.ads_report_occurrences o,public.jobs j,public.reports r where j.run_type='ads.report.send' and r.id=o.report_id;select pg_sleep(0.2);commit;`;
  const child=spawn(process.env.CODEV_CORE_TEST_PSQL??'psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-c',source],{env,windowsHide:true});let stdout='',stderr='';const timer=setTimeout(()=>child.kill(),15000);
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr});});
 });
 const attempts=await Promise.all([race(),race(),race(),race()]);attempts.forEach(a=>assert.equal(a.status,0,a.stderr));
 assert.deepEqual(attempts.map(a=>a.stdout.trim()).sort(),['f','f','f','t']);
 result=sql(env,'select count(*) from public.report_deliveries;');assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'1');
});
