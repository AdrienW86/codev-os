import 'server-only';
// Référencement local (lot 6), porté par l'Agent SEO (étape « local_seo ») : chaque semaine, pour chaque fiche Google
// Business Profile connectée, statistiques des 28 derniers jours (vues Maps / Recherche, appels, clics vers le site,
// itinéraires), recherches qui ont affiché la fiche et avis. Lecture seule avec la connexion Google déjà accordée
// (business.manage) ; jamais de réponse aux avis : un avis à traiter devient un incident avec une recommandation.
// Sans la migration 20261217000000 : rien ne tourne (comportement d'avant).
import type {SupabaseClient} from '@supabase/supabase-js';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {writeAudit} from '@/lib/core/audit';
import type {Actor} from '@/lib/core/actor';
import {clientContextDenied,getAgentByType,openIncident,recordRecommendation,resolveIncident} from '@/lib/agents/outputs';
import {googleOAuthConfig} from '@/lib/integrations/publications-oauth/config';
import {googleTransport} from '@/lib/integrations/publications-oauth/http';
import {gbpInsightsTransport,type GbpInsightsTransport} from '@/lib/integrations/gbp-insights';
import {createGoogleBusinessProfileConnectionProvider} from '@/lib/publications/connections/google-business-profile';
import {productionOAuthDeps} from '@/lib/publications/oauth/service';
import {isCredentialReference,type CredentialVault,type ProviderCredential} from '@/lib/publications/connections/vault';
import {GBP_DAILY_METRICS,LOCAL_CODES,LOCATION_RE,evaluateLocal,localDue,localFingerprint,localPeriods,readDailyMetrics,readKeywords,readReviews,type LocalSnapshot} from './model';

const ACTOR:Actor={kind:'system',worker:'local-seo-weekly'};
const FAILURE_ACTION='local_seo.collect_failed';
const TABLE='local_seo_snapshots';
const MAX_PER_TICK=2;
const missingTable=(error:unknown)=>{const e=error as {code?:string;message?:string}|null;return e?.code==='42P01'||e?.code==='PGRST205'||/could not find the table|does not exist/i.test(e?.message??'');};

export type LocalSeoSummary={disabled?:'agent'|'migration'|'google'|'vault';collected:number;failed:number;pending:number;alerts:number;resolved:number};
export type LocalSeoDeps={db:SupabaseClient;vault:CredentialVault|null;transport:GbpInsightsTransport|null;refresh:((credential:ProviderCredential)=>Promise<ProviderCredential>)|null};
export function productionLocalSeoDeps():LocalSeoDeps{
 const google=googleOAuthConfig();const provider=google?createGoogleBusinessProfileConnectionProvider(googleTransport(google)):null;
 return {db:getSupabaseServerClient() as unknown as SupabaseClient,vault:productionOAuthDeps().vault,transport:google?gbpInsightsTransport():null,refresh:provider?credential=>provider.refresh(credential):null};
}

type Location={client_id:string;external_account_id:string;connection_id:string|null;display_name:string|null};

export async function runLocalSeoTick(now=new Date(),deps:LocalSeoDeps=productionLocalSeoDeps()):Promise<LocalSeoSummary>{
 const summary:LocalSeoSummary={collected:0,failed:0,pending:0,alerts:0,resolved:0};
 const agent=await getAgentByType('seo');
 if(!agent||!agent.enabled||agent.status!=='Actif')return {...summary,disabled:'agent'};
 if(!deps.transport)return {...summary,disabled:'google'};
 if(!deps.vault)return {...summary,disabled:'vault'};
 const since=new Date(now.getTime()-9*86_400_000).toISOString();
 const last=await deps.db.from(TABLE).select('client_id,location_name,fetched_at').gte('fetched_at',since).limit(1000);
 if(last.error){if(missingTable(last.error))return {...summary,disabled:'migration'};throw Error('local seo read');}
 const accounts=await deps.db.from('publication_accounts').select('client_id,external_account_id,connection_id,display_name').eq('platform','google_business_profile').eq('status','active').limit(500);
 if(accounts.error)throw Error('accounts read');
 const failures=await deps.db.from('audit_logs').select('resource_id,metadata,created_at').eq('action',FAILURE_ACTION).gte('created_at',since).limit(500);
 const lastAt=new Map<string,string>(),lastFailure=new Map<string,string>();
 for(const row of (last.data??[]) as {client_id:string;location_name:string;fetched_at:string}[]){const key=`${row.client_id}|${row.location_name}`;if(!lastAt.has(key)||lastAt.get(key)!<row.fetched_at)lastAt.set(key,row.fetched_at);}
 for(const row of (failures.data??[]) as {resource_id:string|null;metadata:unknown;created_at:string}[]){const loc=(row.metadata as {location?:unknown}|null)?.location;if(row.resource_id&&typeof loc==='string')lastFailure.set(`${row.resource_id}|${loc}`,row.created_at);}
 const due=((accounts.data??[]) as Location[]).filter(row=>LOCATION_RE.test(row.external_account_id)&&row.connection_id)
  .filter(row=>localDue({lastAt:lastAt.get(`${row.client_id}|${row.external_account_id}`)??null,lastFailureAt:lastFailure.get(`${row.client_id}|${row.external_account_id}`)??null},now));
 summary.pending=Math.max(0,due.length-MAX_PER_TICK);
 for(const location of due.slice(0,MAX_PER_TICK)){
  const snapshot=await collect(location,deps,now).catch(()=>null);
  if(!snapshot||(!snapshot.metrics&&!snapshot.reviews)){summary.failed++;await writeAudit(ACTOR,{action:FAILURE_ACTION,resource_type:'client',resource_id:location.client_id,metadata:{location:location.external_account_id}}).catch(()=>undefined);continue;}
  const findings=evaluateLocal(snapshot,now);
  const saved=await deps.db.from(TABLE).insert({client_id:location.client_id,location_name:location.external_account_id,location_title:(location.display_name??'').slice(0,200)||null,
   period_start:snapshot.period.start,period_end:snapshot.period.end,metrics:snapshot.metrics,previous_metrics:snapshot.previous,keywords:snapshot.keywords,reviews:snapshot.reviews,findings,fetched_at:now.toISOString()});
  if(saved.error)throw Error('local seo write');
  summary.collected++;
  const canRecommend=(await clientContextDenied(agent,location.client_id))===null;
  const open=new Set<string>();
  for(const finding of findings.filter(f=>f.severity!=='low')){
   const fingerprint=localFingerprint(location.client_id,finding.code);open.add(fingerprint);
   const title=`Fiche Google${location.display_name?` ${location.display_name.slice(0,60)}`:''} : ${finding.title}`;
   const incident=await openIncident(ACTOR,{clientId:location.client_id,agentId:agent.id,source:'seo',severity:finding.severity,title,fingerprint,details:{code:finding.code,detail:finding.detail,location:location.external_account_id,source:'Google Business Profile (Agent SEO)'}});
   if(!incident.created)continue;summary.alerts++;
   if(!canRecommend)continue;
   const recommendation=await recordRecommendation(ACTOR,{agentId:agent.id,clientId:location.client_id,title,severity:finding.severity,reason:`${finding.detail} Proposition : ${finding.fix}`,payload:{incident_id:incident.id,code:finding.code,location:location.external_account_id}});
   await deps.db.from('incidents').update({recommendation_id:recommendation.id}).eq('id',incident.id);
  }
  for(const code of LOCAL_CODES){const fp=localFingerprint(location.client_id,code);
   const verifiable=code==='actions_drop'?Boolean(snapshot.metrics&&snapshot.previous):Boolean(snapshot.reviews);
   if(!open.has(fp)&&verifiable)summary.resolved+=await resolveIncident(ACTOR,fp);}
 }
 return summary;
}

async function collect(location:Location,deps:LocalSeoDeps,now:Date):Promise<LocalSnapshot|null>{
 const connection=await deps.db.from('client_connections').select('credential_reference,status').eq('id',location.connection_id!).maybeSingle();
 const c=connection.data as {credential_reference?:unknown;status?:unknown}|null;
 if(connection.error||c?.status!=='active'||!isCredentialReference(c.credential_reference))return null;
 let credential=await deps.vault!.readCredential(c.credential_reference,'google_business_profile');
 const expires=credential.expiresAt?Date.parse(credential.expiresAt):NaN;
 if(!(Number.isFinite(expires)&&expires>now.getTime()+60_000)){if(!deps.refresh||!credential.refreshToken)return null;credential=await deps.refresh(credential);}
 const token=credential.accessToken;
 const {current,previous}=localPeriods(now);
 const range=(p:{start:string;end:string}):[string,string][]=>{const [sy,sm,sd]=p.start.split('-'),[ey,em,ed]=p.end.split('-');
  return [['dailyRange.startDate.year',sy],['dailyRange.startDate.month',String(+sm)],['dailyRange.startDate.day',String(+sd)],['dailyRange.endDate.year',ey],['dailyRange.endDate.month',String(+em)],['dailyRange.endDate.day',String(+ed)]];};
 const metrics:[string,string][]=GBP_DAILY_METRICS.map(m=>['dailyMetrics',m]);
 const span={start:previous.start,end:current.end};
 const [daily,keywords,reviews]=await Promise.all([
  deps.transport!.read({kind:'daily',location:location.external_account_id,params:[...metrics,...range(span)],token}).catch(()=>null),
  deps.transport!.read({kind:'keywords',location:location.external_account_id,params:(()=>{const [y,m]=current.end.split('-');const prev=new Date(Date.UTC(+y,+m-2,1));return [['monthlyRange.startMonth.year',String(prev.getUTCFullYear())],['monthlyRange.startMonth.month',String(prev.getUTCMonth()+1)],['monthlyRange.endMonth.year',String(prev.getUTCFullYear())],['monthlyRange.endMonth.month',String(prev.getUTCMonth()+1)],['pageSize','100']] as [string,string][];})(),token}).catch(()=>null),
  deps.transport!.read({kind:'reviews',location:location.external_account_id,params:[['pageSize','50'],['orderBy','updateTime desc']],token}).catch(()=>null),
 ]);
 return {period:current,
  metrics:daily?.status===200?readDailyMetrics(daily.body,current):null,
  previous:daily?.status===200?readDailyMetrics(daily.body,previous):null,
  keywords:keywords?.status===200?readKeywords(keywords.body):null,
  reviews:reviews?.status===200?readReviews(reviews.body):null};
}
