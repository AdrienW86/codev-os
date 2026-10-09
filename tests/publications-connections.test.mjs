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

// Lot 4.3 P9 — publication connections. No real OAuth, Meta, GBP, vault or Supabase call: everything is doubled.
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
const C=uid(1,1),OTHER=uid(1,2),P=uid(3,1),META=uid(5,1),FB1=uid(6,1),FB2=uid(6,2),IG1=uid(6,3),LEGACY=uid(6,9);
const REF='vault:connection/'+uid(9,1);
const model=load('lib/publications/connections/model.ts');
const vault=load('lib/publications/connections/vault.ts');
const providers=load('lib/publications/connections/providers.ts');
const fakes=load('lib/publications/connections/fakes.ts',{'./vault':vault,'./providers':providers});

test('model: providers, platform matrix, labels; Meta / GBP normalization keeps ids and names only',()=>{
 assert.deepEqual(json(model.CONNECTION_PROVIDERS),['meta','google_business_profile']);
 assert.deepEqual(json(model.PROVIDER_PLATFORMS),{meta:['facebook','instagram'],google_business_profile:['google_business_profile']});
 assert.equal(model.providerOfPlatform('instagram'),'meta');assert.equal(model.providerOfPlatform('google_business_profile'),'google_business_profile');
 assert.equal(model.connectFirstMessage('facebook'),'Connectez d’abord Meta');assert.equal(model.connectFirstMessage('google_business_profile'),'Connectez d’abord Google Business Profile');
 assert.equal(model.isConnectionProvider('facebook'),false,'Facebook is a platform, Meta the provider');
 const meta=model.normalizeMetaAccounts([{id:'101',name:'Toitures Dupont',category:'Couvreur',access_token:'EAAB-page-token'},{id:'https://x',name:'URL'},{id:'102',name:''},{id:'101',name:'Doublon'}],
  [{id:'201',username:'toitures.dupont',name:null,pageId:'101'},{id:'202',username:null,name:'Sans page',pageId:''}]);
 assert.deepEqual(json(meta),[{provider:'meta',platform:'facebook',externalAccountId:'101',displayName:'Toitures Dupont',parentExternalId:null,metadata:{}},
  {provider:'meta',platform:'instagram',externalAccountId:'201',displayName:'@toitures.dupont',parentExternalId:'101',metadata:{}}],'invalid ids, empty names and duplicates dropped');
 assert.ok(!JSON.stringify(meta).includes('EAAB'),'page token never kept');
 const gbp=model.normalizeGbpAccounts([{name:'locations/7',title:'Toitures Dupont — Lyon',accountName:'accounts/1'},{name:'locations/8',title:null,accountName:'accounts/1'},{name:'bad',title:'X',accountName:'accounts/1'}]);
 assert.deepEqual(json(gbp),[{provider:'google_business_profile',platform:'google_business_profile',externalAccountId:'accounts/1/locations/7',displayName:'Toitures Dupont — Lyon',parentExternalId:'accounts/1',metadata:{}}]);
 assert.deepEqual(json(model.syncPayload(meta)[1]),{platform:'instagram',external_account_id:'201',display_name:'@toitures.dupont',parent_external_id:'101',metadata:{}},'exact RPC keys');});

test('publishability: central reasons, same order as the SQL function, fail closed',()=>{
 const base={emergencyStop:false,publishingEnabled:true,clientPublishingEnabled:true,platform:'facebook',channel:{enabled:true,accountId:FB1},
  account:{status:'active',enabled:true,platform:'facebook',connectionBacked:true},connection:{provider:'meta',status:'active',hasCredential:true,expiresAt:'2030-01-01T00:00:00Z'},now:new Date('2026-10-09T00:00:00Z')};
 const r=extra=>model.getChannelPublishability({...base,...extra});
 assert.equal(r({}),'publishable');
 assert.equal(r({emergencyStop:true,publishingEnabled:false,channel:null}),'emergency_stop','most global reason first');
 assert.equal(r({publishingEnabled:false}),'publishing_disabled');assert.equal(r({clientPublishingEnabled:false}),'publishing_disabled');
 assert.equal(r({channel:{enabled:false,accountId:FB1}}),'channel_disabled');assert.equal(r({channel:null}),'channel_disabled');
 assert.equal(r({channel:{enabled:true,accountId:null}}),'no_account');
 for(const connection of [null,{...base.connection,status:'expired'},{...base.connection,hasCredential:false},{...base.connection,expiresAt:'2026-10-08T00:00:00Z'},{...base.connection,provider:'google_business_profile'}])
  assert.equal(r({connection}),'connection_inactive',JSON.stringify(connection));
 assert.equal(r({account:{...base.account,connectionBacked:false}}),'connection_inactive','legacy account (no connection) never publishable');
 for(const account of [{...base.account,status:'unavailable'},{...base.account,enabled:false},{...base.account,platform:'instagram'}])assert.equal(r({account}),'account_inactive');
 assert.equal(r({account:{...base.account,usedByOtherClient:true}}),'account_shared','P13: a Page / account used by another client is never publishable');
 // Latest SQL definition (P13 replaced it with the account_shared reason).
 const sql=src('supabase/migrations/20261014000000_publications_account_client_exclusivity.sql').match(/function publications_private\.channel_publishability[\s\S]*?\$\$;/)[0];
 const order=[...sql.matchAll(/then '([a-z_]+)'/g)].map(m=>m[1]).concat([...sql.matchAll(/else '([a-z_]+)'/g)].map(m=>m[1]));
 assert.deepEqual(order,['emergency_stop','publishing_disabled','channel_disabled','no_account','connection_inactive','account_inactive','account_shared','publishable'],'SQL order');
 assert.deepEqual([...model.PUBLISHABILITY_REASONS].sort(),[...order].sort(),'same vocabulary');
 for(const reason of model.PUBLISHABILITY_REASONS)assert.ok(model.PUBLISHABILITY_LABELS[reason],reason);});

test('vault: opaque references, store / read / rotate / delete, invalid input refused, production vault unconfigured',async()=>{
 assert.equal(vault.isCredentialReference(REF),true);
 for(const bad of ['vault:connection/abc','https://vault/x','{"accessToken":"x"}','EAABtoken','ref:legacy/1',null])assert.equal(vault.isCredentialReference(bad),false,String(bad));
 const v=fakes.createMemoryCredentialVault();const secret={accessToken:'EAAB-secret-access',refreshToken:'secret-refresh',expiresAt:'2030-01-01T00:00:00.000Z',scopes:['pages_show_list']};
 const ref=await v.storeCredential(secret);assert.equal(ref,'vault:connection/00000000-0000-4000-8000-000000000001','deterministic in tests');
 assert.ok(vault.isCredentialReference(ref)&&!ref.includes('EAAB')&&!ref.includes('secret'),'reference carries no secret');
 assert.deepEqual(json(await v.readCredential(ref)),secret);
 const rotated=await v.rotateCredential(ref,{...secret,accessToken:'EAAB-rotated'});assert.notEqual(rotated,ref);
 await assert.rejects(()=>v.readCredential(ref),e=>e.kind==='not_found','old reference gone after rotation');assert.equal((await v.readCredential(rotated)).accessToken,'EAAB-rotated');
 await v.deleteCredential(rotated);assert.equal(v.size(),0);await assert.rejects(()=>v.deleteCredential(rotated),e=>e.kind==='not_found');
 await assert.rejects(()=>v.readCredential('https://vault/x'),e=>e.kind==='invalid_reference');
 await assert.rejects(()=>v.storeCredential({accessToken:'',refreshToken:null,expiresAt:null,scopes:[]}),e=>e.kind==='invalid_secret');
 const prod=vault.unconfiguredCredentialVault();for(const op of ['storeCredential','readCredential','rotateCredential','deleteCredential'])await assert.rejects(()=>prod[op](REF,secret),e=>e.kind==='unconfigured',op);
 assert.match(String(new vault.CredentialVaultError('not_found').message),/^Credential vault: not_found$/,'errors never echo a secret');});

test('Meta provider (fake transport, P11-a contract): short → long-lived token, debug_token, pages without page tokens, Instagram linked, expired / revoked',async()=>{
 const m=load('lib/publications/connections/meta.ts',{'./providers':providers});const calls=[];let reads=()=>({status:200,body:{}});let debug={is_valid:true,app_id:'123456',user_id:'987',scopes:['pages_show_list','instagram_basic'],expires_at:4102444800};
 const p=m.createMetaConnectionProvider({request:async r=>{calls.push(json(r));
  if(r.operation==='token')return {status:200,body:{access_token:r.params.grant_type==='fb_exchange_token'?'EAAB-long-lived-token':'EAAB-short-token',token_type:'bearer',expires_in:5184000}};
  if(r.operation==='debug')return {status:200,body:{data:debug}};return reads(r);}},{appId:'123456'});
 const cred={accessToken:'EAAB-user-token',refreshToken:null,expiresAt:null,scopes:[]};
 const c=await p.exchangeCode('AQD-auth-code-123','https://cockpit.local/callback');
 assert.equal(c.accessToken,'EAAB-long-lived-token');assert.equal(c.refreshToken,null);assert.equal(c.subject,'987');assert.equal(c.provider,'meta');assert.equal(c.expiresAt,'2100-01-01T00:00:00.000Z');
 assert.deepEqual(calls.map(r=>r.operation),['token','token','debug'],'code → short token → long-lived token → inspection');
 reads=r=>r.params.fields.startsWith('id,name')?{status:200,body:{data:[{id:'101',name:'Toitures Dupont',access_token:'EAAB-page-token',category:'Couvreur'},{id:'102'}]}}
  :{status:200,body:{data:[{id:'101',instagram_business_account:{id:'201',username:'toitures.dupont'}},{id:'102'}]}};
 assert.deepEqual(json(await p.listFacebookPages(cred)),[{id:'101',name:'Toitures Dupont',category:'Couvreur'}]);
 assert.deepEqual(json(await p.listInstagramAccounts(cred)),[{id:'201',pageId:'101',username:'toitures.dupont',name:null}]);
 assert.ok(calls.filter(r=>r.operation==='read').every(r=>!JSON.stringify(r.params).includes('EAAB')),'token passed as credential, never in query params');
 debug={is_valid:false,app_id:'123456',error:{code:190,subcode:463}};assert.deepEqual(json(await p.validateConnection(cred)),{status:'expired',externalIdentity:null});
 debug={is_valid:false,app_id:'123456',error:{code:190,subcode:460}};assert.deepEqual(json(await p.validateConnection(cred)),{status:'revoked',externalIdentity:null});
 debug={is_valid:true,app_id:'123456',user_id:'meta-user-1',scopes:['pages_show_list']};assert.deepEqual(json(await p.validateConnection(cred)),{status:'active',externalIdentity:'meta-user-1'});
 debug={is_valid:true,app_id:'999',user_id:'x',scopes:['pages_show_list']};await assert.rejects(()=>p.validateConnection(cred),e=>e.kind==='invalid','token of another app refused');
 reads=()=>{throw Error('socket EAAB-user-token');};await assert.rejects(()=>p.listFacebookPages(cred),e=>e.kind==='unavailable'&&!e.message.includes('EAAB'),'transport error sanitized');});

test('GBP provider (fake transport, P11-a contract): business.manage scope required, PKCE verifier, refresh, revoked / expired / permission, accounts and locations',async()=>{
 const g=load('lib/publications/connections/google-business-profile.ts',{'./providers':providers});let reply=()=>({status:200,body:{}});const calls=[];
 const p=g.createGoogleBusinessProfileConnectionProvider({request:async r=>{calls.push(json(r));return reply(r);}});const cred={accessToken:'ya29.access-token',refreshToken:'1//refresh-token-value',expiresAt:null,scopes:[]};
 reply=()=>({status:200,body:{access_token:'ya29.new-access',token_type:'Bearer',expires_in:3599,refresh_token:'1//new-refresh-token',scope:'https://www.googleapis.com/auth/business.manage'}});
 const c=await p.exchangeCode('4/0Ab-auth-code','https://cockpit.local/callback','v'.repeat(43));assert.equal(c.refreshToken,'1//new-refresh-token');assert.equal(c.provider,'google_business_profile');
 assert.equal(calls[0].params.code_verifier,'v'.repeat(43),'PKCE verifier sent with the code');
 reply=()=>({status:200,body:{access_token:'ya29.new-access',token_type:'Bearer',expires_in:3599,scope:'https://www.googleapis.com/auth/drive.readonly'}});
 await assert.rejects(()=>p.refresh(cred),e=>e.kind==='permission','wrong scope refused');
 reply=()=>({status:400,body:{error:'invalid_grant'}});await assert.rejects(()=>p.refresh(cred),e=>e.kind==='revoked');
 await assert.rejects(()=>p.refresh({...cred,refreshToken:null}),e=>e.kind==='revoked','no refresh token');
 reply=()=>({status:401,body:{}});assert.deepEqual(json(await p.validateConnection(cred)),{status:'expired',externalIdentity:null});
 reply=()=>({status:403,body:{error:{status:'PERMISSION_DENIED'}}});await assert.rejects(()=>p.validateConnection(cred),e=>e.kind==='permission','403 is a permission problem, not a revocation');
 reply=r=>r.path==='accounts'?{status:200,body:{accounts:[{name:'accounts/1',accountName:'Toitures Dupont'},{name:'nope'}]}}:{status:200,body:{locations:[{name:'locations/7',title:'Lyon'},{name:'x'}]}};
 assert.deepEqual(json(await p.listAccounts(cred)),[{name:'accounts/1',accountName:'Toitures Dupont'}]);
 assert.deepEqual(json(await p.listLocations(cred,'accounts/1')),[{name:'locations/7',title:'Lyon',accountName:'accounts/1'}]);
 await assert.rejects(()=>p.listLocations(cred,'../admin'),e=>e.kind==='invalid');});

test('fakes: deterministic Meta / GBP providers with active, expired and revoked states',async()=>{
 let state='active';const meta=fakes.createFakeMetaProvider({pages:[{id:'101',name:'Toitures Dupont'}],instagram:[{id:'201',username:'toitures.dupont',name:null,pageId:'101'}]},()=>state);
 const cred=await meta.exchangeCode('code','uri');assert.equal(cred.accessToken,'fake-access-1');
 assert.equal((await meta.listFacebookPages(cred)).length,1);assert.equal((await meta.listInstagramAccounts(cred))[0].pageId,'101');
 state='revoked';await assert.rejects(()=>meta.listFacebookPages(cred),e=>e.kind==='revoked');assert.equal((await meta.validateConnection(cred)).status,'revoked');
 state='expired';await assert.rejects(()=>meta.refresh(cred),e=>e.kind==='expired');
 const gbp=fakes.createFakeGbpProvider({accounts:[{name:'accounts/1',accountName:'Toitures'}],locations:{'accounts/1':[{name:'locations/7',title:'Lyon'}]}});
 assert.deepEqual(json(await gbp.listLocations(cred,'accounts/1')),[{name:'locations/7',title:'Lyon',accountName:'accounts/1'}]);
 const revoked=fakes.createFakeGbpProvider({accounts:[],locations:{}},()=>'revoked');await assert.rejects(()=>revoked.listAccounts(cred),e=>e.kind==='revoked');
 for(const dir of ['app','components','lib']){for(const f of readdirSync(resolve(root,dir),{recursive:true}).filter(f=>/\.(ts|tsx)$/.test(f))){const path=resolve(root,dir,f);
  if(relative(root,path).replaceAll('\\','/')==='lib/publications/connections/fakes.ts')continue;assert.doesNotMatch(src(relative(root,path)),/connections\/fakes|from ['"]\.\/fakes['"]/,`no application import of the fakes: ${f}`);}}});

// --- Services ------------------------------------------------------------------------------------------------
const listed=()=>[{id:META,provider:'meta',status:'active',connected_at:'2026-10-01T00:00:00Z',expires_at:'2026-12-01T00:00:00Z',has_credential:true,accounts:{facebook:2,instagram:1,google_business_profile:0}}];
const available=()=>[{id:FB1,platform:'facebook',display_name:'Toitures Dupont',status:'active',enabled:true,connection_status:'active',assignable:true},
 {id:FB2,platform:'facebook',display_name:'Toitures Dupont Lyon',status:'unavailable',enabled:false,connection_status:'active',assignable:false},
 {id:IG1,platform:'instagram',display_name:'@toitures.dupont',status:'active',enabled:true,connection_status:'active',assignable:true}];
function serviceWith({rpc={},tables={}}={}){
 const log=[];
 const data={projects:[{id:P,client_id:C}],publication_project_channels:[{project_id:P,client_id:C,platform:'facebook',enabled:true,publication_account_id:FB1},
   {project_id:P,client_id:C,platform:'instagram',enabled:true,publication_account_id:null},{project_id:P,client_id:C,platform:'google_business_profile',enabled:true,publication_account_id:LEGACY}],
  publication_settings:[{emergency_stop:false,publishing_enabled:true}],publication_client_settings:[{client_id:C,publishing_enabled:true}],
  publication_accounts:[{id:LEGACY,client_id:C,platform:'google_business_profile',status:'connected',enabled:true,display_name:null,credential_reference:'ref:legacy/1'}],
  client_connections:[{id:META,client_id:C,provider:'meta',status:'active',credential_reference:REF}],...tables};
 const db={from(table){const f=[];const rows=()=>({data:json((data[table]??[]).filter(r=>f.every(x=>x(r)))),error:null});log.push(['from',table]);
   const q={select:c=>{log.push(['select',table,c]);return q;},limit:()=>q,eq(k,v){f.push(r=>r[k]===v);return q;},in(k,vs){f.push(r=>vs.includes(r[k]));return q;},
    maybeSingle:async()=>({data:rows().data[0]??null,error:null}),then(ok,ko){return Promise.resolve(rows()).then(ok,ko);}};return q;},
  rpc:async(name,args)=>{log.push(['rpc',name,json(args)]);if(rpc[name])return rpc[name](args);
   return name==='publication_connections_list'?{data:args.p_client_id===C?listed():[],error:null}:name==='publication_accounts_available'?{data:args.p_client_id===C?available():[],error:null}
    :name==='publication_connection_disconnect'?{data:{connection_id:META,status:'disabled',already:false,previous_reference:REF},error:null}:{data:{inserted:2,updated:0,unavailable:0},error:null};}};
 const m=load('lib/publications/connections/service.ts',{'@/lib/require-admin':{requireAdmin:async()=>{log.push('admin');return {userId:'user_admin'};}},'@/lib/supabase/server':{getSupabaseServerClient:()=>db},
  './vault':vault,'./providers':providers,'./model':model,
  // P11-a production wiring (environment): doubled here, the services stay under test with explicit deps.
  '../oauth/service':{productionOAuthDeps:()=>({db:null,vault:null,meta:null,google:null,pkceKey:null}),oauthReadiness:()=>({meta:false,google_business_profile:false})}});
 return {m,log,rpcs:name=>log.filter(x=>x[0]==='rpc'&&x[1]===name).map(x=>x[2])};}
const leak=v=>{const s=JSON.stringify(v);return ['vault:','credential_reference','ref:legacy','EAAB','fake-access','fake-refresh','101','201','accounts/1'].filter(x=>s.includes(x));};

test('services: admin first, listings and project configuration without any secret, reference or external id',async()=>{
 const s=serviceWith();const list=await s.m.getClientConnections(C);assert.equal(s.log[0],'admin');
 assert.deepEqual(json(list.map(c=>[c.provider,c.status,c.connected,c.counts,c.canDisconnect])),[['meta','active',true,{facebook:2,instagram:1,google_business_profile:0},true],['google_business_profile','none',false,{facebook:0,instagram:0,google_business_profile:0},false]]);
 assert.match(list[0].expiresLabel,/^Expire le 01\/12\/2026$/);
 const accounts=await s.m.getAvailablePublicationAccounts(C);assert.deepEqual(json(accounts.map(a=>[a.name,a.platform,a.statusLabel,a.assignable])),[['Toitures Dupont','facebook','Actif',true],['Toitures Dupont Lyon','facebook','Indisponible',false],['@toitures.dupont','instagram','Actif',true]]);
 await assert.rejects(()=>s.m.getClientConnections('nope'));
 const conf=await s.m.getProjectConnectionConfiguration(P,new Date('2026-10-09T00:00:00Z'));
 const fb=conf.channels.find(c=>c.platform==='facebook'),ig=conf.channels.find(c=>c.platform==='instagram'),gb=conf.channels.find(c=>c.platform==='google_business_profile');
 assert.deepEqual(json([fb.options.length,fb.currentAccountId,fb.publishability,fb.emptyMessage]),[2,FB1,'publishable',null],'Facebook: Facebook accounts only');
 assert.deepEqual(json([ig.options.map(o=>o.platform),ig.publishability]),[['instagram'],'no_account']);
 assert.deepEqual(json([gb.options.length,gb.currentLabel,gb.publishability,gb.emptyMessage]),[0,'Compte — Compte historique','connection_inactive',null],'legacy account visible, never publishable');
 assert.equal(conf.oauthMessage,'Connexion OAuth non configurée sur le serveur.');
 assert.deepEqual(leak(conf),[],'no secret / reference / external id');
 const legacyRead=s.log.find(x=>x[0]==='select'&&x[1]==='publication_accounts');assert.doesNotMatch(legacyRead[2],/credential|external/,'legacy read never selects the credential');
 const noAccounts=serviceWith({rpc:{publication_accounts_available:()=>({data:[],error:null})},tables:{publication_project_channels:[{project_id:P,client_id:C,platform:'google_business_profile',enabled:true,publication_account_id:null}]}});
 assert.equal((await noAccounts.m.getProjectConnectionConfiguration(P)).channels.find(c=>c.platform==='google_business_profile').emptyMessage,'Connectez d’abord Google Business Profile');
 const stopped=serviceWith({tables:{publication_settings:[{emergency_stop:true,publishing_enabled:false}]}});assert.equal(await stopped.m.getChannelPublishability(P,'facebook'),'emergency_stop');
 const down=serviceWith({rpc:{publication_connections_list:()=>({data:null,error:{message:'down'}})}});await assert.rejects(()=>down.m.getProjectConnectionConfiguration(P),'fail closed');});

test('services: sync = vault read + provider + normalization + ONE RPC; unavailable in production; revoked recorded; nothing leaked',async()=>{
 const prod=serviceWith();const r=await prod.m.syncPublicationAccounts(P,'meta');
 assert.deepEqual(json(r),{ok:false,message:'Connexion OAuth non configurée sur le serveur.'});assert.ok(!prod.log.some(x=>x[0]==='from'||x[0]==='rpc'),'no read without OAuth');
 const v=fakes.createMemoryCredentialVault(()=>uid(9,1).replace(/^9/,'9'));const ref=await v.storeCredential({accessToken:'EAAB-secret',refreshToken:null,expiresAt:null,scopes:[]});
 const meta=fakes.createFakeMetaProvider({pages:[{id:'101',name:'Toitures Dupont'},{id:'102',name:'Lyon'}],instagram:[{id:'201',username:'toitures.dupont',name:null,pageId:'101'}]});
 const s=serviceWith({tables:{client_connections:[{id:META,client_id:C,provider:'meta',status:'active',credential_reference:ref}]}});
 const ok=await s.m.syncPublicationAccounts(P,'meta',{vault:v,meta,gbp:null});assert.equal(ok.ok,true);assert.deepEqual(json(ok.counts),{inserted:2,updated:0,unavailable:0});
 const [call]=s.rpcs('publication_accounts_sync');assert.equal(call.p_client_id,C,'client resolved on the server');assert.equal(call.p_connection_id,META);
 assert.deepEqual(call.p_accounts.map(a=>[a.platform,a.external_account_id]),[['facebook','101'],['facebook','102'],['instagram','201']]);
 assert.deepEqual(leak(ok),[]);assert.ok(!JSON.stringify(call).includes('EAAB'),'secret never sent to the database');
 let state='revoked';const revoked=serviceWith({tables:{client_connections:[{id:META,client_id:C,provider:'meta',status:'active',credential_reference:ref}]}});
 const rr=await revoked.m.syncPublicationAccounts(P,'meta',{vault:v,meta:fakes.createFakeMetaProvider({pages:[],instagram:[]},()=>state),gbp:null});
 assert.equal(rr.ok,false);assert.match(rr.message,/révoqué/);assert.deepEqual(revoked.rpcs('publication_connection_set_status').map(a=>a.p_status),['revoked']);assert.equal(revoked.rpcs('publication_accounts_sync').length,0);
 const inactive=serviceWith({tables:{client_connections:[{id:META,client_id:C,provider:'meta',status:'expired',credential_reference:ref}]}});
 assert.match((await inactive.m.syncPublicationAccounts(P,'meta',{vault:v,meta,gbp:null})).message,/Connexion inactive/);
 const errors=[];const original=console.error;console.error=(...a)=>errors.push(a);
 try{const broken=serviceWith({tables:{client_connections:[{id:META,client_id:C,provider:'meta',status:'active',credential_reference:ref}]}});
  const bad=await broken.m.syncPublicationAccounts(P,'meta',{vault:v,meta:{...meta,listFacebookPages:async()=>{throw Error('Graph error for token EAAB-secret');}},gbp:null});
  assert.equal(bad.message,'Synchronisation impossible. Réessayez plus tard.');assert.ok(!JSON.stringify(errors).includes('EAAB'),'provider error text never logged');
  const vaultDown=serviceWith();assert.equal((await vaultDown.m.syncPublicationAccounts(P,'meta',{vault:vault.unconfiguredCredentialVault(),meta,gbp:null})).ok,false);
 }finally{console.error=original;}
 assert.equal((await prod.m.syncPublicationAccounts(P,'facebook')).message,'Connexion invalide.');});

test('services: assignment and disconnect (server-resolved client, vault purge, generic failure), Google Ads untouched',async()=>{
 const s=serviceWith();
 assert.equal((await s.m.assignPublicationAccountToChannel(P,'tiktok',FB1)).ok,false);assert.equal((await s.m.assignPublicationAccountToChannel(P,'facebook','x')).ok,false);
 assert.deepEqual(json(await s.m.assignPublicationAccountToChannel(P,'facebook',FB1)),{ok:true,message:'Compte de publication enregistré.'});
 assert.deepEqual(s.rpcs('publication_channel_assign_account'),[{p_project_id:P,p_platform:'facebook',p_account_id:FB1,p_actor_id:'user_admin'}]);
 assert.equal((await s.m.assignPublicationAccountToChannel(P,'facebook',null)).message,'Compte de publication retiré.');
 const refused=serviceWith({rpc:{publication_channel_assign_account:()=>({data:null,error:{code:'23514',message:'Account not assignable'}})}});
 assert.match((await refused.m.assignPublicationAccountToChannel(P,'facebook',IG1)).message,/ne peut pas être utilisé pour ce canal/);
 const v=fakes.createMemoryCredentialVault(()=>uid(9,1).slice(0,36));await v.storeCredential({accessToken:'EAAB-secret',refreshToken:null,expiresAt:null,scopes:[]});
 const d=serviceWith();const out=await d.m.disconnectConnection(P,'meta',{vault:v});
 assert.deepEqual(json(out),{ok:true,message:'Meta déconnecté. Les comptes associés ne sont plus utilisables pour publier.'});
 assert.deepEqual(d.rpcs('publication_connection_disconnect'),[{p_client_id:C,p_connection_id:META,p_actor_id:'user_admin'}],'client from the project, connection from the server listing');
 assert.equal(v.size(),0,'secret deleted from the vault');assert.deepEqual(leak(out),[]);
 const errors=[];const original=console.error;console.error=(...a)=>errors.push(a);
 try{const failing=serviceWith();const r=await failing.m.disconnectConnection(P,'meta',{vault:{deleteCredential:async ref=>{throw Error('vault down for '+ref);}}});
  assert.equal(r.ok,true,'connection stays disconnected');assert.equal(r.message,out.message,'same generic message');
  assert.ok(errors.length===1&&!JSON.stringify(errors).includes('vault:'),'generic log without the reference');
 }finally{console.error=original;}
 assert.equal(failingRestore(),true);
 const none=serviceWith();assert.equal((await none.m.disconnectConnection(P,'google_business_profile')).message,'Aucune connexion à déconnecter.');
 assert.equal((await none.m.disconnectConnection(P,'google_ads')).message,'Connexion invalide.','Google Ads is never handled here');
 const ads=src('lib/integrations/google-ads/service.ts');assert.match(ads,/const connectionColumns = "id,client_id,provider,status,external_account_id,metadata,last_checked_at,created_at,updated_at"/,'Google Ads service unchanged');
 const sql=src('supabase/migrations/20261009000000_publications_connections.sql');
 assert.match(sql,/if publications_private\.connection_provider\(new\.provider\) or \(tg_op='UPDATE' and publications_private\.connection_provider\(old\.provider\)\)/,'guard scoped to the publication providers');
 assert.match(sql,/select coalesce\(p_provider in\('meta','google_business_profile'\),false\)/);});
function failingRestore(){return !/restore|status='active'/.test(src('lib/publications/connections/service.ts').match(/export async function disconnectConnection[\s\S]*?\n}\n/)[0]);}

test('actions: admin first, confirmation for disconnect, server resolution, revalidation',async()=>{
 const calls=[];const a=load('app/(cockpit)/publications/connection-actions.ts',{'next/cache':{revalidatePath:p=>calls.push(['revalidate',p])},'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');}},
  '@/lib/publications/connections/service':{assignPublicationAccountToChannel:async(p,pl,acc)=>{calls.push(['assign',p,pl,acc]);return {ok:true,message:'ok'};},disconnectConnection:async(p,pr)=>{calls.push(['disconnect',p,pr]);return {ok:true,message:'ok'};}}});
 const form=e=>{const f=new FormData();for(const [k,v] of Object.entries(e))f.set(k,v);return f;};
 await a.assignPublicationAccountAction({},form({project_id:P,platform:'facebook',account_id:'',client_id:OTHER}));
 assert.deepEqual(json(calls.slice(0,2)),['admin',['assign',P,'facebook',null]],'empty selection = unassign; browser client id ignored');
 for(const tab of ['','/configuration','/calendar','/agent','/review'])assert.ok(calls.some(c=>c[1]===`/projects/${P}${tab}`),tab);assert.ok(calls.some(c=>c[1]==='/publications'));
 calls.length=0;assert.match((await a.disconnectPublicationConnectionAction({},form({project_id:P,provider:'meta'}))).message,/confirmation/);assert.ok(!calls.some(c=>c[0]==='disconnect'));
 calls.length=0;await a.disconnectPublicationConnectionAction({},form({project_id:P,provider:'meta',confirm:'on'}));assert.deepEqual(json(calls.slice(0,2)),['admin',['disconnect',P,'meta']]);});

test('UI: connection cards, OAuth pending, disconnect, account selector (multiple / none / inactive), publishability; no secret anywhere',()=>{
 const p=load('components/publications/connections-panel.tsx',{'@/app/(cockpit)/publications/connection-actions':{assignPublicationAccountAction:async()=>({}),disconnectPublicationConnectionAction:async()=>({})}});
 const metaSummary=model.connectionSummary('meta',{status:'active',has_credential:true,expires_at:'2026-12-01T10:00:00Z',accounts:{facebook:2,instagram:1}});
 const gbpSummary=model.connectionSummary('google_business_profile',null),disabled=model.connectionSummary('google_business_profile',{status:'disabled',accounts:{google_business_profile:0}});
 const html=renderToStaticMarkup(jsx.jsx(p.ConnectionsPanel,{projectId:P,connections:[metaSummary,gbpSummary],oauthMessage:'Connexion OAuth non configurée sur le serveur.',oauthReady:{meta:false,google_business_profile:false}}));
 assert.match(html,/Connexions/);assert.match(html,/data-connection="meta" data-status="active"/);assert.match(html,/2 page\(s\) Facebook · 1 compte\(s\) Instagram/);assert.match(html,/Expire le 01\/12\/2026/);
 assert.match(html,/0 fiche\(s\) Google Business Profile/);assert.match(html,/Non connecté/);
 assert.match(html,/<button[^>]*disabled=""[^>]*>Connecter Meta<\/button>/);assert.match(html,/<button[^>]*disabled=""[^>]*>Connecter Google Business Profile<\/button>/);
 assert.equal((html.match(/Connexion OAuth non configurée sur le serveur\./g)??[]).length,2);
 assert.equal((html.match(/>Déconnecter</g)??[]).length,1,'disconnect only for an existing connection');
 assert.doesNotMatch(renderToStaticMarkup(jsx.jsx(p.ConnectionsPanel,{projectId:P,connections:[disabled],oauthMessage:'x',oauthReady:{meta:false,google_business_profile:false}})),/>Déconnecter</,'already disconnected');
 const options=[{id:FB1,platform:'facebook',name:'Toitures Dupont',status:'active',statusLabel:'Actif',assignable:true},{id:FB2,platform:'facebook',name:'Toitures Dupont Lyon',status:'unavailable',statusLabel:'Indisponible',assignable:false}];
 const selector=renderToStaticMarkup(jsx.jsx(p.ChannelAccountSelector,{projectId:P,view:{platform:'facebook',platformLabel:'Facebook',currentAccountId:FB1,currentLabel:'Toitures Dupont — Actif',options,emptyMessage:null,publishability:'publishable',publishabilityLabel:'Prêt pour la publication'}}));
 assert.match(selector,/Compte de publication/);assert.match(selector,/Toitures Dupont — Facebook — Actif/);assert.match(selector,new RegExp(`<option value="${FB2}"[^>]*disabled=""[^>]*>Toitures Dupont Lyon — Facebook — Indisponible`));
 assert.match(selector,/Publication : Prêt pour la publication/);assert.doesNotMatch(selector,/name="client_id"/,'the browser never sends a client');
 const empty=renderToStaticMarkup(jsx.jsx(p.ChannelAccountSelector,{projectId:P,view:{platform:'instagram',platformLabel:'Instagram',currentAccountId:null,currentLabel:null,options:[],emptyMessage:'Connectez d’abord Meta',publishability:'no_account',publishabilityLabel:'Aucun compte de publication'}}));
 assert.match(empty,/Connectez d’abord Meta/);assert.doesNotMatch(empty,/<select/);assert.match(empty,/Publication : Aucun compte de publication/);
 const inactive=renderToStaticMarkup(jsx.jsx(p.ChannelAccountSelector,{projectId:P,view:{platform:'google_business_profile',platformLabel:'Google Business Profile',currentAccountId:LEGACY,currentLabel:'Compte — Compte historique',options:[],emptyMessage:null,publishability:'connection_inactive',publishabilityLabel:'Connexion inactive'}}));
 assert.match(inactive,new RegExp(`<option value="${LEGACY}"[^>]*disabled=""[^>]*>Compte — Compte historique`));assert.match(inactive,/data-publishability="connection_inactive"/);
 for(const out of [html,selector,empty,inactive])assert.deepEqual(leak(out).filter(x=>!['101','201'].includes(x)),[]);});

test('P9 security: client components and logs never handle secrets; scope of the lot',()=>{
 for(const f of ['components/publications/connections-panel.tsx','components/publications/channel-configuration.tsx','lib/publications/connections/model.ts','app/(cockpit)/publications/connection-actions.ts'])
  assert.doesNotMatch(src(f).replace(/\/\/[^\n]*/g,''),/credential_reference|access_token|refresh_token|client_secret|authorization code|Bearer|@\/lib\/supabase|getSupabaseServerClient|\.rpc\(|process\.env/i,f);
 for(const f of ['components/publications/connections-panel.tsx','components/publications/channel-configuration.tsx'])assert.doesNotMatch(src(f),/connections\/(service|vault|providers|meta|google-business-profile|fakes)/,f);
 for(const f of readdirSync(resolve(root,'lib/publications/connections'))){const code=src('lib/publications/connections/'+f).replace(/\/\/[^\n]*/g,'');
  assert.doesNotMatch(code,/\bfetch\s*\(|https?:\/\/|process\.env|console\.log/,f);
  for(const m of code.matchAll(/console\.error\(([^;]*)\)/g))assert.doesNotMatch(m[1],/message|reference|credential|token|error\)/,`${f}: log without provider text`);}
 const list=readdirSync(resolve(root,'supabase/migrations')).filter(f=>f<'20261015').sort();assert.equal(list.length,23);assert.equal(list[17],'20261009000000_publications_connections.sql');
 const sql=src('supabase/migrations/20261009000000_publications_connections.sql').replace(/--[^\n]*/g,'');
 assert.doesNotMatch(sql,/security definer|insert into public\.publication_deliveries|insert into public\.publication_jobs|delete from public\.|drop (table|function)|cron|http/i);});
