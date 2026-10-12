// Socle Publications multiclient — disposable local PostgreSQL only (never a remote project).
// Rebuilds the production schema snapshot + EVERY migration in order (same chain as codev-core-db), then runs each
// supabase/tests/publications-socle-*.sql suite in its own transaction, rolled back. Two rebuilds prove replayability.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';

const databaseUrl=process.env.PUBLICATIONS_SOCLE_TEST_DATABASE_URL;
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
function environment(database){
 const url=new URL(databaseUrl);
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'loopback only');
 assert.match(url.pathname,/^\/publications_socle_test(?:_[a-z0-9_]+)?$/,'dedicated test database only');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:database??url.pathname.slice(1),PGCONNECT_TIMEOUT:'5'};
 delete env.PGSERVICE;delete env.PGSERVICEFILE;return env;
}
const psql=(env,sql)=>executeLocalSql(process.env.PUBLICATIONS_SOCLE_TEST_PSQL??'psql',env,sql);
function rebuild(){
 const target=environment();
 const admin=psql(environment('postgres'),`drop database if exists ${target.PGDATABASE}; create database ${target.PGDATABASE};`);assert.equal(admin.status,0,admin.stderr);
 const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 const bootstrap=`do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
 end $$;
 create schema if not exists storage;
 create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);\n`;
 const result=psql(target,bootstrap+read('supabase/local/remote-schema.sql')+migrations.map(f=>read(`supabase/migrations/${f}`)).join('\n'));
 assert.equal(result.status,0,result.stderr);return target;
}
const suites=readdirSync(new URL('../supabase/tests/',import.meta.url)).filter(f=>/^publications-socle-.*\.sql$/.test(f)).sort();

test('Socle Publications SQL suites on the full migration chain (two rebuilds)',{skip:!databaseUrl?'PUBLICATIONS_SOCLE_TEST_DATABASE_URL absent: local SQL suites not executed.':false},()=>{
 assert.ok(suites.length>=1);
 for(let i=1;i<=2;i++){
  const env=rebuild();
  for(const suite of suites){
   const marker=suite.replace(/\.sql$/,'').replace(/[^a-z0-9]+/gi,'_').toUpperCase();
   const r=psql(env,'begin;'+read('supabase/tests/remote-replay-helpers.sql')+read(`supabase/tests/${suite}`)+`\nreset role;select '${marker}='||passed from pg_temp.remote_replay;rollback;`);
   assert.equal(r.status,0,`${suite}: ${r.stderr}\n${r.stdout.slice(-2000)}`);
   const found=r.stdout.match(new RegExp(`${marker}=([0-9]+)`));assert.ok(found&&Number(found[1])>0,suite);
   console.log(`${found[0]} (rebuild ${i}/2)`);
  }
 }
});
