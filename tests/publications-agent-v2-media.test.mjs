import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Lot 4.3 P8 — Agent v2 media pipeline. No real call: Drive, storage, Supabase and OpenAI are all doubled.
// Images are real (generated locally with sharp) so binary validation and decoding are actually exercised.
const native=createRequire(import.meta.url),root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
const sharp=native('sharp');
function load(file,mocks={}){const cache=new Map();const find=base=>[base+'.ts',base+'.tsx'].find(p=>existsSync(p))??base;
 function read(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Map,Set,Object,JSON,Number,Date,Intl,Error,FormData,URLSearchParams,console,Uint8Array,Buffer,Promise,Array,String,Math,parseInt,
   require:name=>{if(name in mocks)return mocks[name];if(name==='react/jsx-runtime')return jsx;if(name==='react')return React;if(name==='server-only')return {};
    if(name.startsWith('@/'))return read(find(resolve(root,name.slice(2))));if(name.startsWith('.'))return read(find(resolve(dirname(path),name)));return native(name);}});
  return exports;}
 return read(resolve(root,file));}
const json=value=>JSON.parse(JSON.stringify(value));
const src=file=>readFileSync(resolve(root,file),'utf8');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const C=uid(1,1),P=uid(3,1),RUN=uid(8,1),M=uid(9,1),PUBS=[uid(4,1),uid(4,2),uid(4,3)];
const DRIVE_FILE='file0000000001',DRIVE_FOLDER='folder00000001';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const image=async format=>new Uint8Array(await sharp({create:{width:96,height:64,channels:3,background:'#c84'}})[format]().toBuffer());
const transform=load('lib/publications/media/transform.ts');
const validate=load('lib/publications/media/validate.ts');

test('binary validation: JPEG / PNG / WebP accepted with SHA-256; empty, oversized, fake or mismatched content refused; real decoding by adaptImage',async()=>{
 for(const [format,mime] of [['jpeg','image/jpeg'],['png','image/png'],['webp','image/webp']]){const bytes=await image(format);
  const r=validate.checkSourceImage(bytes,mime);assert.equal(r.ok,true,format);assert.equal(r.mimeType,mime);assert.equal(r.sha256,sha(bytes));assert.equal(r.size,bytes.length);
  for(const platform of ['facebook','instagram','google_business_profile']){const d=await transform.adaptImage(bytes,platform);
   assert.equal(d.mime_type,'image/jpeg');assert.ok(d.bytes.length>0&&d.bytes.length<=786432);assert.deepEqual([d.width,d.height],platform==='google_business_profile'?[1200,900]:[1080,1080]);
   assert.equal(validate.checkSourceImage(d.bytes,'image/jpeg').ok,true,'derivative is a real JPEG');}}
 assert.deepEqual(json(validate.checkSourceImage(new Uint8Array(0),'image/jpeg')),{ok:false,reason:'empty'});
 assert.deepEqual(json(validate.checkSourceImage(null,'image/jpeg')),{ok:false,reason:'empty'});
 const big=new Uint8Array(8388609);big.set([255,216,255]);assert.deepEqual(json(validate.checkSourceImage(big,'image/jpeg')),{ok:false,reason:'too_large'});
 assert.deepEqual(json(validate.checkSourceImage(new TextEncoder().encode('<html>not an image</html>'),'image/jpeg')),{ok:false,reason:'unsupported_type'});
 assert.deepEqual(json(validate.checkSourceImage(new Uint8Array([71,73,70,56,57,97,1,0,1,0,0,0,0]),'image/gif')),{ok:false,reason:'unsupported_type'},'GIF refused');
 assert.deepEqual(json(validate.checkSourceImage(await image('png'),'image/jpeg')),{ok:false,reason:'mime_mismatch'});
 const truncated=(await image('jpeg')).slice(0,40);assert.equal(validate.checkSourceImage(truncated,'image/jpeg').ok,true,'signature alone passes the sniffing');
 await assert.rejects(()=>transform.adaptImage(truncated,'instagram'),'but a truncated JPEG is refused by the real decoding');});

test('media capability: centralized (every platform requires a media, kept product rule), mirrored by the SQL function, used by the media rule',()=>{
 const channels=load('lib/publications/channels.ts'),rule=load('lib/publications/media-rule.ts');
 assert.deepEqual(json(channels.PLATFORM_MEDIA_REQUIREMENT),{facebook:true,instagram:true,google_business_profile:true});
 assert.equal(channels.platformRequiresMedia('instagram'),true);assert.equal(channels.platformRequiresMedia('tiktok'),false);assert.equal(channels.platformRequiresMedia(''),false);
 const sql=src('supabase/migrations/20261008050000_publications_agent_v2_media.sql');
 const listed=sql.match(/platform_requires_media\(p_platform text\)[\s\S]*?p_platform in\(([^)]*)\)/)[1].split(',').map(s=>s.trim().replace(/'/g,'')).sort();
 assert.deepEqual(listed,Object.entries(json(channels.PLATFORM_MEDIA_REQUIREMENT)).filter(([,v])=>v).map(([k])=>k).sort(),'TS capability and SQL invariant in sync');
 assert.deepEqual(json(rule.channelsWithoutMedia([{id:'a',platform:'facebook'},{id:'b',platform:'instagram'},{id:'c',platform:'google_business_profile'}],[{variant_id:'a'}])),['instagram','google_business_profile']);
 assert.equal(rule.missingMediaMessage(['instagram']),'Média requis avant validation : ajoutez une photo avant de passer à « À publier » (Instagram).');
 assert.equal(rule.missingMediaMessage([]),'Média requis avant validation : ajoutez une photo avant de passer à « À publier ».');
 for(const f of ['lib/publications/agent-v2/media.ts','lib/publications/agent-v2/service.ts','lib/publications/media-rule.ts','components/publications/agent-v2-form.tsx'])
  assert.doesNotMatch(src(f).replace(/\/\/[^\n]*/g,''),/===\s*['"]instagram['"]|platform\s*===\s*['"]google_business_profile['"]/,`no scattered platform rule in ${f}`);});

test('Drive media source: lazy (no credentials before a fetch), reuses the v1 provider with the database folder, injectable',async()=>{
 let created=0;const calls=[];
 const m=load('lib/publications/media/source.ts',{'@/lib/integrations/publications-drive':{driveReadProvider:()=>{created++;return {download:async(f,d)=>{calls.push([f,d]);return new Uint8Array([1,2,3]);}};}}});
 const source=m.driveMediaSource();assert.equal(created,0,'no Drive client before a fetch');
 const r=await source.fetchMedia({id:M,driveFileId:DRIVE_FILE,driveFolderId:DRIVE_FOLDER,mimeType:'image/png',fileSize:3});
 assert.equal(created,1);assert.deepEqual(calls,[[DRIVE_FILE,DRIVE_FOLDER]]);assert.equal(r.mimeType,'image/png');assert.deepEqual([...r.bytes],[1,2,3]);
 const broken=load('lib/publications/media/source.ts',{'@/lib/integrations/publications-drive':{driveReadProvider:()=>{throw Error('Drive not configured');}}}).driveMediaSource();
 await assert.rejects(()=>broken.fetchMedia({id:M,driveFileId:DRIVE_FILE,driveFolderId:DRIVE_FOLDER,mimeType:'image/png',fileSize:3}),/Drive not configured/,'missing configuration = fetch failure');});

// --- Compensable workflow -------------------------------------------------------------------------------------
const media=load('lib/publications/agent-v2/media.ts');
const claimOf=(bytes,extra={})=>({run_id:RUN,media_status:'pending',attempt:1,client_id:C,media:{id:M,drive_file_id:DRIVE_FILE,drive_folder_id:DRIVE_FOLDER,mime_type:'image/jpeg',file_size:bytes.length},
 targets:[{publication_id:PUBS[0],revision_id:uid(6,1),variant_id:uid(7,1),platform:'facebook'},{publication_id:PUBS[1],revision_id:uid(6,2),variant_id:uid(7,2),platform:'instagram'},
  {publication_id:PUBS[2],revision_id:uid(6,3),variant_id:uid(7,3),platform:'google_business_profile'}],...extra});
function harness({claim,attach,fail,state,upload,fetch}={}){
 const log=[],stored=new Map();
 const db={rpc:async(name,args)=>{log.push(['rpc',name,json(args)]);const h={publication_agent_v2_media_claim:claim,publication_agent_v2_media_attach:attach,publication_agent_v2_media_fail:fail??(()=>({data:{media_status:'needs_media'},error:null}))}[name];
   return h?h(args):{data:null,error:{code:'XX000'}};},
  from:table=>({select:columns=>({eq:(k,v)=>({maybeSingle:async()=>{log.push(['read',table,columns,v]);return state?state():{data:null,error:{message:'down'}};}})})}),
  storage:{from:bucket=>({upload:async(path,bytes,options)=>{log.push(['upload',bucket,path,json(options)]);const r=upload?upload(path):{error:null};if(!r.error)stored.set(path,bytes);return r;},
   remove:async paths=>{log.push(['remove',bucket,[...paths]]);for(const p of paths)stored.delete(p);return {error:null};}})}};
 let fetches=0;const source={fetchMedia:async ref=>{fetches++;log.push(['fetch',json(ref)]);return fetch(ref);}};
 return {log,stored,db,source,fetches:()=>fetches,rpcs:name=>log.filter(x=>x[0]==='rpc'&&x[1]===name).map(x=>x[2])};}
const run=(h,adapt=transform.adaptImage)=>media.attachAgentV2Media(RUN,'user_admin',{db:h.db,source:h.source,adapt});

test('workflow: FB + IG + GBP attached — fetched once, one private upload per draft (client/publication/asset), one atomic attach, nothing leaked',async()=>{
 const bytes=await image('jpeg');const errors=[];const original=console.error;console.error=(...a)=>errors.push(a);
 try{
  const h=harness({claim:()=>({data:claimOf(bytes),error:null}),attach:()=>({data:{media_status:'attached'},error:null}),fetch:()=>({bytes,mimeType:'image/jpeg',fileName:'chantier-lyon.jpg'})});
  const outcome=await run(h);assert.deepEqual(json(outcome),{state:'attached'});assert.equal(h.fetches(),1,'Drive fetched once');
  assert.deepEqual(h.rpcs('publication_agent_v2_media_claim'),[{p_run_id:RUN,p_actor_id:'user_admin'}],'reference read from the database, never from the browser');
  const uploads=h.log.filter(x=>x[0]==='upload');assert.equal(uploads.length,3);
  for(const [i,u] of uploads.entries()){const id=media.agentMediaAssetId(RUN,1,PUBS[i]);assert.deepEqual(u,['upload','publication-images',`${C}/${PUBS[i]}/${id}`,{contentType:'image/jpeg',upsert:false}]);}
  const [attach]=h.rpcs('publication_agent_v2_media_attach');assert.equal(attach.p_attempt,1);assert.equal(attach.p_original_hash,sha(bytes),'original SHA-256');
  assert.deepEqual(attach.p_assets.map(a=>Object.keys(a).sort().join(',')),Array(3).fill('asset_id,file_hash,height,mime_type,publication_id,storage_path,width'),'metadata only, no bytes');
  assert.deepEqual(attach.p_assets.map(a=>[a.publication_id,a.width,a.height,a.mime_type]),[[PUBS[0],1080,1080,'image/jpeg'],[PUBS[1],1080,1080,'image/jpeg'],[PUBS[2],1200,900,'image/jpeg']]);
  for(const a of attach.p_assets)assert.equal(a.file_hash,sha(h.stored.get(a.storage_path)),'hash of the stored derivative');
  assert.ok(!h.log.some(x=>x[0]==='remove'),'nothing removed on success');
  const leaked=JSON.stringify([outcome,attach,errors]);for(const s of [DRIVE_FILE,DRIVE_FOLDER,'chantier-lyon','token','https://'])assert.ok(!leaked.includes(s),`no leak: ${s}`);
 }finally{console.error=original;}});

test('workflow: deterministic idempotent ids; retry of an attached run does nothing; concurrent attempt untouched',async()=>{
 const a=media.agentMediaAssetId(RUN,1,PUBS[0]);assert.match(a,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.equal(a,media.agentMediaAssetId(RUN,1,PUBS[0]));assert.notEqual(a,media.agentMediaAssetId(RUN,2,PUBS[0]));assert.notEqual(a,media.agentMediaAssetId(RUN,1,PUBS[1]));
 const attached=harness({claim:()=>({data:{run_id:RUN,media_status:'attached',attempt:1},error:null}),fetch:()=>{throw Error('no fetch');}});
 assert.deepEqual(json(await run(attached)),{state:'attached'});assert.equal(attached.fetches(),0);assert.ok(!attached.log.some(x=>x[0]==='upload'||x[0]==='remove'),'no upload, no duplicate');
 const busy=harness({claim:()=>({data:null,error:{code:'55P03'}}),fetch:()=>{throw Error('no fetch');}});
 assert.deepEqual(json(await run(busy)),{state:'in_progress'});assert.equal(busy.fetches(),0);assert.equal(busy.rpcs('publication_agent_v2_media_fail').length,0,'a running attempt is never failed by another');});

test('workflow failures before any upload: Drive down, invalid / foreign bytes, wrong size, refused guard → explicit needs_media, no storage write',async()=>{
 const bytes=await image('jpeg');
 const cases=[
  ['Drive down',{fetch:()=>{throw Error('Drive read failed');}},'fetch_failed'],
  ['fake bytes',{fetch:()=>({bytes:new TextEncoder().encode('x'.repeat(bytes.length)),mimeType:'image/jpeg'})},'invalid_media'],
  ['empty',{fetch:()=>({bytes:new Uint8Array(0),mimeType:'image/jpeg'})},'invalid_media'],
  ['other format than analysed',{fetch:async()=>({bytes:await image('png'),mimeType:'image/jpeg'})},'invalid_media'],
  ['declared mime differs',{fetch:()=>({bytes,mimeType:'image/png'})},'invalid_media'],
  ['file changed on Drive (size)',{fetch:()=>({bytes:bytes.slice(0,bytes.length-1),mimeType:'image/jpeg'})},'invalid_media']];
 for(const [label,c,code] of cases){const h=harness({claim:()=>({data:claimOf(bytes),error:null}),...c});
  assert.deepEqual(json(await run(h)),{state:'needs_media',code},label);
  assert.deepEqual(h.rpcs('publication_agent_v2_media_fail'),[{p_run_id:RUN,p_attempt:1,p_error_code:code,p_actor_id:'user_admin'}],label);
  assert.ok(!h.log.some(x=>x[0]==='upload')&&h.rpcs('publication_agent_v2_media_attach').length===0,`${label}: no upload, no attach`);}
 const undecodable=harness({claim:()=>({data:claimOf(bytes),error:null}),fetch:()=>({bytes,mimeType:'image/jpeg'})});
 assert.deepEqual(json(await run(undecodable,async()=>{throw Error('Unsupported image');})),{state:'needs_media',code:'invalid_media'},'decoding failure');assert.ok(!undecodable.log.some(x=>x[0]==='upload'));
 // Database guard (wrong client / folder, used, archived or reviewed draft): refused at claim, closed explicitly.
 const guard=harness({claim:()=>({data:null,error:{code:'23514',message:'Media unavailable'}}),state:()=>({data:{media_status:'pending',media_attempts:0,media_error_code:null},error:null}),fetch:()=>{throw Error('no fetch');}});
 assert.deepEqual(json(await run(guard)),{state:'needs_media',code:'media_unavailable'});assert.equal(guard.fetches(),0,'no external I/O after a refusal');
 assert.deepEqual(guard.rpcs('publication_agent_v2_media_fail'),[{p_run_id:RUN,p_attempt:0,p_error_code:'media_unavailable',p_actor_id:'user_admin'}]);
 const already=harness({claim:()=>({data:null,error:{code:'23514'}}),state:()=>({data:{media_status:'needs_media',media_attempts:2,media_error_code:'fetch_failed'},error:null}),fetch:()=>{throw Error('no');}});
 assert.deepEqual(json(await run(already)),{state:'needs_media',code:'fetch_failed'});assert.equal(already.rpcs('publication_agent_v2_media_fail').length,0);
 const malformed=harness({claim:()=>({data:claimOf(bytes,{targets:[{publication_id:'x',platform:'facebook'}]}),error:null}),fetch:()=>{throw Error('no');}});
 assert.deepEqual(json(await run(malformed)),{state:'needs_media',code:'media_unavailable'});assert.equal(malformed.fetches(),0);
 const unconfirmed=harness({claim:()=>({data:claimOf(bytes),error:null}),fail:()=>({data:null,error:{code:'XX000'}}),fetch:()=>{throw Error('down');}});
 assert.deepEqual(json(await run(unconfirmed)),{state:'unconfirmed'},'failure not recorded: reported as unconfirmed, never as success');});

test('workflow failures after upload: storage down, attach refused → orphans removed; ambiguous attach resolved by the database (never a link to a missing file)',async()=>{
 const bytes=await image('webp');const claim=()=>({data:{...claimOf(bytes),media:{...claimOf(bytes).media,mime_type:'image/webp'}},error:null}),fetch=()=>({bytes,mimeType:'image/webp'});
 let n=0;const storageDown=harness({claim,fetch,upload:()=>(++n===2?{error:{message:'storage down'}}:{error:null})});
 assert.deepEqual(json(await run(storageDown)),{state:'needs_media',code:'upload_failed'});
 const removed=storageDown.log.filter(x=>x[0]==='remove').flatMap(x=>x[2]);
 assert.deepEqual(removed,[`${C}/${PUBS[0]}/${media.agentMediaAssetId(RUN,1,PUBS[0])}`,`${C}/${PUBS[1]}/${media.agentMediaAssetId(RUN,1,PUBS[1])}`],'written objects removed (including the failed one)');
 assert.equal(storageDown.stored.size,0,'no orphan left');assert.equal(storageDown.rpcs('publication_agent_v2_media_attach').length,0);
 const refused=harness({claim,fetch,attach:()=>({data:null,error:{code:'23514',message:'Media target unavailable'}}),state:()=>({data:{media_status:'pending',media_attempts:1,media_error_code:null},error:null})});
 assert.deepEqual(json(await run(refused)),{state:'needs_media',code:'attach_failed'});assert.equal(refused.stored.size,0,'objects of the refused attempt removed');
 assert.deepEqual(refused.rpcs('publication_agent_v2_media_fail'),[{p_run_id:RUN,p_attempt:1,p_error_code:'attach_failed',p_actor_id:'user_admin'}]);
 const committed=harness({claim,fetch,attach:()=>{throw Error('socket hang up');},state:()=>({data:{media_status:'attached',media_attempts:1,media_error_code:null},error:null})});
 assert.deepEqual(json(await run(committed)),{state:'attached'},'commit confirmed by the database');assert.equal(committed.stored.size,3,'linked files kept');assert.ok(!committed.log.some(x=>x[0]==='remove'));
 const unknown=harness({claim,fetch,attach:()=>({data:null,error:{code:'network'}})});
 assert.deepEqual(json(await run(unknown)),{state:'unconfirmed'});assert.equal(unknown.stored.size,3,'state unknown: nothing deleted');assert.equal(unknown.rpcs('publication_agent_v2_media_fail').length,0);});

test('workflow retry: superseded attempts cleaned (never linked), new attempt uploads under new ids, no generation involved',async()=>{
 const bytes=await image('jpeg');const h=harness({claim:()=>({data:claimOf(bytes,{attempt:3}),error:null}),attach:()=>({data:{media_status:'attached'},error:null}),fetch:()=>({bytes,mimeType:'image/jpeg'})});
 assert.deepEqual(json(await run(h)),{state:'attached'});
 const first=h.log.findIndex(x=>x[0]==='remove'),fetchAt=h.log.findIndex(x=>x[0]==='fetch');assert.ok(first>=0&&first<fetchAt,'cleanup before the new attempt');
 assert.deepEqual(h.log[first][2].sort(),[1,2].flatMap(a=>PUBS.map(p=>`${C}/${p}/${media.agentMediaAssetId(RUN,a,p)}`)).sort());
 assert.deepEqual(h.rpcs('publication_agent_v2_media_attach')[0].p_assets.map(a=>a.asset_id),PUBS.map(p=>media.agentMediaAssetId(RUN,3,p)));
 assert.doesNotMatch(src('lib/publications/agent-v2/media.ts'),/openai|generate\(|publication_agent_v2_finish|publication_agent_v2_begin/i,'media step never generates');});

// --- Service -------------------------------------------------------------------------------------------------
const batch=[{occurrenceId:uid(5,1),projectId:P,clientId:C,platform:'facebook',date:'2026-10-13',time:'12:00',timezone:'Europe/Paris',scheduledFor:'2026-10-13T10:00:00Z'},
 {occurrenceId:uid(5,2),projectId:P,clientId:C,platform:'instagram',date:'2026-10-13',time:'18:00',timezone:'Europe/Paris',scheduledFor:'2026-10-13T16:00:00Z'},
 {occurrenceId:uid(5,3),projectId:P,clientId:C,platform:'google_business_profile',date:'2026-10-14',time:'09:00',timezone:'Europe/Paris',scheduledFor:'2026-10-14T07:00:00Z'}];
const input={client:{name:'Toitures Dupont',activity:'Couverture',zone:null},project:{name:'Réseaux sociaux'},services:['Couverture'],rules:'Ton sobre',channelRules:[],occurrences:batch,
 media:[{id:M,categories:['roof'],description:'Surface de toiture visible.',used:false}],previousSubjects:[]};
const output=mediaId=>({idea:{subject:'Entretien de toiture',angle:'Vérifier la toiture avant l’hiver'},publications:[
 {occurrenceId:uid(5,1),platform:'facebook',text:'Avant l’hiver, un contrôle de la toiture permet de repérer les tuiles déplacées.',cta:null,mediaId},
 {occurrenceId:uid(5,2),platform:'instagram',text:'Toiture prête pour l’hiver ? #toiture',cta:null,mediaId},{occurrenceId:uid(5,3),platform:'google_business_profile',text:'Couverture : contrôle de toiture.',cta:null,mediaId}]});
function serviceWith({mediaRpc={},run={project_id:P,status:'completed',media_status:'needs_media'}}={}){
 const log=[],stored=new Map();let generations=0;
 const db={from(table){const q={select:()=>q,eq:()=>q,in:async()=>({data:PUBS.map((id,i)=>({id,platform:batch[i].platform,occurrence_id:batch[i].occurrenceId})),error:null}),
   maybeSingle:async()=>{log.push(['read',table]);return table==='publication_agent_v2_runs'?{data:mediaRpc.state?mediaRpc.state():run,error:null}:{data:{id:P,client_id:C,type:'Réseaux sociaux'},error:null};}};return q;},
  rpc:async(name,args)=>{log.push([name,json(args)]);if(mediaRpc[name])return mediaRpc[name](args);
   return name==='publication_agent_v2_begin'?{data:{run_id:RUN,reused:false},error:null}:name==='publication_agent_v2_finish'?{data:{run_id:RUN,publication_ids:PUBS,editorial_group_id:uid(7,1),media_status:'pending'},error:null}:{data:null,error:null};},
  storage:{from:()=>({upload:async(p,b)=>{stored.set(p,b);return {error:null};},remove:async ps=>{for(const p of ps)stored.delete(p);return {error:null};}})}};
 const m=load('lib/publications/agent-v2/service.ts',{'@/lib/require-admin':{requireAdmin:async()=>{log.push('admin');return {userId:'user_admin'};}},'@/lib/supabase/server':{getSupabaseServerClient:()=>db},
  '../project-channels':{getPublicationProjectChannels:async()=>({source:'configured',channels:[],platforms:['facebook','instagram','google_business_profile'],legacyAligned:true})},
  './open-occurrences':{getOpenOccurrencesForAgent:async()=>batch},'./context':{AgentV2ContextError:class extends Error{},buildAgentV2Context:async()=>({clientId:C,input})},
  './openai-generator':{openaiAgentV2Generator:()=>{throw Error('real AI must not be used in tests');}},'./media-runs':{getAgentV2RunMedia:async id=>({id,media:{state:'attached',category:'Toiture',preview:'https://storage.local/signed?token=short'}})},
  '../media/source':{driveMediaSource:()=>{throw Error('Drive must not be used in tests');}}});
 const generator=mediaId=>({generate:async()=>{generations++;return {output:output(mediaId),usage:{input_tokens:10,output_tokens:10,estimated_cost_eur:.001,model:'m'}};}});
 return {m,log,stored,generator,generations:()=>generations};}
const now=new Date('2026-10-12T00:00:00Z');

test('service: drafts + media attached → "3 brouillons créés avec média", signed preview and category; no media → "sans média" and no media step',async()=>{
 const bytes=await image('jpeg');
 const s=serviceWith({mediaRpc:{publication_agent_v2_media_claim:()=>({data:claimOf(bytes),error:null}),publication_agent_v2_media_attach:()=>({data:{media_status:'attached'},error:null})}});
 const r=await s.m.prepareNextPublications(P,{allowRealAI:false,generator:s.generator(M),now,mediaSource:{fetchMedia:async()=>({bytes,mimeType:'image/jpeg'})},adapt:transform.adaptImage});
 assert.equal(r.ok,true);assert.equal(r.message,'3 brouillons créés avec média. À relire et valider manuellement.');assert.equal(r.withMedia,true);assert.equal(r.runId,RUN);
 assert.deepEqual(json(r.media),{state:'attached',category:'Toiture',preview:'https://storage.local/signed?token=short'});assert.equal(s.stored.size,3);
 const order=s.log.filter(x=>Array.isArray(x)&&String(x[0]).startsWith('publication_agent_v2')).map(x=>x[0]);
 assert.deepEqual(order,['publication_agent_v2_begin','publication_agent_v2_finish','publication_agent_v2_media_claim','publication_agent_v2_media_attach'],'drafts created before any media I/O');
 const none=serviceWith();const n=await none.m.prepareNextPublications(P,{allowRealAI:false,generator:none.generator(null),now});
 assert.equal(n.message,'3 brouillons créés sans média. Média requis avant validation : ajoutez une photo à chaque brouillon.');assert.deepEqual(json(n.media),{state:'none',category:null,preview:null});
 assert.ok(!none.log.some(x=>Array.isArray(x)&&/media_(claim|attach|fail)/.test(x[0])),'no media step without a selected media');});

test('service: media failure keeps the drafts and is never a full success; retry = media step only, no second generation, no duplicate',async()=>{
 const bytes=await image('jpeg');let attempt=1,attached=false;const errors=[];const original=console.error;console.error=(...a)=>errors.push(a);
 try{
  const s=serviceWith({mediaRpc:{publication_agent_v2_media_claim:()=>attached?{data:{media_status:'attached',attempt},error:null}:{data:claimOf(bytes,{attempt}),error:null},
   publication_agent_v2_media_fail:()=>({data:{media_status:'needs_media'},error:null}),publication_agent_v2_media_attach:()=>{attached=true;return {data:{media_status:'attached'},error:null};},
   state:()=>({project_id:P,status:'completed',media_status:attached?'attached':'needs_media'})}});
  let drive='down';const source={fetchMedia:async()=>{if(drive==='down')throw Error('Drive read failed');return {bytes,mimeType:'image/jpeg'};}};
  const r=await s.m.prepareNextPublications(P,{allowRealAI:false,generator:s.generator(M),now,mediaSource:source,adapt:transform.adaptImage});
  assert.equal(r.ok,true,'drafts exist');assert.equal(r.withMedia,false,'never reported as a full success');
  assert.equal(r.message,'Les brouillons ont été créés mais le média n’a pas pu être attaché. Média requis avant validation.');
  assert.deepEqual(json(r.media),{state:'failed',category:'Toiture',preview:null});assert.equal(r.publications.length,3);
  assert.deepEqual(s.log.filter(x=>x[0]==='publication_agent_v2_media_fail').map(x=>x[1].p_error_code),['fetch_failed']);
  assert.ok(!s.log.some(x=>x[0]==='publication_agent_v2_fail'),'the run itself is not failed: drafts kept');
  assert.equal(s.generations(),1);
  drive='up';attempt=2;
  const retry=await s.m.retryAgentV2Media(RUN,{mediaSource:source,adapt:transform.adaptImage});
  assert.deepEqual(json(retry),{ok:true,message:'Média attaché aux brouillons.',projectId:P});assert.equal(s.generations(),1,'no second OpenAI call');
  assert.deepEqual(s.log.filter(x=>x[0]==='publication_agent_v2_media_attach').map(x=>x[1].p_attempt),[2]);
  const again=await s.m.retryAgentV2Media(RUN,{mediaSource:source,adapt:transform.adaptImage});assert.equal(again.ok,true);
  assert.equal(s.log.filter(x=>x[0]==='publication_agent_v2_media_attach').length,1,'already attached: no new attempt, no duplicate');
  assert.equal(s.stored.size,3,'one object per draft');
  for(const bad of [null,'x',uid(8,9).slice(0,10)])assert.equal((await s.m.retryAgentV2Media(bad)).ok,false);
  const noMedia=serviceWith({run:{project_id:P,status:'completed',media_status:'none'}});assert.match((await noMedia.m.retryAgentV2Media(RUN)).message,/Aucun média à attacher/);
  assert.ok(!JSON.stringify(errors).includes(DRIVE_FILE)&&!JSON.stringify(errors).includes(DRIVE_FOLDER),'logs without Drive ids');
 }finally{console.error=original;}});

// --- Action and UI -------------------------------------------------------------------------------------------
test('retry action: admin first, run id validated, revalidation; UI shows state, category, signed preview and the required-media messages',async()=>{
 const calls=[];const a=load('app/(cockpit)/publications/agent-v2-actions.ts',{'next/cache':{revalidatePath:p=>calls.push(['revalidate',p])},'@/lib/require-admin':{requireAdmin:async()=>{calls.push('admin');}},
  '@/lib/publications/agent-v2/service':{prepareNextPublications:async()=>({ok:true,message:'m',publications:[],withMedia:false}),retryAgentV2Media:async id=>{calls.push(['retry',id]);return {ok:true,message:'Média attaché aux brouillons.',projectId:P};}}});
 const form=e=>{const f=new FormData();for(const [k,v] of Object.entries(e))f.set(k,v);return f;};
 assert.deepEqual(json(await a.retryAgentV2MediaAction({},form({run_id:'nope'}))),{ok:false,message:'Préparation invalide.'});assert.ok(!calls.some(c=>c[0]==='retry'));
 calls.length=0;assert.equal((await a.retryAgentV2MediaAction({},form({run_id:RUN}))).ok,true);assert.deepEqual(json(calls.slice(0,2)),['admin',['retry',RUN]]);assert.ok(calls.some(c=>c[1]===`/projects/${P}/agent`));
 const link={__esModule:true,default:({href,children,...p})=>jsx.jsx('a',{href,...p,children})};
 const f=load('components/publications/agent-v2-form.tsx',{'next/link':link,'@/app/(cockpit)/publications/agent-v2-actions':{prepareNextPublicationsAction:async()=>({}),retryAgentV2MediaAction:async()=>({})}});
 const attached=renderToStaticMarkup(jsx.jsx(f.AgentV2MediaSummary,{media:{state:'attached',category:'Toiture',preview:'https://storage.local/signed?token=short'}}));
 assert.match(attached,/<img[^>]*src="https:\/\/storage\.local\/signed\?token=short"/);assert.match(attached,/Média attaché/);assert.match(attached,/Catégorie : Toiture/);assert.doesNotMatch(attached,/Média requis/);
 const failedHtml=renderToStaticMarkup(jsx.jsx(f.AgentV2MediaSummary,{media:{state:'failed',category:'Toiture',preview:null}}));
 assert.match(failedHtml,/Échec média/);assert.match(failedHtml,/Média requis avant validation\./);assert.doesNotMatch(failedHtml,/<img/);
 assert.match(renderToStaticMarkup(jsx.jsx(f.AgentV2MediaSummary,{media:{state:'none',category:null,preview:null}})),/Aucun média.*Média requis avant validation/);
 assert.match(renderToStaticMarkup(jsx.jsx(f.AgentV2MediaRetryForm,{runId:RUN})),new RegExp(`name="run_id"[^>]*value="${RUN}"|value="${RUN}"[^>]*name="run_id"`));
 const {AgentV2Section}=load('components/publications/agent-v2-section.tsx',{'next/link':link,'./agent-forms':{AgentConfigurationForm:()=>null},
  './agent-v2-form':{AgentV2Form:()=>null,AgentV2MediaSummary:p=>jsx.jsx('span',{'data-summary':p.media.state}),AgentV2MediaRetryForm:p=>jsx.jsx('form',{'data-retry':p.runId})}});
 const html=renderToStaticMarkup(jsx.jsx(AgentV2Section,{projectId:P,status:'active',config:null,openCount:0,upcoming:[],runs:[
  {id:uid(8,1),createdAt:'2026-10-12T08:00:00Z',drafts:3,retryable:false,media:{state:'attached',category:'Toiture',preview:'https://storage.local/s'}},
  {id:uid(8,2),createdAt:'2026-10-11T08:00:00Z',drafts:2,retryable:true,media:{state:'failed',category:'Façade',preview:null}}]}));
 assert.match(html,/Dernières préparations/);assert.match(html,/3 brouillons/);assert.match(html,/data-summary="attached"/);assert.match(html,/data-summary="failed"/);
 assert.match(html,/Les brouillons ont été créés mais le média n’a pas pu être attaché\./);assert.match(html,new RegExp(`data-retry="${uid(8,2)}"`));assert.doesNotMatch(html,new RegExp(`data-retry="${uid(8,1)}"`));
 for(const s of ['components/publications/agent-v2-form.tsx','components/publications/agent-v2-section.tsx','lib/publications/agent-v2/media-view.ts'])
  assert.doesNotMatch(src(s),/@\/lib\/supabase|getSupabaseServerClient|\.rpc\(|server-only|drive_file_id|driveFileId|storage_path|agent-v2\/service/,s);
 const view=load('lib/publications/agent-v2/media-view.ts');
 assert.equal(view.agentV2ResultMessage(1,'failed'),'Le brouillon a été créé mais le média n’a pas pu être attaché. Média requis avant validation.');
 assert.equal(view.agentV2ResultMessage(1,'none'),'1 brouillon créé sans média. Média requis avant validation : ajoutez une photo à chaque brouillon.');
 assert.equal(view.mediaStateOf({state:'unconfirmed'}),'failed','an unconfirmed step is never displayed as attached');});

test('runs view: state per run, retry only for failed or stalled attempts, signed previews in one request, no path exposed',async()=>{
 const log=[];const tables={publication_agent_v2_runs:[{id:uid(8,1),created_at:'2026-10-12T08:00:00Z',publication_ids:PUBS,selected_media_id:M,media_status:'attached',media_lease_until:null},
   {id:uid(8,2),created_at:'2026-10-11T08:00:00Z',publication_ids:PUBS.slice(0,2),selected_media_id:uid(9,2),media_status:'needs_media',media_lease_until:null},
   {id:uid(8,3),created_at:'2026-10-10T08:00:00Z',publication_ids:[PUBS[2]],selected_media_id:uid(9,3),media_status:'pending',media_lease_until:'2026-10-12T00:05:00Z'},
   {id:uid(8,4),created_at:'2026-10-09T08:00:00Z',publication_ids:[PUBS[2]],selected_media_id:null,media_status:'none',media_lease_until:null}],
  publication_drive_media:[{id:M,analysis:{scene:'roof'},drive_file_id:DRIVE_FILE},{id:uid(9,2),analysis:{scene:'facade'}},{id:uid(9,3),analysis:{scene:'nope'}}],
  publication_media_uses:PUBS.map((p,i)=>({publication_id:p,asset_id:uid(6,i+1),media_id:M})),
  publication_assets:PUBS.map((p,i)=>({id:uid(6,i+1),storage_path:`${C}/${p}/${uid(6,i+1)}`}))};
 const db={from(table){const f=[];const rows=()=>({data:json((tables[table]??[]).filter(r=>f.every(x=>x(r)))),error:null});log.push(table);
  const q={select:()=>q,order:()=>q,limit:()=>q,eq(k,v){f.push(r=>r[k]===undefined||r[k]===v);return q;},in(k,vs){f.push(r=>vs.includes(r[k]));return q;},maybeSingle:async()=>({data:rows().data[0]??null,error:null}),then(ok,ko){return Promise.resolve(rows()).then(ok,ko);}};return q;}};
 const m=load('lib/publications/agent-v2/media-runs.ts',{'@/lib/require-admin':{requireAdmin:async()=>{log.push('admin');}},'@/lib/supabase/server':{getSupabaseServerClient:()=>db},
  '../board':{signBoardImages:async paths=>{log.push(['sign',paths.length]);return new Map(paths.map(p=>[p,'https://storage.local/signed/'+p.split('/').pop()]));}}});
 const runs=await m.getAgentV2MediaRuns(P,5,new Date('2026-10-12T00:00:00Z'));assert.equal(log[0],'admin');
 assert.deepEqual(json(runs.map(r=>[r.media.state,r.media.category,r.retryable,r.drafts])),[['attached','Toiture',false,3],['failed','Façade',true,2],['pending',null,false,1],['none',null,false,1]]);
 assert.equal(runs[0].media.preview,'https://storage.local/signed/'+uid(6,1));assert.equal(runs[1].media.preview,null);
 assert.deepEqual(log.filter(x=>Array.isArray(x)),[['sign',3]],'one signing request');
 assert.equal(m.isRetryable({media_status:'pending',media_lease_until:'2026-10-11T23:00:00Z'},new Date('2026-10-12T00:00:00Z')),true,'expired attempt can be retried');
 assert.equal(m.isRetryable({media_status:'pending',media_lease_until:null},new Date()),true,'attempt never started can be retried');
 const all=JSON.stringify(runs);for(const s of [DRIVE_FILE,DRIVE_FOLDER,`${C}/`,'storage_path'])assert.ok(!all.includes(s),`not exposed: ${s}`);
 assert.deepEqual(json(await m.getAgentV2MediaRuns('bad')),[]);});

test('P8 scope: one migration, no publisher / delivery / job / cron / security definer; media code never calls AI; remote untouched',()=>{
 const list=readdirSync(resolve(root,'supabase/migrations')).sort();assert.equal(list.length,23);assert.equal(list[16],'20261008050000_publications_agent_v2_media.sql');
 const sql=src('supabase/migrations/20261008050000_publications_agent_v2_media.sql').replace(/--[^\n]*/g,'');
 assert.doesNotMatch(sql,/\bdrop (table|column|index|function)|delete from|truncate (table )?public|security definer|insert into public\.publication_deliveries|insert into public\.publication_jobs|publication_submit_manual|publication_review_manual|cron|http/i);
 assert.match(sql,/create trigger publications_media_before_approval before update of status on public\.publications/);
 for(const f of ['lib/publications/agent-v2/media.ts','lib/publications/agent-v2/media-runs.ts','lib/publications/agent-v2/media-view.ts','lib/publications/media/source.ts','lib/publications/media/validate.ts'])
  assert.doesNotMatch(src(f).replace(/\/\/[^\n]*/g,''),/openai|setInterval|cron|publication_deliveries|publication_jobs|getPublicUrl|console\.log/i,f);
 for(const f of readdirSync(resolve(root,'lib/publications/agent-v2')))assert.doesNotMatch(src('lib/publications/agent-v2/'+f).replace(/\/\/[^\n]*/g,''),/publications-drive|google-drive|googleapis/i,`${f}: Drive only through the injectable media source`);});
