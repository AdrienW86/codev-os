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
 result=sql(env,`do $$ begin
 perform pg_advisory_xact_lock(761616);
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
 end $$;
 create schema if not exists storage;create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);${read('supabase/local/remote-schema.sql')}${migrations.map(f=>read(`supabase/migrations/${f}`)).join('\n')}${read('e2e/harness/seed.sql')}${read('supabase/tests/ads-recurring-reports.sql')}${read('supabase/tests/ads-recurring-hardening.sql')}`);assert.equal(result.status,0,result.stderr);
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
 result=sql(env,"do $$ begin if (select count(*) from public.report_deliveries)<>1 then raise exception 'Expected exactly one reservation'; end if; end $$;");assert.equal(result.status,0,result.stderr);
});

test('native PostgreSQL: four ticks, competing workers and publication replays remain unique', {skip:databaseUrl?false:'Dedicated disposable loopback PostgreSQL absent'},async()=>{
 const url=new URL(databaseUrl);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/codev_core_test(?:_[a-z0-9_]+)?$/);
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:'codev_core_test_recurring_races',PGCONNECT_TIMEOUT:'5'};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const sql=source=>{const r=executeLocalSql(process.env.CODEV_CORE_TEST_PSQL??'psql',env,source);assert.equal(r.status,0,r.stderr);return r;};
 const created=executeLocalSql(process.env.CODEV_CORE_TEST_PSQL??'psql',{...env,PGDATABASE:'postgres'},'drop database if exists codev_core_test_recurring_races;create database codev_core_test_recurring_races;');assert.equal(created.status,0,created.stderr);
 const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 sql(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);${read('supabase/local/remote-schema.sql')}${migrations.map(f=>read(`supabase/migrations/${f}`)).join('\n')}${read('e2e/harness/seed.sql')}`);
 const fixture=read('supabase/tests/ads-recurring-reports.sql');
 const setup=fixture.slice(fixture.indexOf('create temporary table fixture'),fixture.indexOf('create temporary table occurrence')).replace('create temporary table fixture','create table race_fixture').replaceAll('from fixture','from race_fixture');
 sql(`begin;create function pg_temp.check_true(v boolean,l text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Check failed: %',l;end if;end$$;${setup}commit;`);
 const run=source=>new Promise((resolve,reject)=>{
  const child=spawn(process.env.CODEV_CORE_TEST_PSQL??'psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-c',`begin;${source};select pg_sleep(0.2);commit;`],{env,windowsHide:true});let stdout='',stderr='';const timer=setTimeout(()=>child.kill(),15000);
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',status=>{clearTimeout(timer);resolve({status,stdout:stdout.trim(),stderr});});
 });
 const check=rows=>rows.forEach(row=>assert.equal(row.status,0,row.stderr));
 const enqueue=`select public.codev_enqueue_ads_report(client,1,due,jsonb_build_object('dueAt',due,'prepareAt',prepare,'start','2026-10-02','end','2026-10-08','timezone','Europe/Paris','cutoff','2026-10-09 00:00 exclusive'),due+interval '7 days',prepare+interval '7 days') from race_fixture`;
 const ticks=await Promise.all(Array.from({length:4},()=>run(enqueue)));check(ticks);assert.equal(ticks.filter(t=>t.stdout).length,1);
 sql("do $$ begin if (select count(*) from public.ads_report_occurrences)<>1 or (select count(*) from public.jobs)<>2 then raise exception 'Duplicate tick';end if;end$$;");
 const workers=await Promise.all(Array.from({length:4},(_,i)=>run(`select id from public.codev_claim_jobs('race-worker-${i}',1,300)`)));check(workers);
 const ids=workers.flatMap(w=>w.stdout?w.stdout.split('\n'):[]);assert.equal(ids.length,2);assert.equal(new Set(ids).size,2);
 const content=fixture.slice(fixture.indexOf('create temporary table content'),fixture.indexOf("select pg_temp.check_true(not public.codev_store_ads_report")).replace('create temporary table content','create table race_content');sql(content);
 const publish=`select public.codev_store_ads_report(o.id,j.id,j.worker_id,c.body) from public.ads_report_occurrences o,public.jobs j,race_content c where j.run_type='ads.report.prepare'`;
 const publications=await Promise.all(Array.from({length:4},()=>run(publish)));check(publications);assert.ok(publications.every(p=>p.stdout==='t'));
 sql("do $$ begin if (select count(*) from public.reports)<>1 or (select count(*) from public.report_versions)<>1 then raise exception 'Duplicate publication';end if;end$$;");
 // A replaced lease must fence late failures as well as late successes.
 sql("update public.jobs set worker_id='replacement' where run_type='ads.report.prepare';");
 const stale=await run("select public.codev_record_ads_report_outcome(o.id,j.id,'race-worker-0','prepare','failed','preparation_failed') from public.ads_report_occurrences o,public.jobs j where j.run_type='ads.report.prepare'");check([stale]);assert.equal(stale.stdout,'f');
 sql("do $$ begin if exists(select 1 from public.ads_report_occurrences where preparation<>'ready') then raise exception 'Stale outcome';end if;end$$;");
});
