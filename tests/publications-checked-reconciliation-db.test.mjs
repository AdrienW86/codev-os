import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const databaseUrl=process.env.PUBLICATIONS_SOCLE_TEST_DATABASE_URL;
const database='publications_socle_test_reconcile';
const migration='20261112000000_publications_checked_reconciliation.sql';

test('Checked reconciliation: current-attempt proof, unknown invalidation, stale checks, grants and two-connection confirmation',{
 skip:!databaseUrl?'PUBLICATIONS_SOCLE_TEST_DATABASE_URL absent: native reconciliation not executed.':false,timeout:120000,
},async()=>{
 const url=new URL(databaseUrl);
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/publications_socle_test');assert.equal(url.search,'');assert.equal(url.hash,'');
 const base={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),
  PGPASSWORD:decodeURIComponent(url.password),PGCONNECT_TIMEOUT:'5',PGOPTIONS:'',PGCLIENTENCODING:'UTF8'};
 delete base.PGSERVICE;delete base.PGSERVICEFILE;
 const psql=process.env.PUBLICATIONS_SOCLE_TEST_PSQL??'psql';
 const run=(target,sql)=>executeLocalSql(psql,{...base,PGDATABASE:target},sql);
 const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 assert.ok(migrations.includes(migration));
 const rebuild=run('postgres',`drop database if exists ${database};create database ${database};`);
 assert.equal(rebuild.status,0,rebuild.stderr);
 try{
  const bootstrap=`do $$ begin
   if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
   if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
   if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;
  end $$;
  create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`;
  const schema=run(database,bootstrap+read('supabase/local/remote-schema.sql')+migrations.map(f=>read('supabase/migrations/'+f)).join('\n'));
  assert.equal(schema.status,0,schema.stderr);
  const fixture=run(database,'begin;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/publications-load-fixtures.sql')
   +read('supabase/tests/publications-checked-reconciliation.sql')+'commit;');
  assert.equal(fixture.status,0,fixture.stderr+'\n'+fixture.stdout.slice(-2500));
  const checks=fixture.stdout.match(/CHECKED_RECONCILIATION=(\d+)/);assert.ok(checks&&Number(checks[1])>30);console.log(checks[0]);
  const id=fixture.stdout.match(/CONCURRENT_DELIVERY=([a-f0-9-]{36})/)?.[1];assert.ok(id);
  // First connection records the decision but retains the delivery row lock. Start the second only after that
  // marker is visible; it must wait for COMMIT, then refuse the already-consumed proof. No timing-only race.
  let signal;
  const locked=new Promise(resolve=>{signal=resolve;});
  const connection=(onOutput)=>{
   const child=spawn(psql,['-X','--no-password','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-A','-t'],
    {env:{...base,PGDATABASE:database},stdio:['pipe','pipe','pipe']});
   let stdout='',stderr='';child.stdout.on('data',d=>{stdout+=d;onOutput?.(stdout);});child.stderr.on('data',d=>{stderr+=d;});
   return {write:sql=>child.stdin.write(sql+'\n'),end:sql=>child.stdin.end(sql+'\n'),
    result:new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));})};
  };
  const first=connection(out=>{if(out.includes('ROW_LOCK_HELD'))signal();});
  first.write(`begin;set local role service_role;select public.publication_delivery_confirm_not_published_checked('${id}','user_local');\n\\echo ROW_LOCK_HELD`);
  let timer;
  const marker=await Promise.race([locked.then(()=>true),first.result.then(()=>false),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);})]);
  clearTimeout(timer);
  if(!marker){first.end('rollback;');await first.result;assert.fail('first connection must hold the locked delivery before second starts');}
  const second=connection();
  second.end(`begin;set local role service_role;select public.publication_delivery_confirm_not_published_checked('${id}','user_local');commit;`);
  const waiting=await Promise.race([second.result.then(()=>false),new Promise(resolve=>setTimeout(()=>resolve(true),150))]);
  first.end('commit;');
  const [one,two]=await Promise.all([first.result,second.result]);
  assert.equal(one.code,0,one.stderr);assert.notEqual(two.code,0,'second confirmation must fail');assert.match(two.stderr,/55000/);
  assert.equal(waiting,true,'second connection really waited for the first transaction');
  const result=run(database,`select 'DECISIONS='||count(*) from public.publication_events where action='publication.delivery_confirmed_not_published' and metadata->>'delivery_id'='${id}';`);
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/DECISIONS=1/);
  console.log('CHECKED_RECONCILIATION_CONCURRENT=one decision, second session blocked then rejected');
 }finally{
  const cleanup=run('postgres',`drop database if exists ${database};`);assert.equal(cleanup.status,0,cleanup.stderr);
 }
});
