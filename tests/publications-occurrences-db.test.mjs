import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const P1='20261007120000_publications_project_channels.sql',P2A='20261007130000_publications_channel_schedules.sql',P3='20261008000000_publications_channel_occurrences.sql';
// Snapshot taken just before P3: legacy calendar, publications, channels, schedules and audit must be unchanged by it.
const beforeP3=`reset role;
create temporary table p3_before as select jsonb_build_object(
 'cadences',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_cadences c),
 'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.publication_calendar_slots s),
 'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),
 'channels',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_project_channels c),
 'schedule_slots',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_channel_schedule_slots c),
 'events',(select count(*) from public.publication_events)) v;
`;
test('Lot 4.3 P3 SQL: twelve migrations, dated channel occurrences, idempotence, DST, immutability, audit, atomicity, unchanged downstream (two rebuilds)',{skip:!process.env.PUBLICATIONS_OCCURRENCES_TEST_DATABASE_URL?'Dedicated local DB not configured':false},()=>{
 const url=new URL(process.env.PUBLICATIONS_OCCURRENCES_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/publications_occurrences_test');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port,PGUSER:url.username,PGDATABASE:'publications_occurrences_test',PGPASSWORD:'',PGOPTIONS:''};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^202610.*\.sql$/.test(f)&&f<=P3).sort();// P3 scope: later migrations have their own suites
 assert.equal(files.length,12);assert.equal(files[9],P1);assert.equal(files[10],P2A);assert.equal(files[11],P3);
 const foundation='begin;'+read('supabase/local/remote-schema.sql')+'reset role;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/remote-replay-fixtures.sql')+`create schema storage authorization postgres;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);alter table storage.buckets owner to postgres;set local role postgres;`+files.slice(0,6).map(f=>read('supabase/migrations/'+f)).join('\n')+read('supabase/tests/publications-review-legacy-fixture.sql')+'set local role postgres;set constraints all immediate;'+files.slice(6,9).map(f=>read('supabase/migrations/'+f)).join('\n')+'reset role;set constraints all deferred;';
 const migrate=f=>'set local role postgres;set constraints all immediate;'+read('supabase/migrations/'+f)+'\nreset role;set constraints all deferred;';
 const command=process.env.PUBLICATIONS_OCCURRENCES_TEST_PSQL??'psql',agent=read('supabase/tests/publications-agent.sql'),checks=read('supabase/tests/publications-occurrences.sql');
 try{
  for(let i=1;i<=2;i++){const result=executeLocalSql(command,env,foundation+agent+'reset role;'+migrate(P1)+migrate(P2A)+beforeP3+migrate(P3)+checks+"select 'OCCURRENCE_CHECKS='||passed from pg_temp.remote_replay;rollback;");
   assert.ifError(result.error);assert.equal(result.status,0,result.stderr+'\n'+result.stdout.slice(-2500));assert.match(result.stdout,/OCCURRENCE_CHECKS=\d+/);console.log(result.stdout.match(/OCCURRENCE_CHECKS=\d+/)[0]+`; rebuild ${i}/2 passed`);}
  // Downstream regression: the Lot 4 agent/calendar suite still passes with P1 + P2-a + P3 applied first.
  const downstream=executeLocalSql(command,env,foundation+migrate(P1)+migrate(P2A)+migrate(P3)+agent+"select 'AGENT_AFTER_P3='||passed from pg_temp.remote_replay;rollback;");
  assert.ifError(downstream.error);assert.equal(downstream.status,0,downstream.stderr+'\n'+downstream.stdout.slice(-2500));console.log(downstream.stdout.match(/AGENT_AFTER_P3=\d+/)[0]+'; Lot 4 suite unchanged after P3');
 }finally{const r=executeLocalSql(command,env,'drop schema if exists publications_private cascade;drop schema if exists agent_scope_private cascade;drop schema if exists storage cascade;drop schema public cascade;create schema public authorization postgres;');assert.equal(r.status,0,r.stderr);}
});
