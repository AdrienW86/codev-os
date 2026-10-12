// Socle Publications, lot 1 : onglet « Publications » de la fiche client (modèle, services, actions, rendu).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {load,src,json,uid,form} from './helpers/ts-load.mjs';

const C=uid(1,1),P=uid(3,1);
const model=load('lib/publications/client-setup-model.ts');

test('model: safe defaults without a row, typed parsing, human approval always required',()=>{
 const d=model.clientSettingsFromRow(null);
 assert.deepEqual(json(d),{timezone:'Europe/Paris',publishingEnabled:false,generationEnabled:false,autoPrepareEnabled:false,prepareLeadDays:3,mediaReuseAllowed:false,mediaReuseAfterDays:180,editorialBrief:'',requireHumanApproval:true,saved:false});
 const s=model.clientSettingsFromRow({timezone:'Indian/Reunion',publishing_enabled:true,auto_prepare_enabled:'yes',prepare_lead_days:5,editorial_brief:'Ton sobre',require_human_approval:false});
 assert.equal(s.timezone,'Indian/Reunion');assert.equal(s.publishingEnabled,true);assert.equal(s.autoPrepareEnabled,false,'non-boolean ignored');assert.equal(s.prepareLeadDays,5);assert.equal(s.requireHumanApproval,true);assert.equal(s.saved,true);
 const ok=model.clientSettingsPayload(form({timezone:'Europe/Paris',prepare_lead_days:'4',media_reuse_after_days:'90',editorial_brief:'Brief',auto_prepare_enabled:'on'}));
 assert.deepEqual(json(ok.payload),{timezone:'Europe/Paris',publishing_enabled:false,generation_enabled:true,auto_prepare_enabled:true,prepare_lead_days:4,media_reuse_allowed:false,media_reuse_after_days:90,editorial_brief:'Brief'});
 assert.ok(!('require_human_approval' in ok.payload),'human approval is never sent');
 for(const [k,v] of [['timezone','../etc'],['prepare_lead_days','0'],['prepare_lead_days','15'],['prepare_lead_days','2.5'],['media_reuse_after_days','10'],['editorial_brief','x'.repeat(10001)]])
  assert.ok('error' in model.clientSettingsPayload(form({timezone:'Europe/Paris',prepare_lead_days:'3',media_reuse_after_days:'180',editorial_brief:'',[k]:v})),`${k}=${String(v).slice(0,10)} refused`);
 assert.deepEqual(json(model.timezoneOptions('Asia/Tokyo').slice(0,2)),['Asia/Tokyo','Europe/Paris']);assert.equal(model.timezoneOptions('Europe/Paris')[0],'Europe/Paris');
 assert.match(model.automationSummary({...d,autoPrepareEnabled:false},false),/suspendue/);
 assert.match(model.automationSummary({...d,autoPrepareEnabled:true,prepareLeadDays:2},true),/2 jours avant chaque créneau.*validation.*arrêt général est actif/s);
});

function service(rpcResult,{tables={}}={}){
 const calls=[];
 const db={rpc:async(name,args)=>{calls.push([name,args]);return rpcResult(name,args);},
  from:table=>{const q={rows:tables[table]??[],select(){return q;},eq(k,v){q.rows=q.rows.filter(r=>r[k]===v);return q;},order(){return q;},limit(){return q;},in(k,v){q.rows=q.rows.filter(r=>v.includes(r[k]));return q;},
   maybeSingle:async()=>({data:q.rows[0]??null,error:null}),then:(ok)=>ok({data:q.rows,error:null})};return q;}};
 const m=load('lib/publications/client-setup.ts',{'@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})},'@/lib/supabase/server':{getSupabaseServerClient:()=>db},
  './project-channels':{getPublicationCapabilitiesForProjects:async projects=>new Map(projects.map(p=>[p.id,{source:p.type==='Site web'?'legacy':'configured',channels:[],platforms:[],legacyAligned:false}])),getPublicationProjectChannels:async()=>({source:'configured',channels:[],platforms:[],legacyAligned:false})},
  './channel-configuration':{loadChannelConfiguration:async()=>({view:{legacy:false,suspended:null,calendarNotice:null,agentNotice:null,cards:[]}})},
  './connections/service':{getProjectConnectionConfiguration:async()=>({connections:[],channels:[],oauthMessage:'',oauthReady:{meta:false,google_business_profile:false}}),getAvailablePublicationAccounts:async()=>[]}});
 return {m,calls};
}

test('service: idempotent project ensure and audited settings save, actor from the server only',async()=>{
 let h=service(()=>({data:{project_id:P,created:true},error:null}));
 assert.deepEqual(json(await h.m.ensureClientPublicationsProject(C)),{ok:true,projectId:P,created:true});
 assert.deepEqual(json(h.calls),[['publication_client_project_ensure',{p_client_id:C,p_actor_id:'user_admin'}]]);
 assert.equal((await h.m.ensureClientPublicationsProject('nope')).ok,false);assert.equal(h.calls.length,1,'invalid client: no RPC');
 h=service(()=>({data:null,error:{code:'42883'}}));assert.match((await h.m.ensureClientPublicationsProject(C)).message,/migration du socle Publications/);
 h=service(()=>({data:uid(4,1),error:null}));
 const saved=await h.m.saveClientPublicationSettings(C,form({timezone:'Europe/Paris',prepare_lead_days:'3',media_reuse_after_days:'180',editorial_brief:'',publishing_enabled:'on',actor_id:'user_evil'}));
 assert.equal(saved.ok,true);assert.equal(h.calls[0][0],'publication_client_settings_save');assert.equal(h.calls[0][1].p_actor_id,'user_admin');assert.equal(h.calls[0][1].p_settings.publishing_enabled,true);
 assert.equal((await h.m.saveClientPublicationSettings(C,form({timezone:'x',prepare_lead_days:'3',media_reuse_after_days:'180',editorial_brief:''}))).ok,false);assert.equal(h.calls.length,1,'invalid form: no RPC');
 h=service(()=>({data:null,error:{code:'23514'}}));assert.match((await h.m.saveClientPublicationSettings(C,form({timezone:'Europe/Paris',prepare_lead_days:'3',media_reuse_after_days:'180',editorial_brief:''}))).message,/Valeur refusée/);
});

test('service: setup picks the oldest Publications project of the client, never a non-eligible one',async()=>{
 const tables={projects:[{id:uid(3,9),client_id:C,name:'Site',type:'Site web'},{id:P,client_id:C,name:'Réseaux',type:'Réseaux sociaux'},{id:uid(3,2),client_id:uid(1,2),name:'Autre client',type:'Réseaux sociaux'}],
  publication_client_settings:[{client_id:C,auto_prepare_enabled:true,prepare_lead_days:4}],publication_settings:[{emergency_stop:true}],publication_agent_projects:[]};
 const {m}=service(()=>({data:null,error:null}),{tables});
 const setup=await m.getClientPublicationsSetup(C);
 assert.deepEqual(json(setup.projects),[{id:P,name:'Réseaux',type:'Réseaux sociaux'}]);assert.equal(setup.project.id,P);assert.equal(setup.settings.autoPrepareEnabled,true);assert.equal(setup.globalStop,true);
 assert.equal((await m.getClientPublicationsSetup(C,uid(3,2))).project.id,P,'a project of another client is never selected');
 const empty=await service(()=>({data:null,error:null}),{tables:{...tables,projects:[]}}).m.getClientPublicationsSetup(C);
 assert.equal(empty.project,null);assert.equal(empty.channels,null);
});

test('actions: refused during a simulation, ensure redirects to the client tab',async()=>{
 let scenario=true,redirected=null;const calls=[];
 const a=load('app/(cockpit)/clients/[id]/publications-actions.ts',{'next/cache':{revalidatePath:p=>calls.push(['revalidate',p])},'next/navigation':{redirect:u=>{redirected=u;throw Error('NEXT_REDIRECT');}},
  '@/lib/require-admin':{requireAdmin:async()=>({userId:'user_admin'})},'@/lib/simulation/server':{getActiveScenario:async()=>scenario},
  '@/lib/publications/client-setup':{ensureClientPublicationsProject:async c=>{calls.push(['ensure',c]);return {ok:true,projectId:P,created:true};},saveClientPublicationSettings:async()=>({ok:true,message:'ok'})},
  '@/lib/publications/channel-configuration':{saveChannelEditorialRules:async(p,pl,r)=>{calls.push(['rules',p,pl,r]);return {ok:true,message:'ok'};}}});
 assert.deepEqual(json(await a.ensureClientPublicationsAction({},form({client_id:C}))),{ok:false,message:'Indisponible en simulation.'});assert.equal(calls.length,0);
 scenario=false;await assert.rejects(()=>a.ensureClientPublicationsAction({},form({client_id:C})),/NEXT_REDIRECT/);
 assert.equal(redirected,`/clients/${C}?tab=publications&project=${P}`);
 await a.saveChannelRulesAction({},form({project_id:P,platform:'instagram',rules:'Pas de hashtag inventé'}));assert.deepEqual(json(calls.find(c=>c[0]==='rules')),['rules',P,'instagram','Pas de hashtag inventé']);
});

test('panel: start, settings with locked human approval, no identifier other than the client',()=>{
 const p=load('components/clients/client-publications-panel.tsx',{'@/app/(cockpit)/clients/[id]/publications-actions':{ensureClientPublicationsAction:async()=>({}),saveClientPublicationSettingsAction:async()=>({})}});
 const start=renderToStaticMarkup(jsx.jsx(p.ClientPublicationsSetupStart,{clientId:C}));
 assert.match(start,/Configurer les publications/);assert.match(start,/Rien n’est publié sans votre validation/);
 const html=renderToStaticMarkup(jsx.jsx(p.ClientPublicationSettingsForm,{clientId:C,settings:{...model.clientSettingsFromRow(null),autoPrepareEnabled:true},globalStop:true}));
 assert.match(html,/Validation humaine obligatoire/);assert.match(html,/type="checkbox" disabled="" readOnly="" checked=""/);assert.doesNotMatch(html,/name="require_human_approval"/);
 assert.match(html,/Préparation automatique active/);assert.match(html,/Arrêt général actif/);assert.match(html,/name="prepare_lead_days"/);assert.match(html,/name="editorial_brief"/);
 assert.equal(renderToStaticMarkup(jsx.jsx(p.ClientPublicationsProjectPicker,{clientId:C,projects:[{id:P,name:'A'}],current:P})),'','single project: no picker');
});

test('client page: « Publications » tab wired, OAuth return view and no secret in the new client components',()=>{
 const page=src('app/(cockpit)/clients/[id]/page.tsx');
 assert.match(page,/"publications"/);assert.match(page,/returnView="client"/);assert.match(page,/getClientPublicationsSetup\(clientId, project\)/);
 for(const f of ['components/clients/client-publications-panel.tsx','lib/publications/client-setup-model.ts','app/(cockpit)/clients/[id]/publications-actions.ts'])
  assert.doesNotMatch(src(f).replace(/\/\/[^\n]*/g,''),/credential_reference|access_token|refresh_token|client_secret|Bearer|getSupabaseServerClient|\.rpc\(|process\.env/i,f);
 const sql=src('supabase/migrations/20261027000000_publications_client_setup.sql').replace(/--[^\n]*/g,'');
 assert.doesNotMatch(sql,/security definer|delete from|drop (table|function)|insert into public\.publication_deliveries|insert into public\.publication_jobs/i);
 assert.match(sql,/check \(require_human_approval\)/);
});
