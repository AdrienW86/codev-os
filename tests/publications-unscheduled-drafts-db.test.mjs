// Brouillons non planifiés (photothèque WhatsApp) — disposable local PostgreSQL only.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const P13='20261014000000_publications_account_client_exclusivity.sql',UD='20261025000000_publications_unscheduled_drafts.sql';
test('Unscheduled drafts SQL: additive migration after P13, no slot consumed, delivery refused, unchanged P13 / P10 / chaos / Lot 4 suites (two rebuilds)',{skip:!process.env.PUBLICATIONS_UNSCHEDULED_TEST_DATABASE_URL?'Dedicated local DB not configured':false},()=>{
 const url=new URL(process.env.PUBLICATIONS_UNSCHEDULED_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/publications_unscheduled_test');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port,PGUSER:url.username,PGDATABASE:'publications_unscheduled_test',PGPASSWORD:'',PGOPTIONS:''};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^202610.*\.sql$/.test(f)&&f<=P13).sort();
 assert.equal(files.length,23);assert.equal(files[22],P13);assert.ok(readdirSync(new URL('../supabase/migrations/',import.meta.url)).includes(UD));
 const foundation='begin;'+read('supabase/local/remote-schema.sql')+'reset role;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/remote-replay-fixtures.sql')+`create schema storage authorization postgres;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);alter table storage.buckets owner to postgres;set local role postgres;`+files.slice(0,6).map(f=>read('supabase/migrations/'+f)).join('\n')+read('supabase/tests/publications-review-legacy-fixture.sql')+'set local role postgres;set constraints all immediate;'+files.slice(6,9).map(f=>read('supabase/migrations/'+f)).join('\n')+'reset role;set constraints all deferred;';
 const migrate=f=>'set local role postgres;set constraints all immediate;'+read('supabase/migrations/'+f)+'\nreset role;set constraints all deferred;';
 const through=last=>files.slice(9,files.indexOf(last)+1).map(migrate).join('');
 const command=process.env.PUBLICATIONS_UNSCHEDULED_TEST_PSQL??'psql';
 const run=(sql,marker,label)=>{const r=executeLocalSql(command,env,sql+`select '${marker}='||passed from pg_temp.remote_replay;rollback;`);assert.ifError(r.error);assert.equal(r.status,0,r.stderr+'\n'+r.stdout.slice(-2500));
  const found=r.stdout.match(new RegExp(`${marker}=[0-9]+`));assert.ok(found,label);console.log(found[0]+'; '+label);return Number(found[0].split('=')[1]);};
 const P9='20261009000000_publications_connections.sql',P10='20261010000000_publications_delivery_engine.sql',P11='20261011000000_publications_oauth.sql',P11B='20261012000000_publications_meta_publisher.sql',P12='20261013000000_publications_gbp_publisher.sql';
 const after=suite=>foundation+through(P9)+read('supabase/tests/publications-delivery-engine-before.sql')+migrate(P10)+migrate(P11)+migrate(P11B)+migrate(P12)+migrate(P13)+migrate(UD)+read(suite);
 try{
  for(let i=1;i<=2;i++)assert.ok(run(after('supabase/tests/publications-unscheduled-drafts.sql'),'UD_CHECKS',`rebuild ${i}/2 passed`)===28);
  run(after('supabase/tests/publications-account-exclusivity.sql'),'P13_AFTER_UD','P13 suite unchanged after the migration');
  run(after('supabase/tests/publications-delivery-engine.sql'),'P10_AFTER_UD','P10 suite unchanged after the migration');
  run(after('supabase/tests/publications-chaos.sql'),'CHAOS_AFTER_UD','chaos suite unchanged after the migration');
  run(foundation+through(P13)+migrate(UD)+read('supabase/tests/publications-agent.sql'),'AGENT_AFTER_UD','Lot 4 (Agent v1) suite unchanged after the migration');
 }finally{const r=executeLocalSql(command,env,'drop schema if exists publications_private cascade;drop schema if exists agent_scope_private cascade;drop schema if exists storage cascade;drop schema public cascade;create schema public authorization postgres;');assert.equal(r.status,0,r.stderr);}
});
