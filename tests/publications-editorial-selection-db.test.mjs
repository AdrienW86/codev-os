// Socle Publications, lots 4-5 — disposable local PostgreSQL only (never a remote project).
// Regression: the Lot 4.3 P8 Agent v2 media suite (finish, claim, attach, fail, approval invariant) still passes once
// EVERY later migration is applied, including the photothèque selection that redefines those RPCs.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';

const databaseUrl=process.env.PUBLICATIONS_SOCLE_TEST_DATABASE_URL;
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const P7='20261008040000_publications_agent_v2.sql',P8='20261008050000_publications_agent_v2_media.sql';

test('Agent v2 media suite (P8) unchanged after the full migration chain (two rebuilds)',{skip:!databaseUrl?'PUBLICATIONS_SOCLE_TEST_DATABASE_URL absent: local SQL suites not executed.':false},()=>{
 const url=new URL(databaseUrl);
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'loopback only');
 assert.match(url.pathname,/^\/publications_socle_test$/,'dedicated test database only');
 const base={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGCONNECT_TIMEOUT:'5'};
 delete base.PGSERVICE;delete base.PGSERVICEFILE;
 const psql=(database,sql)=>executeLocalSql(process.env.PUBLICATIONS_SOCLE_TEST_PSQL??'psql',{...base,PGDATABASE:database},sql);
 const database='publications_socle_test_p8';
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 assert.ok(files.indexOf(P8)>files.indexOf(P7)&&files.at(-1)>P8);
 const foundation='begin;'+read('supabase/local/remote-schema.sql')+'reset role;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/remote-replay-fixtures.sql')
  +'create schema storage authorization postgres;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);alter table storage.buckets owner to postgres;set local role postgres;'
  +files.slice(0,6).map(f=>read('supabase/migrations/'+f)).join('\n')+read('supabase/tests/publications-review-legacy-fixture.sql')
  +'set local role postgres;set constraints all immediate;'+files.slice(6,9).map(f=>read('supabase/migrations/'+f)).join('\n')+'reset role;set constraints all deferred;';
 const migrate=f=>'set local role postgres;set constraints all immediate;'+read('supabase/migrations/'+f)+'\nreset role;set constraints all deferred;';
 const sql=foundation+files.slice(9,files.indexOf(P7)+1).map(migrate).join('')+read('supabase/tests/publications-agent-v2-media-before.sql')+migrate(P8)
  +files.slice(files.indexOf(P8)+1).map(migrate).join('')+read('supabase/tests/publications-agent-v2-media.sql')+"select 'P8_FULL_CHAIN='||passed from pg_temp.remote_replay;rollback;";
 for(let i=1;i<=2;i++){
  const admin=psql('postgres',`drop database if exists ${database}; create database ${database};`);assert.equal(admin.status,0,admin.stderr);
  const r=psql(database,sql);
  assert.equal(r.status,0,r.stderr+'\n'+r.stdout.slice(-2000));
  const found=r.stdout.match(/P8_FULL_CHAIN=(\d+)/);assert.ok(found&&Number(found[1])>0);console.log(`${found[0]} (rebuild ${i}/2)`);
 }
 psql('postgres',`drop database if exists ${database};`);
});
