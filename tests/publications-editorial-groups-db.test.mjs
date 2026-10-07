import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const P1='20261007120000_publications_project_channels.sql',P2A='20261007130000_publications_channel_schedules.sql',P3='20261008000000_publications_channel_occurrences.sql',P4A='20261008010000_publications_editorial_groups.sql';
// Snapshot taken just before P4-a: publications (without the new columns), variants, occurrences, legacy calendar and audit.
const beforeP4=`reset role;
create temporary table p4_before as select jsonb_build_object(
 'variants',(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') from public.publication_variants v),
 'occurrences',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.publication_channel_occurrences o),
 'cadences',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_cadences c),
 'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.publication_calendar_slots s),
 'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),
 'channels',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_project_channels c),
 'schedule_slots',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.publication_channel_schedule_slots c),
 'events',(select count(*) from public.publication_events)) v;
`;
test('Lot 4.3 P4-a SQL: thirteen migrations, editorial groups, mono-platform publications bound to occurrences, legacy intact, unchanged downstream (two rebuilds)',{skip:!process.env.PUBLICATIONS_GROUPS_TEST_DATABASE_URL?'Dedicated local DB not configured':false},()=>{
 const url=new URL(process.env.PUBLICATIONS_GROUPS_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/publications_groups_test');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port,PGUSER:url.username,PGDATABASE:'publications_groups_test',PGPASSWORD:'',PGOPTIONS:''};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^202610.*\.sql$/.test(f)).sort();
 assert.equal(files.length,13);assert.equal(files[9],P1);assert.equal(files[10],P2A);assert.equal(files[11],P3);assert.equal(files[12],P4A);
 const foundation='begin;'+read('supabase/local/remote-schema.sql')+'reset role;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/remote-replay-fixtures.sql')+`create schema storage authorization postgres;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);alter table storage.buckets owner to postgres;set local role postgres;`+files.slice(0,6).map(f=>read('supabase/migrations/'+f)).join('\n')+read('supabase/tests/publications-review-legacy-fixture.sql')+'set local role postgres;set constraints all immediate;'+files.slice(6,9).map(f=>read('supabase/migrations/'+f)).join('\n')+'reset role;set constraints all deferred;';
 const migrate=f=>'set local role postgres;set constraints all immediate;'+read('supabase/migrations/'+f)+'\nreset role;set constraints all deferred;';
 const command=process.env.PUBLICATIONS_GROUPS_TEST_PSQL??'psql',agent=read('supabase/tests/publications-agent.sql'),checks=read('supabase/tests/publications-editorial-groups.sql');
 try{
  for(let i=1;i<=2;i++){const result=executeLocalSql(command,env,foundation+agent+'reset role;'+migrate(P1)+migrate(P2A)+migrate(P3)+beforeP4+migrate(P4A)+checks+"select 'GROUP_CHECKS='||passed from pg_temp.remote_replay;rollback;");
   assert.ifError(result.error);assert.equal(result.status,0,result.stderr+'\n'+result.stdout.slice(-2500));assert.match(result.stdout,/GROUP_CHECKS=\d+/);console.log(result.stdout.match(/GROUP_CHECKS=\d+/)[0]+`; rebuild ${i}/2 passed`);}
  // Downstream regression: the Lot 4 agent/calendar suite still passes with P1 + P2-a + P3 + P4-a applied first.
  const downstream=executeLocalSql(command,env,foundation+migrate(P1)+migrate(P2A)+migrate(P3)+migrate(P4A)+agent+"select 'AGENT_AFTER_P4A='||passed from pg_temp.remote_replay;rollback;");
  assert.ifError(downstream.error);assert.equal(downstream.status,0,downstream.stderr+'\n'+downstream.stdout.slice(-2500));console.log(downstream.stdout.match(/AGENT_AFTER_P4A=\d+/)[0]+'; Lot 4 suite unchanged after P4-a');
 }finally{const r=executeLocalSql(command,env,'drop schema if exists publications_private cascade;drop schema if exists agent_scope_private cascade;drop schema if exists storage cascade;drop schema public cascade;create schema public authorization postgres;');assert.equal(r.status,0,r.stderr);}
});
