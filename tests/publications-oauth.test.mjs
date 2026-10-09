import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Lot 4.3 P11-a — OAuth connections. No network: fetch, Supabase and providers are doubled; no real OAuth.
const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,Intl,Error,FormData,URL,URLSearchParams,console,Promise,Array,String,Math,Buffer,Uint8Array,TextEncoder,AbortSignal,Symbol,process:{env:{}},
   require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='react')return React;if(name==='server-only')return {};
    if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const C=uid(1,1),P=uid(3,1),CONN=uid(5,1);
const KEY=randomBytes(32),KEY2=randomBytes(32);
const ENV={PUBLICATIONS_OAUTH_BASE_URL:'https://cockpit.example.test',META_APP_ID:'123456789012',META_APP_SECRET:'meta-app-secret-value-0123456789',
 GOOGLE_BUSINESS_PROFILE_CLIENT_ID:'1234567890-abcdefghij.apps.googleusercontent.com',GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET:'GOCSPX-google-secret-value',
 PUBLICATION_CREDENTIALS_KEY:KEY.toString('base64'),PUBLICATION_CREDENTIALS_KEY_ID:'k2026a'};
const vault=load('lib/publications/connections/vault.ts');
const model=load('lib/publications/connections/model.ts');
const providers=load('lib/publications/connections/providers.ts',{'./vault':vault});
const config=load('lib/integrations/publications-oauth/config.ts');
const encrypted=load('lib/publications/connections/encrypted-vault.ts',{'./vault':vault});
const http=load('lib/integrations/publications-oauth/http.ts',{'./config':config});
const meta=load('lib/publications/connections/meta.ts',{'./providers':providers});
const gbp=load('lib/publications/connections/google-business-profile.ts',{'./providers':providers});
const oauthModel=load('lib/publications/oauth/model.ts',{'../connections/model':model});
const SECRETS=['EAAB-','ya29.','1//','meta-app-secret-value','GOCSPX-','AQD-code','4/0Ab-code',KEY.toString('base64')];
const leaks=v=>{const s=typeof v==='string'?v:JSON.stringify(v);return SECRETS.filter(x=>s.includes(x));};

test('configuration: server-only names, https base URL allowlist, strict values, key ring, fail closed',()=>{
 assert.equal(config.oauthBaseUrl({PUBLICATIONS_OAUTH_BASE_URL:'https://cockpit.example.test'}),'https://cockpit.example.test');
 assert.equal(config.oauthBaseUrl({PUBLICATIONS_OAUTH_BASE_URL:'http://localhost:3000'}),'http://localhost:3000','loopback http for development');
 for(const bad of ['http://cockpit.example.test','https://cockpit.example.test/app','https://x.test/?a=1','https://user:pw@x.test','javascript:alert(1)','',undefined])assert.equal(config.oauthBaseUrl({PUBLICATIONS_OAUTH_BASE_URL:bad}),null,String(bad));
 assert.equal(config.redirectUriFor('meta',ENV),'https://cockpit.example.test/api/publications/oauth/meta/callback');
 assert.equal(config.redirectUriFor('google_business_profile',ENV),'https://cockpit.example.test/api/publications/oauth/google-business-profile/callback');
 assert.ok(config.metaOAuthConfig(ENV));assert.ok(config.googleOAuthConfig(ENV));
 assert.equal(config.metaOAuthConfig({...ENV,META_APP_ID:'abc'}),null);assert.equal(config.googleOAuthConfig({...ENV,GOOGLE_BUSINESS_PROFILE_CLIENT_ID:'x'}),null);
 assert.equal(config.metaOAuthConfig({...ENV,PUBLICATIONS_OAUTH_BASE_URL:undefined}),null,'no redirect URI → disabled');
 const ring=config.credentialKeyring(ENV);assert.equal(ring.current.id,'k2026a');assert.equal(ring.current.key.length,32);assert.equal(ring.previous,null);
 for(const bad of [{PUBLICATION_CREDENTIALS_KEY:randomBytes(16).toString('base64')},{PUBLICATION_CREDENTIALS_KEY_ID:'K!'},{PUBLICATION_CREDENTIALS_KEY:'not base64 ***'},{PUBLICATION_CREDENTIALS_PREVIOUS_KEY:KEY2.toString('base64'),PUBLICATION_CREDENTIALS_PREVIOUS_KEY_ID:'k2026a'}])
  assert.equal(config.credentialKeyring({...ENV,...bad}),null,JSON.stringify(Object.keys(bad)));
 assert.equal(config.credentialKeyring({...ENV,PUBLICATION_CREDENTIALS_PREVIOUS_KEY:KEY2.toString('base64'),PUBLICATION_CREDENTIALS_PREVIOUS_KEY_ID:'k2025z'}).previous.id,'k2025z');
 assert.deepEqual(json(config.missingOAuthConfiguration('meta',{})),['PUBLICATIONS_OAUTH_BASE_URL','PUBLICATION_CREDENTIALS_KEY','PUBLICATION_CREDENTIALS_KEY_ID','META_APP_ID','META_APP_SECRET'],'names only');
 assert.equal(config.META_GRAPH_VERSION,'v26.0');
 const example=src('.env.example');assert.ok(example.split(/\r?\n/).every(l=>/^\s*(#.*)?$/.test(l)||/^[A-Z][A-Z0-9_]*=$/.test(l)),'.env.example: names only');
 for(const name of Object.keys(ENV))assert.match(example,new RegExp(`^${name}=$`,'m'));
 assert.doesNotMatch(example,/^NEXT_PUBLIC_/m,'no public variable declared');
 for(const f of readdirSync(resolve(root,'lib'),{recursive:true}).filter(f=>/\.(ts|tsx)$/.test(f)))assert.doesNotMatch(src('lib/'+f),/NEXT_PUBLIC_[A-Z_]*(SECRET|KEY|TOKEN)/,f);});

function memoryStore(){const rows=new Map();const s={rows,insert:async r=>{if(rows.has(r.reference))throw Error('dup');rows.set(r.reference,{...r});},get:async ref=>rows.get(ref)??null,remove:async ref=>{rows.delete(ref);}};return s;}
const seq=()=>{let n=0;return ()=>uid(9,++n);};
const credential=(extra={})=>({accessToken:'EAAB-long-lived-secret-token',refreshToken:null,expiresAt:'2030-01-01T00:00:00.000Z',scopes:['pages_show_list'],provider:'meta',subject:'987',...extra});

test('encrypted vault: AES-256-GCM, opaque references, provider-bound, tamper-evident, rotation, deletion, no secret anywhere',async()=>{
 const store=memoryStore(),ring={current:{id:'k2026a',key:KEY},previous:null},v=encrypted.createEncryptedCredentialVault(store,ring,seq());
 const ref=await v.storeCredential(credential());
 assert.equal(ref,'vault:connection/'+uid(9,1));assert.ok(vault.isCredentialReference(ref));assert.deepEqual(leaks(ref),[]);
 const row=store.rows.get(ref);assert.equal(row.provider,'meta');assert.equal(row.key_id,'k2026a');assert.equal(row.iv.length,12);assert.equal(row.auth_tag.length,16);
 assert.deepEqual(leaks(Buffer.from(row.ciphertext).toString('latin1')),[],'ciphertext only, no plaintext in storage');
 assert.deepEqual(json(await v.readCredential(ref,'meta')),json(credential()));
 await assert.rejects(()=>v.readCredential(ref,'google_business_profile'),e=>e.kind==='wrong_provider');
 await assert.rejects(()=>v.readCredential('vault:connection/abc'),e=>e.kind==='invalid_reference');
 await assert.rejects(()=>v.readCredential('vault:connection/'+uid(9,9)),e=>e.kind==='not_found');
 const tampered=Buffer.from(row.ciphertext);tampered[0]^=1;store.rows.set(ref,{...row,ciphertext:tampered});
 await assert.rejects(()=>v.readCredential(ref),e=>e.kind==='corrupted'&&!/EAAB/.test(e.message));store.rows.set(ref,row);
 const other=await v.storeCredential(credential({accessToken:'EAAB-other-token'}));store.rows.set(other,{...row,reference:other});
 await assert.rejects(()=>v.readCredential(other),e=>e.kind==='corrupted','a ciphertext moved to another reference fails (AAD)');
 store.rows.set(ref,{...row,provider:'google_business_profile'});await assert.rejects(()=>v.readCredential(ref),e=>e.kind==='corrupted','provider swap detected');store.rows.set(ref,row);
 await assert.rejects(()=>v.storeCredential(credential({provider:undefined})),e=>e.kind==='invalid_secret','the provider is mandatory');
 await assert.rejects(()=>v.storeCredential({accessToken:'',refreshToken:null,expiresAt:null,scopes:[],provider:'meta'}),e=>e.kind==='invalid_secret');
 const rotated=await v.rotateCredential(ref,credential({accessToken:'EAAB-rotated-token'}));
 assert.notEqual(rotated,ref);assert.equal(store.rows.has(ref),false,'old reference removed');assert.equal((await v.readCredential(rotated)).accessToken,'EAAB-rotated-token');
 await v.deleteCredential(rotated);assert.equal(store.rows.has(rotated),false);
 // Key rotation: a new key reads secrets of the previous one, writes with the new one.
 const legacy=await v.storeCredential(credential({accessToken:'EAAB-old-key-token'}));
 const next=encrypted.createEncryptedCredentialVault(store,{current:{id:'k2026b',key:KEY2},previous:{id:'k2026a',key:KEY}},seq());
 assert.equal((await next.readCredential(legacy)).accessToken,'EAAB-old-key-token');
 await assert.rejects(()=>encrypted.createEncryptedCredentialVault(store,{current:{id:'k2026b',key:KEY2},previous:null},seq()).readCredential(legacy),e=>e.kind==='unconfigured','unknown key id: fail closed');
 const broken={insert:async()=>{throw Error('network EAAB-x');},get:async()=>{throw Error('down');},remove:async()=>{throw Error('down');}};
 const down=encrypted.createEncryptedCredentialVault(broken,ring,seq());
 await assert.rejects(()=>down.storeCredential(credential()),e=>e.kind==='unavailable'&&!/EAAB/.test(e.message));await assert.rejects(()=>down.readCredential(ref),e=>e.kind==='unavailable');
 assert.throws(()=>encrypted.createEncryptedCredentialVault(store,{current:{id:'x',key:randomBytes(16)},previous:null}),e=>e.kind==='unconfigured');});

function fetchDouble(reply){const calls=[];const f=async(url,init)=>{calls.push({url,init:{...init,signal:undefined}});const r=await reply(url,init);
 return {status:r.status??200,headers:{get:k=>({'content-type':r.type??'application/json','content-length':r.length??null})[k.toLowerCase()]??null},text:async()=>r.text??JSON.stringify(r.body??{})};};f.calls=calls;return f;}
const metaCfg=config.metaOAuthConfig(ENV),googleCfg=config.googleOAuthConfig(ENV);

test('HTTP transports: official endpoints only, secrets server-side, bearer + appsecret_proof, no redirect, bounded, JSON only',async()=>{
 let f=fetchDouble(()=>({body:{access_token:'EAAB-short'}}));let t=http.metaTransport(metaCfg,f);
 await t.request({operation:'token',path:'oauth/access_token',params:{code:'AQD-code'}});
 let u=new URL(f.calls[0].url);assert.equal(u.origin+u.pathname,'https://graph.facebook.com/v26.0/oauth/access_token');
 assert.deepEqual([u.searchParams.get('client_id'),u.searchParams.get('redirect_uri'),u.searchParams.get('code')],['123456789012','https://cockpit.example.test/api/publications/oauth/meta/callback','AQD-code']);
 assert.equal(f.calls[0].init.redirect,'error');assert.equal(f.calls[0].init.cache,'no-store');
 await t.request({operation:'token',path:'oauth/access_token',params:{grant_type:'fb_exchange_token'},credential:{accessToken:'EAAB-short'}});
 u=new URL(f.calls[1].url);assert.equal(u.searchParams.get('fb_exchange_token'),'EAAB-short');assert.equal(u.searchParams.get('grant_type'),'fb_exchange_token');
 await t.request({operation:'read',path:'me/accounts',params:{fields:'id,name'},credential:{accessToken:'EAAB-user'}});
 u=new URL(f.calls[2].url);assert.equal(u.pathname,'/v26.0/me/accounts');assert.equal(u.searchParams.get('appsecret_proof'),createHmac('sha256',ENV.META_APP_SECRET).update('EAAB-user').digest('hex'));
 assert.ok(!f.calls[2].url.includes('EAAB')&&!f.calls[2].url.includes(ENV.META_APP_SECRET),'read: no token or secret in the URL');assert.equal(f.calls[2].init.headers.Authorization,'Bearer EAAB-user');
 await t.request({operation:'debug',path:'debug_token',params:{},credential:{accessToken:'EAAB-user'}});
 u=new URL(f.calls[3].url);assert.equal(u.pathname,'/v26.0/debug_token');assert.equal(u.searchParams.get('access_token'),`${ENV.META_APP_ID}|${ENV.META_APP_SECRET}`);
 for(const path of ['me/feed','../oauth','102/photos','me/accounts?x','https://evil.test'])await assert.rejects(()=>t.request({operation:'read',path,params:{},credential:{accessToken:'x'}}),e=>e.kind==='invalid_path',path);
 f=fetchDouble(()=>{throw Error('ECONNRESET EAAB');});await assert.rejects(()=>http.metaTransport(metaCfg,f).request({operation:'read',path:'me',params:{},credential:{accessToken:'x'}}),e=>e.kind==='network'&&!/EAAB/.test(e.message));
 f=fetchDouble(()=>({text:'x'.repeat(1_048_577)}));await assert.rejects(()=>http.metaTransport(metaCfg,f).request({operation:'read',path:'me',params:{},credential:{accessToken:'x'}}),e=>e.kind==='too_large');
 f=fetchDouble(()=>({type:'text/html',text:'<html>'}));assert.equal((await http.metaTransport(metaCfg,f).request({operation:'read',path:'me',params:{},credential:{accessToken:'x'}})).body,null,'non-JSON body ignored');
 f=fetchDouble(()=>({text:'{bad json'}));assert.equal((await http.metaTransport(metaCfg,f).request({operation:'read',path:'me',params:{},credential:{accessToken:'x'}})).body,null);
 f=fetchDouble(()=>({body:{}}));t=http.googleTransport(googleCfg,f);
 await t.request({operation:'token',path:'token',params:{grant_type:'authorization_code',code:'4/0Ab-code',code_verifier:'v'.repeat(43)}});
 assert.equal(f.calls[0].url,'https://oauth2.googleapis.com/token');assert.equal(f.calls[0].init.method,'POST');
 const body=new URLSearchParams(f.calls[0].init.body);assert.deepEqual([body.get('client_secret'),body.get('code_verifier'),body.get('redirect_uri')],[ENV.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET,'v'.repeat(43),'https://cockpit.example.test/api/publications/oauth/google-business-profile/callback']);
 await t.request({operation:'token',path:'token',params:{grant_type:'refresh_token'},credential:{accessToken:'ya29.x',refreshToken:'1//refresh'}});
 assert.equal(new URLSearchParams(f.calls[1].init.body).get('refresh_token'),'1//refresh');
 await t.request({operation:'read',path:'accounts',params:{pageSize:'20'},credential:{accessToken:'ya29.x'}});assert.equal(new URL(f.calls[2].url).origin+new URL(f.calls[2].url).pathname,'https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
 await t.request({operation:'read',path:'accounts/42/locations',params:{readMask:'name,title'},credential:{accessToken:'ya29.x'}});assert.equal(new URL(f.calls[3].url).pathname,'/v1/accounts/42/locations');
 for(const path of ['accounts/42/locations/1/localPosts','accounts/../x/locations','v4/accounts'])await assert.rejects(()=>t.request({operation:'read',path,params:{},credential:{accessToken:'x'}}),e=>e.kind==='invalid_path',path);
 const metaUrl=new URL(http.metaAuthorizeUrl(metaCfg,'S'.repeat(43)));
 assert.equal(metaUrl.origin+metaUrl.pathname,'https://www.facebook.com/v26.0/dialog/oauth');
 assert.equal(metaUrl.searchParams.get('scope'),'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish');
 assert.deepEqual([metaUrl.searchParams.get('state'),metaUrl.searchParams.get('response_type')],['S'.repeat(43),'code']);
 const gUrl=new URL(http.googleAuthorizeUrl(googleCfg,'S'.repeat(43),'C'.repeat(43)));
 assert.equal(gUrl.origin+gUrl.pathname,'https://accounts.google.com/o/oauth2/v2/auth');
 assert.deepEqual(['scope','access_type','prompt','code_challenge','code_challenge_method','include_granted_scopes'].map(k=>gUrl.searchParams.get(k)),['https://www.googleapis.com/auth/business.manage','offline','consent','C'.repeat(43),'S256','false']);
 for(const u2 of [metaUrl.href,gUrl.href])assert.deepEqual(leaks(u2),[],'no secret in an authorization URL');
 const code=src('lib/integrations/publications-oauth/http.ts');assert.doesNotMatch(code.replace(/\/\/[^\n]*/g,''),/feed|media_publish|localPosts|\/photos|method:'DELETE'|revoke/i,'no publishing or revocation endpoint');});

test('Meta provider: pagination, Page without Instagram, permission / rate-limit / malformed handling, page tokens dropped',async()=>{
 const p=meta.createMetaConnectionProvider({request:async r=>{
  if(r.operation==='debug')return {status:200,body:{data:{is_valid:true,app_id:'123456789012',user_id:'987',scopes:['instagram_basic'],expires_at:0}}};
  if(r.operation==='token')return {status:200,body:{access_token:'EAAB-token-value',token_type:'bearer'}};
  const first=!r.params.after;
  return {status:200,body:first?{data:[{id:'101',name:'Page A',access_token:'EAAB-page-token-a',instagram_business_account:{id:'201',username:'page.a'}}],paging:{cursors:{after:'C1'},next:'https://graph/next'}}
   :{data:[{id:'102',name:'Page B'}],paging:{cursors:{after:'C2'}}}};}},{appId:'123456789012'});
 await assert.rejects(()=>p.exchangeCode('AQD-code-value','https://cockpit.example.test/cb'),e=>e.kind==='permission','pages_show_list not granted → refused');
 const cred={accessToken:'EAAB-token-value',refreshToken:null,expiresAt:null,scopes:[]};
 assert.deepEqual(json(await p.listFacebookPages(cred)),[{id:'101',name:'Page A',category:null},{id:'102',name:'Page B',category:null}],'two pages via cursor');
 const ig=json(await p.listInstagramAccounts(cred));assert.deepEqual(ig,[{id:'201',pageId:'101',username:'page.a',name:null}],'Page B has no Instagram');
 assert.deepEqual(leaks(ig).concat(leaks(await p.listFacebookPages(cred))),[],'page tokens dropped');
 const failing=status=>meta.createMetaConnectionProvider({request:async()=>status});const c={accessToken:'EAAB-x-12345',refreshToken:null,expiresAt:null,scopes:[]};
 await assert.rejects(()=>failing({status:400,body:{error:{code:4}}}).listFacebookPages(c),e=>e.kind==='rate_limited');
 await assert.rejects(()=>failing({status:403,body:{error:{code:10}}}).listFacebookPages(c),e=>e.kind==='permission');
 await assert.rejects(()=>failing({status:200,body:null}).listFacebookPages(c),e=>e.kind==='invalid','malformed answer');
 await assert.rejects(()=>failing({status:500,body:{}}).listFacebookPages(c),e=>e.kind==='unavailable');
 await assert.rejects(()=>meta.createMetaConnectionProvider({request:async()=>({status:200,body:{}})},{now:()=>Date.parse('2031-01-01')}).refresh({...c,expiresAt:'2030-01-01T00:00:00.000Z'}),e=>e.kind==='expired','an expired long-lived token cannot be extended');
 const normalized=model.normalizeMetaAccounts([{id:'101',name:'Page A'},{id:'101',name:'Page A bis'},{id:'102',name:'Page B'}],[{id:'201',username:'page.a',name:null,pageId:'101'}]);
 assert.deepEqual(json(normalized.map(a=>[a.platform,a.externalAccountId])),[['facebook','101'],['facebook','102'],['instagram','201']],'duplicates removed, Facebook-only Page kept');});

test('GBP provider: accounts and locations pagination, empty account, rate limit, revoked refresh',async()=>{
 const p=gbp.createGoogleBusinessProfileConnectionProvider({request:async r=>{
  if(r.path==='accounts')return {status:200,body:r.params.pageToken?{accounts:[{name:'accounts/2',accountName:'B'}]}:{accounts:[{name:'accounts/1',accountName:'A'},{name:'accounts/1',accountName:'dup'}],nextPageToken:'T1'}};
  if(r.path==='accounts/1/locations')return {status:200,body:r.params.pageToken?{locations:[{name:'locations/8',title:'Lyon 2'}]}:{locations:[{name:'locations/7',title:'Lyon'}],nextPageToken:'L1'}};
  return {status:200,body:{}};}});
 const cred={accessToken:'ya29.token-value',refreshToken:'1//refresh-value',expiresAt:null,scopes:[]};
 assert.deepEqual(json(await p.listAccounts(cred)),[{name:'accounts/1',accountName:'A'},{name:'accounts/2',accountName:'B'}]);
 assert.deepEqual(json((await p.listLocations(cred,'accounts/1')).map(l=>l.name)),['locations/7','locations/8']);
 assert.deepEqual(json(await p.listLocations(cred,'accounts/2')),[],'account without location');
 const failing=reply=>gbp.createGoogleBusinessProfileConnectionProvider({request:async()=>reply});
 await assert.rejects(()=>failing({status:429,body:{}}).listAccounts(cred),e=>e.kind==='rate_limited');
 await assert.rejects(()=>failing({status:400,body:{error:'invalid_grant'}}).refresh(cred),e=>e.kind==='revoked');
 await assert.rejects(()=>failing({status:200,body:{access_token:'ya29.x-value',token_type:'Bearer',expires_in:10,scope:'https://www.googleapis.com/auth/business.manage'}}).refresh(cred),e=>e.kind==='invalid','too-short expiry refused');
 await assert.rejects(()=>failing({status:200,body:{}}).exchangeCode('4/0Ab-code','https://x.test/cb','short'),e=>e.kind==='invalid','malformed PKCE verifier refused');
 const accounts=model.normalizeGbpAccounts([{name:'locations/7',title:'Lyon',accountName:'accounts/1'},{name:'locations/7',title:'Lyon',accountName:'accounts/1'}]);
 assert.equal(accounts.length,1,'no duplicate location');});

// --- OAuth service -------------------------------------------------------------------------------------------
function oauthHarness({rpc={},project={id:P,client_id:C},connection=null,metaProvider,gbpProvider,vaultImpl}={}){
 const log=[],store=memoryStore();
 const v=vaultImpl??encrypted.createEncryptedCredentialVault(store,{current:{id:'k2026a',key:KEY},previous:null},seq());
 const db={rpc:async(name,args)=>{log.push(['rpc',name,json(args)]);if(rpc[name])return rpc[name](args);
   return name==='publication_oauth_state_consume'?{data:{status:'valid',client_id:C,project_id:P},error:null}:name==='publication_connection_register'?{data:{connection_id:CONN,created:true,replaced_reference:null},error:null}
    :{data:{ok:true},error:null};},
  from:table=>({select:cols=>{const q={eq:()=>q,maybeSingle:async()=>{log.push(['read',table,cols]);return {data:table==='projects'?project:connection,error:null};}};return q;}})};
 const defaultMeta={calls:[],exchangeCode:async(code,uri)=>{defaultMeta.calls.push(['exchange',code,uri]);return {accessToken:'EAAB-long-lived-secret',refreshToken:null,expiresAt:'2030-01-01T00:00:00.000Z',scopes:['pages_show_list'],provider:'meta',subject:'987'};},
  refresh:async c=>({...c,accessToken:'EAAB-refreshed-secret',expiresAt:'2031-01-01T00:00:00.000Z'}),validateConnection:async()=>({status:'active',externalIdentity:'987'}),
  listFacebookPages:async()=>[{id:'101',name:'Page A'},{id:'102',name:'Page B'}],listInstagramAccounts:async()=>[{id:'201',username:'page.a',name:null,pageId:'101'}]};
 const defaultGbp={calls:[],exchangeCode:async(code,uri,verifier)=>{defaultGbp.calls.push(['exchange',code,uri,verifier]);return {accessToken:'ya29.access-secret',refreshToken:'1//refresh-secret',expiresAt:'2030-01-01T00:00:00.000Z',scopes:['https://www.googleapis.com/auth/business.manage'],provider:'google_business_profile',subject:null};},
  refresh:async c=>c,validateConnection:async()=>({status:'active',externalIdentity:null}),listAccounts:async()=>[{name:'accounts/1',accountName:'A'}],listLocations:async(_c,a)=>[{name:'locations/7',title:'Lyon',accountName:a}]};
 const pkceKey=createHmac('sha256',KEY).update('codev:publications-oauth:pkce:v1').digest();
 const deps={db,vault:v,pkceKey,random:()=>'S'.repeat(43),now:()=>Date.parse('2029-12-25T00:00:00Z'),
  meta:{config:metaCfg,provider:metaProvider??defaultMeta},google:{config:googleCfg,provider:gbpProvider??defaultGbp}};
 const logs=[];
 const m=load('lib/publications/oauth/service.ts',{'@/lib/require-admin':{requireAdmin:async()=>{log.push('admin');return {userId:'user_admin'};}},'@/lib/supabase/server':{getSupabaseServerClient:()=>db},
  '@/lib/integrations/publications-oauth/config':config,'@/lib/integrations/publications-oauth/http':http,'../connections/model':model,'../connections/vault':vault,'../connections/providers':providers,
  '../connections/meta':meta,'../connections/google-business-profile':gbp,'../connections/encrypted-vault':encrypted,'../connections/secret-store':{supabaseSecretStore:()=>store},'./model':oauthModel});
 return {m,log,deps,store,meta:defaultMeta,gbp:defaultGbp,rpcs:name=>log.filter(x=>x[0]==='rpc'&&x[1]===name).map(x=>x[2]),
  capture:async work=>{const original=console.error;console.error=(...a)=>logs.push(a);try{return await work();}finally{console.error=original;}},logs};}
const q=o=>new URLSearchParams(o);
const sha=v=>createHash('sha256').update(v).digest('hex');
const verifierOf=state=>Buffer.from(createHmac('sha256',createHmac('sha256',KEY).update('codev:publications-oauth:pkce:v1').digest()).update('pkce:'+state).digest()).toString('base64url');

test('start: admin, client resolved from the project, state hash only, official consent URL; Google PKCE S256',async()=>{
 const h=oauthHarness();const r=await h.m.startOAuth('meta',P,h.deps);
 assert.equal(h.log[0],'admin');assert.equal(r.ok,true);
 assert.deepEqual(h.rpcs('publication_oauth_state_create'),[{p_provider:'meta',p_client_id:C,p_project_id:P,p_state_hash:sha('S'.repeat(43)),p_actor_id:'user_admin'}],'hash only, client from the server');
 assert.equal(new URL(r.url).searchParams.get('state'),'S'.repeat(43));assert.deepEqual(leaks(r.url),[]);
 const g=oauthHarness();const gr=await g.m.startOAuth('google_business_profile',P,g.deps);const challenge=new URL(gr.url).searchParams.get('code_challenge');
 assert.equal(challenge,createHash('sha256').update(verifierOf('S'.repeat(43))).digest('base64url'),'S256 of the server-derived verifier');
 assert.ok(!gr.url.includes(verifierOf('S'.repeat(43))),'verifier never in the URL');
 assert.deepEqual(json(await h.m.startOAuth('facebook',P,h.deps)),{ok:false,message:'Connexion invalide.'});
 const off=oauthHarness();assert.match((await off.m.startOAuth('meta',P,{...off.deps,meta:null})).message,/configuration OAuth incomplète/);assert.equal(off.rpcs('publication_oauth_state_create').length,0);
 const noProject=oauthHarness({project:null});assert.equal((await noProject.m.startOAuth('meta',P,noProject.deps)).message,'Projet invalide.');});

test('callback (Meta): state consumed BEFORE the exchange; vault stores the credential; only the reference reaches the database; sync; audit',async()=>{
 const h=oauthHarness({rpc:{publication_connection_register:()=>({data:{connection_id:CONN,created:false,replaced_reference:'vault:connection/'+uid(9,7)},error:null})}});
 const old=await h.deps.vault.storeCredential({accessToken:'EAAB-previous-secret',refreshToken:null,expiresAt:null,scopes:[],provider:'meta'});
 h.deps.vault=encrypted.createEncryptedCredentialVault(h.store,{current:{id:'k2026a',key:KEY},previous:null},(()=>{let n=10;return ()=>uid(9,++n);})());
 h.store.rows.set('vault:connection/'+uid(9,7),{...h.store.rows.get(old),reference:'vault:connection/'+uid(9,7)});
 const path=await h.capture(()=>h.m.completeOAuthCallback('meta',q({state:'S'.repeat(43),code:'AQD-code-value'}),h.deps));
 assert.equal(path,`/projects/${P}/configuration?oauth=success&provider=meta`);
 const order=h.log.filter(x=>x[0]==='rpc').map(x=>x[1]);
 assert.deepEqual(order,['publication_oauth_state_consume','publication_connection_register','publication_accounts_sync','publication_oauth_record']);
 assert.deepEqual(h.rpcs('publication_oauth_state_consume')[0],{p_provider:'meta',p_state_hash:sha('S'.repeat(43)),p_actor_id:'user_admin'});
 assert.deepEqual(h.meta.calls,[['exchange','AQD-code-value','https://cockpit.example.test/api/publications/oauth/meta/callback']],'one exchange, official redirect URI');
 const reg=h.rpcs('publication_connection_register')[0];assert.ok(vault.isCredentialReference(reg.p_credential_reference));assert.equal(reg.p_external_identity,'987');assert.deepEqual(reg.p_metadata,{});
 assert.equal((await h.deps.vault.readCredential(reg.p_credential_reference,'meta')).accessToken,'EAAB-long-lived-secret','secret in the vault only');
 assert.equal(h.store.rows.has('vault:connection/'+uid(9,7)),false,'replaced secret deleted');
 assert.deepEqual(h.rpcs('publication_accounts_sync')[0].p_accounts.map(a=>[a.platform,a.external_account_id]),[['facebook','101'],['facebook','102'],['instagram','201']]);
 assert.deepEqual(h.rpcs('publication_oauth_record')[0],{p_client_id:C,p_provider:'meta',p_outcome:'oauth_completed',p_code:null,p_counts:{accounts:3,facebook:2,instagram:1,google_business_profile:0},p_actor_id:'user_admin'});
 assert.deepEqual(leaks(h.log.filter(x=>x[0]==='rpc')),[],'no token, code or secret sent to the database');assert.deepEqual(leaks(h.logs),[]);assert.deepEqual(h.logs,[]);});

test('callback refusals: forged / replayed / expired state, provider error, missing code, exchange failures, register failure, discovery failure',async()=>{
 const run=async(h,query,provider='meta')=>({path:await h.capture(()=>h.m.completeOAuthCallback(provider,q(query),h.deps)),h});
 let {path,h}=await run(oauthHarness(),{state:'short',code:'AQD-code-value'});
 assert.equal(path,'/projects?oauth=invalid&provider=meta');assert.equal(h.log.filter(x=>x[0]==='rpc').length,0,'malformed state: nothing touched');
 ({path,h}=await run(oauthHarness({rpc:{publication_oauth_state_consume:()=>({data:null,error:{code:'55000',message:'OAuth state already used'}})}}),{state:'S'.repeat(43),code:'AQD-code-value'}));
 assert.equal(path,'/projects?oauth=invalid&provider=meta');assert.equal(h.meta.calls.length,0,'replay: no exchange');
 ({path,h}=await run(oauthHarness({rpc:{publication_oauth_state_consume:()=>({data:{status:'expired',client_id:C,project_id:P},error:null})}}),{state:'S'.repeat(43),code:'AQD-code-value'}));
 assert.equal(path,`/projects/${P}/configuration?oauth=expired&provider=meta`);assert.equal(h.meta.calls.length,0);
 ({path,h}=await run(oauthHarness(),{state:'S'.repeat(43),error:'access_denied',error_description:'User denied EAAB'}));
 assert.match(path,/oauth=refused/);assert.equal(h.rpcs('publication_oauth_record')[0].p_code,'access_denied');assert.equal(h.meta.calls.length,0);assert.deepEqual(leaks(h.log),[]);
 ({path,h}=await run(oauthHarness(),{state:'S'.repeat(43)}));assert.match(path,/oauth=invalid/);assert.equal(h.rpcs('publication_oauth_record')[0].p_code,'missing_code');
 for(const [kind,outcome] of [['permission','inaccessible'],['revoked','expired'],['invalid','expired'],['unavailable','unavailable'],['rate_limited','unavailable']]){
  const failing={exchangeCode:async()=>{throw new providers.ConnectionProviderError(kind);}};
  ({path,h}=await run(oauthHarness({metaProvider:failing}),{state:'S'.repeat(43),code:'AQD-code-value'}));
  assert.match(path,new RegExp(`oauth=${outcome}`),kind);assert.equal(h.rpcs('publication_connection_register').length,0,kind+': nothing registered');
  assert.equal(h.rpcs('publication_oauth_record')[0].p_code,'exchange_'+kind);assert.ok(h.logs.every(l=>!JSON.stringify(l).includes('AQD')),'code never logged');}
 h=oauthHarness({rpc:{publication_connection_register:()=>({data:null,error:{code:'23514'}})}});({path}=await run(h,{state:'S'.repeat(43),code:'AQD-code-value'}));
 assert.match(path,/oauth=unavailable/);assert.equal(h.store.rows.size,0,'stored secret cleaned when the registration fails');
 const noDiscovery={exchangeCode:async()=>({accessToken:'EAAB-long-lived-secret',refreshToken:null,expiresAt:null,scopes:['pages_show_list'],provider:'meta',subject:'1'}),listFacebookPages:async()=>{throw new providers.ConnectionProviderError('rate_limited');}};
 ({path,h}=await run(oauthHarness({metaProvider:noDiscovery}),{state:'S'.repeat(43),code:'AQD-code-value'}));
 assert.match(path,/oauth=partial/);assert.equal(h.rpcs('publication_connection_register').length,1,'connection kept');assert.equal(h.rpcs('publication_accounts_sync').length,0);
 ({path,h}=await run(oauthHarness(),{state:'S'.repeat(43),code:'AQD-code-value'},'google_business_profile'));
 assert.match(path,/oauth=success&provider=google_business_profile/);assert.equal(h.gbp.calls[0][3],verifierOf('S'.repeat(43)),'PKCE verifier re-derived on the server');
 assert.deepEqual(h.rpcs('publication_accounts_sync')[0].p_accounts.map(a=>a.external_account_id),['accounts/1/locations/7']);
 assert.equal(h.rpcs('publication_connection_register')[0].p_expires_at,null,'GBP with a refresh token: the connection does not expire with the one-hour access token');});

test('verify: refresh near expiry (rotation), validation, resync; revoked / expired / permission statuses; network keeps the status',async()=>{
 const store=memoryStore(),v=encrypted.createEncryptedCredentialVault(store,{current:{id:'k2026a',key:KEY},previous:null},seq());const r1=await v.storeCredential({accessToken:'EAAB-near-expiry',refreshToken:null,expiresAt:'2030-01-01T00:00:00.000Z',scopes:['pages_show_list'],provider:'meta',subject:'987'});
 const h=oauthHarness({connection:{id:CONN,status:'active',credential_reference:r1,expires_at:'2030-01-01T00:00:00Z'},vaultImpl:v});
 const r=await h.capture(()=>h.m.verifyConnection(P,'meta',h.deps));
 assert.deepEqual(json(r),{ok:true,message:'Connexion vérifiée : 3 compte(s) disponible(s).'});
 const status=h.rpcs('publication_connection_set_status')[0];assert.equal(status.p_status,'active');assert.notEqual(status.p_credential_reference,r1);assert.equal(status.p_expires_at,'2031-01-01T00:00:00.000Z');
 assert.equal(store.rows.has(r1),false,'rotated: old secret removed');assert.equal((await v.readCredential(status.p_credential_reference)).accessToken,'EAAB-refreshed-secret');
 assert.ok(h.rpcs('publication_oauth_record').some(x=>x.p_outcome==='connection_refreshed'));assert.equal(h.rpcs('publication_accounts_sync').length,1);
 const fresh=await v.storeCredential({accessToken:'EAAB-fresh',refreshToken:null,expiresAt:'2031-06-01T00:00:00.000Z',scopes:[],provider:'meta'});
 const outcome=async(provider)=>{const x=oauthHarness({connection:{id:CONN,status:'active',credential_reference:fresh,expires_at:null},vaultImpl:v,metaProvider:provider});
  const res=await x.capture(()=>x.m.verifyConnection(P,'meta',x.deps));return {res:json(res),statuses:x.rpcs('publication_connection_set_status').map(s=>s.p_status),sync:x.rpcs('publication_accounts_sync').length,logs:x.logs};};
 let o=await outcome({validateConnection:async()=>({status:'revoked',externalIdentity:null})});assert.deepEqual(o.statuses,['revoked']);assert.match(o.res.message,/révoqué/);assert.equal(o.sync,0);
 o=await outcome({validateConnection:async()=>({status:'expired',externalIdentity:null})});assert.deepEqual(o.statuses,['expired']);
 o=await outcome({validateConnection:async()=>{throw new providers.ConnectionProviderError('unavailable');}});assert.deepEqual(o.statuses,[],'network error: status untouched');assert.equal(o.res.message,'Connexion impossible pour le moment');
 o=await outcome({validateConnection:async()=>{throw new providers.ConnectionProviderError('rate_limited');}});assert.deepEqual(o.statuses,[]);
 o=await outcome({validateConnection:async()=>{throw new providers.ConnectionProviderError('permission');}});assert.deepEqual(o.statuses,['error'],'ambiguous: error');assert.equal(o.res.message,'Compte inaccessible');
 for(const x of [o.logs])assert.deepEqual(leaks(x),[]);
 const none=oauthHarness({connection:{id:CONN,status:'disabled',credential_reference:null,expires_at:null}});assert.match((await none.m.verifyConnection(P,'meta',none.deps)).message,/Aucune connexion active/);});

test('callback route, actions and UI: internal 303 redirect without referrer, admin-only actions, connect / reconnect / verify / disconnect, safe banners',async()=>{
 const calls=[];
 const cb=load('lib/publications/oauth/callback.ts',{'next/server':{NextResponse:{redirect:(url,status)=>{const headers=new Map();return {url:String(url),status,headers:{set:(k,v)=>headers.set(k,v),get:k=>headers.get(k)}};}}},
  './service':{completeOAuthCallback:async(provider,params)=>{calls.push([provider,params.get('code')]);return `/projects/${P}/configuration?oauth=success&provider=${provider}`;}}});
 const res=await cb.handleOAuthCallback('meta',{nextUrl:{searchParams:q({state:'S',code:'AQD-code-value'}),origin:'https://cockpit.example.test'}});
 assert.equal(res.status,303);assert.equal(res.url,`https://cockpit.example.test/projects/${P}/configuration?oauth=success&provider=meta`);
 assert.equal(res.headers.get('Referrer-Policy'),'no-referrer');assert.equal(res.headers.get('Cache-Control'),'no-store');assert.deepEqual(leaks(res.url),[]);
 const evil=load('lib/publications/oauth/callback.ts',{'next/server':{NextResponse:{redirect:()=>({})}},'./service':{completeOAuthCallback:async()=>'//evil.test/x'}});
 await assert.rejects(()=>evil.handleOAuthCallback('meta',{nextUrl:{searchParams:q({}),origin:'https://cockpit.example.test'}}),/Unsafe redirect/);
 for(const p of ['app/api/publications/oauth/meta/callback/route.ts','app/api/publications/oauth/google-business-profile/callback/route.ts']){const code=src(p);assert.match(code,/export async function GET\(request:NextRequest\)\{return handleOAuthCallback\("(meta|google_business_profile)",request\);\}/);}
 assert.doesNotMatch(src('proxy.ts'),/api\/publications\/oauth/,'callbacks stay behind the admin proxy (no public exception)');
 assert.equal(oauthModel.oauthReturnPath('nope','meta','success'),'/projects?oauth=success&provider=meta');
 assert.deepEqual(json(oauthModel.oauthBanner({oauth:'success',provider:'meta'})),{ok:true,message:'Connexion Meta réussie'});
 assert.deepEqual(json(oauthModel.oauthBanner({oauth:'success',provider:'google_business_profile'})),{ok:true,message:'Connexion Google Business Profile réussie'});
 for(const [o,m] of [['refused','Connexion refusée'],['expired','Autorisation expirée'],['inaccessible','Compte inaccessible'],['unavailable','Connexion impossible pour le moment']])assert.equal(oauthModel.oauthBanner({oauth:o,provider:'meta'}).message,m);
 assert.equal(oauthModel.oauthBanner({oauth:'<script>',provider:'meta'}),null);assert.equal(oauthModel.oauthBanner({oauth:'success',provider:'evil'}),null);
 const acts=[];let redirected=null;
 const a=load('app/(cockpit)/publications/connection-actions.ts',{'next/cache':{revalidatePath:p=>acts.push(['revalidate',p])},'next/navigation':{redirect:u=>{redirected=u;throw Object.assign(Error('NEXT_REDIRECT'),{digest:'NEXT_REDIRECT'});}},
  '@/lib/require-admin':{requireAdmin:async()=>{acts.push('admin');}},'@/lib/publications/connections/service':{assignPublicationAccountToChannel:async()=>({ok:true,message:'ok'}),disconnectConnection:async()=>({ok:true,message:'ok'})},
  '@/lib/publications/oauth/service':{startOAuth:async(provider,project)=>{acts.push(['start',provider,project]);return provider==='meta'?{ok:true,url:'https://www.facebook.com/v26.0/dialog/oauth?state=x'}:{ok:false,message:'Connexion indisponible'};},
   verifyConnection:async(project,provider)=>{acts.push(['verify',project,provider]);return {ok:true,message:'Connexion vérifiée'};}}});
 const form=e=>{const f=new FormData();for(const [k,v] of Object.entries(e))f.set(k,v);return f;};
 await assert.rejects(()=>a.startOAuthAction({},form({project_id:P,provider:'meta',client_id:uid(1,9)})),/NEXT_REDIRECT/);
 assert.equal(redirected,'https://www.facebook.com/v26.0/dialog/oauth?state=x');assert.deepEqual(json(acts.slice(0,2)),['admin',['start','meta',P]],'client id from the browser ignored');
 acts.length=0;assert.deepEqual(json(await a.startOAuthAction({},form({project_id:P,provider:'google_business_profile'}))),{ok:false,message:'Connexion indisponible'});
 acts.length=0;await a.verifyConnectionAction({},form({project_id:P,provider:'meta'}));assert.deepEqual(json(acts.slice(0,2)),['admin',['verify',P,'meta']]);
 const panel=load('components/publications/connections-panel.tsx',{'@/app/(cockpit)/publications/connection-actions':{assignPublicationAccountAction:async()=>({}),disconnectPublicationConnectionAction:async()=>({}),startOAuthAction:async()=>({}),verifyConnectionAction:async()=>({})}});
 const active=model.connectionSummary('meta',{status:'active',has_credential:true,expires_at:'2026-12-01T10:00:00Z',connected_at:'2026-10-09T08:00:00Z',accounts:{facebook:2,instagram:1}});
 const none=model.connectionSummary('google_business_profile',null);
 const html=renderToStaticMarkup(jsx.jsx(panel.ConnectionsPanel,{projectId:P,connections:[active,none],oauthMessage:'Connexion OAuth non configurée sur le serveur.',oauthReady:{meta:true,google_business_profile:true},banner:{ok:true,message:'Connexion Meta réussie'}}));
 assert.match(html,/>Reconnecter Meta</);assert.match(html,/>Vérifier la connexion</);assert.match(html,/>Déconnecter</);assert.match(html,/>Connecter Google Business Profile</);
 assert.match(html,/Connecté le 09\/10\/2026/);assert.match(html,/Expire le 01\/12\/2026/);assert.match(html,/2 page\(s\) Facebook · 1 compte\(s\) Instagram/);assert.match(html,/0 fiche\(s\) Google Business Profile/);
 assert.match(html,/data-oauth-result="success"[^>]*>Connexion Meta réussie/);assert.doesNotMatch(html,/Connexion OAuth non configurée/);
 assert.equal((html.match(/>Vérifier la connexion</g)??[]).length,1,'verify only for an existing connection');
 const off=renderToStaticMarkup(jsx.jsx(panel.ConnectionsPanel,{projectId:P,connections:[active],oauthMessage:'Connexion OAuth non configurée sur le serveur.',oauthReady:{meta:false,google_business_profile:false}}));
 assert.match(off,/<button[^>]*disabled=""[^>]*>Connecter Meta<\/button>/);assert.match(off,/Connexion OAuth non configurée sur le serveur\./);assert.doesNotMatch(off,/Vérifier la connexion/);
 for(const out of [html,off])assert.doesNotMatch(out,/vault:|credential_reference|access_token|refresh_token|Bearer|code_verifier|state=/i);});

test('P11-a security scope: no secret client-side, no provider call in client code, no publisher wired, callbacks protected, one migration',()=>{
 const clientFiles=readdirSync(resolve(root,'components'),{recursive:true}).filter(f=>/\.(ts|tsx)$/.test(f)).map(f=>'components/'+f.replaceAll('\\','/'));
 for(const f of clientFiles)assert.doesNotMatch(src(f),/publications-oauth\/(config|http)|oauth\/service|encrypted-vault|secret-store|process\.env\.(META|GOOGLE_BUSINESS|PUBLICATION_CREDENTIALS)|\bfetch\s*\(/,f);
 for(const f of ['components/publications/connections-panel.tsx','app/(cockpit)/publications/connection-actions.ts','lib/publications/oauth/model.ts'])
  assert.doesNotMatch(src(f).replace(/\/\/[^\n]*/g,''),/credential_reference|access_token|refresh_token|client_secret|Bearer|code_verifier/i,f);
 for(const f of ['lib/publications/oauth/service.ts','lib/publications/connections/encrypted-vault.ts','lib/integrations/publications-oauth/http.ts']){const code=src(f).replace(/\/\/[^\n]*/g,'');
  for(const m of code.matchAll(/console\.(error|log|warn|info)\(([^;]*)\)/g))assert.doesNotMatch(m[2].replace(/instanceof [A-Za-z]+/g,''),/credential|token|code\b|state\b|reference|secret|body|headers/i,`${f}: generic logs only`);
  assert.doesNotMatch(code,/delivery\/(engine|fakes|publisher)|publication_job_|publication_prepare_delivery/,`${f}: no publisher / delivery wiring`);}
 assert.match(src('lib/publications/oauth/service.ts'),/publication_oauth_state_consume[\s\S]*exchangeCode/,'state consumed before any exchange');
 const list=readdirSync(resolve(root,'supabase/migrations')).filter(f=>f<'20261015').sort();assert.equal(list.length,23);assert.equal(list[19],'20261011000000_publications_oauth.sql');
 const sql=src('supabase/migrations/20261011000000_publications_oauth.sql').replace(/--[^\n]*/g,'');
 assert.doesNotMatch(sql,/security definer|create policy|grant [a-z, ]* to (anon|authenticated)|insert into public\.publication_deliveries|http|cron/i);
 assert.match(src('docs/publications-oauth.md'),/\/api\/publications\/oauth\/meta\/callback/);assert.doesNotMatch(src('docs/publications-oauth.md'),/EAAB|ya29\.|GOCSPX-[A-Za-z0-9]/);});

test('Gate 4: GBP connection expiry follows the refresh token, not the access token; Meta keeps its expiry',async()=>{
 const m=oauthHarness().m;
 assert.equal(m.connectionExpiry('google_business_profile',{expiresAt:'2030-01-01T00:00:00Z',refreshToken:'1//r'}),null);
 assert.equal(m.connectionExpiry('google_business_profile',{expiresAt:'2030-01-01T00:00:00Z',refreshToken:null}),'2030-01-01T00:00:00Z','no refresh token: the access token expiry is the connection expiry');
 assert.equal(m.connectionExpiry('meta',{expiresAt:'2030-01-01T00:00:00Z',refreshToken:'x'}),'2030-01-01T00:00:00Z');
 const store=memoryStore(),v=encrypted.createEncryptedCredentialVault(store,{current:{id:'k2026a',key:KEY},previous:null},seq());
 const ref=await v.storeCredential({accessToken:'ya29.expired-access',refreshToken:'1//refresh-secret',expiresAt:'2029-12-24T23:00:00.000Z',scopes:['https://www.googleapis.com/auth/business.manage'],provider:'google_business_profile'});
 const gbpProvider={refresh:async c=>({...c,accessToken:'ya29.fresh-access',expiresAt:'2029-12-25T01:00:00.000Z'}),validateConnection:async()=>({status:'active',externalIdentity:null}),
  listAccounts:async()=>[{name:'accounts/1',accountName:'A'}],listLocations:async(_c,a)=>[{name:'locations/7',title:'Lyon',accountName:a}]};
 const h=oauthHarness({connection:{id:CONN,status:'active',credential_reference:ref,expires_at:null},vaultImpl:v,gbpProvider});
 const r=await h.capture(()=>h.m.verifyConnection(P,'google_business_profile',h.deps));
 assert.equal(r.ok,true);const status=h.rpcs('publication_connection_set_status')[0];
 assert.equal(status.p_status,'active');assert.equal(status.p_expires_at,null,'refreshed GBP connection: no one-hour expiry recorded');
 assert.equal((await v.readCredential(status.p_credential_reference)).expiresAt,'2029-12-25T01:00:00.000Z','the access token expiry stays in the vault only');});
