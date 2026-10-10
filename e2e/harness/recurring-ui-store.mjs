// UI-only fixture repository. SQL semantics are tested independently; NEVER imported by production.
import { createFakeSupabase } from '../../tests/helpers/fake-supabase.mjs';
const clientId='11111111-1111-4111-8111-111111111111';
const agent={id:'33333333-3333-4333-8333-333333333333',name:'Agent Ads',agent_type:'google-ads',enabled:true,status:'Actif',agent_scope:'client',scope_review_required:false,autonomy_level:1,instructions:'Recommandations prudentes, aucune modification externe.',created_at:'2026-01-01T00:00:00Z'};
const client={id:clientId,name:'Jrenov',company_name:'Fixture UI',email:'fixture@example.invalid',created_at:'2026-01-01T00:00:00Z'};
export function resetUiFixture(){
 const db=createFakeSupabase({clients:[client],agents:[agent],agent_client_assignments:[{client_id:clientId,agent_id:agent.id,enabled:true,agent,client,client_instructions:'Contexte client de test.',created_at:'2026-01-01T00:00:00Z'}],client_connections:[{id:'44444444-4444-4444-8444-444444444444',client_id:clientId,client,provider:'google_ads',status:'connected',external_account_id:'1234567890',metadata:{timezone:'Europe/Paris',account_name:'Compte E2E',currency_code:'EUR'},created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'}],client_ads_report_settings:[],ads_report_occurrences:[],reports:[],report_versions:[],report_deliveries:[],agent_runs:[],client_ads_context:[],admin_notifications:[]},{rpc:{
  codev_unread_notifications:()=>0,
  codev_claim_ads_analysis:()=>true,
  codev_save_ads_report_settings:(p,t)=>{let row=t.client_ads_report_settings.find(s=>s.client_id===p.p_client_id);if((row?.revision??0)!==p.p_revision)throw Error('stale');const next={client_id:p.p_client_id,revision:p.p_revision+1,config:p.p_config,next_due_at:p.p_due,next_prepare_at:p.p_prepare,updated_at:new Date().toISOString()};if(row)Object.assign(row,next);else t.client_ads_report_settings.push(next);return next.revision;},
  codev_claim_report_delivery:(p,t)=>{if(t.report_deliveries.some(r=>r.report_id===p.p_report_id&&r.version===p.p_version))return false;t.report_deliveries.push({report_id:p.p_report_id,version:p.p_version,token:p.p_token,state:'sending'});return true;},
  codev_finish_report_delivery:(p,t)=>{const d=t.report_deliveries.find(d=>d.report_id===p.p_report_id&&d.token===p.p_token);if(!d)return false;d.state=p.p_state;if(p.p_state==='accepted'){const r=t.reports.find(r=>r.id===p.p_report_id);r.status='sent';r.sent_at=new Date().toISOString();}return true;}
 }});globalThis.__recurringUiFixture=db;return db;
}
export function uiStore(){return globalThis.__recurringUiFixture??resetUiFixture();}
export function seedUiReport(){
 const db=uiStore(),s=db.tables.client_ads_report_settings[0];if(!s)throw Error('settings required');
 const id='55555555-5555-4555-8555-555555555555';
 db.tables.ads_report_occurrences.push({id:'66666666-6666-4666-8666-666666666666',client_id:clientId,revision:s.revision,config:s.config,period_window:{start:'2026-10-02',end:'2026-10-08',cutoff:'2026-10-09 00:00, exclusive'},due_at:s.next_due_at,prepare_at:s.next_prepare_at,report_id:id,preparation:'ready',transport:'blocked',reason:'approval_required',created_at:new Date().toISOString()});
 const content={summary:'Rapport fictif pour tester le parcours de validation.',sections:[{title:'Recommandations',lines:['Vérifier le suivi des conversions.']}],highlights:[],empty:false};
 db.tables.reports.push({id,client_id:clientId,client,kind:'google_ads',period_start:'2026-10-02',period_end:'2026-10-08',status:'ready_for_review',version:1,title:'Rapport UI fictif',summary:content.summary,client_content:content,internal_content:content,generated_at:new Date().toISOString(),approved_version:null,delivery:{}});
 db.tables.report_versions.push({report_id:id,version:1,summary:content.summary,client_content:content,internal_content:content,created_at:new Date().toISOString()});
}
