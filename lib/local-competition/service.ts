import 'server-only';
// Concurrence locale (lot 7), portée par l'Agent SEO (étape « local_competition ») : chaque semaine, deux clients au
// plus par passage, la recherche « métier ville » est relevée chez Google Places (si GOOGLE_PLACES_API_KEY) et chez
// DataForSEO Google Maps (si DATAFORSEO_LOGIN et DATAFORSEO_PASSWORD). Sans aucune clé : étape désactivée.
// Stockage dans metric_snapshots (provider local-competition, une clé par source) : aucune migration. Les relevés
// Google Places sont effacés après 30 jours (conditions Google). Un constat ouvre un incident avec une recommandation.
import type {SupabaseClient} from '@supabase/supabase-js';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {writeAudit} from '@/lib/core/audit';
import type {Actor} from '@/lib/core/actor';
import {clientContextDenied,getAgentByType,openIncident,recordRecommendation,resolveIncident} from '@/lib/agents/outputs';
import {localCompetitionTransport,type LocalCompetitionTransport} from '@/lib/integrations/local-competition';
import {COMPETITION_CODES,COMPETITION_PROVIDER,LOCAL_SOURCES,PLACES_RETENTION_DAYS,buildCompetition,competitionDue,competitionFingerprint,competitionKeyword,competitionTarget,evaluateCompetition,readCompetition,readDataForSeoResults,readPlacesResults,type CompetitionSnapshot,type LocalSource,type LocalTarget} from './model';

const ACTOR:Actor={kind:'system',worker:'local-competition-weekly'};
const FAILURE_ACTION='local_competition.collect_failed';
const MAX_PER_TICK=2;

export type LocalCompetitionSummary={disabled?:'agent'|'provider';sources:number;collected:number;failed:number;pending:number;alerts:number;resolved:number;purged:number};
export type LocalCompetitionDeps={db:SupabaseClient;transport:LocalCompetitionTransport};
export function productionLocalCompetitionDeps():LocalCompetitionDeps{
 return {db:getSupabaseServerClient() as unknown as SupabaseClient,transport:localCompetitionTransport({placesKey:process.env.GOOGLE_PLACES_API_KEY,dataforseoLogin:process.env.DATAFORSEO_LOGIN,dataforseoPassword:process.env.DATAFORSEO_PASSWORD})};
}
/** Sources actives selon les clés présentes (DataForSEO d'abord : vraie position Google Maps). */
export function activeSources(transport:LocalCompetitionTransport):LocalSource[]{
 return LOCAL_SOURCES.filter(source=>source==='dataforseo-maps'?Boolean(transport.dataforseo):Boolean(transport.places));
}

type ClientRow={id:string;name:string|null;company_name:string|null;activity:string|null;geographic_area:string|null;website:string|null};
type SnapshotRow={client_id:string;metric_key:string;period_end:string;fetched_at:string;data:unknown};

// options.clientId : lancement manuel pour ce client seulement, sans attendre l'échéance.
export async function runLocalCompetitionTick(now=new Date(),deps:LocalCompetitionDeps=productionLocalCompetitionDeps(),options:{clientId?:string}={}):Promise<LocalCompetitionSummary>{
 const sources=activeSources(deps.transport);
 const summary:LocalCompetitionSummary={sources:sources.length,collected:0,failed:0,pending:0,alerts:0,resolved:0,purged:0};
 const agent=await getAgentByType('seo');
 if(!agent||!agent.enabled||agent.status!=='Actif')return {...summary,disabled:'agent'};
 // Conditions Google Places : purge à 30 jours, même quand la clé a été retirée depuis.
 const purge=await deps.db.from('metric_snapshots').delete().eq('provider',COMPETITION_PROVIDER).eq('metric_key','google-places').lt('fetched_at',new Date(now.getTime()-PLACES_RETENTION_DAYS*86_400_000).toISOString()).select('id');
 summary.purged=purge.error?0:(purge.data??[]).length;
 if(!sources.length)return {...summary,disabled:'provider'};
 const today=now.toISOString().slice(0,10);
 const [clients,history,failures]=await Promise.all([
  deps.db.from('clients').select('id,name,company_name,activity,geographic_area,website').limit(500),
  deps.db.from('metric_snapshots').select('client_id,metric_key,period_end,fetched_at,data').eq('provider',COMPETITION_PROVIDER).gte('fetched_at',new Date(now.getTime()-60*86_400_000).toISOString()).order('fetched_at',{ascending:false}).limit(2000),
  deps.db.from('audit_logs').select('resource_id,created_at').eq('action',FAILURE_ACTION).gte('created_at',new Date(now.getTime()-2*86_400_000).toISOString()).limit(500),
 ]);
 if(clients.error||history.error)throw Error('local competition read');
 const rows=(history.data??[]) as SnapshotRow[];
 const lastAt=new Map<string,string>(),lastFailure=new Map<string,string>();
 for(const row of rows)if(!lastAt.has(row.client_id))lastAt.set(row.client_id,row.fetched_at);
 for(const row of (failures.data??[]) as {resource_id:string|null;created_at:string}[])if(row.resource_id&&(!lastFailure.has(row.resource_id)||lastFailure.get(row.resource_id)!<row.created_at))lastFailure.set(row.resource_id,row.created_at);
 const due=((clients.data??[]) as ClientRow[]).map(competitionTarget).filter((t):t is LocalTarget=>t!==null&&(!options.clientId||t.clientId===options.clientId))
  .filter(t=>Boolean(options.clientId)||competitionDue({lastAt:lastAt.get(t.clientId)??null,lastFailureAt:lastFailure.get(t.clientId)??null},now));
 summary.pending=Math.max(0,due.length-MAX_PER_TICK);
 for(const target of due.slice(0,MAX_PER_TICK)){
  const keyword=competitionKeyword(target);
  const snapshots:CompetitionSnapshot[]=[];
  for(const source of sources){
   const results=await search(deps.transport,source,keyword).catch(()=>null);
   if(!results)continue;
   snapshots.push(buildCompetition(source,keyword,results,target,now));
  }
  if(!snapshots.length){summary.failed++;await writeAudit(ACTOR,{action:FAILURE_ACTION,resource_type:'client',resource_id:target.clientId,metadata:{sources:sources.length}}).catch(()=>undefined);continue;}
  for(const snapshot of snapshots){
   const saved=await deps.db.from('metric_snapshots').upsert({client_id:target.clientId,provider:COMPETITION_PROVIDER,metric_key:snapshot.source,period_start:today,period_end:today,data:snapshot,fetched_at:now.toISOString()},{onConflict:'client_id,provider,metric_key,period_start,period_end'});
   if(saved.error)throw Error('local competition write');
  }
  summary.collected++;
  // Constats sur la meilleure source relevée (Google Maps si DataForSEO, sinon Places), comparée à son relevé précédent.
  const primary=snapshots[0];
  const previousRow=rows.find(row=>row.client_id===target.clientId&&row.metric_key===primary.source&&row.period_end<today);
  const findings=evaluateCompetition(primary,previousRow?readCompetition(previousRow.data):null);
  const canRecommend=(await clientContextDenied(agent,target.clientId))===null;
  const open=new Set<string>();
  for(const finding of findings){
   const fingerprint=competitionFingerprint(target.clientId,finding.code);open.add(fingerprint);
   const title=`Concurrence locale « ${primary.keyword} » : ${finding.title}`.slice(0,200);
   const incident=await openIncident(ACTOR,{clientId:target.clientId,agentId:agent.id,source:'seo',severity:finding.severity,title,fingerprint,details:{code:finding.code,detail:finding.detail,keyword:primary.keyword,source:`${primary.source} (Agent SEO)`}});
   if(!incident.created)continue;summary.alerts++;
   if(!canRecommend)continue;
   const recommendation=await recordRecommendation(ACTOR,{agentId:agent.id,clientId:target.clientId,title,severity:finding.severity,reason:`${finding.detail} Proposition : ${finding.fix}`,payload:{incident_id:incident.id,code:finding.code,keyword:primary.keyword}});
   await deps.db.from('incidents').update({recommendation_id:recommendation.id}).eq('id',incident.id);
  }
  for(const code of COMPETITION_CODES){const fp=competitionFingerprint(target.clientId,code);if(!open.has(fp))summary.resolved+=await resolveIncident(ACTOR,fp);}
 }
 return summary;
}

async function search(transport:LocalCompetitionTransport,source:LocalSource,keyword:string){
 if(source==='dataforseo-maps'){
  const response=await transport.dataforseo!({keyword});
  const results=response.status===200?readDataForSeoResults(response.body):null;
  // Aucune fiche du tout (pas même un concurrent) : relevé inexploitable, jamais « fiche absente ».
  return results?.length?results:null;
 }
 const response=await transport.places!({keyword});
 const results=response.status===200?readPlacesResults(response.body):null;
 return results?.length?results:null;
}
