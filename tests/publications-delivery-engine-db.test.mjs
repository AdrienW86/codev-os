import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {Worker} from 'node:worker_threads';
import {executeLocalSql} from './helpers/local-postgres.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const P10='20261010000000_publications_delivery_engine.sql';
const snapshot=(name,publications)=>`reset role;
create temporary table ${name} as select jsonb_build_object(${publications}) v;
`;
test('Lot 4.3 P10 SQL: nineteen migrations, delivery engine (prepare, claim, lease, dispatch, complete, retry), real concurrent sessions, unchanged P9 / P8 / P7 / P5 / Lot 4 suites (two rebuilds)',{skip:!process.env.PUBLICATIONS_P10_TEST_DATABASE_URL?'Dedicated local DB not configured':false},async()=>{
 const url=new URL(process.env.PUBLICATIONS_P10_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/publications_p10_test');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port,PGUSER:url.username,PGDATABASE:'publications_p10_test',PGPASSWORD:'',PGOPTIONS:''};delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>/^202610.*\.sql$/.test(f)&&f<=P10).sort();
 assert.equal(files.length,19);assert.equal(files[18],P10);
 const foundation='begin;'+read('supabase/local/remote-schema.sql')+'reset role;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/remote-replay-fixtures.sql')+`create schema storage authorization postgres;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);alter table storage.buckets owner to postgres;set local role postgres;`+files.slice(0,6).map(f=>read('supabase/migrations/'+f)).join('\n')+read('supabase/tests/publications-review-legacy-fixture.sql')+'set local role postgres;set constraints all immediate;'+files.slice(6,9).map(f=>read('supabase/migrations/'+f)).join('\n')+'reset role;set constraints all deferred;';
 const migrate=f=>'set local role postgres;set constraints all immediate;'+read('supabase/migrations/'+f)+'\nreset role;set constraints all deferred;';
 const through=last=>files.slice(9,files.indexOf(last)+1).map(migrate).join('');
 const command=process.env.PUBLICATIONS_P10_TEST_PSQL??'psql';
 const run=(sql,marker,label)=>{const r=executeLocalSql(command,env,sql+`select '${marker}='||passed from pg_temp.remote_replay;rollback;`);assert.ifError(r.error);assert.equal(r.status,0,r.stderr+'\n'+r.stdout.slice(-2500));
  const found=r.stdout.match(new RegExp(`${marker}=\\d+`));assert.ok(found,label);console.log(found[0]+'; '+label);};
 const P5='20261008030000_publications_archiving.sql',P7='20261008040000_publications_agent_v2.sql',P8='20261008050000_publications_agent_v2_media.sql',P9='20261009000000_publications_connections.sql';
 const session=sql=>new Promise((resolve,reject)=>{const w=new Worker(`const {parentPort,workerData}=require('node:worker_threads');import(workerData.helper).then(({executeLocalSql})=>parentPort.postMessage(executeLocalSql(workerData.command,workerData.env,workerData.sql)));`,
  {eval:true,workerData:{helper:new URL('./helpers/local-postgres.mjs',import.meta.url).href,command,env,sql}});w.once('message',resolve);w.once('error',reject);});
 try{
  for(let i=1;i<=2;i++)run(foundation+through(P9)+read('supabase/tests/publications-delivery-engine-before.sql')+migrate(P10)+read('supabase/tests/publications-delivery-engine.sql'),'P10_CHECKS',`rebuild ${i}/2 passed`);
  // Regressions once P10 is applied.
  run(foundation+through(P8)+read('supabase/tests/publications-connections-before.sql')+migrate(P9)+migrate(P10)+read('supabase/tests/publications-connections.sql'),'P9_AFTER_P10','P9 suite unchanged after P10');
  run(foundation+through(P7)+read('supabase/tests/publications-agent-v2-media-before.sql')+migrate(P8)+migrate(P9)+migrate(P10)+read('supabase/tests/publications-agent-v2-media.sql'),'P8_AFTER_P10','P8 suite unchanged after P10');
  run(foundation+through(P5)+snapshot('p7_before',`'publications',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.publications p),'events',(select count(*) from public.publication_events)`)
   +migrate(P7)+migrate(P8)+migrate(P9)+migrate(P10)+read('supabase/tests/publications-agent-v2.sql'),'P7_AFTER_P10','P7 suite unchanged after P10');
  run(foundation+through(P5)+snapshot('p5_before',`'publications',(select coalesce(jsonb_agg(to_jsonb(p)-'archived_at'-'archived_by' order by p.id),'[]') from public.publications p),'events',(select count(*) from public.publication_events)`)
   +migrate(P7)+migrate(P8)+migrate(P9)+migrate(P10)+read('supabase/tests/publications-archiving.sql'),'P5_AFTER_P10','P5 suite unchanged after P10');
  run(foundation+through(P10)+read('supabase/tests/publications-agent.sql'),'AGENT_AFTER_P10','Lot 4 (Agent v1) suite unchanged after P10');
  // Real concurrency: committed state with three due deliveries and one approved, not yet prepared publication.
  const setup=executeLocalSql(command,env,foundation+through(P9)+read('supabase/tests/publications-delivery-engine-before.sql')+migrate(P10)+`
   do $$declare p uuid;begin
    foreach p in array array[pg_temp.p10_publication('facebook','Course A'),pg_temp.p10_publication('instagram','Course B'),pg_temp.p10_publication('google_business_profile','Course C')] loop
     set local role service_role;perform public.publication_prepare_delivery(p,'user_local');reset role;
    end loop;
    update public.publication_jobs set run_at=now()-interval '1 second' where type='deliver' and status='pending';
    perform pg_temp.p10_publication('facebook','Course D');
   end $$;
   commit;`);
  assert.equal(setup.status,0,setup.stderr+'\n'+setup.stdout.slice(-1500));
  const claimer=worker=>`begin;set local role service_role;select 'CLAIM='||coalesce(public.publication_job_claim('${worker}',120)->>'job_id','none');select pg_sleep(0.4);
   select 'CLAIM='||coalesce(public.publication_job_claim('${worker}',120)->>'job_id','none');commit;`;
  const claims=(await Promise.all([session(claimer('worker-a')),session(claimer('worker-b'))])).map(r=>{assert.equal(r.status,0,r.stderr);return [...r.stdout.matchAll(/CLAIM=([0-9a-f-]{36}|none)/g)].map(m=>m[1]);}).flat();
  const won=claims.filter(c=>c!=='none');
  assert.equal(won.length,3,'three due jobs, three claims');assert.equal(new Set(won).size,3,'never the same job twice');assert.equal(claims.filter(c=>c==='none').length,1);
  const check=executeLocalSql(command,env,`select 'PROCESSING='||count(*) from public.publication_jobs where type='deliver' and status='processing' and attempts=1 and locked_by in('worker-a','worker-b');
   select 'DELIVERIES='||count(*) from public.publication_deliveries where status='processing';`);
  assert.equal(check.status,0,check.stderr);assert.match(check.stdout,/PROCESSING=3/);assert.match(check.stdout,/DELIVERIES=3/);
  console.log('Two simultaneous workers (SKIP LOCKED): 3 jobs claimed exactly once, 1 empty claim.');
  const preparer=`begin;set local role service_role;select public.publication_prepare_delivery((select publication_id from public.publication_variants where text_content='Course D'),'user_local');select pg_sleep(0.3);commit;`;
  for(const r of await Promise.all([session(preparer),session(preparer)]))assert.equal(r.status,0,r.stderr);
  const once=executeLocalSql(command,env,`select 'RACE_DELIVERIES='||count(*) from public.publication_deliveries d where d.publication_id=(select publication_id from public.publication_variants where text_content='Course D');
   select 'RACE_JOBS='||count(*) from public.publication_jobs j where j.publication_id=(select publication_id from public.publication_variants where text_content='Course D');`);
  assert.equal(once.status,0,once.stderr);assert.match(once.stdout,/RACE_DELIVERIES=1/);assert.match(once.stdout,/RACE_JOBS=1/);
  console.log('Two simultaneous preparations: one delivery, one job.');
 }finally{const r=executeLocalSql(command,env,'drop schema if exists publications_private cascade;drop schema if exists agent_scope_private cascade;drop schema if exists storage cascade;drop schema public cascade;create schema public authorization postgres;');assert.equal(r.status,0,r.stderr);}
});
