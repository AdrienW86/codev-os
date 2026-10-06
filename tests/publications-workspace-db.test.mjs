import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {Worker} from 'node:worker_threads';
import {executeLocalSql} from './helpers/local-postgres.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Lot 2 SQL: seven migrations, human workflow, media, rollback and two clean rebuilds',{skip:!process.env.PUBLICATIONS_WORKSPACE_TEST_DATABASE_URL?'Dedicated local DB not configured':false},async()=>{
 const url=new URL(process.env.PUBLICATIONS_WORKSPACE_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/publications_workspace_test');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port,PGUSER:url.username,PGDATABASE:'publications_workspace_test',PGPASSWORD:'',PGOPTIONS:''};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^20261005.*\.sql$/.test(f)&&!f.includes("editorial_calendar")&&!f.includes('opportunity_agent')).sort();assert.equal(files.length,7);
 const sql='begin;'+read('supabase/local/remote-schema.sql')+'reset role;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/remote-replay-fixtures.sql')+`create schema storage authorization postgres;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);alter table storage.buckets owner to postgres;set local role postgres;`+files.slice(0,6).map(f=>read('supabase/migrations/'+f)).join('\n')+read('supabase/tests/publications-review-legacy-fixture.sql')+'set local role postgres;'+read('supabase/migrations/'+files[6])+'reset role;'+read('supabase/tests/publications-workspace.sql')+read('supabase/tests/publications-revision-decisions.sql')+"select 'WORKSPACE_CHECKS='||passed from pg_temp.remote_replay;rollback;";
 for(let i=1;i<=2;i++){const result=executeLocalSql(process.env.PUBLICATIONS_WORKSPACE_TEST_PSQL??'psql',env,sql);assert.ifError(result.error);assert.equal(result.status,0,result.stderr+'\n'+result.stdout.slice(-2500));const checks=result.stdout.match(/WORKSPACE_CHECKS=(\d+)/)?.[1];assert.ok(checks);console.log(`WORKSPACE_CHECKS=${checks}; rebuild ${i}/2 passed`);}
 const command=process.env.PUBLICATIONS_WORKSPACE_TEST_PSQL??'psql';
 const fixture=`reset role;set local role service_role;do $$declare p public.publications;r uuid;begin
 select * into p from public.publications where subject='Second';
 perform public.publication_save_draft(p.id,p.current_revision_id,p.client_id,p.project_id,'Concurrent review','A','S',null,null,null,
 '[{"platform":"facebook","text_content":"F"},{"platform":"instagram","text_content":"I"}]','user_local');
 select current_revision_id into r from public.publications where id=p.id;
 perform public.publication_submit_manual(p.id,r,'user_local');end $$;commit;`;
 try {
  const prepared=executeLocalSql(command,env,sql.replace("select 'WORKSPACE_CHECKS='||passed from pg_temp.remote_replay;rollback;",()=>fixture));
  assert.equal(prepared.status,0,prepared.stderr);
  const raceSql=`begin;set local role service_role;do $$declare p public.publications;begin
   select * into p from public.publications where subject='Concurrent review';
   perform public.publication_review_manual(p.id,p.current_revision_id,'rejected','Concurrent refusal','user_local');
   perform pg_sleep(0.25);end $$;commit;`;
  const run=()=>new Promise((resolve,reject)=>{
   const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');
    import(workerData.helper).then(({executeLocalSql})=>parentPort.postMessage(executeLocalSql(workerData.command,workerData.env,workerData.sql))).catch(e=>{throw e});`,
    {eval:true,workerData:{helper:new URL('./helpers/local-postgres.mjs',import.meta.url).href,command,env,sql:raceSql}});
   worker.once('message',resolve);worker.once('error',reject);
  });
  const concurrent=await Promise.all([run(),run()]);
  for(const result of concurrent)assert.equal(result.status,0,result.stderr);
  const result=executeLocalSql(command,env,`select 'RACE_DECISIONS='||count(*) from public.publication_reviews r join public.publications p on p.id=r.publication_id where p.subject='Concurrent review';
   select 'RACE_EVENTS='||count(*) from public.publication_events e join public.publications p on p.id=e.resource_id where p.subject='Concurrent review' and e.action='publication.reviewed';`);
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/RACE_DECISIONS=1/);assert.match(result.stdout,/RACE_EVENTS=1/);
  console.log('Two simultaneous PostgreSQL sessions: one decision, one event, both retries succeed.');
 } finally {
  const cleanup=executeLocalSql(command,env,'drop schema if exists publications_private cascade;drop schema if exists agent_scope_private cascade;drop schema if exists storage cascade;drop schema public cascade;create schema public authorization postgres;');
  assert.equal(cleanup.status,0,cleanup.stderr);
 }
});
