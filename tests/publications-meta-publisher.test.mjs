import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Lot 4.3 P11-b — real Meta publisher. Every provider answer is a mock: no request ever leaves the machine.
const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,Intl,Error,FormData,URL,URLSearchParams,console,Promise,Array,String,Math,Buffer,Uint8Array,TextEncoder,AbortSignal,Symbol,setTimeout,process:{env:{}},
   require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='react')return React;if(name==='server-only')return {};
    if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const model=load('lib/publications/delivery/model.ts');
const publisherContract=load('lib/publications/delivery/publisher.ts',{'./model':model});
const integration=load('lib/integrations/publications-meta-publish.ts');
const meta=load('lib/publications/delivery/meta-publisher.ts',{'@/lib/integrations/publications-meta-publish':integration});
const USER='EAAB-user-long-lived-secret',PAGE='EAAB-page-token-secret',SIGNED='https://storage.example.test/object/sign/publication-images/c/p/a?token=signed-jwt';
const SECRETS=[USER,PAGE,'signed-jwt','meta-app-secret-value'];
const leaks=v=>{const s=typeof v==='string'?v:JSON.stringify(v);return SECRETS.filter(x=>s.includes(x));};
const input=(extra={})=>({platform:'facebook',account:{externalAccountId:'1001',parentExternalId:null},text:'Avant l’hiver, faites vérifier votre toiture.',media:[],idempotencyKey:'deliver:v:a',
 credential:{accessToken:USER,refreshToken:null,expiresAt:'2030-01-01T00:00:00.000Z',scopes:['pages_show_list'],provider:'meta',subject:'987'},...extra});
const ig=(extra={})=>input({platform:'instagram',account:{externalAccountId:'17841400000000001',parentExternalId:'1001'},media:[{url:SIGNED,mimeType:'image/jpeg'}],...extra});
// Scripted Meta: answers by method + path; records every request (tokens included, to assert where they go).
function metaDouble(script){const calls=[];const transport={async request(r){calls.push(json(r));const h=script(r,calls.length);if(h instanceof Error)throw h;return h;}};return {transport,calls};}
const ok=body=>({status:200,body});
const page=()=>ok({access_token:PAGE,id:'1001'});
const err=(status,code,sub)=>({status,body:{error:{code,...(sub?{error_subcode:sub}:{}),message:`Invalid OAuth access token ${USER}`,fbtrace_id:'x'}}});
const timeout=()=>Object.assign(new Error('timeout'),{kind:'timeout'});
const publisherWith=(script,opts={})=>{const d=metaDouble(script);return {...d,p:meta.createMetaPublisher(d.transport,{sleep:async()=>{},pollAttempts:3,now:()=>Date.parse('2029-06-01T00:00:00Z'),...opts})};};

test('Facebook: text post via /feed, image post via /photos (caption), Page token in memory only',async()=>{
 let m=publisherWith(r=>r.method==='GET'?page():ok({id:'1001_555'}));
 let res=await m.p.publish(input());
 assert.deepEqual(json(res),{ok:true,remoteId:'1001_555',simulated:false});
 assert.deepEqual(m.calls.map(c=>[c.method,c.path]),[['GET','1001'],['POST','1001/feed']]);
 assert.equal(m.calls[0].token,USER,'Page token looked up with the user token');assert.equal(m.calls[1].token,PAGE,'post with the Page token');
 assert.deepEqual(m.calls[1].params,{message:'Avant l’hiver, faites vérifier votre toiture.'});
 m=publisherWith(r=>r.method==='GET'?page():ok({id:'777',post_id:'1001_778'}));
 res=await m.p.publish(input({media:[{url:SIGNED,mimeType:'image/png'}]}));
 assert.deepEqual(json(res),{ok:true,remoteId:'1001_778',simulated:false},'post id preferred over photo id');
 assert.deepEqual(m.calls[1],{method:'POST',path:'1001/photos',params:{url:SIGNED,caption:'Avant l’hiver, faites vérifier votre toiture.'},token:PAGE});
 assert.deepEqual(leaks(res),[]);});

test('Facebook failures: page / token / permission / rate limit before the write; ambiguous write → uncertain; malformed / missing id',async()=>{
 const r=async(script,extra={})=>json(await publisherWith(script).p.publish(input(extra)));
 assert.deepEqual(await r(()=>ok({})),{ok:false,errorClass:'auth',errorCode:'page_unavailable',retryAfterSeconds:null},'no Page token: Page unavailable');
 assert.deepEqual(await r(()=>err(400,100,33)),{ok:false,errorClass:'auth',errorCode:'account_unavailable',retryAfterSeconds:null});
 assert.deepEqual(await r(()=>err(400,190,463)),{ok:false,errorClass:'auth',errorCode:'token_expired',retryAfterSeconds:null});
 assert.deepEqual(await r(()=>err(400,190,460)),{ok:false,errorClass:'auth',errorCode:'token_revoked',retryAfterSeconds:null});
 assert.deepEqual(await r(x=>x.method==='GET'?page():err(403,200)),{ok:false,errorClass:'auth',errorCode:'permission_missing',retryAfterSeconds:null},'missing pages_manage_posts');
 assert.deepEqual(await r(x=>x.method==='GET'?page():err(400,32)),{ok:false,errorClass:'rate_limit',errorCode:'rate_limited',retryAfterSeconds:null});
 assert.deepEqual(await r(x=>x.method==='GET'?page():err(400,368)),{ok:false,errorClass:'invalid_payload',errorCode:'content_blocked',retryAfterSeconds:null});
 assert.deepEqual(await r(()=>timeout()),{ok:false,errorClass:'provider_unavailable',errorCode:'timeout',retryAfterSeconds:null},'timeout BEFORE the write: retryable');
 assert.deepEqual(await r(()=>({status:503,body:null})),{ok:false,errorClass:'provider_unavailable',errorCode:'provider_5xx',retryAfterSeconds:null});
 assert.deepEqual(await r(x=>x.method==='GET'?page():timeout()),{ok:false,uncertain:true,errorCode:'timeout_after_dispatch'},'timeout AFTER the write: uncertain');
 assert.deepEqual(await r(x=>x.method==='GET'?page():Object.assign(new Error('reset'),{kind:'network'})),{ok:false,uncertain:true,errorCode:'network_after_dispatch'});
 assert.deepEqual(await r(x=>x.method==='GET'?page():({status:500,body:null})),{ok:false,uncertain:true,errorCode:'provider_5xx'});
 assert.deepEqual(await r(x=>x.method==='GET'?page():err(500,2)),{ok:false,uncertain:true,errorCode:'provider_transient'},'transient error on a write: may exist');
 assert.deepEqual(await r(x=>x.method==='GET'?page():ok({})),{ok:false,uncertain:true,errorCode:'remote_id_missing'},'200 without id: never invented');
 assert.deepEqual(await r(x=>x.method==='GET'?page():({status:200,body:null})),{ok:false,uncertain:true,errorCode:'malformed_response'});
 assert.deepEqual(await r(()=>page(),{text:'   ',media:[]}),{ok:false,errorClass:'invalid_payload',errorCode:'empty_post',retryAfterSeconds:null});
 assert.deepEqual(await r(()=>page(),{credential:{...input().credential,expiresAt:'2020-01-01T00:00:00.000Z'}}),{ok:false,errorClass:'auth',errorCode:'token_expired',retryAfterSeconds:null},'expired user token: no call');
 assert.deepEqual(await r(()=>page(),{credential:{...input().credential,provider:'google_business_profile'}}),{ok:false,errorClass:'auth',errorCode:'credential_invalid',retryAfterSeconds:null});
 assert.deepEqual(await r(()=>page(),{media:[{url:'http://insecure.test/a.jpg',mimeType:'image/jpeg'}]}),{ok:false,errorClass:'invalid_payload',errorCode:'invalid_media',retryAfterSeconds:null});
 // P10 mapping of each result.
 assert.deepEqual(json(publisherContract.outcomeOf({ok:false,uncertain:true,errorCode:'timeout_after_dispatch'})),{result:'uncertain',errorCode:'timeout_after_dispatch'});
 assert.deepEqual(json(publisherContract.outcomeOf({ok:false,errorClass:'auth',errorCode:'token_revoked'})),{result:'auth',errorCode:'token_revoked',retryAfterSeconds:null});});

test('Instagram: container → status polling → media_publish; a container is never a publication',async()=>{
 let polls=0;let m=publisherWith(r=>{
  if(r.method==='GET'&&r.path==='1001')return page();
  if(r.path==='17841400000000001/media')return ok({id:'900001'});
  if(r.path==='900001'){polls++;return ok({status_code:polls<2?'IN_PROGRESS':'FINISHED'});}
  if(r.path==='17841400000000001/media_publish')return ok({id:'17890000000000001'});});
 const res=await m.p.publish(ig());
 assert.deepEqual(json(res),{ok:true,remoteId:'17890000000000001',simulated:false});
 assert.deepEqual(m.calls.map(c=>[c.method,c.path]),[['GET','1001'],['POST','17841400000000001/media'],['GET','900001'],['GET','900001'],['POST','17841400000000001/media_publish']],'async processing polled');
 assert.deepEqual(m.calls[1].params,{image_url:SIGNED,caption:'Avant l’hiver, faites vérifier votre toiture.'});assert.equal(m.calls[1].token,PAGE,'Instagram with the Page token');
 assert.deepEqual(m.calls[4].params,{creation_id:'900001'});
 const flow=(status,publish=ok({id:'17890000000000001'}),container=ok({id:'900001'}))=>publisherWith(r=>r.path==='1001'?page():r.path.endsWith('/media')?container:r.path==='900001'?status:publish);
 const r=async(m2,extra={})=>({res:json(await m2.p.publish(ig(extra))),calls:m2.calls});
 let x=await r(flow(ok({status_code:'ERROR'})));assert.deepEqual(x.res,{ok:false,errorClass:'invalid_payload',errorCode:'container_error',retryAfterSeconds:null},'processing failed');assert.ok(!x.calls.some(c=>c.path.endsWith('media_publish')));
 x=await r(flow(ok({status_code:'IN_PROGRESS'})));assert.deepEqual(x.res,{ok:false,errorClass:'retryable',errorCode:'container_processing',retryAfterSeconds:null},'still processing: nothing published, retry later');assert.ok(!x.calls.some(c=>c.path.endsWith('media_publish')));
 x=await r(flow(ok({status_code:'EXPIRED'})));assert.equal(x.res.errorCode,'container_expired');
 x=await r(flow(ok({status_code:'FINISHED'}),ok({}),err(400,36003)));assert.deepEqual(x.res,{ok:false,errorClass:'invalid_payload',errorCode:'invalid_media',retryAfterSeconds:null},'container rejected (aspect ratio)');
 x=await r(flow(ok({status_code:'FINISHED'}),ok({}),timeout()));assert.deepEqual(x.res,{ok:false,errorClass:'provider_unavailable',errorCode:'timeout',retryAfterSeconds:null},'timeout on the container: nothing published');
 x=await r(flow(ok({status_code:'FINISHED'}),timeout()));assert.deepEqual(x.res,{ok:false,uncertain:true,errorCode:'timeout_after_dispatch'},'timeout on media_publish: uncertain');
 x=await r(flow(ok({status_code:'FINISHED'}),err(400,9)));assert.equal(x.res.errorClass,'rate_limit','publishing limit (100 / 24 h)');
 x=await r(flow(ok({status_code:'FINISHED'}),ok({})));assert.deepEqual(x.res,{ok:false,uncertain:true,errorCode:'remote_id_missing'});
 x=await r(flow(ok({status_code:'PUBLISHED'})));assert.deepEqual(x.res,{ok:false,uncertain:true,errorCode:'container_already_published'});
 x=await r(flow(ok({})),{media:[]});assert.deepEqual(x.res,{ok:false,errorClass:'invalid_payload',errorCode:'image_required',retryAfterSeconds:null});assert.equal(x.calls.length,0,'checked before any call');
 x=await r(flow(ok({})),{media:[{url:SIGNED,mimeType:'image/png'}]});assert.equal(x.res.errorCode,'invalid_media','JPEG only');
 x=await r(flow(ok({})),{text:'#a '.repeat(31)});assert.equal(x.res.errorCode,'caption_invalid','30 hashtags max');
 x=await r(flow(ok({})),{text:'x'.repeat(2201)});assert.equal(x.res.errorCode,'caption_invalid','2200 characters max');
 x=await r(flow(ok({})),{account:{externalAccountId:'17841400000000001',parentExternalId:null}});assert.equal(x.res.errorCode,'instagram_unavailable');});

test('reconciliation: known id checked, lookup by exact text after dispatch, missing / unknown, never invented',async()=>{
 const rec=script=>{const d=metaDouble(script);return {...d,r:meta.createMetaReconciler(d.transport)};};
 const base={platform:'facebook',remoteId:null,idempotencyKey:'',credential:input().credential,account:{externalAccountId:'1001',parentExternalId:null},text:'Texte exact',since:'2029-06-01T10:00:00.000Z'};
 let m=rec(r=>r.path==='1001'?page():ok({data:[{id:'1001_1',message:'Texte exact',created_time:'2029-06-01T10:00:05+0000'},{id:'1001_0',message:'Texte exact',created_time:'2029-05-30T10:00:00+0000'}]}));
 assert.deepEqual(json(await m.r.reconcile(base)),{status:'exists',remoteId:'1001_1'},'post after the dispatch found');
 assert.deepEqual(m.calls[1].path,'1001/published_posts');assert.equal(m.calls[1].token,PAGE);
 m=rec(r=>r.path==='1001'?page():ok({data:[{id:'1001_2',message:'Autre texte',created_time:'2029-06-01T10:00:05+0000'}]}));assert.deepEqual(json(await m.r.reconcile(base)),{status:'missing',remoteId:null});
 m=rec(r=>r.path==='1001'?page():ok({data:[{id:'1001_3',message:'Texte exact',created_time:'2029-06-01T10:00:05+0000'},{id:'1001_4',message:'Texte exact',created_time:'2029-06-01T10:01:05+0000'}]}));
 assert.deepEqual(json(await m.r.reconcile(base)),{status:'unknown',remoteId:null},'two candidates: no guess');
 m=rec(()=>timeout());assert.deepEqual(json(await m.r.reconcile(base)),{status:'unknown',remoteId:null});
 m=rec(r=>r.path==='1001'?page():({status:500,body:null}));assert.deepEqual(json(await m.r.reconcile(base)),{status:'unknown',remoteId:null});
 m=rec(r=>r.path==='1001'?page():ok({id:'1001_9'}));assert.deepEqual(json(await m.r.reconcile({...base,remoteId:'1001_9'})),{status:'exists',remoteId:'1001_9'});
 m=rec(r=>r.path==='1001'?page():err(400,100,33));assert.deepEqual(json(await m.r.reconcile({...base,remoteId:'1001_9'})),{status:'missing',remoteId:null});
 m=rec(r=>r.path==='1001'?page():ok({data:[{id:'17890000000000005',caption:'Légende',timestamp:'2029-06-01T10:00:09+0000'}]}));
 assert.deepEqual(json(await m.r.reconcile({...base,platform:'instagram',account:{externalAccountId:'17841400000000001',parentExternalId:'1001'},text:'Légende'})),{status:'exists',remoteId:'17890000000000005'});
 assert.equal(m.calls[1].path,'17841400000000001/media');
 assert.deepEqual(json(await rec(()=>page()).r.reconcile({...base,since:null})),{status:'unknown',remoteId:null},'no dispatch time: unknown');
 assert.deepEqual(json(await rec(()=>page()).r.reconcile({...base,platform:'google_business_profile'})),{status:'unknown',remoteId:null});});

test('publish transport: write allowlist, token only in the Authorization header, appsecret_proof, no redirect, bounded, no retry',async()=>{
 const calls=[];const f=async(url,init)=>{calls.push({url,init:{...init,signal:undefined}});return {status:200,headers:{get:k=>({'content-type':'application/json'})[k.toLowerCase()]??null},text:async()=>JSON.stringify({id:'1'})};};
 const t=integration.metaPublishTransport({appSecret:'meta-app-secret-value'},f);
 await t.request({method:'POST',path:'1001/feed',params:{message:'Bonjour'},token:PAGE});
 assert.equal(calls[0].url,'https://graph.facebook.com/v25.0/1001/feed');assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.redirect,'error');
 assert.equal(calls[0].init.headers.Authorization,`Bearer ${PAGE}`);const body=new URLSearchParams(calls[0].init.body);
 assert.equal(body.get('appsecret_proof'),createHmac('sha256','meta-app-secret-value').update(PAGE).digest('hex'));assert.equal(body.get('message'),'Bonjour');
 assert.ok(!calls[0].url.includes('EAAB'),'never a token in the URL');
 await t.request({method:'GET',path:'1001',params:{fields:'access_token'},token:USER});assert.ok(!calls[1].url.includes('EAAB')&&!calls[1].url.includes('meta-app-secret'));
 for(const [method,path] of [['POST','1001'],['POST','1001/comments'],['POST','me/feed'],['GET','1001/feed'],['POST','1001/feed/../photos'],['DELETE','1001_1'],['GET','https://evil.test']])
  await assert.rejects(()=>t.request({method,path,params:{},token:PAGE}),e=>e.kind==='invalid_path',`${method} ${path}`);
 await assert.rejects(()=>integration.metaPublishTransport({appSecret:'s'},async()=>{throw Object.assign(new Error('x'),{name:'TimeoutError'});}).request({method:'POST',path:'1/feed',params:{},token:PAGE}),e=>e.kind==='timeout');
 assert.equal(calls.length,2,'a failed request is never retried by the transport');});

// --- Engine with the REAL Meta publisher (mock transport): kill switches and at-most-once ------------------------
const vault=load('lib/publications/connections/vault.ts');
const fakes=load('lib/publications/connections/fakes.ts',{'./vault':vault});
const engine=load('lib/publications/delivery/engine.ts',{'../connections/vault':vault,'./publisher':publisherContract,'./model':model});
async function engineHarness({claim,context,dispatch=true,complete}={}){
 const v=fakes.createMemoryCredentialVault(()=>uid(9,1));await v.storeCredential({accessToken:USER,refreshToken:null,expiresAt:'2030-01-01T00:00:00.000Z',scopes:[],provider:'meta'});
 const rpcs=[];const db={rpc:async(name,args)=>{rpcs.push([name,json(args)]);
   if(name==='publication_job_claim')return {data:claim===undefined?{job_id:uid(6,1),delivery_id:uid(5,1),attempt:1,platform:'facebook'}:claim,error:null};
   if(name==='publication_job_context')return {data:context??{status:'ready',job_id:uid(6,1),delivery_id:uid(5,1),attempt:1,platform:'facebook',idempotency_key:'deliver:v:a',text:'Bonjour',connection_id:uid(7,1),
    account:{external_account_id:'1001',parent_external_id:null},assets:[]},error:null};
   if(name==='publication_job_dispatch')return {data:dispatch,error:null};
   if(name==='publication_job_complete')return complete?complete(args):{data:{delivery_status:'published',job_status:'succeeded'},error:null};return {data:null,error:{code:'X'}};},
  from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{credential_reference:'vault:connection/'+uid(9,1),status:'active'},error:null})})})}),
  storage:{from:()=>({createSignedUrls:async paths=>({data:paths.map(p=>({path:p,signedUrl:'https://storage.example.test/'+p,error:null})),error:null})})}};
 let requests=0;const transport={async request(r){requests++;return r.method==='GET'?page():ok({id:'1001_42'});}};
 const publisher=meta.createMetaPublisher(transport,{sleep:async()=>{},now:()=>Date.parse('2029-06-01T00:00:00Z')});
 const logs=[];const original=console.error;console.error=(...a)=>logs.push(a);
 try{const result=await engine.runOnePublicationJob('worker-1',{db,vault:v,publisher});return {result:json(result),requests,rpcs,logs};}finally{console.error=original;}
}

test('kill switches with the real Meta publisher: no claim, blocked context or refused dispatch → zero provider request',async()=>{
 let h=await engineHarness({claim:null});assert.deepEqual(h.result,{state:'idle'});assert.equal(h.requests,0,'emergency stop: claim returns nothing');
 h=await engineHarness({context:{status:'blocked',reason:'emergency_stop'}});assert.deepEqual(h.result,{state:'blocked',reason:'emergency_stop'});assert.equal(h.requests,0);
 h=await engineHarness({context:{status:'blocked',reason:'publishing_disabled'}});assert.equal(h.requests,0);
 h=await engineHarness({dispatch:false});assert.deepEqual(h.result,{state:'blocked',reason:'not_ready'});assert.equal(h.requests,0,'last check before the dispatch marker');
 h=await engineHarness();assert.deepEqual(h.result,{state:'completed',deliveryStatus:'published',outcome:'published'});assert.equal(h.requests,2);
 assert.deepEqual(h.rpcs.map(r=>r[0]),['publication_job_claim','publication_job_context','publication_job_dispatch','publication_job_complete']);
 assert.deepEqual(h.rpcs[3][1].p_outcome,{result:'published',remote_id:'1001_42',duration_ms:h.rpcs[3][1].p_outcome.duration_ms});
 h=await engineHarness({complete:()=>({data:null,error:{code:'40001'}})});assert.deepEqual(h.result,{state:'unconfirmed'});assert.equal(h.requests,2,'completion lost: no second post');
 for(const x of [h.logs,h.rpcs])assert.deepEqual(leaks(x),[],'no token in logs or database calls');});

test('registry, production entry point, reconcile service and drawer actions: explicit only, fail closed, no secret',async()=>{
 const reg=load('lib/publications/delivery/registry.ts',{'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})},'@/lib/supabase/server':{getSupabaseServerClient:()=>({})},
  '@/lib/integrations/publications-oauth/config':{metaOAuthConfig:()=>null,googleOAuthConfig:()=>null},'@/lib/integrations/publications-meta-publish':integration,'../oauth/service':{productionOAuthDeps:()=>({vault:null})},
  '@/lib/integrations/publications-oauth/http':{},'@/lib/integrations/publications-gbp-publish':{},'../connections/google-business-profile':{},'./gbp-publisher':{},
  './meta-publisher':meta,'./engine':{runOnePublicationJob:async()=>{throw Error('must not run');}},'../connections/vault':vault});
 assert.deepEqual(json(await reg.registryPublisher({}).publish(input())),{ok:false,errorClass:'auth',errorCode:'provider_not_configured'});
 assert.deepEqual(json(reg.productionPublisherRegistry()),{publishers:{},reconcilers:{}},'no Meta config: no publisher');
 assert.deepEqual(json(await reg.runOnePublicationJobInProduction('worker-1')),{state:'idle'},'no vault: nothing runs');
 const v=fakes.createMemoryCredentialVault(()=>uid(9,2));const ref=await v.storeCredential({accessToken:USER,refreshToken:null,expiresAt:null,scopes:[],provider:'meta'});
 const rpcs=[];const ctx={platform:'facebook',remote_id:null,connection_id:uid(7,1),account:{external_account_id:'1001',parent_external_id:null},text:'Texte exact',since:'2029-06-01T10:00:00.000Z'};
 const db=(extra={})=>({rpc:async(n,a)=>{rpcs.push([n,json(a)]);if(extra[n])return extra[n](a);return n==='publication_delivery_reconcile_context'?{data:ctx,error:null}:{data:{status:'published'},error:null};},
  from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{credential_reference:ref,status:'active'},error:null})})})})});
 const reconciler={reconcile:async d=>{rpcs.push(['reconciler',{platform:d.platform,text:d.text,since:d.since,hasToken:Boolean(d.credential.accessToken)}]);return {status:'exists',remoteId:'1001_7'};}};
 let r=await reg.reconcileDelivery(uid(5,1),{db:db(),vault:v,reconcilers:{facebook:reconciler}});
 assert.equal(r.ok,true);assert.equal(r.result,'exists');assert.deepEqual(rpcs.find(x=>x[0]==='publication_delivery_reconcile')[1],{p_delivery_id:uid(5,1),p_status:'exists',p_remote_id:'1001_7',p_actor_id:'user_admin'});
 assert.deepEqual(leaks(rpcs),[],'credential never sent to the database');
 rpcs.length=0;r=await reg.reconcileDelivery(uid(5,1),{db:db(),vault:v,reconcilers:{facebook:{reconcile:async()=>({status:'missing',remoteId:null})}}});
 assert.match(r.message,/Aucune publication trouvée/);assert.equal(rpcs.find(x=>x[0]==='publication_delivery_reconcile')[1].p_remote_id,null);
 assert.match((await reg.reconcileDelivery(uid(5,1),{db:db(),vault:v,reconcilers:{}})).message,/indisponible/);
 assert.match((await reg.reconcileDelivery(uid(5,1),{db:db({publication_delivery_reconcile_context:()=>({data:null,error:{code:'55000'}})}),vault:v,reconcilers:{facebook:reconciler}})).message,/pas à vérifier/);
 assert.match((await reg.confirmDeliveryNotPublished(uid(5,1),{db:db({publication_delivery_confirm_not_published:()=>({data:null,error:{code:'55000',message:'Reconcile first: no provider check'}})})})).message,/Vérifiez d’abord/);
 const {DeliverySection}=load('components/publications/delivery-section.tsx',{'@/app/(cockpit)/publications/delivery-actions':{prepareDeliveryAction:async()=>({}),retryDeliveryAction:async()=>({}),reconcileDeliveryAction:async()=>({}),confirmNotPublishedAction:async()=>({})}});
 const v1=model.deliveryView({id:uid(5,1),platform:'instagram',status:'uncertain',remote_id:null,blocked_reason:null,last_error_class:'provider_unavailable',last_error_code:'timeout_after_dispatch'},{accountName:'@toitures',attempts:1,nextRetryAt:null});
 const html=renderToStaticMarkup(jsx.jsx(DeliverySection,{publicationId:uid(4,1),diffusion:{deliveries:[v1],canPrepare:false}}));
 assert.match(html,/Résultat incertain/);assert.match(html,/Vérifier chez le fournisseur/);assert.match(html,/Confirmer : non publiée/);assert.doesNotMatch(html,/>Réessayer</);assert.doesNotMatch(html,/Publier maintenant/i);});

test('P11-b scope: nothing triggers publishing, OAuth transport still read-only, generic logs, docs, migrations',()=>{
 for(const dir of ['app','components','lib','proxy.ts']){const files=dir.endsWith('.ts')?[dir]:readdirSync(resolve(root,dir),{recursive:true}).filter(f=>/\.(ts|tsx)$/.test(f)).map(f=>dir+'/'+f.replaceAll('\\','/'));
  for(const f of files){if(f.startsWith('lib/publications/delivery/')||f==='lib/integrations/publications-meta-publish.ts'||f==='lib/integrations/publications-gbp-publish.ts')continue;const code=src(f);
   assert.doesNotMatch(code,/runOnePublicationJobInProduction|runOnePublicationJob\b|createMetaPublisher|metaPublishTransport/,`${f}: no trigger of the real publisher`);}}
 assert.doesNotMatch(src('lib/integrations/publications-oauth/http.ts').replace(/\/\/[^\n]*/g,''),/feed|media_publish|\/photos/,'OAuth transport stays read-only');
 for(const f of ['lib/publications/delivery/meta-publisher.ts','lib/publications/delivery/registry.ts','lib/integrations/publications-meta-publish.ts']){const code=src(f).replace(/\/\/[^\n]*/g,'');
  assert.doesNotMatch(code,/console\.log/,f);for(const m of code.matchAll(/console\.error\(([^;]*)\)/g))assert.doesNotMatch(m[1],/token|credential|body|url|text|message|error\b/i,`${f}: generic logs`);}
 const doc=src('docs/publications-meta-publisher.md');for(const s of ['v25.0','/feed','/photos','/media_publish','status_code','pages_manage_posts','instagram_content_publish','uncertain','App Review'])assert.ok(doc.includes(s),s);
 assert.doesNotMatch(doc,/EAAB|appsecret_proof=[a-f0-9]{10}/);
 const list=readdirSync(resolve(root,'supabase/migrations')).sort();assert.equal(list.length,22);assert.equal(list[20],'20261012000000_publications_meta_publisher.sql');
 const sql=src('supabase/migrations/20261012000000_publications_meta_publisher.sql').replace(/--[^\n]*/g,'');assert.doesNotMatch(sql,/security definer|create policy|http|cron|insert into public\.publication_jobs/i);});

test('Gate 4: Meta reconciliation never concludes "missing" from a full page of newer posts (a false missing would allow a duplicate)',async()=>{
 const rec=script=>{const d=metaDouble(script);return {...d,r:meta.createMetaReconciler(d.transport)};};
 const base={platform:'facebook',remoteId:null,idempotencyKey:'',credential:{accessToken:USER,refreshToken:null,expiresAt:null,scopes:[],provider:'meta'},
  account:{externalAccountId:'1001',parentExternalId:null},text:'Texte exact',since:'2029-06-01T10:00:00.000Z'};
 const newer=n=>Array.from({length:n},(_,i)=>({id:`1001_${i+1}`,message:'Autre texte',created_time:'2029-06-01T11:00:00+0000'}));
 assert.deepEqual(json(await rec(r=>r.path==='1001'?page():ok({data:newer(25)})).r.reconcile(base)),{status:'unknown',remoteId:null},'full page, window not covered');
 assert.deepEqual(json(await rec(r=>r.path==='1001'?page():ok({data:newer(3)})).r.reconcile(base)),{status:'missing',remoteId:null},'page not full: whole window read');
 assert.deepEqual(json(await rec(r=>r.path==='1001'?page():ok({data:[...newer(24),{id:'1001_99',message:'Ancien',created_time:'2029-06-01T09:00:00+0000'}]})).r.reconcile(base)),{status:'missing',remoteId:null},'older post reached: window covered');
 const ig={...base,platform:'instagram',account:{externalAccountId:'17841400000000001',parentExternalId:'1001'}};
 assert.deepEqual(json(await rec(r=>r.path==='1001'?page():ok({data:Array.from({length:25},(_,i)=>({id:String(17890000000000100+i),caption:'Autre',timestamp:'2029-06-01T11:00:00+0000'}))})).r.reconcile(ig)),{status:'unknown',remoteId:null},'Instagram: same rule');});
