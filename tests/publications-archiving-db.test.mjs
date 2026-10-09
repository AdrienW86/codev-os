import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const P1='20261007120000_publications_project_channels.sql',P2A='20261007130000_publications_channel_schedules.sql',P3='20261008000000_publications_channel_occurrences.sql',P4A='20261008010000_publications_editorial_groups.sql',P4B='20261008020000_publications_occurrence_publications.sql',P5='20261008030000_publications_archiving.sql';
// Snapshot taken just before P5: publications and audit must be unchanged by it.
const beforeP5=`reset role;
create temporary table p5_before as select jsonb_build_object(
 'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),
 'events',(select count(*) from public.publication_events)) v;
`;
test('Lot 4.3 P5 SQL: fifteen migrations, one-way publication archiving, history intact, atomicity, unchanged downstream (two rebuilds)',{skip:!process.env.PUBLICATIONS_P5_TEST_DATABASE_URL?'Dedicated local DB not configured':false},()=>{
 const url=new URL(process.env.PUBLICATIONS_P5_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/publications_p5_test');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port,PGUSER:url.username,PGDATABASE:'publications_p5_test',PGPASSWORD:'',PGOPTIONS:''};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^202610.*\.sql$/.test(f)&&f<=P5).sort();// P5 scope: later migrations have their own suites
 assert.equal(files.length,15);assert.equal(files[13],P4B);assert.equal(files[14],P5);
 const foundation='begin;'+read('supabase/local/remote-schema.sql')+'reset role;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/remote-replay-fixtures.sql')+`create schema storage authorization postgres;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);alter table storage.buckets owner to postgres;set local role postgres;`+files.slice(0,6).map(f=>read('supabase/migrations/'+f)).join('\n')+read('supabase/tests/publications-review-legacy-fixture.sql')+'set local role postgres;set constraints all immediate;'+files.slice(6,9).map(f=>read('supabase/migrations/'+f)).join('\n')+'reset role;set constraints all deferred;';
 const migrate=f=>'set local role postgres;set constraints all immediate;'+read('supabase/migrations/'+f)+'\nreset role;set constraints all deferred;';
 const command=process.env.PUBLICATIONS_P5_TEST_PSQL??'psql',agent=read('supabase/tests/publications-agent.sql'),checks=read('supabase/tests/publications-archiving.sql');
 try{
  for(let i=1;i<=2;i++){const result=executeLocalSql(command,env,foundation+agent+'reset role;'+migrate(P1)+migrate(P2A)+migrate(P3)+migrate(P4A)+migrate(P4B)+beforeP5+migrate(P5)+checks+"select 'P5_CHECKS='||passed from pg_temp.remote_replay;rollback;");
   assert.ifError(result.error);assert.equal(result.status,0,result.stderr+'\n'+result.stdout.slice(-2500));assert.match(result.stdout,/P5_CHECKS=\d+/);console.log(result.stdout.match(/P5_CHECKS=\d+/)[0]+`; rebuild ${i}/2 passed`);}
  // Downstream regression: the Lot 4 agent/calendar suite still passes with P1 … P5 applied first.
  const downstream=executeLocalSql(command,env,foundation+migrate(P1)+migrate(P2A)+migrate(P3)+migrate(P4A)+migrate(P4B)+migrate(P5)+agent+"select 'AGENT_AFTER_P5='||passed from pg_temp.remote_replay;rollback;");
  assert.ifError(downstream.error);assert.equal(downstream.status,0,downstream.stderr+'\n'+downstream.stdout.slice(-2500));console.log(downstream.stdout.match(/AGENT_AFTER_P5=\d+/)[0]+'; Lot 4 suite unchanged after P5');
 }finally{const r=executeLocalSql(command,env,'drop schema if exists publications_private cascade;drop schema if exists agent_scope_private cascade;drop schema if exists storage cascade;drop schema public cascade;create schema public authorization postgres;');assert.equal(r.status,0,r.stderr);}
});
