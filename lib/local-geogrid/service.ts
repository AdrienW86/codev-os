import 'server-only';
// Carte de positions Google Maps (lot 7), portée par l'Agent SEO (étape « local_geogrid ») : une grille par passage
// (49 recherches DataForSEO depuis 49 points autour de la fiche), chaque recherche suivie une fois par semaine,
// 3 recherches au plus par client. Inactive sans DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD. Le centre vient du relevé
// de concurrence locale DataForSEO (coordonnées de la fiche) : sans ce relevé, rien n'est lancé.
// Stockage : metric_snapshots (provider local-geogrid, une clé par recherche), aucune migration.
import type {SupabaseClient} from '@supabase/supabase-js';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {writeAudit} from '@/lib/core/audit';
import type {Actor} from '@/lib/core/actor';
import {getAgentByType} from '@/lib/agents/outputs';
import {localCompetitionTransport,type LocalCompetitionTransport} from '@/lib/integrations/local-competition';
import {COMPETITION_PROVIDER,competitionTarget,findClient,readDataForSeoResults,type LocalTarget} from '@/lib/local-competition/model';
import {GEOGRID_PROVIDER,buildGeogrid,geogridCenter,geogridDue,geogridKey,geogridKeywords,geogridPoints} from './model';

const ACTOR:Actor={kind:'system',worker:'local-geogrid-weekly'};
const FAILURE_ACTION='local_geogrid.collect_failed';
const CONCURRENCY=7;

export type LocalGeogridSummary={disabled?:'agent'|'provider';collected:number;failed:number;pending:number;points:number};
export type LocalGeogridDeps={db:SupabaseClient;transport:Pick<LocalCompetitionTransport,'dataforseo'>};
export function productionLocalGeogridDeps():LocalGeogridDeps{
 return {db:getSupabaseServerClient() as unknown as SupabaseClient,transport:localCompetitionTransport({dataforseoLogin:process.env.DATAFORSEO_LOGIN,dataforseoPassword:process.env.DATAFORSEO_PASSWORD})};
}

type ClientRow={id:string;name:string|null;company_name:string|null;activity:string|null;geographic_area:string|null;website:string|null};
type Candidate={target:LocalTarget;keyword:string;key:string;center:NonNullable<ReturnType<typeof geogridCenter>>};

// options.clientId : lancement manuel pour ce client seulement, sans attendre l'échéance (coût DataForSEO : confirmé par l'administrateur).
export async function runLocalGeogridTick(now=new Date(),deps:LocalGeogridDeps=productionLocalGeogridDeps(),options:{clientId?:string}={}):Promise<LocalGeogridSummary>{
 const summary:LocalGeogridSummary={collected:0,failed:0,pending:0,points:0};
 if(!deps.transport.dataforseo)return {...summary,disabled:'provider'};
 const agent=await getAgentByType('seo');
 if(!agent||!agent.enabled||agent.status!=='Actif')return {...summary,disabled:'agent'};
 const since=(days:number)=>new Date(now.getTime()-days*86_400_000).toISOString();
 const [clients,competition,queries,history,failures]=await Promise.all([
  deps.db.from('clients').select('id,name,company_name,activity,geographic_area,website').limit(500),
  deps.db.from('metric_snapshots').select('client_id,fetched_at,data').eq('provider',COMPETITION_PROVIDER).eq('metric_key','dataforseo-maps').gte('fetched_at',since(30)).order('fetched_at',{ascending:false}).limit(500),
  deps.db.from('metric_snapshots').select('client_id,fetched_at,queries:data->queries').eq('provider','search-console').eq('metric_key','performance').gte('fetched_at',since(60)).order('fetched_at',{ascending:false}).limit(200),
  deps.db.from('metric_snapshots').select('client_id,metric_key,fetched_at').eq('provider',GEOGRID_PROVIDER).gte('fetched_at',since(30)).limit(2000),
  deps.db.from('audit_logs').select('resource_id,metadata,created_at').eq('action',FAILURE_ACTION).gte('created_at',since(2)).limit(500),
 ]);
 if(clients.error||competition.error||history.error)throw Error('local geogrid read');
 const centerBy=new Map<string,ReturnType<typeof geogridCenter>>();
 for(const row of (competition.data??[]) as {client_id:string;data:unknown}[])if(!centerBy.has(row.client_id))centerBy.set(row.client_id,geogridCenter(row.data));
 const queriesBy=new Map<string,{query:string;impressions:number}[]>();
 for(const row of (queries.error?[]:(queries.data??[])) as {client_id:string;queries:unknown}[]){
  if(queriesBy.has(row.client_id))continue;
  queriesBy.set(row.client_id,(Array.isArray(row.queries)?row.queries:[]).flatMap(q=>{const r=q as {key?:unknown;impressions?:unknown};return typeof r?.key==='string'&&typeof r.impressions==='number'?[{query:r.key,impressions:r.impressions}]:[];}).slice(0,200));
 }
 const lastAt=new Map<string,string>(),lastFailure=new Map<string,string>();
 for(const row of (history.data??[]) as {client_id:string;metric_key:string;fetched_at:string}[]){const k=`${row.client_id}|${row.metric_key}`;if(!lastAt.has(k)||lastAt.get(k)!<row.fetched_at)lastAt.set(k,row.fetched_at);}
 for(const row of (failures.data??[]) as {resource_id:string|null;metadata:unknown;created_at:string}[]){const key=(row.metadata as {key?:unknown}|null)?.key;if(row.resource_id&&typeof key==='string')lastFailure.set(`${row.resource_id}|${key}`,row.created_at);}
 const due:Candidate[]=[];
 for(const target of ((clients.data??[]) as ClientRow[]).map(competitionTarget)){
  const center=target?centerBy.get(target.clientId):null;
  if(!target||!center||(options.clientId&&target.clientId!==options.clientId))continue;
  for(const keyword of geogridKeywords({activity:target.activity,company:target.company,queries:queriesBy.get(target.clientId)??[]})){
   const key=geogridKey(keyword),k=`${target.clientId}|${key}`;
   if(Boolean(options.clientId)||geogridDue({lastAt:lastAt.get(k)??null,lastFailureAt:lastFailure.get(k)??null},now))due.push({target,keyword,key,center});
  }
 }
 summary.pending=Math.max(0,due.length-1);
 const next=due[0];
 if(!next)return summary;
 const points=geogridPoints(next.center);
 const ranks:(number|null|undefined)[]=new Array(points.length).fill(undefined);
 for(let i=0;i<points.length;i+=CONCURRENCY){
  await Promise.all(points.slice(i,i+CONCURRENCY).map(async(point,j)=>{
   const response=await deps.transport.dataforseo!({keyword:next.keyword,coordinate:point}).catch(()=>null);
   const results=response?.status===200?readDataForSeoResults(response.body):null;
   if(results)ranks[i+j]=findClient(results,next.target)?.rank??null;
  }));
 }
 const grid=buildGeogrid({keyword:next.keyword,center:next.center,ranks,now});
 summary.points=points.length-grid.failed.length;
 if(grid.failed.length>points.length/2){summary.failed++;await writeAudit(ACTOR,{action:FAILURE_ACTION,resource_type:'client',resource_id:next.target.clientId,metadata:{key:next.key,failed:grid.failed.length}}).catch(()=>undefined);return summary;}
 const today=now.toISOString().slice(0,10);
 const saved=await deps.db.from('metric_snapshots').upsert({client_id:next.target.clientId,provider:GEOGRID_PROVIDER,metric_key:next.key,period_start:today,period_end:today,data:grid,fetched_at:now.toISOString()},{onConflict:'client_id,provider,metric_key,period_start,period_end'});
 if(saved.error)throw Error('local geogrid write');
 summary.collected++;
 return summary;
}
