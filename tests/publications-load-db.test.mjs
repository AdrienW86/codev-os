// Phase 8 (#47) — charge et concurrence côté base, PostgreSQL local jetable uniquement (jamais un projet distant).
// 1. Reconstruit le schéma de production + TOUTES les migrations (même chaîne que publications-socle-db), puis lance
//    chaque suite supabase/tests/publications-load-<n>-*.sql (après publications-load-fixtures.sql) dans sa propre
//    transaction annulée.
// 2. Essais à DEUX SESSIONS réelles (deux processus psql simultanés, données validées) : réservation SKIP LOCKED des
//    diffusions et des jobs, double préparation d'une diffusion, rotation des clients en compare-and-set, rejeux de
//    webhook WhatsApp. Chaque essai prouve qu'une session bloquée attend ou saute la ligne verrouillée, jamais un doublon.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {executeLocalSql} from './helpers/local-postgres.mjs';

const databaseUrl=process.env.PUBLICATIONS_SOCLE_TEST_DATABASE_URL;
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const DATABASE='publications_socle_test_load';
function environment(database){
 const url=new URL(databaseUrl);
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'loopback only');
 assert.match(url.pathname,/^\/publications_socle_test(?:_[a-z0-9_]+)?$/,'dedicated test database only');
 const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:database,PGCONNECT_TIMEOUT:'5'};
 delete env.PGSERVICE;delete env.PGSERVICEFILE;return env;
}
const psqlBin=()=>process.env.PUBLICATIONS_SOCLE_TEST_PSQL??'psql';
const psql=(env,sql)=>executeLocalSql(psqlBin(),env,sql);
function rebuild(){
 const target=environment(DATABASE);
 const admin=psql(environment('postgres'),`drop database if exists ${DATABASE}; create database ${DATABASE};`);assert.equal(admin.status,0,admin.stderr);
 const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 const bootstrap=`do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
 end $$;
 create schema if not exists storage;
 create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);\n`;
 const result=psql(target,bootstrap+read('supabase/local/remote-schema.sql')+migrations.map(f=>read(`supabase/migrations/${f}`)).join('\n'));
 assert.equal(result.status,0,result.stderr);return target;
}
const suites=readdirSync(new URL('../supabase/tests/',import.meta.url)).filter(f=>/^publications-load-\d+-.*\.sql$/.test(f)).sort();

// Session psql interactive : chaque requête se termine par un marqueur, la promesse se résout quand il arrive.
function session(env){
 const child=spawn(psqlBin(),['-X','-q','-A','-t','--no-password','-v','ON_ERROR_STOP=0'],{env:{...env,PGCLIENTENCODING:'UTF8'},stdio:['pipe','pipe','pipe']});
 let out='',err='',n=0;const waiters=[];
 const flush=()=>{while(waiters.length){const w=waiters[0],i=out.indexOf(w.mark);if(i<0)return;const text=out.slice(0,i);out=out.slice(i+w.mark.length);waiters.shift();w.resolve(text.trim());}};
 child.stdout.on('data',d=>{out+=d;flush();});child.stderr.on('data',d=>{err+=d;});
 return {query(sql){const mark=`__LOAD_DONE_${++n}__`;const p=new Promise(resolve=>waiters.push({mark,resolve}));child.stdin.write(`${sql}\n\\echo ${mark}\n`);return p;},
  get errors(){return err;},close(){child.stdin.end();return new Promise(r=>child.on('close',r));}};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Une requête « bloquée » ne s'est pas terminée après ms ; sinon son résultat.
const within=(promise,ms)=>Promise.race([promise.then(value=>({done:true,value})),sleep(ms).then(()=>({done:false}))]);

test('Publications load SQL suites + two-session concurrency proofs on the full migration chain',{skip:!databaseUrl?'PUBLICATIONS_SOCLE_TEST_DATABASE_URL absent: local SQL suites not executed.':false,timeout:240000},async()=>{
 assert.ok(suites.length>=2);
 const started=Date.now();
 const env=rebuild();
 console.log(`LOAD rebuild: ${Date.now()-started} ms`);
 for(const suite of suites){
  const marker=suite.replace(/\.sql$/,'').replace(/[^a-z0-9]+/gi,'_').toUpperCase(),t=Date.now();
  const r=psql(env,'begin;'+read('supabase/tests/remote-replay-helpers.sql')+read('supabase/tests/publications-load-fixtures.sql')+read(`supabase/tests/${suite}`)+`\nreset role;select '${marker}='||passed from pg_temp.remote_replay;rollback;`);
  assert.equal(r.status,0,`${suite}: ${r.stderr}\n${r.stdout.slice(-2000)}`);
  const found=r.stdout.match(new RegExp(`${marker}=([0-9]+)`));assert.ok(found&&Number(found[1])>0,suite);
  console.log(`${found[0]} (${Date.now()-t} ms)`);
 }

 // Données validées pour les sessions concurrentes : 2 clients, 6 publications approuvées, 4 diffusions dues, 4 jobs
 // génériques en file, un client en préparation automatique jamais traité, la file WhatsApp avec un expéditeur.
 const fixture=psql(env,`begin;${read('supabase/tests/publications-load-fixtures.sql')}
 create table public.load_two_sessions(name text primary key,id uuid not null);
 do $$declare i integer;pub uuid;cl uuid;begin
  for i in 1..2 loop cl:=pg_temp.load_client(i);insert into public.load_two_sessions values('client'||i,cl); end loop;
  for i in 1..6 loop pub:=pg_temp.load_publication(1+(i%2),'google_business_profile','Deux sessions '||i);insert into public.load_two_sessions values('pub'||i,pub);
   if i<=4 then set local role service_role;perform public.publication_prepare_delivery(pub,'user_local');reset role; end if;
  end loop;
  update public.publication_jobs set run_at=now()-interval '1 minute' where type='deliver';
  update public.publication_deliveries set scheduled_for=now()-interval '1 minute';
  insert into public.jobs(run_type,idempotency_key,scheduled_for) select 'publications.load','load:'||k,now()-interval '1 minute' from generate_series(1,4) k;
  update public.publication_client_settings set auto_prepare_enabled=false;
  insert into public.whatsapp_senders(sender,client_id,drive_folder_id,rights_confirmed,enabled,updated_by) values('33698765432',(select id from public.load_two_sessions where name='client1'),'folder_two_sessions_01',true,true,'user_local');
 end $$;
 commit;`);
 assert.equal(fixture.status,0,fixture.stderr);
 const a=session(env),b=session(env);
 try{
  for(const s of [a,b])await s.query("set lock_timeout='20s'; set statement_timeout='30s'; set role service_role;");
  // 1. Réservation des diffusions : A garde sa réservation ouverte, B saute la ligne verrouillée (SKIP LOCKED) sans attendre.
  await a.query('begin;');
  const ja=JSON.parse(await a.query("select public.publication_job_claim_scheduled('worker-a',60,7200,null);"));
  const tb=Date.now(),rb=await within(b.query("select public.publication_job_claim_scheduled('worker-b',60,7200,null);"),5000);
  assert.ok(rb.done,'B never waits for A (SKIP LOCKED)');const jb=JSON.parse(rb.value);
  assert.notEqual(ja.job_id,jb.job_id,'two sessions never claim the same delivery job');
  console.log(`LOAD two sessions claim: B answered in ${Date.now()-tb} ms while A held its lock`);
  await a.query('commit;');
  const again=await b.query("select public.publication_job_claim_scheduled('worker-b',60,7200,null);");
  assert.ok(![ja.job_id,jb.job_id].includes(JSON.parse(again).job_id),'a leased job is never claimed again');
  const attempts=await a.query("select count(*)||':'||max(attempts) from public.publication_jobs where status='processing';");
  assert.equal(attempts,'3:1','three distinct jobs, one attempt each');
  // 2. Double préparation simultanée d'une même publication : B attend le verrou de A, puis reçoit la même diffusion.
  await a.query('begin;');
  const pa=JSON.parse(await a.query("select public.publication_prepare_delivery((select id from public.load_two_sessions where name='pub5'),'user_local');"));
  const pending=b.query("select public.publication_prepare_delivery((select id from public.load_two_sessions where name='pub5'),'user_local');");
  assert.equal((await within(pending,700)).done,false,'B waits for A (row lock), it does not create a second delivery');
  await a.query('commit;');
  const pb=JSON.parse(await pending);
  assert.equal(pa.created,true);assert.equal(pb.created,false);assert.equal(pb.delivery_id,pa.delivery_id,'same delivery');
  assert.equal(await a.query("select count(*) from public.publication_deliveries where publication_id=(select id from public.load_two_sessions where name='pub5');"),'1');
  // 3. Jobs génériques (codev_claim_jobs) : deux workers concurrents reçoivent des lots disjoints.
  await a.query('begin;');
  const ca=(await a.query("select id from public.codev_claim_jobs('worker-a',2,300);")).split('\n').filter(Boolean);
  const cbr=await within(b.query("select id from public.codev_claim_jobs('worker-b',4,300);"),5000);
  assert.ok(cbr.done,'B does not wait');const cb=cbr.value.split('\n').filter(Boolean);
  await a.query('commit;');
  assert.equal(ca.length,2);assert.equal(cb.length,2);assert.equal(new Set([...ca,...cb]).size,4,'disjoint batches');
  // 4. Rotation des clients (compare-and-set de runScheduledPreparation) : un seul des deux passages réserve le client.
  await a.query('reset role;');await b.query('reset role;');
  await a.query('begin;');
  const ua=await a.query("with u as (update public.publication_client_settings set last_auto_prepared_at=now() where client_id=(select id from public.load_two_sessions where name='client1') and last_auto_prepared_at is null returning 1) select count(*) from u;");
  const ub=b.query("with u as (update public.publication_client_settings set last_auto_prepared_at=now() where client_id=(select id from public.load_two_sessions where name='client1') and last_auto_prepared_at is null returning 1) select count(*) from u;");
  assert.equal((await within(ub,700)).done,false,'B waits on the row');
  await a.query('commit;');
  assert.equal(ua,'1');assert.equal(await ub,'0','B re-checks the condition after A commits: client already claimed');
  // 5. Webhook WhatsApp rejoué en parallèle : une seule ligne ; puis réservation de la file par deux workers, disjointe.
  await a.query('begin;');
  await a.query("insert into public.whatsapp_inbox(waba_id,phone_number_id,message_id,sender,media_id,mime_type,received_at) values('waba-2','phone-2','wamid.race','33698765432','media-race','image/jpeg',now()) on conflict(waba_id,message_id) do nothing;");
  const wb=b.query("with i as (insert into public.whatsapp_inbox(waba_id,phone_number_id,message_id,sender,media_id,mime_type,received_at) values('waba-2','phone-2','wamid.race','33698765432','media-race','image/jpeg',now()) on conflict(waba_id,message_id) do nothing returning 1) select count(*) from i;");
  await a.query('commit;');
  assert.equal(await wb,'0','the concurrent retry inserts nothing');
  await a.query("insert into public.whatsapp_inbox(waba_id,phone_number_id,message_id,sender,media_id,mime_type,received_at) select 'waba-2','phone-2','wamid.q'||k,'33698765432','media-q'||k,'image/jpeg',now() from generate_series(1,3) k;");
  await a.query('set role service_role;');await b.query('set role service_role;');
  await a.query('begin;');
  const qa=await a.query("select id from public.whatsapp_claim(gen_random_uuid());");
  const qb=await within(b.query("select id from public.whatsapp_claim(gen_random_uuid());"),5000);
  await a.query('commit;');
  assert.ok(qb.done&&qa&&qb.value&&qa!==qb.value,'two workers never claim the same WhatsApp media');
  assert.equal(await a.query("select count(*) from public.whatsapp_inbox where message_id='wamid.race';"),'1');
  // 6. Job interrompu en cours d'étape (processus coupé) : bail expiré → repris par un autre worker au passage suivant ;
  // l'ancien worker ne peut plus écrire son résultat (fencing par worker_id), une seule exécution comptée.
  await a.query('reset role;');
  await a.query("insert into public.jobs(run_type,idempotency_key,scheduled_for) values('publications.load','load:crash',now()-interval '1 minute');");
  await a.query('set role service_role;');
  const crashed=await a.query("select id from public.codev_claim_jobs('worker-crash',1,300);");
  await a.query("reset role;");await a.query(`update public.jobs set lease_expires_at=now()-interval '1 second' where id='${crashed}';`);
  await b.query('set role service_role;');
  const resumed=await b.query("select id||':'||attempts from public.codev_claim_jobs('worker-resume',1,300);");
  assert.equal(resumed,`${crashed}:2`,'the interrupted job is reclaimed (attempt 2)');
  await a.query('set role service_role;');
  assert.equal(await a.query(`with u as (update public.jobs set status='succeeded' where id='${crashed}' and worker_id='worker-crash' and status='running' returning 1) select count(*) from u;`),'0','the crashed worker can no longer complete it');
  assert.equal(a.errors.replace(/NOTICE.*\n?/g,''),'');assert.equal(b.errors.replace(/NOTICE.*\n?/g,''),'');
 }finally{await a.close();await b.close();}
 psql(environment('postgres'),`drop database if exists ${DATABASE};`);
});
