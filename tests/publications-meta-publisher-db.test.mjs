import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const P11B='20261012000000_publications_meta_publisher.sql';
test('Lot 4.3 P11-b SQL: twenty-one migrations, reconciliation of uncertain deliveries, unchanged P10 / P11-a / Lot 4 suites (two rebuilds)',{skip:!process.env.PUBLICATIONS_P11B_TEST_DATABASE_URL?'Dedicated local DB not configured':false},()=>{
 const url=new URL(process.env.PUBLICATIONS_P11B_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/publications_p11b_test');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port,PGUSER:url.username,PGDATABASE:'publications_p11b_test',PGPASSWORD:'',PGOPTIONS:''};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^202610.*\.sql$/.test(f)&&f<=P11B).sort();
 assert.equal(files.length,21);assert.equal(files[20],P11B);
 const foundation='begin;'+read('supabase/local/remote-schema.sql')+'reset role;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/remote-replay-fixtures.sql')+`create schema storage authorization postgres;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);alter table storage.buckets owner to postgres;set local role postgres;`+files.slice(0,6).map(f=>read('supabase/migrations/'+f)).join('\n')+read('supabase/tests/publications-review-legacy-fixture.sql')+'set local role postgres;set constraints all immediate;'+files.slice(6,9).map(f=>read('supabase/migrations/'+f)).join('\n')+'reset role;set constraints all deferred;';
 const migrate=f=>'set local role postgres;set constraints all immediate;'+read('supabase/migrations/'+f)+'\nreset role;set constraints all deferred;';
 const through=last=>files.slice(9,files.indexOf(last)+1).map(migrate).join('');
 const command=process.env.PUBLICATIONS_P11B_TEST_PSQL??'psql';
 const run=(sql,marker,label)=>{const r=executeLocalSql(command,env,sql+`select '${marker}='||passed from pg_temp.remote_replay;rollback;`);assert.ifError(r.error);assert.equal(r.status,0,r.stderr+'\n'+r.stdout.slice(-2500));
  const found=r.stdout.match(new RegExp(`${marker}=\\d+`));assert.ok(found,label);console.log(found[0]+'; '+label);};
 const P9='20261009000000_publications_connections.sql',P10='20261010000000_publications_delivery_engine.sql',P11='20261011000000_publications_oauth.sql';
 try{
  for(let i=1;i<=2;i++)run(foundation+through(P9)+read('supabase/tests/publications-delivery-engine-before.sql')+migrate(P10)+migrate(P11)+migrate(P11B)+read('supabase/tests/publications-meta-publisher.sql'),'P11B_CHECKS',`rebuild ${i}/2 passed`);
  run(foundation+through(P9)+read('supabase/tests/publications-delivery-engine-before.sql')+migrate(P10)+migrate(P11)+migrate(P11B)+read('supabase/tests/publications-delivery-engine.sql'),'P10_AFTER_P11B','P10 suite unchanged after P11-b');
  run(foundation+through(P10)+migrate(P11)+migrate(P11B)+read('supabase/tests/publications-oauth.sql'),'P11_AFTER_P11B','P11-a suite unchanged after P11-b');
  run(foundation+through(P11B)+read('supabase/tests/publications-agent.sql'),'AGENT_AFTER_P11B','Lot 4 (Agent v1) suite unchanged after P11-b');
 }finally{const r=executeLocalSql(command,env,'drop schema if exists publications_private cascade;drop schema if exists agent_scope_private cascade;drop schema if exists storage cascade;drop schema public cascade;create schema public authorization postgres;');assert.equal(r.status,0,r.stderr);}
});
