import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const P1='20261007120000_publications_project_channels.sql',P2A='20261007130000_publications_channel_schedules.sql';
// Snapshot taken just before P2-a: legacy calendar, publications, channels and audit must be unchanged by it.
const beforeP2=`reset role;
create temporary table p2_before as select jsonb_build_object(
 'cadences',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_cadences c),
 'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.publication_calendar_slots s),
 'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),
 'channels',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_project_channels c),
 'events',(select count(*) from public.publication_events)) v;
`;
test('Lot 4.3 P2-a SQL: eleven migrations, channel schedules and slots, sync, audit, atomicity, unchanged downstream (two rebuilds)',{skip:!process.env.PUBLICATIONS_SCHEDULES_TEST_DATABASE_URL?'Dedicated local DB not configured':false},()=>{
 const url=new URL(process.env.PUBLICATIONS_SCHEDULES_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/publications_schedules_test');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port,PGUSER:url.username,PGDATABASE:'publications_schedules_test',PGPASSWORD:'',PGOPTIONS:''};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^202610.*\.sql$/.test(f)&&f<=P2A).sort();// P2-a scope: later migrations have their own suites
 assert.equal(files.length,11);assert.equal(files[9],P1);assert.equal(files[10],P2A);
 const foundation='begin;'+read('supabase/local/remote-schema.sql')+'reset role;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/remote-replay-fixtures.sql')+`create schema storage authorization postgres;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);alter table storage.buckets owner to postgres;set local role postgres;`+files.slice(0,6).map(f=>read('supabase/migrations/'+f)).join('\n')+read('supabase/tests/publications-review-legacy-fixture.sql')+'set local role postgres;set constraints all immediate;'+files.slice(6,9).map(f=>read('supabase/migrations/'+f)).join('\n')+'reset role;set constraints all deferred;';
 const migrate=f=>'set local role postgres;set constraints all immediate;'+read('supabase/migrations/'+f)+'\nreset role;set constraints all deferred;';
 const command=process.env.PUBLICATIONS_SCHEDULES_TEST_PSQL??'psql',agent=read('supabase/tests/publications-agent.sql'),checks=read('supabase/tests/publications-schedules.sql');
 try{
  for(let i=1;i<=2;i++){const result=executeLocalSql(command,env,foundation+agent+'reset role;'+migrate(P1)+beforeP2+migrate(P2A)+checks+"select 'SCHEDULE_CHECKS='||passed from pg_temp.remote_replay;rollback;");
   assert.ifError(result.error);assert.equal(result.status,0,result.stderr+'\n'+result.stdout.slice(-2500));assert.match(result.stdout,/SCHEDULE_CHECKS=\d+/);console.log(result.stdout.match(/SCHEDULE_CHECKS=\d+/)[0]+`; rebuild ${i}/2 passed`);}
  // Downstream regression: the Lot 4 agent/calendar suite still passes with P1 + P2-a applied first.
  const downstream=executeLocalSql(command,env,foundation+migrate(P1)+migrate(P2A)+agent+"select 'AGENT_AFTER_P2A='||passed from pg_temp.remote_replay;rollback;");
  assert.ifError(downstream.error);assert.equal(downstream.status,0,downstream.stderr+'\n'+downstream.stdout.slice(-2500));console.log(downstream.stdout.match(/AGENT_AFTER_P2A=\d+/)[0]+'; Lot 4 suite unchanged after P2-a');
 }finally{const r=executeLocalSql(command,env,'drop schema if exists publications_private cascade;drop schema if exists agent_scope_private cascade;drop schema if exists storage cascade;drop schema public cascade;create schema public authorization postgres;');assert.equal(r.status,0,r.stderr);}
});
