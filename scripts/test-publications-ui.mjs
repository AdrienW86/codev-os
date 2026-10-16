#!/usr/bin/env node
// Real Next + Chromium + PostgREST + disposable native PostgreSQL. Clerk and private object storage only
// are simulated. No credentials are inherited by Next and HTTP is restricted to loopback during the run.
// E2E_DATABASE_URL=postgres://postgres@127.0.0.1:54329/codev_publications_ui \
// CODEV_CORE_TEST_PSQL=/path/to/psql POSTGREST_BIN=/path/to/postgrest node scripts/test-publications-ui.mjs
// Pass --download-postgrest to install the pinned, SHA256-verified Linux x86_64 binary into .local first.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {cpSync,createWriteStream,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import http from 'node:http';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {serviceJwt} from '../e2e/harness/gateway.mjs';
import {executeLocalSql} from '../tests/helpers/local-postgres.mjs';

const root=resolve(import.meta.dirname,'..'),out=join(root,'e2e/output/publications'),app=join(out,'app');
const base='http://127.0.0.1:3344',gatewayPort=54332,restPort=54333;
const apiKey='sb_secret_publications_ui_local_only',jwtSecret='publications-ui-local-jwt-0123456789abcdef';
const database=new URL(process.env.E2E_DATABASE_URL??'postgres://postgres@127.0.0.1:54329/codev_publications_ui');
assert.equal(database.hostname,'127.0.0.1','Only loopback PostgreSQL is allowed');
assert.equal(database.pathname,'/codev_publications_ui','Only the disposable publications UI database is allowed');
assert.equal(database.search,'');assert.equal(database.hash,'');
const clientId='11111111-1111-4111-8111-111111111111',projectId='22222222-2222-4222-8222-222222222222';
const title='Inspection préventive — fixture Publications',initialText='Une inspection préventive identifie les accès à protéger. Contactez notre équipe.';
// Valid 1×1 PNG decoded with the installed sharp version; the former magic-only
// fixture had a corrupt IDAT payload and could never prove a usable preview.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWOQCzjxHwAD/AI2VgzYvQAAAABJRU5ErkJggg==','base64');
const safeEnv={};
for(const key of ['PATH','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL','TZ','LD_LIBRARY_PATH'])if(process.env[key])safeEnv[key]=process.env[key];
const pgEnv=name=>({...safeEnv,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:database.port||'5432',PGUSER:decodeURIComponent(database.username||'postgres'),PGPASSWORD:decodeURIComponent(database.password),PGDATABASE:name,PGOPTIONS:''});
const psql=process.env.CODEV_CORE_TEST_PSQL??'psql';
function sql(value,name='codev_publications_ui'){
 const result=executeLocalSql(psql,pgEnv(name),value);
 assert.ifError(result.error);assert.equal(result.status,0,(result.stderr+'\n'+result.stdout).slice(-6000));return result.stdout;
}
function snapshot(){
 const keys=['publications','publication_revisions','publication_reviews','publication_assets','publication_variant_assets','publication_events','publication_deliveries','publication_jobs','publication_attempts'];
 const query='select jsonb_build_object('+keys.map(key=>`'${key}',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.${key} t)`).join(',')+');';
 const result=spawnSync(psql,['-X','--no-password','-At','-v','ON_ERROR_STOP=1','-c',query],{env:pgEnv('codev_publications_ui'),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
function rebuild(){
 sql("select pg_terminate_backend(pid) from pg_stat_activity where datname='codev_publications_ui';drop database if exists codev_publications_ui;create database codev_publications_ui;",'postgres');
 const read=path=>readFileSync(join(root,path),'utf8');
 const migrations=readdirSync(join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
 sql(`begin;do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;end $$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 ${read('supabase/local/remote-schema.sql')}\n${migrations.map(f=>read('supabase/migrations/'+f)).join('\n')}\ncommit;`);
 sql(`insert into public.clients(id,name,activity,email) values('${clientId}','Protection Nuisibles — fixture','Protection contre les nuisibles','fixture@example.invalid');
 insert into public.projects(id,client_id,name,type) values('${projectId}','${clientId}','Réseaux sociaux — fixture','Réseaux sociaux');
 set role service_role;do $$declare channel uuid;begin
 channel:=public.publication_channel_save('${projectId}','facebook',true,null,null,'user_e2e_admin');
 perform public.publication_channel_save('${projectId}','instagram',false,null,null,'user_e2e_admin');
 perform public.publication_channel_schedule_save(channel,'Europe/Paris',true,
 (select jsonb_agg(jsonb_build_object('weekday',d,'local_time','18:00','enabled',true)) from generate_series(1,7) d),'user_e2e_admin');
 perform public.publication_channel_occurrences_ensure('${projectId}',current_date+1,current_date+28,'user_e2e_admin');end $$;reset role;`);
 console.log(`Native PostgreSQL fixture rebuilt with ${migrations.length} local migrations; all publication sending switches remain off.`);
}
let postgrest=process.env.POSTGREST_BIN??'postgrest';
if(process.argv.includes('--download-postgrest')){
 assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
 const target=join(root,'.local/postgrest-v13.0.7'),archive=join(target,'postgrest-v13.0.7-linux-static-x86-64.tar.xz');mkdirSync(target,{recursive:true});
 const hash='4153f81ccc40e7b735edc89cd84b49da25ba27eb37d57c7f6a82c9005a0b762b';
 if(!existsSync(archive)||createHash('sha256').update(readFileSync(archive)).digest('hex')!==hash){
  const download=spawnSync('curl',['--fail','--location','--silent','--show-error','--proto','=https','--tlsv1.2','https://github.com/PostgREST/postgrest/releases/download/v13.0.7/postgrest-v13.0.7-linux-static-x86-64.tar.xz','--output',archive],{stdio:'inherit'});
  assert.equal(download.status,0,'Pinned PostgREST download failed');
 }
 assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'),hash,'Official PostgREST asset SHA256 mismatch');
 const extract=spawnSync('tar',['-xJf',archive,'-C',target,'postgrest']);assert.equal(extract.status,0,extract.stderr?.toString());postgrest=join(target,'postgrest');
}
const version=spawnSync(postgrest,['--version'],{encoding:'utf8'});assert.equal(version.status,0,'PostgREST required: set POSTGREST_BIN or pass --download-postgrest');assert.match(version.stdout,/PostgREST 13\.0\.7/);
for(const port of [3344,gatewayPort,restPort]){
 const available=await new Promise(resolve=>{const probe=http.createServer();probe.once('error',()=>resolve(false));probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve(true)));});
 assert.ok(available,`Port ${port} is already occupied; no existing server will be reused.`);
}
rmSync(out,{recursive:true,force:true});mkdirSync(app,{recursive:true});
for(const item of ['app','components','lib','public','e2e/harness/stubs','package.json','tsconfig.json','postcss.config.mjs'])cpSync(join(root,item),join(app,item),{recursive:true});
symlinkSync(join(root,'node_modules'),join(app,'node_modules'),'dir');
writeFileSync(join(app,'next.config.ts'),`import path from 'node:path';export default {webpack(config:any){config.resolve.alias={...config.resolve.alias,'@clerk/nextjs/server':path.resolve(process.cwd(),'e2e/harness/stubs/clerk-server.ts'),'@clerk/nextjs':path.resolve(process.cwd(),'e2e/harness/stubs/clerk.tsx')};return config;}};`);
const guard=join(app,'e2e/harness/local-network-only.cjs');
writeFileSync(guard,`const fs=require('node:fs'),http=require('node:http'),https=require('node:https');
const allowed=new Set(['127.0.0.1','localhost','::1','[::1]']);function check(value){const host=typeof value==='string'||value instanceof URL?new URL(value).hostname:value?.hostname??value?.host??'localhost';if(!allowed.has(String(host).replace(/:\\d+$/,''))){fs.appendFileSync(${JSON.stringify(join(out,'external-network-attempts.log'))},String(host)+'\\n');throw Error('External network disabled for publications UI test');}}
for(const module of [http,https])for(const name of ['request','get']){const original=module[name];module[name]=function(...args){check(args[0]);return original.apply(this,args);};}
const originalFetch=globalThis.fetch;globalThis.fetch=function(input,...args){const target=typeof input==='object'&&input.url?input.url:input;
// Next development mode checks its installed version. Answer that exact probe
// locally; application/provider traffic still fails the loopback-only guard.
if(String(target)==='https://registry.npmjs.org/-/package/next/dist-tags'&&(!args[0]?.method||args[0].method==='GET')){fs.appendFileSync(${JSON.stringify(join(out,'framework-version-probes.log'))},'Next development version check answered locally\\n');return Promise.resolve(new Response('',{status:503}));}
check(target);return originalFetch.call(this,input,...args);};`);
const storedImages=new Map(),restCalls=[];let uploads=0,storageDenied=false;
const token=serviceJwt(jwtSecret);
const gateway=http.createServer(async(request,response)=>{
 const pathname=new URL(request.url,'http://127.0.0.1').pathname;
 if(pathname.startsWith('/rest/v1/')&&request.headers.apikey===apiKey){
  restCalls.push({method:request.method,path:pathname});
  const headers={...request.headers,authorization:`Bearer ${token}`,host:`127.0.0.1:${restPort}`};delete headers.apikey;
  const upstream=http.request({hostname:'127.0.0.1',port:restPort,path:request.url.slice('/rest/v1'.length),method:request.method,headers},reply=>{response.writeHead(reply.statusCode??502,reply.headers);reply.pipe(response);});
  upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end('local database unavailable');});request.pipe(upstream);return;
 }
 if(pathname.startsWith('/storage/v1/object/sign/')&&request.method==='POST'&&request.headers.apikey===apiKey){
  const key=pathname.slice('/storage/v1/object/sign/'.length);response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({signedURL:'/object/sign/'+key+'?token=local-fixture'}));return;
 }
 if(pathname.startsWith('/storage/v1/object/sign/')&&request.method==='GET'){
  const image=storedImages.get(pathname.slice('/storage/v1/object/sign/'.length));if(!image){response.writeHead(404).end();return;}
  response.writeHead(200,{'content-type':image.mime,'cache-control':'no-store'}).end(image.bytes);return;
 }
 if(pathname.startsWith('/storage/v1/object/')&&request.method==='POST'&&request.headers.apikey===apiKey){
  if(storageDenied){response.writeHead(403,{'content-type':'application/json'}).end(JSON.stringify({statusCode:403,error:'Forbidden',message:'Fixture storage denied'}));return;}
  const parts=[];for await(const chunk of request)parts.push(chunk);const key=pathname.slice('/storage/v1/object/'.length);
  storedImages.set(key,{bytes:Buffer.concat(parts),mime:request.headers['content-type']});uploads++;response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({Key:key,Id:'local-image'}));return;
 }
 response.writeHead(403).end('unavailable');
});
let server,rest,browser,activePage;
async function waitFor(url){for(let i=0;i<150;i++){if(server?.exitCode!==null&&server?.exitCode!==undefined)throw Error('Next server stopped');try{if((await fetch(url,{headers:{apikey:apiKey},signal:AbortSignal.timeout(1500)})).ok)return;}catch{}await new Promise(done=>setTimeout(done,400));}throw Error('Local service did not become ready: '+url);}
async function stop(child){if(!child||child.exitCode!==null)return;try{if(child===server)process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM');}catch{}await Promise.race([new Promise(done=>child.once('exit',done)),new Promise(done=>setTimeout(done,3000))]);}
const report={nativeDatabase:true,authentication:'local Clerk stub',objectStorage:'local simulated private storage',clipboard:'deterministic local Clipboard adapter, both permission outcomes',frameworkVersionCheck:'exact Next development npm version probe answered locally with HTTP 503',externalRequests:[],journeys:[],passed:0,failed:[]};
try{
 await new Promise(done=>gateway.listen(gatewayPort,'127.0.0.1',done));
 rebuild();
 const restLog=createWriteStream(join(out,'postgrest.log'));
 const startRest=()=>{rest=spawn(postgrest,[],{env:{...safeEnv,PGRST_DB_URI:database.href,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:jwtSecret,PGRST_SERVER_PORT:String(restPort),PGRST_SERVER_HOST:'127.0.0.1',PGRST_LOG_LEVEL:'error'},stdio:['ignore','pipe','pipe']});rest.stdout.pipe(restLog);rest.stderr.pipe(restLog);};
 startRest();await waitFor(`http://127.0.0.1:${gatewayPort}/rest/v1/clients?select=id`);
 const env={...safeEnv,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',AUTHORIZED_ADMIN_USER_ID:'user_e2e_admin',E2E_USER_ID:'user_e2e_admin',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'pk_test_e2e',NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${gatewayPort}`,SUPABASE_SECRET_KEY:apiKey,EMAIL_SENDING_ENABLED:'false',PUSH_SENDING_ENABLED:'false',WHATSAPP_INGESTION_ENABLED:'false'};
 server=spawn(process.execPath,['--require',guard,join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','-H','127.0.0.1','-p','3344'],{cwd:app,env,stdio:['ignore','pipe','pipe'],detached:true});
 const nextLog=createWriteStream(join(out,'next.log'));server.stdout.pipe(nextLog);server.stderr.pipe(nextLog);
 await waitFor(base+'/sign-in');
 browser=await chromium.launch({executablePath:process.env.E2E_CHROMIUM??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--disable-background-networking','--disable-component-update','--no-default-browser-check']});
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:375,height:812}]]){
  if(name!=='desktop'){await stop(rest);rebuild();storedImages.clear();uploads=0;startRest();await waitFor(`http://127.0.0.1:${gatewayPort}/rest/v1/clients?select=id`);}
  const context=await browser.newContext({viewport,locale:'fr-FR',timezoneId:'Europe/Paris',serviceWorkers:'block'}),errors=[];
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==base&&url.origin!==`http://127.0.0.1:${gatewayPort}`){report.externalRequests.push(url.origin);return route.abort();}return route.continue();});
  // Browser clipboard permissions differ by OS and CI container. Exercise both
  // component branches with a deterministic local adapter; downloads use the
  // browser's real download event and the filesystem.
  await context.addInitScript(()=>{globalThis.__publicationClipboardDenied=true;globalThis.__publicationCopied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(globalThis.__publicationClipboardDenied)throw new DOMException('Local clipboard permission denied','NotAllowedError');globalThis.__publicationCopied.push(text);}}});});
  const page=await context.newPage();activePage=page;page.setDefaultTimeout(35000);page.on('pageerror',e=>errors.push(e.message));
  const check=async label=>{const size=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert.ok(size.document<=size.width+1&&size.body<=size.width+1,label+': no horizontal overflow '+JSON.stringify(size));const html=await page.content();assert.ok(!html.includes(apiKey)&&!html.includes(jwtSecret),'No local credential leaked into HTML');assert.deepEqual(errors,[],label+': no browser runtime error');};
  const shot=async label=>{await check(label);await page.screenshot({path:join(out,name+'-'+label+'.png'),fullPage:true});};
  const publication=()=>{const rows=snapshot().publications;assert.equal(rows.length,1);return rows[0];};
  await page.goto(base+`/publications/new?client=${clientId}&project=${projectId}`);
  await page.getByRole('heading',{name:'Nouvelle publication',exact:true}).waitFor();
  assert.equal(await page.locator('[name=client_id]').inputValue(),clientId);assert.equal(await page.locator('[name=project_id]').inputValue(),projectId);
  assert.equal(await page.locator('[name=creation_mode][value=unscheduled]').isChecked(),true);
  await page.getByLabel('Titre interne',{exact:true}).fill(title);await page.getByLabel('Sujet / angle',{exact:true}).fill('Prévention et inspection');await page.getByLabel('Contenu source',{exact:true}).fill('Information fournie par le client pour cette fixture locale.');await page.locator('[name=facebook_text]').fill(initialText);
  await page.getByRole('button',{name:'Enregistrer le brouillon',exact:true}).click();await page.waitForURL(/\/publications\/[0-9a-f-]{36}$/);
  const id=publication().id;assert.equal(publication().slot,null);assert.equal(publication().occurrence_id,null);assert.equal(snapshot().publication_revisions.length,1);
  assert.equal(await page.getByRole('button',{name:'À publier',exact:true}).isDisabled(),true);await shot('01-draft-photo-required');
  const manualExport=page.locator('[data-publication-manual-export]');
  await manualExport.getByRole('note').filter({hasText:'Version non approuvée'}).waitFor();
  const exportBefore=snapshot();
  await manualExport.getByRole('button',{name:'Copier le texte',exact:true}).click();
  const fallback=manualExport.getByLabel(/^Texte à copier manuellement — Facebook/);await fallback.waitFor();assert.equal(await fallback.inputValue(),initialText);assert.equal(await fallback.evaluate(el=>el.selectionEnd-el.selectionStart),initialText.length,'Clipboard fallback selects the full saved text');
  await page.evaluate(()=>{globalThis.__publicationClipboardDenied=false;});await manualExport.getByRole('button',{name:'Copier le texte',exact:true}).click();await manualExport.getByRole('status').filter({hasText:'Texte copié.'}).waitFor();assert.deepEqual(await page.evaluate(()=>globalThis.__publicationCopied),[initialText]);
  const downloadPromise=page.waitForEvent('download');await manualExport.getByRole('button',{name:'Télécharger les textes',exact:true}).click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/^publication-.*-v1\.txt$/);const exportPath=join(out,name+'-draft-texts.txt');await download.saveAs(exportPath);const exported=readFileSync(exportPath,'utf8');assert.ok(exported.includes(initialText)&&exported.includes('NON APPROUVÉ'));for(const privateValue of [clientId,projectId,apiKey,jwtSecret,'Information fournie par le client pour cette fixture locale.'])assert.ok(!exported.includes(privateValue),'Export contains only public copy and human context');assert.deepEqual(snapshot(),exportBefore,'Copy and download cannot mutate a publication');
  const upload=page.locator('form[data-stage-media]');
  const stageImage=async buffer=>{await upload.locator('[name=image]').setInputFiles({name:'photo.png',mimeType:'image/png',buffer});await upload.getByLabel('Provenance',{exact:true}).fill('Photo de démonstration locale');await upload.locator('[name=rights]').check();await upload.getByRole('button',{name:'Préparer cette image',exact:true}).click();};
  await stageImage(Buffer.from('not an image, locally invalid'));await upload.getByRole('status').filter({hasText:'Le contenu du fichier ne correspond pas'}).waitFor();assert.equal(uploads,0);assert.equal(snapshot().publication_assets.length,0);
  storageDenied=true;await stageImage(png);await upload.getByRole('status').filter({hasText:'Upload impossible'}).waitFor();assert.equal(snapshot().publication_assets.length,0);storageDenied=false;
  await stageImage(png);await page.getByText('Nouvelle image — modifications non enregistrées',{exact:true}).waitFor();await page.waitForFunction(()=>{const image=document.querySelector('[data-media-panel] img');return image?.complete&&image.naturalWidth===1;});assert.equal(uploads,1);assert.equal(snapshot().publication_revisions.length,1,'Staging photo cannot mutate approved content');
  await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await manualExport.getByText('Version 2',{exact:false}).waitFor();assert.equal(snapshot().publication_revisions.length,2);assert.equal(snapshot().publication_variant_assets.length,1);await page.reload();
  const stale=await context.newPage();await stale.goto(base+'/publications/'+id);await stale.getByRole('button',{name:'À publier',exact:true}).waitFor();
  await page.getByRole('button',{name:'À publier',exact:true}).evaluate(button=>{button.click();button.click();});await page.getByText('Version approuvée. Toute modification',{exact:false}).waitFor();assert.equal(publication().status,'approved');assert.equal(snapshot().publication_reviews.length,1,'Double click creates one review');await shot('02-approved');
  await manualExport.getByText('Version 2',{exact:false}).waitFor();assert.equal(await manualExport.getByRole('note').filter({hasText:'Version non approuvée'}).count(),0);
  await page.locator('form[data-drawer-editor] [name=facebook_text]').fill(initialText+' Version corrigée après validation.');
  await page.evaluate(()=>{globalThis.__publicationClipboardDenied=false;});
  await manualExport.getByRole('button',{name:'Copier le texte',exact:true}).click();await manualExport.getByRole('status').filter({hasText:'Texte copié.'}).waitFor();assert.equal((await page.evaluate(()=>globalThis.__publicationCopied)).at(-1),initialText,'Unsaved editor text cannot leak into the saved-version export');
  await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await manualExport.getByText('Version 3',{exact:false}).waitFor();assert.equal(publication().status,'draft');assert.equal(snapshot().publication_revisions.length,3);assert.equal(snapshot().publication_reviews.length,1,'Previous review preserved as history');
  await stale.getByRole('button',{name:'À publier',exact:true}).click();await stale.getByRole('status').filter({hasText:'La publication a changé. Rechargez avant de valider.'}).waitFor();assert.equal(publication().status,'draft');assert.equal(snapshot().publication_reviews.length,1,'Stale tab cannot approve latest revision');await stale.close();await page.reload();
  await page.getByRole('button',{name:'À publier',exact:true}).click();await page.getByText('Version approuvée. Toute modification',{exact:false}).waitFor();assert.equal(snapshot().publication_reviews.length,2);
  await page.locator('[name=occurrence_facebook]').selectOption({index:1});const occurrence=await page.locator('[name=occurrence_facebook]').inputValue();await page.getByRole('button',{name:'Planifier ce brouillon',exact:true}).click();await manualExport.getByText('Version 4',{exact:false}).waitFor();assert.equal(publication().status,'draft');assert.equal(publication().occurrence_id,occurrence);assert.equal(snapshot().publication_revisions.length,4,'Scheduling invalidates previous approval');await page.reload();await shot('03-scheduled-new-approval-required');
  await page.getByRole('button',{name:'À publier',exact:true}).click();await page.getByText('Version approuvée. Toute modification',{exact:false}).waitFor();await page.getByRole('button',{name:'Préparer la diffusion',exact:true}).click();await page.locator('[data-diffusion]').getByRole('alert').filter({hasText:/Diffusion impossible/}).waitFor();assert.equal(snapshot().publication_deliveries.length,0);assert.equal(snapshot().publication_jobs.length,0);assert.equal(snapshot().publication_attempts.length,0);await shot('04-delivery-blocked-without-api');
  const date=publication().target_date;await page.goto(base+`/publications/calendar?date=${date}&client=${clientId}&project=${projectId}`);await page.getByRole('heading',{name:'Calendrier éditorial',exact:true}).waitFor();const calendarLink=page.getByRole('link',{name:title,exact:true});await calendarLink.waitFor();assert.equal(await calendarLink.count(),1,'A channel publication appears once in the global calendar');const calendarRow=page.getByRole('row').filter({has:calendarLink});assert.match(await calendarRow.innerText(),/18:00/);assert.match(await calendarRow.innerText(),/Europe\/Paris/);assert.ok(await page.getByRole('row').filter({hasText:'Contenu à préparer'}).count()>0,'Real open channel occurrences are visible without a fake publication');await shot('05-calendar');
  await page.goto(base+'/publications/'+id);await page.locator('[data-archive] [name=confirm]').check();await page.locator('[data-archive]').getByRole('button',{name:'Archiver',exact:true}).click();await page.locator('[data-read-only]').filter({hasText:/archivée/}).waitFor();assert.ok(publication().archived_at);assert.equal(await page.getByRole('button',{name:'À publier',exact:true}).count(),0);assert.equal(await page.locator('form[data-drawer-editor]').count(),0);assert.equal(await page.getByRole('link',{name:'Créer une nouvelle révision',exact:true}).count(),0);await shot('06-archived-read-only');
  await page.goto(base+'/publications/'+id+'/edit');await page.locator('[data-channel-lock]').filter({hasText:/archivée/}).waitFor();assert.equal(await page.getByRole('button',{name:'Enregistrer le brouillon',exact:true}).count(),0);await check('archived edit route');
  const final=snapshot();assert.equal(final.publication_reviews.length,3);assert.equal(final.publication_revisions.length,4);assert.equal(final.publication_deliveries.length,0);assert.equal(final.publication_jobs.length,0);assert.equal(final.publication_attempts.length,0);
  report.journeys.push({viewport:name,steps:['manual unscheduled draft','image required','clipboard denial fallback selected','clipboard local adapter success','real UTF-8 download without private fields or side effects','invalid image refused','private storage error recoverable','private image staged then revision saved','double approval click idempotent','edit invalidates approval','stale tab rejected','new approval','schedule invalidates approval','calendar visible','delivery blocked without API','archive read only including edit route'],revisions:4,reviews:3,realProviderCalls:0});report.passed++;console.log(`PASS publications ${name}: native SQL, complete workflow and manual export, no outgoing provider call.`);await context.close();
 }
 assert.deepEqual(report.externalRequests,[],'No browser request may escape loopback');assert.ok(!existsSync(join(out,'external-network-attempts.log')),'No server request may escape loopback');
 assert.ok(!restCalls.some(call=>call.path.includes('publication_job_claim')||call.path.includes('codev_claim_jobs')),'No scheduler or publication worker was activated');
}catch(error){report.failed.push(error.message);if(activePage){await activePage.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});writeFileSync(join(out,'failure.html'),await activePage.content().catch(()=>''));}throw error;
}finally{writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();await stop(server);await stop(rest);await new Promise(done=>gateway.close(done));}
