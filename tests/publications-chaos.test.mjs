import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Lot 4.3 Gate 5 — local chaos suite, worker side: the REAL P10 engine with the REAL Meta and Google Business Profile
// publishers; only the network (provider transport) and the database (RPC double) are simulated. Database-side
// scenarios run on PostgreSQL in publications-chaos-db.test.mjs. No request ever leaves the machine.
const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,Intl,Error,URL,URLSearchParams,console,Promise,Array,String,Math,Buffer,Uint8Array,TextEncoder,AbortSignal,Symbol,RegExp,setTimeout,process:{env:{}},
   require:name=>{if(name in mocks)return mocks[name];if(name==='server-only')return {};
    if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const model=load('lib/publications/delivery/model.ts');
const contract=load('lib/publications/delivery/publisher.ts',{'./model':model});
const vault=load('lib/publications/connections/vault.ts');
const fakes=load('lib/publications/connections/fakes.ts',{'./vault':vault});
const engine=load('lib/publications/delivery/engine.ts',{'../connections/vault':vault,'./publisher':contract,'./model':model});
const meta=load('lib/publications/delivery/meta-publisher.ts',{'@/lib/integrations/publications-meta-publish':{waitMilliseconds:async()=>{}}});
const gbp=load('lib/publications/delivery/gbp-publisher.ts');
const reg=load('lib/publications/delivery/registry.ts',{'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})},'@/lib/supabase/server':{getSupabaseServerClient:()=>({})},
 '@/lib/integrations/publications-oauth/config':{metaOAuthConfig:()=>null,googleOAuthConfig:()=>null},'@/lib/integrations/publications-oauth/http':{},'@/lib/integrations/publications-meta-publish':{},
 '@/lib/integrations/publications-gbp-publish':{},'../connections/google-business-profile':{},'./gbp-publisher':gbp,'./meta-publisher':meta,'../connections/vault':vault,'../oauth/service':{productionOAuthDeps:()=>({vault:null})},'./engine':engine});

const NOW=Date.parse('2029-06-01T10:00:00Z');
const USER='EAAB-user-secret',PAGE='EAAB-page-secret',ACCESS='ya29.access-secret',FRESH='ya29.fresh-secret',REFRESH='1//refresh-secret';
const SECRETS=[USER,PAGE,ACCESS,FRESH,REFRESH,'signed-jwt'];
const leaks=v=>{const s=JSON.stringify(v);return SECRETS.filter(x=>s.includes(x));};
const ACCOUNTS={facebook:{external_account_id:'1001',parent_external_id:null},instagram:{external_account_id:'17841400000000001',parent_external_id:'1001'},
 google_business_profile:{external_account_id:'accounts/10/locations/1',parent_external_id:'accounts/10'}};
const CREDENTIALS={meta:{accessToken:USER,refreshToken:null,expiresAt:'2029-08-01T00:00:00.000Z',scopes:[],provider:'meta',subject:'987'},
 google_business_profile:{accessToken:ACCESS,refreshToken:REFRESH,expiresAt:'2029-06-01T10:30:00.000Z',scopes:['https://www.googleapis.com/auth/business.manage'],provider:'google_business_profile'}};
const ok=body=>({status:200,body});
const kind=k=>Object.assign(new Error(k),{kind:k});
// Healthy provider answers per platform (Meta: Page token, then write / container flow; GBP: create).
const healthy=r=>r.path==='1001'&&r.method==='GET'?ok({access_token:PAGE}):r.path==='1001/feed'||r.path==='1001/photos'?ok({id:'1001_42'})
 :r.path.endsWith('/media')&&r.method==='POST'?ok({id:'555'}):r.path==='555'?ok({status_code:'FINISHED'}):r.path.endsWith('/media_publish')?ok({id:'17890000000000042'})
 :r.path.endsWith('/localPosts')?ok({name:'accounts/10/locations/1/localPosts/p42',state:'LIVE'}):{status:404,body:null};

// One worker run: database double with overridable RPC answers; provider transport scripted (default healthy).
async function chaos(platform,{provider=healthy,rpc={},connectionStatus='active',signed='ok',credential,assets,refresh,workerId='worker-1'}={}){
 const v=fakes.createMemoryCredentialVault(()=>uid(9,1));
 await v.storeCredential(credential??CREDENTIALS[platform==='google_business_profile'?'google_business_profile':'meta']);
 const rpcs=[],requests=[];
 const context={status:'ready',job_id:uid(6,1),delivery_id:uid(5,1),attempt:1,platform,idempotency_key:'deliver:v:a',text:'Texte chaos',connection_id:uid(7,1),account:ACCOUNTS[platform],
  assets:assets??(platform==='facebook'?[]:[{storage_path:'c/p/a.jpg',mime_type:'image/jpeg'}])};
 const answer=(name,args)=>{if(rpc[name])return rpc[name](args);
  if(name==='publication_job_claim')return {data:{job_id:uid(6,1),delivery_id:uid(5,1),attempt:1,platform},error:null};
  if(name==='publication_job_context')return {data:context,error:null};
  if(name==='publication_job_dispatch')return {data:true,error:null};
  if(name==='publication_job_complete'){const r=args.p_outcome.result;return {data:{delivery_status:r==='uncertain'?'uncertain':r==='published'?'published':r,job_status:'x'},error:null};}
  return {data:null,error:{code:'X'}};};
 const db={rpc:async(name,args)=>{rpcs.push([name,json(args)]);const a=answer(name,args);if(a instanceof Error)throw a;return a;},
  from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{credential_reference:'vault:connection/'+uid(9,1),status:connectionStatus},error:null})})})}),
  storage:{from:()=>({createSignedUrls:async paths=>signed==='missing'?{data:paths.map(p=>({path:p,signedUrl:'',error:'Object not found'})),error:null}
   :signed==='error'?{data:null,error:{message:'storage down'}}:{data:paths.map(p=>({path:p,signedUrl:'https://storage.example.test/'+p+'?token=signed-jwt',error:null})),error:null}})}};
 const transport={async request(r){requests.push(json(r));const a=provider(r,requests.length);if(a instanceof Error)throw a;return a;}};
 const publisher=reg.registryPublisher({facebook:meta.createMetaPublisher(transport,{sleep:async()=>{},pollAttempts:3,now:()=>NOW}),
  instagram:meta.createMetaPublisher(transport,{sleep:async()=>{},pollAttempts:3,now:()=>NOW}),
  google_business_profile:gbp.createGoogleBusinessProfilePublisher(transport,{now:()=>NOW,refresh:refresh??null})});
 const logs=[];const original=console.error;console.error=(...a)=>logs.push(a);
 try{const result=json(await engine.runOnePublicationJob(workerId,{db,vault:v,publisher}));
  const writes=requests.filter(r=>r.method==='POST'&&/(feed|photos|media_publish|localPosts)$/.test(r.path)).length;
  const complete=rpcs.find(x=>x[0]==='publication_job_complete')?.[1].p_outcome??null;
  assert.deepEqual(leaks({rpcs,logs}),[],'no secret in the database calls or the logs');
  return {result,requests,writes,complete,rpcs:rpcs.map(x=>x[0]),logs};}
 finally{console.error=original;}
}
const PLATFORMS=['facebook','instagram','google_business_profile'];

test('C01 worker crash before dispatch (dispatch marker lost): zero provider request, nothing completed',async()=>{
 for(const p of PLATFORMS){
  const h=await chaos(p,{rpc:{publication_job_dispatch:()=>({data:null,error:{code:'08006'}})}});
  assert.deepEqual(h.result,{state:'stale'},p);assert.equal(h.requests.length,0,p);assert.ok(!h.rpcs.includes('publication_job_complete'),p);}
 const thrown=await chaos('instagram',{rpc:{publication_job_dispatch:()=>new Error('socket closed')}});
 assert.deepEqual(thrown.result,{state:'stale'});assert.equal(thrown.requests.length,0);});

test('C02 / C05 crash or database failure AFTER the provider succeeded: exactly one write, never a second one',async()=>{
 for(const p of PLATFORMS){
  const h=await chaos(p,{rpc:{publication_job_complete:()=>({data:null,error:{code:'57P01'}})}});
  assert.deepEqual(h.result,{state:'unconfirmed'},p);assert.equal(h.writes,1,p+': one write');
  assert.equal(h.complete.result,'published',p+': the provider id was handed to the database');
  const thrown=await chaos(p,{rpc:{publication_job_complete:()=>new Error('connection reset')}});
  assert.deepEqual(thrown.result,{state:'unconfirmed'},p);assert.equal(thrown.writes,1,p);}});

test('C03 provider timeout / C04 lost response after the write: uncertain, recorded once, never retried by the worker',async()=>{
 for(const p of PLATFORMS)for(const k of ['timeout','network']){
  const write=r=>/(feed|photos|media_publish|localPosts)$/.test(r.path)&&r.method==='POST';
  const h=await chaos(p,{provider:r=>write(r)?kind(k):healthy(r)});
  assert.equal(h.complete.result,'uncertain',`${p} ${k}`);assert.equal(h.complete.error_code,k==='timeout'?'timeout_after_dispatch':'network_after_dispatch');
  assert.equal(h.requests.filter(write).length,1,`${p} ${k}: exactly one write attempt`);}
 for(const p of PLATFORMS){const h=await chaos(p,{provider:r=>/(feed|photos|media_publish|localPosts)$/.test(r.path)?{status:503,body:null}:healthy(r)});
  assert.equal(h.complete.result,'uncertain',p+': 5xx after the write');}
 const ig=await chaos('instagram',{provider:r=>r.path==='17841400000000001/media'?kind('timeout'):healthy(r)});
 assert.equal(ig.complete.result,'provider_unavailable','container timeout: nothing can be published, retryable');});

test('C06 expired token / C07 revoked token: auth (delivery blocked), no write',async()=>{
 let h=await chaos('facebook',{credential:{...CREDENTIALS.meta,expiresAt:'2029-05-01T00:00:00Z'}});
 assert.deepEqual([h.complete.result,h.complete.error_code],['auth','token_expired']);assert.equal(h.requests.length,0,'expired Meta token: no request at all');
 h=await chaos('instagram',{provider:()=>({status:400,body:{error:{code:190,error_subcode:460,message:'revoked'}}})});
 assert.deepEqual([h.complete.result,h.complete.error_code],['auth','token_revoked']);assert.equal(h.writes,0);
 h=await chaos('google_business_profile',{credential:{...CREDENTIALS.google_business_profile,expiresAt:'2029-06-01T09:00:00Z',refreshToken:null}});
 assert.deepEqual([h.complete.result,h.complete.error_code],['auth','token_expired']);assert.equal(h.requests.length,0);
 h=await chaos('google_business_profile',{credential:{...CREDENTIALS.google_business_profile,expiresAt:'2029-06-01T09:00:00Z'},refresh:async()=>{throw kind('revoked');}});
 assert.deepEqual([h.complete.result,h.complete.error_code],['auth','token_revoked']);assert.equal(h.requests.length,0,'refresh refused: no create');
 h=await chaos('google_business_profile',{credential:{...CREDENTIALS.google_business_profile,expiresAt:'2029-06-01T09:00:00Z'},refresh:async c=>({...c,accessToken:FRESH,expiresAt:'2029-06-01T11:00:00Z'})});
 assert.equal(h.complete.result,'published');assert.equal(h.requests[0].token,FRESH,'expired access token renewed in memory, then one create');
 h=await chaos('google_business_profile',{provider:()=>({status:401,body:{error:{code:401,status:'UNAUTHENTICATED'}}})});
 assert.deepEqual([h.complete.result,h.complete.error_code],['auth','token_invalid']);});

test('C08 account / C09 channel disabled, C10 emergency stop, C11 archived, C12 revision changed: blocked before any request',async()=>{
 for(const reason of ['account_inactive','channel_disabled','emergency_stop','publishing_disabled','archived','publication_changed','content_changed'])for(const p of PLATFORMS){
  const h=await chaos(p,{rpc:{publication_job_context:()=>({data:{status:'blocked',reason},error:null})}});
  assert.deepEqual(h.result,{state:'blocked',reason},`${reason} ${p}`);assert.equal(h.requests.length,0);assert.ok(!h.rpcs.includes('publication_job_dispatch'));}
 for(const p of PLATFORMS){
  const stop=await chaos(p,{rpc:{publication_job_claim:()=>({data:null,error:null})}});
  assert.deepEqual(stop.result,{state:'idle'},'emergency stop: the claim returns nothing');assert.equal(stop.requests.length,0);
  const last=await chaos(p,{rpc:{publication_job_dispatch:()=>({data:false,error:null})}});
  assert.deepEqual(last.result,{state:'blocked',reason:'not_ready'},'switch closed between context and dispatch');assert.equal(last.requests.length,0);}});

test('C13 media missing / C14 signed URL expired or refused: no dispatch without media; provider refusal is final',async()=>{
 for(const p of ['instagram','google_business_profile'])for(const s of ['missing','error']){
  const h=await chaos(p,{signed:s});
  assert.deepEqual(h.result,{state:'aborted',step:'media'},`${p} ${s}`);assert.equal(h.requests.length,0);assert.ok(!h.rpcs.includes('publication_job_dispatch'),'never dispatched without its media');}
 let h=await chaos('instagram',{provider:r=>r.path==='555'?ok({status_code:'ERROR'}):healthy(r)});
 assert.deepEqual([h.complete.result,h.complete.error_code],['invalid_payload','container_error'],'Instagram could not fetch the (expired) URL');assert.equal(h.writes,0);
 h=await chaos('facebook',{assets:[{storage_path:'c/p/a.jpg',mime_type:'image/jpeg'}],provider:r=>r.path==='1001/photos'?{status:400,body:{error:{code:9004,message:'url'}}}:healthy(r)});
 assert.deepEqual([h.complete.result,h.complete.error_code],['invalid_payload','invalid_media']);
 h=await chaos('google_business_profile',{provider:()=>({status:400,body:{error:{code:400,status:'INVALID_ARGUMENT'}}})});
 assert.deepEqual([h.complete.result,h.complete.error_code],['invalid_payload','invalid_parameter']);});

test('C15 duplicate workers: only the claim holder reaches the provider',async()=>{
 let claimed=false;const rpc={publication_job_claim:()=>{if(claimed)return {data:null,error:null};claimed=true;return {data:{job_id:uid(6,1),delivery_id:uid(5,1),attempt:1,platform:'google_business_profile'},error:null};}};
 const [a,b]=await Promise.all([chaos('google_business_profile',{rpc,workerId:'worker-a'}),chaos('google_business_profile',{rpc,workerId:'worker-b'})]);
 assert.deepEqual([a.result.state,b.result.state].sort(),['completed','idle']);assert.equal(a.writes+b.writes,1,'one create in total');
 const stale=await chaos('facebook',{rpc:{publication_job_context:()=>({data:null,error:{code:'40001'}})}});
 assert.deepEqual(stale.result,{state:'stale'},'lease taken over: the late worker stops');assert.equal(stale.requests.length,0);});

test('C16 duplicate retries / C17 disconnection during the job / vault failure: no request without a live credential',async()=>{
 for(const p of PLATFORMS){
  const off=await chaos(p,{connectionStatus:'disabled'});assert.deepEqual(off.result,{state:'aborted',step:'credential'},p);assert.equal(off.requests.length,0);
  assert.ok(!off.rpcs.includes('publication_job_dispatch'),'disconnected before dispatch: never dispatched');}
 const wrong=await chaos('facebook',{credential:CREDENTIALS.google_business_profile});
 assert.deepEqual([wrong.complete.result,wrong.complete.error_code],['auth','credential_invalid'],'a Google secret is never sent to Meta');assert.equal(wrong.requests.length,0);
 // Retried twice by an admin: the database keeps one live job (SQL chaos C16); the worker runs only what it claims.
 const once=await chaos('instagram');assert.equal(once.writes,1);assert.deepEqual(once.rpcs,['publication_job_claim','publication_job_context','publication_job_dispatch','publication_job_complete']);});

test('C18 account removed by a sync, C19 Meta rate limit, C20 GBP quota: classified, no uncertain, bounded',async()=>{
 let h=await chaos('facebook',{rpc:{publication_job_dispatch:()=>({data:false,error:null})}});assert.deepEqual(h.result,{state:'blocked',reason:'not_ready'});assert.equal(h.requests.length,0);
 for(const code of [4,17,32,613,80001]){h=await chaos('facebook',{provider:r=>r.path==='1001'?{status:400,body:{error:{code,message:'limit'}}}:healthy(r)});
  assert.equal(h.complete.result,'rate_limit',`Meta ${code}`);assert.equal(h.writes,0);}
 h=await chaos('instagram',{provider:r=>r.path==='17841400000000001/media_publish'?{status:400,body:{error:{code:9,message:'limit'}}}:healthy(r)});
 assert.equal(h.complete.result,'rate_limit','Instagram 100 posts / 24 h: explicit refusal, nothing published');
 h=await chaos('google_business_profile',{provider:()=>({status:429,body:{error:{code:429,status:'RESOURCE_EXHAUSTED'}}})});
 assert.deepEqual([h.complete.result,h.complete.error_code],['rate_limit','rate_limited']);
 h=await chaos('google_business_profile',{provider:()=>({status:403,body:{error:{code:403,status:'PERMISSION_DENIED'}}})});
 assert.deepEqual([h.complete.result,h.complete.error_code],['auth','permission_missing'],'project not approved (0 QPM): blocked, not retried');
 assert.equal(model.ERROR_CLASSES.includes('rate_limit'),true);});
