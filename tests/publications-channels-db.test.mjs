import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
// Snapshot taken just before P1, on the richest local state (agent suite data): used to prove the backfill
// and the unchanged history. Local synthetic data only.
const beforeP1=`reset role;
create temporary table p1_before_publications as select to_jsonb(p) v from public.publications p;
create temporary table p1_before_revisions as select to_jsonb(r) v from public.publication_revisions r;
create temporary table p1_before_variants as select to_jsonb(v) v from public.publication_variants v;
create temporary table p1_before_events as select count(*) n from public.publication_events;
create temporary table p1_expected as select p.id project_id,p.client_id,l.platform from public.projects p
 cross join lateral unnest(case p.type when 'Réseaux sociaux' then array['facebook','instagram'] when 'Google Business Profile' then array['google_business_profile'] else array[]::text[] end) l(platform);
create temporary table p1_before_allowed_acl as select proacl::text acl from pg_proc where oid='publications_private.project_platform_allowed(uuid,uuid,text)'::regprocedure;
create temporary table p1_before_event_contract as
 select 'constraint' kind,conname::text name,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.publication_events'::regclass
 union all select 'trigger',tgname::text,pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.publication_events'::regclass and not tgisinternal
 union all select 'column',attname::text,format_type(atttypid,atttypmod)||coalesce(' default '||pg_get_expr(d.adbin,d.adrelid),'')||case when attnotnull then ' not null' else '' end
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.publication_events'::regclass and a.attnum>0 and not a.attisdropped;
`;
test('Lot 4.3 P1 SQL: ten migrations, channels, backfill, fallback, atomicity and unchanged downstream suites (two rebuilds)',{skip:!process.env.PUBLICATIONS_CHANNELS_TEST_DATABASE_URL?'Dedicated local DB not configured':false},()=>{
 const url=new URL(process.env.PUBLICATIONS_CHANNELS_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/publications_channels_test');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port,PGUSER:url.username,PGDATABASE:'publications_channels_test',PGPASSWORD:'',PGOPTIONS:''};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^202610.*\.sql$/.test(f)&&f<='20261007120000_publications_project_channels.sql').sort();// P1 scope: later migrations are tested by their own suites
 assert.equal(files.length,10);assert.equal(files[9],'20261007120000_publications_project_channels.sql');
 const foundation='begin;'+read('supabase/local/remote-schema.sql')+'reset role;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/remote-replay-fixtures.sql')+`create schema storage authorization postgres;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);alter table storage.buckets owner to postgres;set local role postgres;`+files.slice(0,6).map(f=>read('supabase/migrations/'+f)).join('\n')+read('supabase/tests/publications-review-legacy-fixture.sql')+'set local role postgres;set constraints all immediate;'+files.slice(6,9).map(f=>read('supabase/migrations/'+f)).join('\n')+'reset role;set constraints all deferred;';
 const p1='set local role postgres;set constraints all immediate;'+read('supabase/migrations/'+files[9])+'\nreset role;set constraints all deferred;';
 const command=process.env.PUBLICATIONS_CHANNELS_TEST_PSQL??'psql',agent=read('supabase/tests/publications-agent.sql'),checks=read('supabase/tests/publications-channels.sql');
 try{
  // P1 applied on the full historical + agent state, then the channel suite. Two clean rebuilds.
  for(let i=1;i<=2;i++){const result=executeLocalSql(command,env,foundation+agent+beforeP1+p1+checks+"select 'CHANNEL_CHECKS='||passed from pg_temp.remote_replay;rollback;");
   assert.ifError(result.error);assert.equal(result.status,0,result.stderr+'\n'+result.stdout.slice(-2500));assert.match(result.stdout,/CHANNEL_CHECKS=\d+/);console.log(result.stdout.match(/CHANNEL_CHECKS=\d+/)[0]+`; rebuild ${i}/2 passed`);}
  // Downstream regression: the whole Lot 4 agent/calendar suite still passes once P1 is applied (legacy fallback path).
  const downstream=executeLocalSql(command,env,foundation+p1+agent+"select 'AGENT_AFTER_P1='||passed from pg_temp.remote_replay;rollback;");
  assert.ifError(downstream.error);assert.equal(downstream.status,0,downstream.stderr+'\n'+downstream.stdout.slice(-2500));assert.match(downstream.stdout,/AGENT_AFTER_P1=\d+/);console.log(downstream.stdout.match(/AGENT_AFTER_P1=\d+/)[0]+'; Lot 4 suite unchanged after P1');
 }finally{const r=executeLocalSql(command,env,'drop schema if exists publications_private cascade;drop schema if exists agent_scope_private cascade;drop schema if exists storage cascade;drop schema public cascade;create schema public authorization postgres;');assert.equal(r.status,0,r.stderr);}
});
