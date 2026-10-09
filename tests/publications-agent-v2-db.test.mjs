import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const P7='20261008040000_publications_agent_v2.sql';
const snapshot=(name,publications)=>`reset role;
create temporary table ${name} as select jsonb_build_object(${publications}) v;
`;
test('Lot 4.3 P7 SQL: sixteen migrations, archive hardening, Agent v2 runs and atomic batches, unchanged P4-b / P5 / Lot 4 suites (two rebuilds)',{skip:!process.env.PUBLICATIONS_P7_TEST_DATABASE_URL?'Dedicated local DB not configured':false},()=>{
 const url=new URL(process.env.PUBLICATIONS_P7_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/publications_p7_test');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port,PGUSER:url.username,PGDATABASE:'publications_p7_test',PGPASSWORD:'',PGOPTIONS:''};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^202610.*\.sql$/.test(f)&&f<=P7).sort();
 assert.equal(files.length,16);assert.equal(files[15],P7);
 const foundation='begin;'+read('supabase/local/remote-schema.sql')+'reset role;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/remote-replay-fixtures.sql')+`create schema storage authorization postgres;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);alter table storage.buckets owner to postgres;set local role postgres;`+files.slice(0,6).map(f=>read('supabase/migrations/'+f)).join('\n')+read('supabase/tests/publications-review-legacy-fixture.sql')+'set local role postgres;set constraints all immediate;'+files.slice(6,9).map(f=>read('supabase/migrations/'+f)).join('\n')+'reset role;set constraints all deferred;';
 const migrate=f=>'set local role postgres;set constraints all immediate;'+read('supabase/migrations/'+f)+'\nreset role;set constraints all deferred;';
 const through=last=>files.slice(9,files.indexOf(last)+1).map(migrate).join('');
 const command=process.env.PUBLICATIONS_P7_TEST_PSQL??'psql';
 const run=(sql,marker,label)=>{const r=executeLocalSql(command,env,sql+`select '${marker}='||passed from pg_temp.remote_replay;rollback;`);assert.ifError(r.error);assert.equal(r.status,0,r.stderr+'\n'+r.stdout.slice(-2500));
  const found=r.stdout.match(new RegExp(`${marker}=\\d+`));assert.ok(found,label);console.log(found[0]+'; '+label);};
 const P5='20261008030000_publications_archiving.sql';
 try{
  for(let i=1;i<=2;i++)run(foundation+through(P5)+snapshot('p7_before',`'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),'events',(select count(*) from public.publication_events)`)
   +migrate(P7)+read('supabase/tests/publications-agent-v2.sql'),'P7_CHECKS',`rebuild ${i}/2 passed`);
  // Regressions: the P4-b and P5 suites still pass once P7 is applied (shared creation logic, archive guards).
  run(foundation+through(P5)+snapshot('p4b_before',`'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),'variants',(select count(*) from public.publication_variants),
   'groups',(select count(*) from public.publication_editorial_groups),'occurrences',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.publication_channel_occurrences o),'events',(select count(*) from public.publication_events)`)
   +migrate(P7)+read('supabase/tests/publications-occurrence-publications.sql'),'P4B_AFTER_P7','P4-b suite unchanged after P7');
  run(foundation+through(P5)+snapshot('p5_before',`'publications',(select coalesce(jsonb_agg(to_jsonb(p)-'archived_at'-'archived_by' order by p.id),'[]') from public.publications p),'events',(select count(*) from public.publication_events)`)
   +migrate(P7)+read('supabase/tests/publications-archiving.sql'),'P5_AFTER_P7','P5 suite unchanged after P7');
  run(foundation+through(P7)+read('supabase/tests/publications-agent.sql'),'AGENT_AFTER_P7','Lot 4 suite unchanged after P7');
 }finally{const r=executeLocalSql(command,env,'drop schema if exists publications_private cascade;drop schema if exists agent_scope_private cascade;drop schema if exists storage cascade;drop schema public cascade;create schema public authorization postgres;');assert.equal(r.status,0,r.stderr);}
});
