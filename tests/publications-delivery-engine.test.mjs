import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname,relative} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Lot 4.3 P10 — delivery engine. No provider, no network, no Supabase: database, vault and publisher are doubled.
const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,Intl,Error,FormData,URLSearchParams,console,Promise,Array,String,Math,
   require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='react')return React;if(name==='server-only')return {};
    if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const PUB=uid(4,1),DEL=uid(5,1),JOB=uid(6,1),CONN=uid(7,1),C=uid(1,1),REF='vault:connection/'+uid(9,1);
const model=load('lib/publications/delivery/model.ts');
const vault=load('lib/publications/connections/vault.ts');
const connectionFakes=load('lib/publications/connections/fakes.ts',{'./vault':vault});
const publisher=load('lib/publications/delivery/publisher.ts',{'./model':model});
const fakes=load('lib/publications/delivery/fakes.ts',{'./publisher':publisher});
const SQL=src('supabase/migrations/20261010000000_publications_delivery_engine.sql');

test('model: transitions, retry schedule and error classes mirror the SQL engine',()=>{
 const pairs=[...SQL.match(/function publications_private\.guard_delivery_transition[\s\S]*?\$\$;/)[0].matchAll(/\('([a-z_]+)','([a-z_]+)'\)/g)].map(m=>`${m[1]}>${m[2]}`).sort();
 const ts=Object.entries(json(model.DELIVERY_TRANSITIONS)).flatMap(([from,to])=>to.map(t=>`${from}>${t}`)).sort();
 assert.deepEqual(ts,pairs,'same transition table as the SQL guard');
 for(const final of ['published','simulated','cancelled'])assert.deepEqual(json(model.DELIVERY_TRANSITIONS[final]),[],final+' is final');
 assert.equal(model.canTransition('scheduled','published'),false);assert.equal(model.canTransition('processing','simulated'),true);assert.equal(model.canTransition('blocked','blocked'),true);
 assert.deepEqual(json(model.DELIVERY_STATUSES),[...SQL.match(/publication_deliveries_status_check check\(status in\(([^)]*)\)\)/)[1].matchAll(/'([a-z_]+)'/g)].map(m=>m[1]));
 assert.deepEqual([1,2,3,4,5,6,9].map(model.retryDelaySeconds),[60,300,900,3600,21600,21600,21600]);
 assert.match(SQL,/p_attempt<=1 then interval '1 minute' when p_attempt=2 then interval '5 minutes' when p_attempt=3 then interval '15 minutes'\s+when p_attempt=4 then interval '1 hour' else interval '6 hours'/,'SQL schedule identical');
 assert.equal(model.nextRetryDelaySeconds(2,'rate_limit',7200),7200);assert.equal(model.nextRetryDelaySeconds(2,'rate_limit',10),300);assert.equal(model.nextRetryDelaySeconds(1,'rate_limit',999999),21600);
 assert.equal(model.nextRetryDelaySeconds(5,'retryable'),null,'max attempts');assert.equal(model.nextRetryDelaySeconds(1,'permanent'),null);assert.equal(model.nextRetryDelaySeconds(1,'auth'),null);
 assert.deepEqual(json(model.ERROR_CLASSES),['retryable','permanent','auth','rate_limit','invalid_payload','provider_unavailable']);
 assert.equal(model.safeErrorCode('http_503'),'http_503');for(const bad of ['Invalid OAuth access token EAAB','x'.repeat(81),'{"a":1}',null])assert.equal(model.safeErrorCode(bad),null);});

test('model: outcome payload validated (simulated never recorded as published, no provider text) and safe delivery views',()=>{
 assert.deepEqual(json(model.outcomePayload({result:'simulated',remoteId:'simulated-abc'},12.4,'req-1')),{result:'simulated',remote_id:'simulated-abc',duration_ms:12,request_id:'req-1'});
 assert.throws(()=>model.outcomePayload({result:'published',remoteId:'simulated-abc'},1),'a simulated id is never a real publication');
 assert.throws(()=>model.outcomePayload({result:'simulated',remoteId:'123456'},1));
 assert.deepEqual(json(model.outcomePayload({result:'rate_limit',errorCode:'Too many calls for token EAAB',retryAfterSeconds:120.7},5,'bad id!')),{result:'rate_limit',retry_after_seconds:121,duration_ms:5},'raw code and bad request id dropped');
 const row={id:uid(5,1),platform:'instagram',status:'retryable_error',remote_id:null,blocked_reason:null,last_error_class:'provider_unavailable',last_error_code:'http_503'};
 assert.deepEqual(json(model.deliveryView(row,{accountName:'@toitures',attempts:2,nextRetryAt:'2026-10-12T10:00:00Z'})),{id:uid(5,1),platform:'instagram',platformLabel:'Instagram',accountLabel:'@toitures',
  status:'retryable_error',statusLabel:'Nouvelle tentative prévue',attempts:2,lastError:'Fournisseur indisponible (http_503)',blockedReason:null,nextRetryAt:'2026-10-12T10:00:00Z',remoteLabel:null,canRetry:true,canReconcile:false});
 const simulated=model.deliveryView({...row,status:'simulated',remote_id:'simulated-x',last_error_class:null,last_error_code:null},{accountName:null,attempts:1,nextRetryAt:'x'});
 assert.equal(simulated.remoteLabel,'Identifiant simulé (aucune publication réelle)');assert.equal(simulated.nextRetryAt,null);assert.equal(simulated.canRetry,false);assert.ok(!JSON.stringify(simulated).includes('simulated-x'),'remote id not displayed');
 assert.equal(model.deliveryView({...row,status:'blocked',blocked_reason:'emergency_stop'},{accountName:'a',attempts:0,nextRetryAt:null}).blockedReason,'Arrêt d’urgence actif');
 assert.equal(model.deliveryView({...row,status:'blocked',blocked_reason:'content_changed'},{accountName:'a',attempts:0,nextRetryAt:null}).blockedReason,'Contenu modifié depuis la préparation');
 assert.equal(model.deliveryView({...row,status:'weird'},{accountName:'a',attempts:0,nextRetryAt:null}),null,'unknown status not displayed');
 assert.equal(model.DELIVERY_ENGINE_NOTICE,'Envoi réel uniquement via « Envoyer les publications dues », et seulement si l’arrêt d’urgence est levé et la publication activée.');});

test('publisher contract and fake publisher: deterministic results, typed failures, unknown exceptions are uncertain',async()=>{
 assert.deepEqual(json(publisher.outcomeOf({ok:true,remoteId:'simulated-a',simulated:true})),{result:'simulated',remoteId:'simulated-a'});
 assert.deepEqual(json(publisher.outcomeOf({ok:false,errorClass:'auth',errorCode:'oauth_revoked'})),{result:'auth',errorCode:'oauth_revoked',retryAfterSeconds:null});
 assert.deepEqual(json(publisher.outcomeOf({ok:'maybe'})),{result:'uncertain',errorCode:'invalid_publisher_result'});
 assert.deepEqual(json(publisher.outcomeOfError(new publisher.PublisherError('rate_limit','rate_limited',60))),{result:'rate_limit',errorCode:'rate_limited',retryAfterSeconds:60});
 assert.deepEqual(json(publisher.outcomeOfError(new Error('ECONNRESET token EAAB'))),{result:'uncertain',errorCode:'publisher_exception'},'ambiguous: never retried blindly');
 const input={platform:'facebook',account:{externalAccountId:'page-1',parentExternalId:null},text:'T',media:[],idempotencyKey:'deliver:a:b',credential:{accessToken:'EAAB-secret',refreshToken:null,expiresAt:null,scopes:[]}};
 const p=fakes.createFakePublisher(['success','retryable','permanent','rate_limit','auth','throw']);
 const first=await p.publish(input);assert.equal(first.ok,true);assert.equal(first.simulated,true);assert.match(first.remoteId,/^simulated-[0-9a-f]{24}$/);
 assert.equal((await fakes.createFakePublisher().publish(input)).remoteId,first.remoteId,'deterministic id from the idempotency key');
 assert.equal((await p.publish(input)).errorClass,'retryable');assert.equal((await p.publish(input)).errorClass,'permanent');
 await assert.rejects(()=>p.publish(input),e=>e.errorClass==='rate_limit'&&e.retryAfterSeconds===7200);assert.equal((await p.publish(input)).errorClass,'auth');
 await assert.rejects(()=>p.publish(input));assert.equal(p.credentialsSeen,6);assert.ok(!JSON.stringify(p.calls).includes('EAAB'),'credential never kept by the fake');
 const r=fakes.createFakeReconciler({'deliver:a:b':'simulated-x'});assert.deepEqual(json(await r.reconcile({platform:'facebook',remoteId:null,idempotencyKey:'deliver:a:b',credential:input.credential})),{status:'exists',remoteId:'simulated-x'});
 assert.equal((await r.reconcile({platform:'facebook',remoteId:'x',idempotencyKey:'other',credential:input.credential})).status,'missing');});

// --- Engine ----------------------------------------------------------------------------------------------------
const engine=load('lib/publications/delivery/engine.ts',{'../connections/vault':vault,'./publisher':publisher,'./model':model});
const context=(extra={})=>({status:'ready',job_id:JOB,delivery_id:DEL,attempt:1,platform:'instagram',idempotency_key:'deliver:v:a',text:'Texte figé de la révision 1',
 connection_id:CONN,account:{external_account_id:'ig-1',parent_external_id:'page-1'},assets:[{asset_id:uid(8,1),storage_path:`${C}/${PUB}/${uid(8,1)}`,mime_type:'image/jpeg'}],...extra});
async function harness({ctx=context(),rpc={},connection={credential_reference:REF,status:'active'},signed=null,storeSecret=true}={}){
 const log=[];const v=connectionFakes.createMemoryCredentialVault(()=>uid(9,1));if(storeSecret)await v.storeCredential({accessToken:'EAAB-secret-token',refreshToken:null,expiresAt:null,scopes:[]});
 const db={rpc:async(name,args)=>{log.push(['rpc',name,json(args)]);if(rpc[name])return rpc[name](args);
   return name==='publication_job_claim'?{data:{job_id:JOB,delivery_id:DEL,attempt:1,platform:'instagram'},error:null}:name==='publication_job_context'?{data:ctx,error:null}
    :name==='publication_job_dispatch'?{data:true,error:null}:name==='publication_job_complete'?{data:{delivery_status:'simulated',job_status:'succeeded'},error:null}:{data:null,error:{code:'XX000'}};},
  from:table=>({select:c=>({eq:(k,id)=>({maybeSingle:async()=>{log.push(['read',table,c,id]);return {data:connection,error:null};}})})}),
  storage:{from:bucket=>({createSignedUrls:async(paths,ttl)=>{log.push(['sign',bucket,paths,ttl]);return signed??{data:paths.map(p=>({path:p,signedUrl:`https://storage.local/signed/${p.split('/').pop()}?token=short`,error:null})),error:null};}})}};
 return {db,log,vault:v,rpcs:name=>log.filter(x=>x[0]==='rpc'&&x[1]===name).map(x=>x[2])};}
const captureLogs=async work=>{const out=[];const original=console.error;console.error=(...a)=>out.push(a);try{return [await work(),out];}finally{console.error=original;}};

test('engine: claim → context → vault (memory) → signed snapshot media → dispatch → ONE provider call → complete',async()=>{
 const h=await harness();const pub=fakes.createFakePublisher(['success']);let t=1000;
 const [r,logs]=await captureLogs(()=>engine.runOnePublicationJob('worker-1',{db:h.db,vault:h.vault,publisher:pub,clock:()=>(t+=25)}));
 assert.deepEqual(json(r),{state:'completed',deliveryStatus:'simulated',outcome:'simulated'});
 assert.deepEqual(h.log.filter(x=>x[0]==='rpc').map(x=>x[1]),['publication_job_claim','publication_job_context','publication_job_dispatch','publication_job_complete'],'dispatch strictly before the provider call');
 assert.deepEqual(h.rpcs('publication_job_claim')[0],{p_worker_id:'worker-1',p_lease_seconds:120});
 assert.deepEqual(h.rpcs('publication_job_context')[0],{p_job_id:JOB,p_worker_id:'worker-1',p_attempt:1});
 assert.equal(pub.calls.length,1,'one provider call');
 assert.deepEqual(pub.calls[0],{platform:'instagram',account:{externalAccountId:'ig-1',parentExternalId:'page-1'},text:'Texte figé de la révision 1',
  media:[{url:`https://storage.local/signed/${uid(8,1)}?token=short`,mimeType:'image/jpeg'}],idempotencyKey:'deliver:v:a'},'text and media of the delivery snapshot only');
 assert.equal(pub.credentialsSeen,1,'credential handed in memory');
 const sign=h.log.find(x=>x[0]==='sign');assert.equal(sign[1],'publication-images');assert.ok(sign[3]>=60&&sign[3]<=600,'short-lived URLs');
 const complete=h.rpcs('publication_job_complete')[0];assert.equal(complete.p_outcome.result,'simulated');assert.match(complete.p_outcome.remote_id,/^simulated-/);assert.equal(complete.p_outcome.duration_ms,25);
 const persisted=JSON.stringify(h.log);for(const s of ['EAAB','accessToken','vault:connection'])assert.ok(!persisted.includes(s)||s==='vault:connection'&&!JSON.stringify(h.log.filter(x=>x[0]==='rpc')).includes(s),`not sent to the database: ${s}`);
 assert.deepEqual(logs,[],'nothing logged on success');
 const read=h.log.find(x=>x[0]==='read');assert.deepEqual(read.slice(1),['client_connections','credential_reference,status',CONN],'reference read on the server from the connection');});

test('engine: re-checks and failures never reach the provider twice; nothing secret logged or stored',async()=>{
 const run=async(h,steps=['success'])=>{const pub=fakes.createFakePublisher(steps);const [r,logs]=await captureLogs(()=>engine.runOnePublicationJob('worker-1',{db:h.db,vault:h.vault,publisher:pub}));return {r:json(r),pub,logs};};
 let h=await harness({ctx:{status:'blocked',reason:'emergency_stop'}});let o=await run(h);
 assert.deepEqual(o.r,{state:'blocked',reason:'emergency_stop'});assert.equal(o.pub.calls.length,0);assert.ok(!h.log.some(x=>x[0]==='read'),'blocked: the vault is not even read');
 h=await harness({rpc:{publication_job_claim:()=>({data:null,error:null})}});o=await run(h);assert.deepEqual(o.r,{state:'idle'});
 h=await harness({rpc:{publication_job_context:()=>({data:null,error:{code:'40001'}})}});o=await run(h);assert.deepEqual(o.r,{state:'stale'});assert.equal(o.pub.calls.length,0);
 h=await harness({connection:{credential_reference:REF,status:'disabled'}});o=await run(h);assert.deepEqual(o.r,{state:'aborted',step:'credential'});assert.equal(h.rpcs('publication_job_dispatch').length,0);
 h=await harness({storeSecret:false});o=await run(h);assert.deepEqual(o.r,{state:'aborted',step:'credential'},'secret missing in the vault');assert.equal(o.pub.calls.length,0);
 h=await harness({signed:{data:null,error:{message:'down'}}});o=await run(h);assert.deepEqual(o.r,{state:'aborted',step:'media'});assert.equal(h.rpcs('publication_job_dispatch').length,0);
 h=await harness({rpc:{publication_job_dispatch:()=>({data:false,error:null})}});o=await run(h);assert.deepEqual(o.r,{state:'blocked',reason:'not_ready'});assert.equal(o.pub.calls.length,0,'last kill-switch check before sending');
 h=await harness();o=await run(h,['throw']);
 assert.equal(h.rpcs('publication_job_complete')[0].p_outcome.result,'uncertain','exception after dispatch: uncertain, reconcile later');assert.equal(h.rpcs('publication_job_complete')[0].p_outcome.error_code,'publisher_exception');
 h=await harness();o=await run(h,['rate_limit']);assert.deepEqual(h.rpcs('publication_job_complete')[0].p_outcome,{result:'rate_limit',error_code:'rate_limited',retry_after_seconds:7200,duration_ms:h.rpcs('publication_job_complete')[0].p_outcome.duration_ms});
 h=await harness();o=await run(h,['auth']);assert.equal(h.rpcs('publication_job_complete')[0].p_outcome.result,'auth');
 h=await harness({rpc:{publication_job_complete:()=>({data:null,error:{code:'40001'}})}});o=await run(h);
 assert.deepEqual(o.r,{state:'unconfirmed'});assert.equal(o.pub.calls.length,1,'completion lost: the provider is NOT called again');
 for(const x of [JSON.stringify(o.logs),JSON.stringify(h.log)])assert.ok(!x.includes('EAAB'),'no token in logs or database calls');
 await assert.rejects(()=>engine.runOnePublicationJob('bad worker!',{db:h.db,vault:h.vault,publisher:fakes.createFakePublisher()}));
 assert.deepEqual(json(await engine.executeClaimedPublicationJob({job_id:'x',delivery_id:DEL,attempt:1,platform:'facebook'},'w',{db:h.db,vault:h.vault,publisher:fakes.createFakePublisher()})),{state:'stale'});});

// --- Admin service, actions, UI ----------------------------------------------------------------------------------
function serviceWith({rpc={},tables={}}={}){
 const log=[];const data={publication_deliveries:[{id:DEL,publication_id:PUB,platform:'facebook',status:'failed',remote_id:null,blocked_reason:null,last_error_class:'permanent',last_error_code:'fake_permanent',publication_account_id:uid(3,1),created_at:'2026-10-10T00:00:00Z'}],
  publication_accounts:[{id:uid(3,1),display_name:'Toitures Dupont',credential_reference:'ref:legacy/1'}],publication_attempts:[{delivery_id:DEL},{delivery_id:DEL}],
  publication_jobs:[],...tables};
 const db={from(table){const f=[];const rows=()=>({data:json((data[table]??[]).filter(r=>f.every(x=>x(r)))),error:null});
   const q={select:c=>{log.push(['select',table,c]);return q;},order:()=>q,eq(k,v){f.push(r=>r[k]===undefined||r[k]===v);return q;},in(k,vs){f.push(r=>vs.includes(r[k]));return q;},
    maybeSingle:async()=>({data:rows().data[0]??null,error:null}),then(ok,ko){return Promise.resolve(rows()).then(ok,ko);}};return q;},
  rpc:async(name,args)=>{log.push(['rpc',name,json(args)]);return rpc[name]?rpc[name](args):{data:{created:true,delivery_id:DEL},error:null};}};
 const m=load('lib/publications/delivery/service.ts',{'@/lib/require-admin':{requireAdmin:async()=>{log.push('admin');return {userId:'user_admin'};}},'@/lib/supabase/server':{getSupabaseServerClient:()=>db},'./model':model});
 return {m,log};}

test('service: deliveries view, prepare refusals mapped, retry only for a delivery of this publication',async()=>{
 const s=serviceWith();const views=await s.m.getPublicationDeliveries(PUB);assert.equal(s.log[0],'admin');
 assert.deepEqual(json(views.map(v=>[v.platformLabel,v.accountLabel,v.statusLabel,v.attempts,v.lastError,v.canRetry])),[['Facebook','Toitures Dupont','Échec',2,'Erreur définitive (fake_permanent)',true]]);
 assert.doesNotMatch(s.log.find(x=>x[0]==='select'&&x[1]==='publication_accounts')[2],/credential|external/,'never selects a credential');
 assert.deepEqual(json(await s.m.getPublicationDeliveries('nope')),[]);
 assert.deepEqual(json(await s.m.preparePublicationDelivery(PUB)),{ok:true,message:'Diffusion préparée : envoi à l’heure prévue, via « Envoyer les publications dues ».'});
 assert.deepEqual(s.log.filter(x=>x[0]==='rpc')[0][2],{p_publication_id:PUB,p_actor_id:'user_admin'});
 for(const [message,expected] of [['Not publishable: emergency_stop','Diffusion impossible : arrêt d’urgence actif.'],['Not publishable: no_account','Diffusion impossible : aucun compte de publication.'],
  ['Publication not approved','Diffusion impossible : la publication doit être validée.'],['Resolve deliveries first','Une diffusion est déjà en cours ou terminée pour cette publication.'],['boom','Diffusion indisponible.']])
  assert.equal((await serviceWith({rpc:{publication_prepare_delivery:()=>({data:null,error:{code:'55000',message}})}}).m.preparePublicationDelivery(PUB)).message,expected,message);
 const r=serviceWith();assert.deepEqual(json(await r.m.retryPublicationDelivery(PUB,DEL)),{ok:true,message:'Nouvelle tentative planifiée.'});
 assert.deepEqual(r.log.filter(x=>x[0]==='rpc').map(x=>x[1]),['publication_delivery_retry']);
 const foreign=serviceWith();assert.equal((await foreign.m.retryPublicationDelivery(uid(4,9),DEL)).message,'Diffusion invalide.');assert.ok(!foreign.log.some(x=>x[0]==='rpc'),'delivery of another publication: no RPC');});

test('actions and UI: admin first, « Diffusion » section, manual-trigger notice, no « Publier maintenant », no secret',async()=>{
 const calls=[];const a=load('app/(cockpit)/publications/delivery-actions.ts',{'next/cache':{revalidatePath:(p,t)=>calls.push(['revalidate',p,t??null])},'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');}},
  '@/lib/publications/delivery/service':{preparePublicationDelivery:async p=>{calls.push(['prepare',p]);return {ok:true,message:'ok'};},retryPublicationDelivery:async(p,d)=>{calls.push(['retry',p,d]);return {ok:true,message:'ok'};}}});
 const form=e=>{const f=new FormData();for(const [k,v] of Object.entries(e))f.set(k,v);return f;};
 await a.prepareDeliveryAction({},form({publication_id:PUB}));assert.deepEqual(json(calls.slice(0,2)),['admin',['prepare',PUB]]);assert.ok(calls.some(c=>c[1]==='/publications'));
 calls.length=0;await a.retryDeliveryAction({},form({publication_id:PUB,delivery_id:DEL}));assert.deepEqual(json(calls.slice(0,2)),['admin',['retry',PUB,DEL]]);
 const {DeliverySection}=load('components/publications/delivery-section.tsx',{'@/app/(cockpit)/publications/delivery-actions':{prepareDeliveryAction:async()=>({}),retryDeliveryAction:async()=>({})}});
 const view=(status,extra={})=>({...model.deliveryView({id:uid(5,status.length),platform:'facebook',status,remote_id:status==='simulated'?'simulated-x':null,blocked_reason:status==='blocked'?'connection_inactive':null,
  last_error_class:status==='failed'?'invalid_payload':null,last_error_code:status==='failed'?'text_too_long':null},{accountName:'Toitures Dupont',attempts:2,nextRetryAt:null}),...extra});
 const html=renderToStaticMarkup(jsx.jsx(DeliverySection,{publicationId:PUB,diffusion:{deliveries:[view('simulated'),view('failed'),view('blocked')],canPrepare:false}}));
 assert.match(html,/Diffusion/);assert.match(html,/data-engine-mode="manual-trigger"[^>]*>Envoi réel uniquement via « Envoyer les publications dues »/);
 assert.match(html,/Diffusion simulée/);assert.match(html,/Identifiant simulé \(aucune publication réelle\)/);assert.match(html,/Contenu refusé par le fournisseur \(text_too_long\)/);assert.match(html,/Motif : Connexion inactive/);
 assert.equal((html.match(/>Réessayer</g)??[]).length,2,'retry for failed and blocked only');assert.doesNotMatch(html,/Préparer la diffusion/);
 assert.doesNotMatch(html,/Publier maintenant|simulated-x|vault:|token|credential/i);
 const empty=renderToStaticMarkup(jsx.jsx(DeliverySection,{publicationId:PUB,diffusion:{deliveries:[],canPrepare:true}}));assert.match(empty,/Aucune diffusion préparée/);assert.match(empty,/Préparer la diffusion/);
 const drawer=src('components/publications/publication-drawer.tsx');assert.match(drawer,/<DeliverySection publicationId=\{detail\.publicationId\} diffusion=\{detail\.diffusion\}\/>/);
 for(const f of ['components/publications/delivery-section.tsx','app/(cockpit)/publications/delivery-actions.ts','lib/publications/delivery/model.ts'])
  assert.doesNotMatch(src(f).replace(/\/\/[^\n]*/g,''),/credential_reference|access_token|refresh_token|Bearer|@\/lib\/supabase|getSupabaseServerClient|\.rpc\(|process\.env|delivery\/engine|delivery\/fakes|Publier maintenant/i,f);});

test('P10 scope: no route runs the engine, fakes never imported by the app, no transport, one migration',()=>{
 for(const dir of ['app','components','lib']){for(const f of readdirSync(resolve(root,dir),{recursive:true}).filter(f=>/\.(ts|tsx)$/.test(f))){const rel=relative(root,resolve(root,dir,f)).replaceAll('\\','/');
  if(rel.startsWith('lib/publications/delivery/'))continue;const code=src(rel);
  assert.doesNotMatch(code,/delivery\/(engine|fakes)/,`${rel}: the engine and the simulated publisher are not wired to the application`);}}
 for(const f of readdirSync(resolve(root,'lib/publications/delivery'))){const code=src('lib/publications/delivery/'+f).replace(/\/\/[^\n]*/g,'');
  assert.doesNotMatch(code,/\bfetch\s*\(|https?:\/\/|process\.env|console\.log|setInterval|setTimeout|while\s*\(true\)/,f);
  for(const m of code.matchAll(/console\.error\(([^;]*)\)/g))assert.doesNotMatch(m[1],/credential|token|message|error\b|payload|text/,`${f}: generic logs only`);}
 const list=readdirSync(resolve(root,'supabase/migrations')).filter(f=>f<'20261015').sort();assert.equal(list.length,23);assert.equal(list[18],'20261010000000_publications_delivery_engine.sql');
 const sql=SQL.replace(/--[^\n]*/g,'');assert.doesNotMatch(sql,/security definer|delete from public\.|drop table|drop function|cron|http|net\./i);
 assert.match(sql,/for update of j skip locked/,'concurrent claiming');});
