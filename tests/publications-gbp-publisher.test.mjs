import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Lot 4.3 P12 — real Google Business Profile publisher. Every provider answer is a mock: no request leaves the machine.
const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,Intl,Error,URL,URLSearchParams,console,Promise,Array,String,Math,Buffer,Uint8Array,TextEncoder,AbortSignal,Symbol,RegExp,process:{env:{}},
   require:name=>{if(name in mocks)return mocks[name];if(name==='server-only')return {};
    if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const model=load('lib/publications/delivery/model.ts');
const publisherContract=load('lib/publications/delivery/publisher.ts',{'./model':model});
const integration=load('lib/integrations/publications-gbp-publish.ts');
const gbp=load('lib/publications/delivery/gbp-publisher.ts');
const ACCESS='ya29.stored-access-token-secret',FRESH='ya29.refreshed-access-token-secret',REFRESH='1//refresh-token-secret',SIGNED='https://storage.example.test/object/sign/publication-images/c/p/a?token=signed-jwt';
const SECRETS=[ACCESS,FRESH,REFRESH,'signed-jwt'];
const leaks=v=>{const s=typeof v==='string'?v:JSON.stringify(v);return SECRETS.filter(x=>s.includes(x));};
const NOW=Date.parse('2029-06-01T10:00:00Z'),LOC='accounts/10/locations/1';
const credential=(extra={})=>({accessToken:ACCESS,refreshToken:REFRESH,expiresAt:'2029-06-01T10:30:00.000Z',scopes:['https://www.googleapis.com/auth/business.manage'],provider:'google_business_profile',subject:null,...extra});
const input=(extra={})=>({platform:'google_business_profile',account:{externalAccountId:LOC,parentExternalId:'accounts/10'},text:'Avant l’hiver, faites vérifier votre toiture.',media:[],idempotencyKey:'deliver:v:a',credential:credential(),...extra});
function double(script){const calls=[];const transport={async request(r){calls.push(json(r));const h=script(r,calls.length);if(h instanceof Error)throw h;return h;}};return {transport,calls};}
const ok=body=>({status:200,body});
const post=(extra={})=>ok({name:`${LOC}/localPosts/abc123`,state:'LIVE',summary:'x',createTime:'2029-06-01T10:00:01Z',...extra});
const gerr=(status,code)=>({status,body:{error:{code:status,status:code,message:`Request had invalid authentication credentials ${ACCESS}`}}});
const kind=k=>Object.assign(new Error(k),{kind:k});
const publisherWith=(script,opts={})=>{const d=double(script);return {...d,p:gbp.createGoogleBusinessProfilePublisher(d.transport,{now:()=>NOW,...opts})};};

test('GBP: STANDARD local post (text, optional photo by signed URL), token only in the request, Google post name kept',async()=>{
 let m=publisherWith(()=>post());
 let res=await m.p.publish(input());
 assert.deepEqual(json(res),{ok:true,remoteId:`${LOC}/localPosts/abc123`,simulated:false});
 assert.deepEqual(m.calls,[{method:'POST',path:`${LOC}/localPosts`,params:{},body:{languageCode:'fr',summary:'Avant l’hiver, faites vérifier votre toiture.',topicType:'STANDARD'},token:ACCESS}]);
 m=publisherWith(()=>post({state:'PROCESSING'}));
 res=await m.p.publish(input({media:[{url:SIGNED,mimeType:'image/png'}]}));
 assert.equal(res.ok,true,'PROCESSING is accepted (Google reviews asynchronously)');
 assert.deepEqual(m.calls[0].body.media,[{mediaFormat:'PHOTO',sourceUrl:SIGNED}]);
 m=publisherWith(()=>post());await m.p.publish(input({media:[{url:SIGNED,mimeType:'image/jpeg'}]}));assert.equal(m.calls.length,1,'exactly one create');
 assert.deepEqual(leaks(res),[]);});

test('GBP validation before any call: platform, location, empty / too long text, media type, count and scheme',async()=>{
 const r=async extra=>{const m=publisherWith(()=>{throw Error('must not call');});const res=json(await m.p.publish(input(extra)));assert.equal(m.calls.length,0);return [res.errorClass,res.errorCode];};
 assert.deepEqual(await r({platform:'facebook'}),['permanent','unsupported_platform']);
 assert.deepEqual(await r({account:{externalAccountId:'locations/1',parentExternalId:null}}),['auth','location_unavailable']);
 assert.deepEqual(await r({account:{externalAccountId:'accounts/10/locations/1/../2',parentExternalId:null}}),['auth','location_unavailable']);
 assert.deepEqual(await r({text:'   '}),['invalid_payload','empty_post']);
 assert.deepEqual(await r({text:'a'.repeat(gbp.GBP_SUMMARY_MAX+1)}),['invalid_payload','text_too_long']);
 assert.deepEqual(await r({media:[{url:SIGNED,mimeType:'image/gif'}]}),['invalid_payload','invalid_media']);
 assert.deepEqual(await r({media:[{url:'http://storage.example.test/a.jpg',mimeType:'image/jpeg'}]}),['invalid_payload','invalid_media']);
 assert.deepEqual(await r({media:[{url:SIGNED,mimeType:'image/jpeg'},{url:SIGNED,mimeType:'image/jpeg'}]}),['invalid_payload','too_many_media']);
 assert.deepEqual(await r({credential:credential({provider:'meta'})}),['auth','credential_invalid'],'a Meta secret is never sent to Google');
 assert.deepEqual(await r({credential:credential({expiresAt:'2029-06-01T09:00:00Z',refreshToken:null})}),['auth','token_expired']);});

test('GBP access token: refreshed in memory when expired (never before the create fails), refresh failures before any write',async()=>{
 const refreshed=[];const refresh=async c=>{refreshed.push(c.refreshToken);return {...c,accessToken:FRESH,expiresAt:'2029-06-01T11:00:00Z'};};
 let m=publisherWith(()=>post(),{refresh});
 await m.p.publish(input());assert.equal(refreshed.length,0,'valid token: no refresh');assert.equal(m.calls[0].token,ACCESS);
 m=publisherWith(()=>post(),{refresh});
 const res=await m.p.publish(input({credential:credential({expiresAt:'2029-06-01T10:00:30Z'})}));
 assert.equal(res.ok,true);assert.deepEqual(refreshed,[REFRESH]);assert.equal(m.calls[0].token,FRESH,'create with the refreshed token');
 for(const [k,expected] of [['revoked',['auth','token_revoked']],['expired',['auth','token_revoked']],['permission',['auth','permission_missing']],['rate_limited',['rate_limit','rate_limited']],['unavailable',['provider_unavailable','token_refresh_failed']]]){
  m=publisherWith(()=>{throw Error('must not call');},{refresh:async()=>{throw kind(k);}});
  const out=json(await m.p.publish(input({credential:credential({expiresAt:null})})));
  assert.deepEqual([out.errorClass,out.errorCode],expected,k);assert.equal(out.uncertain,undefined,'nothing can exist: never uncertain');assert.equal(m.calls.length,0);}
 m=publisherWith(()=>post(),{refresh:async c=>({...c,accessToken:''})});
 assert.equal(json(await m.p.publish(input({credential:credential({expiresAt:null})}))).errorCode,'token_invalid');});

test('GBP error mapping: explicit 4xx → classified (no post), 5xx / 409 / timeout / lost id after the create → uncertain',async()=>{
 const r=async script=>json(await publisherWith(script).p.publish(input()));
 const pair=o=>o.uncertain?['uncertain',o.errorCode]:[o.errorClass,o.errorCode];
 assert.deepEqual(pair(await r(()=>gerr(401,'UNAUTHENTICATED'))),['auth','token_invalid']);
 assert.deepEqual(pair(await r(()=>gerr(403,'PERMISSION_DENIED'))),['auth','permission_missing'],'API not approved (0 QPM) or no access');
 assert.deepEqual(pair(await r(()=>gerr(404,'NOT_FOUND'))),['auth','location_unavailable']);
 assert.deepEqual(pair(await r(()=>gerr(429,'RESOURCE_EXHAUSTED'))),['rate_limit','rate_limited'],'GBP quota');
 assert.deepEqual(pair(await r(()=>gerr(400,'INVALID_ARGUMENT'))),['invalid_payload','invalid_parameter']);
 assert.deepEqual(pair(await r(()=>gerr(400,'FAILED_PRECONDITION'))),['invalid_payload','invalid_parameter']);
 assert.deepEqual(pair(await r(()=>gerr(500,'INTERNAL'))),['uncertain','provider_5xx']);
 assert.deepEqual(pair(await r(()=>gerr(503,'UNAVAILABLE'))),['uncertain','provider_5xx']);
 assert.deepEqual(pair(await r(()=>gerr(409,'ALREADY_EXISTS'))),['uncertain','provider_conflict']);
 assert.deepEqual(pair(await r(()=>({status:502,body:null}))),['uncertain','provider_5xx']);
 assert.deepEqual(pair(await r(()=>kind('timeout'))),['uncertain','timeout_after_dispatch']);
 assert.deepEqual(pair(await r(()=>kind('network'))),['uncertain','network_after_dispatch']);
 assert.deepEqual(pair(await r(()=>kind('too_large'))),['uncertain','network_after_dispatch']);
 assert.deepEqual(pair(await r(()=>kind('invalid_path'))),['permanent','invalid_request']);
 assert.deepEqual(pair(await r(()=>ok({}))),['uncertain','remote_id_missing']);
 assert.deepEqual(pair(await r(()=>post({name:'accounts/10/locations/2/localPosts/x'}))),['uncertain','remote_id_missing'],'a post of another location is never accepted');
 assert.deepEqual(pair(await r(()=>post({state:'REJECTED'}))),['invalid_payload','post_rejected']);
 for(const x of [await r(()=>gerr(401,'UNAUTHENTICATED')),await r(()=>gerr(500,'INTERNAL'))])assert.deepEqual(leaks(x),[],'provider text never kept');
 const outcome=publisherContract.outcomeOf(await r(()=>kind('timeout')));assert.deepEqual(json(outcome),{result:'uncertain',errorCode:'timeout_after_dispatch'},'P10: uncertain, never retried');
 assert.equal(publisherContract.outcomeOf(await r(()=>gerr(429,'RESOURCE_EXHAUSTED'))).result,'rate_limit');});

test('GBP reconciler: known name read, otherwise exact summary after the dispatch over bounded pages; never invents an id',async()=>{
 const rec=(script,opts={})=>{const d=double(script);return {...d,r:gbp.createGoogleBusinessProfileReconciler(d.transport,{now:()=>NOW,...opts})};};
 const base={platform:'google_business_profile',remoteId:null,idempotencyKey:'',credential:credential(),account:{externalAccountId:LOC,parentExternalId:'accounts/10'},text:'Texte exact',since:'2029-06-01T10:00:00.000Z'};
 const p=(id,summary,createTime='2029-06-01T10:00:05Z',state='LIVE')=>({name:`${LOC}/localPosts/${id}`,summary,createTime,state});
 let m=rec(()=>ok({localPosts:[p('a','Autre'),p('b','Texte exact'),p('old','Texte exact','2029-05-01T10:00:00Z'),p('rej','Texte exact','2029-06-01T10:00:06Z','REJECTED')]}));
 assert.deepEqual(json(await m.r.reconcile(base)),{status:'exists',remoteId:`${LOC}/localPosts/b`});
 assert.deepEqual(m.calls,[{method:'GET',path:`${LOC}/localPosts`,params:{pageSize:'100'},token:ACCESS}]);
 m=rec((r,n)=>n===1?ok({localPosts:[p('a','Autre')],nextPageToken:'page-2'}):ok({localPosts:[]}));
 assert.deepEqual(json(await m.r.reconcile(base)),{status:'missing',remoteId:null},'every page read: missing');assert.equal(m.calls[1].params.pageToken,'page-2');
 m=rec(()=>ok({localPosts:[],nextPageToken:'again'}));
 assert.deepEqual(json(await m.r.reconcile(base)),{status:'unknown',remoteId:null},'more pages than the bound: cannot conclude');assert.equal(m.calls.length,5);
 assert.deepEqual(json(await rec(()=>ok({localPosts:[p('a','Texte exact'),p('b','Texte exact')]})).r.reconcile(base)),{status:'unknown',remoteId:null},'two matches: unknown');
 assert.deepEqual(json(await rec(()=>gerr(500,'INTERNAL')).r.reconcile(base)),{status:'unknown',remoteId:null});
 assert.deepEqual(json(await rec(()=>kind('timeout')).r.reconcile(base)),{status:'unknown',remoteId:null});
 const known={...base,remoteId:`${LOC}/localPosts/k1`};
 assert.deepEqual(json(await rec(()=>ok({name:`${LOC}/localPosts/k1`,state:'LIVE'})).r.reconcile(known)),{status:'exists',remoteId:`${LOC}/localPosts/k1`});
 assert.deepEqual(json(await rec(()=>gerr(404,'NOT_FOUND')).r.reconcile(known)),{status:'missing',remoteId:null});
 assert.deepEqual(json(await rec(()=>gerr(403,'PERMISSION_DENIED')).r.reconcile(known)),{status:'unknown',remoteId:null});
 assert.deepEqual(json(await rec(()=>{throw Error('no call');}).r.reconcile({...base,remoteId:'accounts/10/locations/2/localPosts/k1'})),{status:'unknown',remoteId:null},'name of another location');
 assert.deepEqual(json(await rec(()=>{throw Error('no call');}).r.reconcile({...base,since:null})),{status:'unknown',remoteId:null});
 assert.deepEqual(json(await rec(()=>{throw Error('no call');}).r.reconcile({...base,platform:'facebook'})),{status:'unknown',remoteId:null});
 assert.deepEqual(json(await rec(()=>{throw Error('no call');}).r.reconcile({...base,credential:credential({expiresAt:null,refreshToken:null})})),{status:'unknown',remoteId:null},'expired, no refresh: unknown');
 m=rec(()=>ok({localPosts:[p('b','Texte exact')]}),{refresh:async c=>({...c,accessToken:FRESH})});
 assert.equal((await m.r.reconcile({...base,credential:credential({expiresAt:null})})).status,'exists');assert.equal(m.calls[0].token,FRESH);});

test('GBP transport: v4 localPosts allowlist, Authorization header only, JSON body, no redirect, bounded, no retry',async()=>{
 const calls=[];const f=async(url,init)=>{calls.push({url,init:{...init,signal:undefined}});return {status:200,headers:{get:k=>({'content-type':'application/json; charset=UTF-8'})[k.toLowerCase()]??null},text:async()=>JSON.stringify({name:'x'})};};
 const t=integration.gbpPublishTransport(f);
 const res=await t.request({method:'POST',path:`${LOC}/localPosts`,params:{},body:{summary:'Bonjour'},token:ACCESS});
 assert.deepEqual(json(res),{status:200,body:{name:'x'}});
 assert.equal(calls[0].url,`https://mybusiness.googleapis.com/v4/${LOC}/localPosts`);assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.redirect,'error');
 assert.equal(calls[0].init.headers.Authorization,`Bearer ${ACCESS}`);assert.equal(calls[0].init.headers['Content-Type'],'application/json');assert.deepEqual(JSON.parse(calls[0].init.body),{summary:'Bonjour'});
 await t.request({method:'GET',path:`${LOC}/localPosts`,params:{pageSize:'100'},token:ACCESS});assert.equal(calls[1].url,`https://mybusiness.googleapis.com/v4/${LOC}/localPosts?pageSize=100`);
 await t.request({method:'GET',path:`${LOC}/localPosts/abc`,params:{},token:ACCESS});
 for(const c of calls)assert.ok(!c.url.includes('ya29'),'never a token in the URL');
 for(const [method,path] of [['POST',`${LOC}/localPosts/abc`],['POST',`${LOC}/media`],['POST',`${LOC}`],['GET',`${LOC}/reviews`],['POST',`${LOC}/localPosts/../media`],['DELETE',`${LOC}/localPosts`],['PATCH',`${LOC}/localPosts`],['GET','https://evil.test'],['POST','locations/1/localPosts']])
  await assert.rejects(()=>t.request({method,path,params:{},token:ACCESS}),e=>e.kind==='invalid_path',`${method} ${path}`);
 await assert.rejects(()=>t.request({method:'POST',path:`${LOC}/localPosts`,params:{},token:''}),e=>e.kind==='invalid_path','no token: refused');
 await assert.rejects(()=>integration.gbpPublishTransport(async()=>{throw Object.assign(new Error('x'),{name:'TimeoutError'});}).request({method:'POST',path:`${LOC}/localPosts`,params:{},token:ACCESS}),e=>e.kind==='timeout');
 await assert.rejects(()=>integration.gbpPublishTransport(async()=>({status:200,headers:{get:k=>k==='content-length'?'5000000':null},text:async()=>''})).request({method:'GET',path:`${LOC}/localPosts`,params:{},token:ACCESS}),e=>e.kind==='too_large');
 assert.equal(calls.length,3,'a failed request is never retried by the transport');});

// --- Engine with the REAL GBP publisher (mock transport): kill switches and at-most-once -------------------------
const vault=load('lib/publications/connections/vault.ts');
const fakes=load('lib/publications/connections/fakes.ts',{'./vault':vault});
const engine=load('lib/publications/delivery/engine.ts',{'../connections/vault':vault,'./publisher':publisherContract,'./model':model});
async function engineHarness({claim,context,dispatch=true,complete,answer=()=>post()}={}){
 const v=fakes.createMemoryCredentialVault(()=>uid(9,1));await v.storeCredential(credential());
 const rpcs=[];const db={rpc:async(name,args)=>{rpcs.push([name,json(args)]);
   if(name==='publication_job_claim')return {data:claim===undefined?{job_id:uid(6,1),delivery_id:uid(5,1),attempt:1,platform:'google_business_profile'}:claim,error:null};
   if(name==='publication_job_context')return {data:context??{status:'ready',job_id:uid(6,1),delivery_id:uid(5,1),attempt:1,platform:'google_business_profile',idempotency_key:'deliver:v:a',text:'Bonjour',connection_id:uid(7,1),
    account:{external_account_id:LOC,parent_external_id:'accounts/10'},assets:[]},error:null};
   if(name==='publication_job_dispatch')return {data:dispatch,error:null};
   if(name==='publication_job_complete')return complete?complete(args):{data:{delivery_status:'published',job_status:'succeeded'},error:null};return {data:null,error:{code:'X'}};},
  from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{credential_reference:'vault:connection/'+uid(9,1),status:'active'},error:null})})})}),
  storage:{from:()=>({createSignedUrls:async paths=>({data:paths.map(p=>({path:p,signedUrl:'https://storage.example.test/'+p,error:null})),error:null})})}};
 let requests=0;const transport={async request(){requests++;const a=answer();if(a instanceof Error)throw a;return a;}};
 const publisher=gbp.createGoogleBusinessProfilePublisher(transport,{now:()=>NOW});
 const logs=[];const original=console.error;console.error=(...a)=>logs.push(a);
 try{const result=await engine.runOnePublicationJob('worker-1',{db,vault:v,publisher});return {result:json(result),requests,rpcs,logs};}finally{console.error=original;}
}

test('kill switches with the real GBP publisher: no claim, blocked context or refused dispatch → zero Google request; lost answer → uncertain',async()=>{
 let h=await engineHarness({claim:null});assert.deepEqual(h.result,{state:'idle'});assert.equal(h.requests,0,'emergency stop: claim returns nothing');
 h=await engineHarness({context:{status:'blocked',reason:'emergency_stop'}});assert.deepEqual(h.result,{state:'blocked',reason:'emergency_stop'});assert.equal(h.requests,0);
 h=await engineHarness({context:{status:'blocked',reason:'publishing_disabled'}});assert.equal(h.requests,0);
 h=await engineHarness({dispatch:false});assert.deepEqual(h.result,{state:'blocked',reason:'not_ready'});assert.equal(h.requests,0,'last check before the dispatch marker');
 h=await engineHarness();assert.deepEqual(h.result,{state:'completed',deliveryStatus:'published',outcome:'published'});assert.equal(h.requests,1);
 assert.deepEqual(h.rpcs[3][1].p_outcome,{result:'published',remote_id:`${LOC}/localPosts/abc123`,duration_ms:h.rpcs[3][1].p_outcome.duration_ms});
 h=await engineHarness({answer:()=>kind('timeout'),complete:()=>({data:{delivery_status:'uncertain',job_status:'failed'},error:null})});
 assert.deepEqual(h.rpcs[3][1].p_outcome.result,'uncertain');assert.equal(h.requests,1,'never a second create');
 h=await engineHarness({complete:()=>({data:null,error:{code:'40001'}})});assert.deepEqual(h.result,{state:'unconfirmed'});assert.equal(h.requests,1,'completion lost: no second post');
 for(const x of [h.logs,h.rpcs])assert.deepEqual(leaks(x),[],'no token in logs or database calls');});

test('P12 scope: nothing triggers publishing, OAuth transport still read-only, generic logs, docs, migrations',()=>{
 for(const dir of ['app','components','lib','proxy.ts']){const files=dir.endsWith('.ts')?[dir]:readdirSync(resolve(root,dir),{recursive:true}).filter(f=>/\.(ts|tsx)$/.test(f)).map(f=>dir+'/'+f.replaceAll('\\','/'));
  for(const f of files){if(f.startsWith('lib/publications/delivery/')||f==='lib/integrations/publications-gbp-publish.ts')continue;
   assert.doesNotMatch(src(f),/createGoogleBusinessProfilePublisher|createGoogleBusinessProfileReconciler|gbpPublishTransport/,`${f}: no trigger of the real GBP publisher`);}}
 assert.doesNotMatch(src('lib/integrations/publications-oauth/http.ts').replace(/\/\/[^\n]*/g,''),/localPosts|mybusiness\.googleapis/,'OAuth transport stays read-only');
 for(const f of ['lib/publications/delivery/gbp-publisher.ts','lib/integrations/publications-gbp-publish.ts','lib/publications/delivery/registry.ts']){const code=src(f).replace(/\/\/[^\n]*/g,'');
  assert.doesNotMatch(code,/console\.log/,f);for(const m of code.matchAll(/console\.error\(([^;]*)\)/g))assert.doesNotMatch(m[1],/token|credential|body|url|text|message|error\b/i,`${f}: generic logs`);}
 assert.doesNotMatch(src('lib/publications/delivery/gbp-publisher.ts'),/https:\/\/|setTimeout|fetch\(/,'no network code in the publisher itself');
 const doc=src('docs/publications-gbp-publisher.md');for(const s of ['v4','localPosts','STANDARD','business.manage','uncertain','sunset-dates','0 QPM','1500','REJECTED'])assert.ok(doc.includes(s),s);
 assert.doesNotMatch(doc,/ya29\.|1\/\/[A-Za-z0-9_-]{10}/);
 const list=readdirSync(resolve(root,'supabase/migrations')).sort();assert.equal(list.length,22);assert.equal(list[21],'20261013000000_publications_gbp_publisher.sql');
 const sql=src('supabase/migrations/20261013000000_publications_gbp_publisher.sql').replace(/--[^\n]*/g,'');assert.doesNotMatch(sql,/security definer|create policy|http|cron|insert into public\.publication_jobs|drop /i);});

test('Gate 4: the production lease outlasts the slowest provider call (completion is refused after the lease)',async()=>{
 const calls=[];const vaultModule=load('lib/publications/connections/vault.ts');
 const reg=load('lib/publications/delivery/registry.ts',{'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})},'@/lib/supabase/server':{getSupabaseServerClient:()=>({})},
  '@/lib/integrations/publications-oauth/config':{metaOAuthConfig:()=>null,googleOAuthConfig:()=>null},'@/lib/integrations/publications-oauth/http':{},'@/lib/integrations/publications-meta-publish':{},
  '@/lib/integrations/publications-gbp-publish':integration,'../connections/google-business-profile':{},'./gbp-publisher':gbp,'./meta-publisher':{},'../connections/vault':vaultModule,
  '../oauth/service':{productionOAuthDeps:()=>({vault:{readCredential:async()=>{throw Error('no read');}}})},'./engine':{runOnePublicationJob:async(worker,deps)=>{calls.push([worker,deps.leaseSeconds]);return {state:'idle'};}}});
 assert.deepEqual(json(await reg.runOnePublicationJobInProduction('worker-1')),{state:'idle'});
 assert.deepEqual(calls,[['worker-1',600]]);
 // Instagram worst case: Page token + container + 10 status checks (20 s each) + 9 waits of 3 s + media_publish.
 const worst=20+20+10*20+9*3+20;assert.ok(reg.PRODUCTION_LEASE_SECONDS>=worst+60&&reg.PRODUCTION_LEASE_SECONDS<=900,`lease ${reg.PRODUCTION_LEASE_SECONDS}s vs worst ${worst}s`);
 // GBP worst case: token refresh (15 s) + create (20 s).
 assert.ok(reg.PRODUCTION_LEASE_SECONDS>=15+20);});
