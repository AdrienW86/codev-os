import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {Worker} from 'node:worker_threads';
import {executeLocalSql} from './helpers/local-postgres.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const P11='20261011000000_publications_oauth.sql';
test('Lot 4.3 P11-a SQL: twenty migrations, encrypted vault table, single-use OAuth states, audit, concurrent consumption, unchanged P10 / P9 / Lot 4 suites (two rebuilds)',{skip:!process.env.PUBLICATIONS_P11_TEST_DATABASE_URL?'Dedicated local DB not configured':false},async()=>{
 const url=new URL(process.env.PUBLICATIONS_P11_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/publications_p11_test');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port,PGUSER:url.username,PGDATABASE:'publications_p11_test',PGPASSWORD:'',PGOPTIONS:''};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^202610.*\.sql$/.test(f)&&f<=P11).sort();
 assert.equal(files.length,20);assert.equal(files[19],P11);
 const foundation='begin;'+read('supabase/local/remote-schema.sql')+'reset role;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/remote-replay-fixtures.sql')+`create schema storage authorization postgres;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);alter table storage.buckets owner to postgres;set local role postgres;`+files.slice(0,6).map(f=>read('supabase/migrations/'+f)).join('\n')+read('supabase/tests/publications-review-legacy-fixture.sql')+'set local role postgres;set constraints all immediate;'+files.slice(6,9).map(f=>read('supabase/migrations/'+f)).join('\n')+'reset role;set constraints all deferred;';
 const migrate=f=>'set local role postgres;set constraints all immediate;'+read('supabase/migrations/'+f)+'\nreset role;set constraints all deferred;';
 const through=last=>files.slice(9,files.indexOf(last)+1).map(migrate).join('');
 const command=process.env.PUBLICATIONS_P11_TEST_PSQL??'psql';
 const run=(sql,marker,label)=>{const r=executeLocalSql(command,env,sql+`select '${marker}='||passed from pg_temp.remote_replay;rollback;`);assert.ifError(r.error);assert.equal(r.status,0,r.stderr+'\n'+r.stdout.slice(-2500));
  const found=r.stdout.match(new RegExp(`${marker}=\\d+`));assert.ok(found,label);console.log(found[0]+'; '+label);};
 const P8='20261008050000_publications_agent_v2_media.sql',P9='20261009000000_publications_connections.sql',P10='20261010000000_publications_delivery_engine.sql';
 const session=sql=>new Promise((resolve,reject)=>{const w=new Worker(`const {parentPort,workerData}=require('node:worker_threads');import(workerData.helper).then(({executeLocalSql})=>parentPort.postMessage(executeLocalSql(workerData.command,workerData.env,workerData.sql)));`,
  {eval:true,workerData:{helper:new URL('./helpers/local-postgres.mjs',import.meta.url).href,command,env,sql}});w.once('message',resolve);w.once('error',reject);});
 try{
  for(let i=1;i<=2;i++)run(foundation+through(P10)+migrate(P11)+read('supabase/tests/publications-oauth.sql'),'P11_CHECKS',`rebuild ${i}/2 passed`);
  run(foundation+through(P9)+read('supabase/tests/publications-delivery-engine-before.sql')+migrate(P10)+migrate(P11)+read('supabase/tests/publications-delivery-engine.sql'),'P10_AFTER_P11','P10 suite unchanged after P11');
  run(foundation+through(P8)+read('supabase/tests/publications-connections-before.sql')+migrate(P9)+migrate(P10)+migrate(P11)+read('supabase/tests/publications-connections.sql'),'P9_AFTER_P11','P9 suite unchanged after P11');
  run(foundation+through(P11)+read('supabase/tests/publications-agent.sql'),'AGENT_AFTER_P11','Lot 4 (Agent v1) suite unchanged after P11');
  // Two callbacks racing on the same state: exactly one consumption succeeds.
  const setup=executeLocalSql(command,env,foundation+through(P11)+`
   insert into public.clients(id,name) values('11000000-0000-4000-8000-000000000011','P11 race');
   set local role service_role;
   select public.publication_oauth_state_create('meta','11000000-0000-4000-8000-000000000011',null,encode(sha256(convert_to('race-state','UTF8')),'hex'),'user_admin');
   reset role;commit;`);
  assert.equal(setup.status,0,setup.stderr+'\n'+setup.stdout.slice(-1500));
  const consumer=`begin;set local role service_role;\\set ON_ERROR_STOP 0
   select 'CONSUMED='||(public.publication_oauth_state_consume('meta',encode(sha256(convert_to('race-state','UTF8')),'hex'),'user_admin')->>'status');select pg_sleep(0.3);commit;`;
  const outs=(await Promise.all([session(consumer),session(consumer)])).map(r=>r.stdout+r.stderr);
  assert.equal(outs.filter(o=>/CONSUMED=valid/.test(o)).length,1,'one callback wins');assert.equal(outs.filter(o=>/already used/.test(o)).length,1,'the other one is refused');
  console.log('Two simultaneous callbacks on one state: one valid consumption, one refusal.');
 }finally{const r=executeLocalSql(command,env,'drop schema if exists publications_private cascade;drop schema if exists agent_scope_private cascade;drop schema if exists storage cascade;drop schema public cascade;create schema public authorization postgres;');assert.equal(r.status,0,r.stderr);}
});
