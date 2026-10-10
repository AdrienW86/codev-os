import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Lot 4.3 P13 — Meta connection for several clients: one external account per client, Graph API v26.0, optional
// Business Manager permissions, explicit admin trigger behind the kill switches. Mocks only: no network, no database.
const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,Intl,Error,URL,URLSearchParams,console,Promise,Array,String,Math,Buffer,Uint8Array,TextEncoder,AbortSignal,Symbol,RegExp,process:{env:{}},
   require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='react')return React;if(name==='server-only')return {};
    if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=v=>JSON.parse(JSON.stringify(v));
const src=f=>readFileSync(resolve(root,f),'utf8').replace(/\r\n/g,'\n');
const ENV={PUBLICATIONS_OAUTH_BASE_URL:'http://localhost:3000',META_APP_ID:'123456789012345',META_APP_SECRET:'meta-app-secret-value-0123'};

test('Meta OAuth: Graph API v26.0, minimum permissions by default, Business Manager permissions only on explicit opt-in',()=>{
 const config=load('lib/integrations/publications-oauth/config.ts');
 const http=load('lib/integrations/publications-oauth/http.ts',{'./config':config});
 assert.equal(config.META_GRAPH_VERSION,'v26.0');
 const base=config.metaOAuthConfig(ENV);assert.equal(base.businessManagerRoles,false);
 let url=new URL(http.metaAuthorizeUrl(base,'S'.repeat(43)));
 assert.equal(url.origin+url.pathname,'https://www.facebook.com/v26.0/dialog/oauth');
 assert.deepEqual(url.searchParams.get('scope').split(','),['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_content_publish']);
 assert.equal(url.searchParams.get('redirect_uri'),'http://localhost:3000/api/publications/oauth/meta/callback');
 const bm=config.metaOAuthConfig({...ENV,META_PAGE_ROLES_VIA_BUSINESS_MANAGER:'true'});
 url=new URL(http.metaAuthorizeUrl(bm,'S'.repeat(43)));
 assert.deepEqual(url.searchParams.get('scope').split(',').slice(-2),['ads_management','ads_read'],'Business Manager roles: ads_management + ads_read (official Instagram publishing guide)');
 assert.equal(config.metaOAuthConfig({...ENV,META_PAGE_ROLES_VIA_BUSINESS_MANAGER:'false'}).businessManagerRoles,false);
 assert.equal(config.metaOAuthConfig({...ENV,META_PAGE_ROLES_VIA_BUSINESS_MANAGER:'yes'}),null,'ambiguous value: Meta disabled (fail closed)');
 assert.ok(!url.toString().includes(ENV.META_APP_SECRET),'app secret never in the authorize URL');
 const flb=config.metaOAuthConfig({...ENV,META_LOGIN_CONFIG_ID:'987654321098765'});
 url=new URL(http.metaAuthorizeUrl(flb,'S'.repeat(43)));
 assert.equal(url.searchParams.get('config_id'),'987654321098765');assert.equal(url.searchParams.get('scope'),null,'Facebook Login for Business: config_id replaces scope');
 assert.equal(url.searchParams.get('response_type'),'code','server-side code exchange');
 assert.equal(config.metaOAuthConfig({...ENV,META_LOGIN_CONFIG_ID:'abc'}),null,'malformed configuration id: Meta disabled');
 for(const f of ['lib/integrations/publications-meta-publish.ts','lib/integrations/publications-oauth/http.ts'])assert.doesNotMatch(src(f),/v25\.0/,f);
 const example=src('.env.example'),names=example.split(/\r?\n/).map(l=>l.trim());assert.ok(names.includes('META_PAGE_ROLES_VIA_BUSINESS_MANAGER='));assert.ok(names.includes('META_LOGIN_CONFIG_ID='));
 for(const line of example.split(/\r?\n/))assert.ok(/^\s*(#.*)?$/.test(line)||/^[A-Z][A-Z0-9_]*=$/.test(line),'names only in .env.example: '+line);});

test('one external account per client: labels, blocked reason, assignment refusal message',async()=>{
 const model=load('lib/publications/connections/model.ts');
 assert.equal(model.PUBLISHABILITY_LABELS.account_shared,'Compte déjà utilisé par un autre client');
 const o={id:'a',platform:'facebook',name:'Toitures P10',status:'active',statusLabel:'Actif',assignable:false,usedByOtherClient:true};
 assert.equal(model.accountOptionLabel(o),'Toitures P10 — Facebook — Déjà utilisé par un autre client');
 assert.equal(model.accountOptionLabel({...o,usedByOtherClient:false}),'Toitures P10 — Facebook — Actif');
 const delivery=load('lib/publications/delivery/model.ts');assert.equal(delivery.blockedReasonLabel('account_shared'),'Compte déjà utilisé par un autre client');
 const rpcs=[];let answer={error:{code:'23505',message:'Account already used by another client'}};
 const db={rpc:async(n,a)=>{rpcs.push([n,a]);return answer;},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'40000000-0000-4000-8000-000000000001',client_id:'10000000-0000-4000-8000-000000000001'},error:null})})})})};
 const service=load('lib/publications/connections/service.ts',{'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})},'@/lib/supabase/server':{getSupabaseServerClient:()=>db},
  '../oauth/service':{productionOAuthDeps:()=>({vault:null}),oauthReadiness:()=>({meta:false,google_business_profile:false})},'@/lib/integrations/publications-oauth/config':{OAUTH_CALLBACK_PATHS:{}}});
 const r=await service.assignPublicationAccountToChannel('40000000-0000-4000-8000-000000000001','facebook','50000000-0000-4000-8000-000000000001');
 assert.equal(r.ok,false);assert.match(r.message,/déjà utilisé par un autre client/);});

test('admin trigger « Envoyer les publications dues »: admin first, kill switches read first, bounded, summary only',async()=>{
 const calls=[];let admin=true;
 const reg=load('lib/publications/delivery/registry.ts',{'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');if(!admin)throw Error('denied');return {userId:'user_2abc'};}},
  '@/lib/supabase/server':{getSupabaseServerClient:()=>({})},'@/lib/integrations/publications-oauth/config':{metaOAuthConfig:()=>null,googleOAuthConfig:()=>null},'@/lib/integrations/publications-oauth/http':{},
  '@/lib/integrations/publications-meta-publish':{},'@/lib/integrations/publications-gbp-publish':{},'../connections/google-business-profile':{},'./gbp-publisher':{},'./meta-publisher':{},
  '../connections/vault':load('lib/publications/connections/vault.ts'),'../oauth/service':{productionOAuthDeps:()=>({vault:null})},'./engine':{runOnePublicationJob:async()=>{throw Error('must not run');}}});
 const settings=s=>({from:t=>{calls.push('read:'+t);return {select:()=>({limit:()=>({maybeSingle:async()=>s})})};}});
 const runner=results=>{let i=0;return async worker=>{calls.push('run:'+worker);return results[i++]??{state:'idle'};};};
 let r=await reg.processDuePublications({db:settings({data:{emergency_stop:true,publishing_enabled:false},error:null}),run:runner([{state:'completed',outcome:'published'}])});
 assert.deepEqual(json(r),{ok:false,message:'Arrêt d’urgence actif : aucun envoi.',counts:{published:0,failed:0,uncertain:0,blocked:0,retry:0}});
 assert.deepEqual(calls,['admin','read:publication_settings'],'admin checked first, nothing run under the emergency stop');
 calls.length=0;r=await reg.processDuePublications({db:settings({data:{emergency_stop:false,publishing_enabled:false},error:null}),run:runner([])});
 assert.equal(r.message,'Publication désactivée dans les réglages : aucun envoi.');assert.ok(!calls.some(c=>c.startsWith('run:')));
 calls.length=0;r=await reg.processDuePublications({db:settings({data:null,error:{code:'X'}}),run:runner([])});assert.equal(r.ok,false);assert.ok(!calls.some(c=>c.startsWith('run:')),'unreadable settings: fail closed');
 calls.length=0;r=await reg.processDuePublications({db:settings({data:{emergency_stop:false,publishing_enabled:true},error:null}),run:runner([
  {state:'completed',outcome:'published'},{state:'completed',outcome:'uncertain'},{state:'completed',outcome:'rate_limit'},{state:'blocked',reason:'account_shared'},{state:'completed',outcome:'invalid_payload'},{state:'completed',outcome:'published'}])});
 assert.equal(calls.filter(c=>c.startsWith('run:')).length,5,'at most 5 jobs per click');assert.ok(calls.includes('run:cockpit-user_2abc'),'worker id derived from the admin');
 assert.deepEqual(json(r.counts),{published:1,failed:1,uncertain:1,blocked:1,retry:1});assert.match(r.message,/5 envoi\(s\) traité\(s\)/);
 calls.length=0;r=await reg.processDuePublications({db:settings({data:{emergency_stop:false,publishing_enabled:true},error:null}),run:runner([])});
 assert.equal(r.message,'Aucune publication due pour le moment.');
 admin=false;calls.length=0;await assert.rejects(()=>reg.processDuePublications({db:settings({data:{emergency_stop:false,publishing_enabled:true},error:null}),run:runner([])}),/denied/);
 assert.deepEqual(calls,['admin'],'non-admin refused before any read');});

test('trigger UI and scope: only the admin action calls it, no cron / route / daemon, one migration added',()=>{
 const form=load('components/publications/process-due-form.tsx',{'@/app/(cockpit)/publications/delivery-actions':{processDuePublicationsAction:async()=>({})}});
 let html=renderToStaticMarkup(jsx.jsx(form.ProcessDueForm,{stopped:true}));
 assert.match(html,/Arrêt d’urgence actif ou publication désactivée : rien ne sera envoyé/);assert.match(html,/Envoyer les publications dues/);
 html=renderToStaticMarkup(jsx.jsx(form.ProcessDueForm,{stopped:false}));assert.match(html,/5 au plus par clic/);
 const action=src('app/(cockpit)/publications/delivery-actions.ts');
 assert.match(action,/export async function processDuePublicationsAction\([^)]*\)[^{]*\{\n await requireAdmin\(\);const result=await processDuePublications\(\)/,'admin first');
 for(const dir of ['app','components','lib','proxy.ts']){const files=dir.endsWith('.ts')?[dir]:readdirSync(resolve(root,dir),{recursive:true}).filter(f=>/\.(ts|tsx)$/.test(f)).map(f=>dir+'/'+f.replaceAll('\\','/'));
  for(const f of files){if(f==='lib/publications/delivery/registry.ts'||f==='app/(cockpit)/publications/delivery-actions.ts')continue;
   assert.doesNotMatch(src(f),/processDuePublications\b|runOnePublicationJobInProduction/,`${f}: no other trigger`);}}
 assert.equal(readdirSync(resolve(root,'app/api'),{recursive:true}).filter(f=>/cron|worker|publish/i.test(f)).length,0,'no cron / worker / publish route');
 if(existsSync(resolve(root,'vercel.json')))assert.doesNotMatch(src('vercel.json').replace(/\s/g,''),/"crons":\[\{/,'no Vercel cron');
 const list=readdirSync(resolve(root,'supabase/migrations')).filter(f=>f<'20261015').sort();assert.equal(list.length,23);assert.equal(list[22],'20261014000000_publications_account_client_exclusivity.sql');
 const sql=src('supabase/migrations/20261014000000_publications_account_client_exclusivity.sql').replace(/--[^\n]*/g,'');
 assert.doesNotMatch(sql,/security definer|create policy|cron|http|insert into public\.publication_jobs|drop |alter table/i);});
