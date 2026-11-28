import 'server-only';
// Agent Veille concurrence (étape « competitor_watch ») : un client local dû par passage, un rapport par mois glissant.
// Sources : relevés Google Maps hebdomadaires de l'Agent SEO (concurrence locale, aucun appel supplémentaire), résultats
// Google et annonces Google Ads vues (DataForSEO organic, 3 recherches au plus, si configuré), sitemaps publics des
// sites (pages publiées sur 30 jours), activité du client en base (articles, diffusions, Google Ads relié).
// Archivé dans metric_snapshots (provider competitor-watch) ; chaque constat devient une recommandation à valider.
// Rien n'est modifié chez le client ni chez les concurrents. Réglages par client : client_competitor_watch (facultatif).
import type {SupabaseClient} from '@supabase/supabase-js';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {writeAudit} from '@/lib/core/audit';
import type {Actor} from '@/lib/core/actor';
import {clientContextDenied,getAgentByType,recordRecommendation} from '@/lib/agents/outputs';
import {competitionKeyword,competitionTarget,COMPETITION_PROVIDER,type LocalTarget} from '@/lib/local-competition/model';
import {SEARCH_CONSOLE_PROVIDER} from '@/lib/integrations/search-console/model';
import {organicSerpTransport,type OrganicSearch} from '@/lib/integrations/competitor-watch';
import {fetchSitePage} from '@/lib/integrations/site-health';
import {readRobots} from '@/lib/site-health/model';
import {agentsAiConfigured} from '@/lib/ai/models';
import {structuredResponse,withAiScope} from '@/lib/ai/metered';
import {withCharter} from '@/lib/harness/charter';
import {
 PLACES_RETENTION_DAYS,WATCH_METRIC,WATCH_PROVIDER,WATCH_SYNTHESIS_INSTRUCTIONS,anonymizeReport,buildWatchReport,pickCompetitionPair,preferredChildSitemaps,
 readOrganicSerp,readSettings,readSitemapEntries,readWatchReport,trackedCompetitors,validateWatchSynthesis,watchDue,watchKeywords,watchSynthesisPayload,watchSynthesisSchema,
 type SerpRead,type WatchReport,type WatchSettings,
} from './model';

const ACTOR:Actor={kind:'system',worker:'competitor-watch-monthly'};
export const WATCH_FAILURE_ACTION='competitor_watch.failed';
export const WATCH_SETTINGS_TABLE='client_competitor_watch';
const missingTable=(error:unknown)=>{const e=error as {code?:string;message?:string}|null;return e?.code==='42P01'||e?.code==='PGRST205'||/could not find the table|does not exist/i.test(e?.message??'');};

export type CompetitorWatchSummary={disabled?:'agent';reports:number;failed:number;pending:number;recommendations:number;anonymized:number;ai:number};
type Page={status:number|null;body:string};
export type CompetitorWatchDeps={
 db:SupabaseClient;serp:OrganicSearch|null;fetchPage:(url:string,maxBytes?:number)=>Promise<Page>;
 synthesize:(clientId:string,report:WatchReport)=>Promise<{summary:string|null;reason?:string}>;
};
export function productionCompetitorWatchDeps():CompetitorWatchDeps{
 return {db:getSupabaseServerClient() as unknown as SupabaseClient,serp:organicSerpTransport({login:process.env.DATAFORSEO_LOGIN,password:process.env.DATAFORSEO_PASSWORD}),fetchPage:fetchSitePage,synthesize:synthesizeWatch};
}

type ClientRow={id:string;name:string|null;company_name:string|null;activity:string|null;geographic_area:string|null;website:string|null};

/** Réglages de tous les clients ; table absente (migration non appliquée) = réglages par défaut pour tous. */
export async function loadWatchSettings(db:SupabaseClient):Promise<{installed:boolean;byClient:Map<string,WatchSettings>}>{
 const {data,error}=await db.from(WATCH_SETTINGS_TABLE).select('client_id,enabled,competitors').limit(1000);
 if(error){if(missingTable(error))return {installed:false,byClient:new Map()};throw Error('competitor watch settings read');}
 return {installed:true,byClient:new Map(((data??[]) as {client_id:string}[]).map(row=>[row.client_id,readSettings(row)]))};
}

// options.clientId : lancement manuel pour ce client, sans attendre l'échéance (réglage « désactivé » respecté).
export async function runCompetitorWatchTick(now=new Date(),deps:CompetitorWatchDeps=productionCompetitorWatchDeps(),options:{clientId?:string}={}):Promise<CompetitorWatchSummary>{
 const summary:CompetitorWatchSummary={reports:0,failed:0,pending:0,recommendations:0,anonymized:0,ai:0};
 // Porté par l'Agent SEO du registre (même garde que la concurrence locale) : agent en pause = veille en pause.
 const agent=await getAgentByType('seo');
 if(!agent||!agent.enabled||agent.status!=='Actif')return {...summary,disabled:'agent'};
 summary.anonymized=await anonymizeExpired(deps.db,now);
 const since=new Date(now.getTime()-60*86_400_000).toISOString();
 const [clients,history,failures,settings]=await Promise.all([
  deps.db.from('clients').select('id,name,company_name,activity,geographic_area,website').limit(500),
  deps.db.from('metric_snapshots').select('client_id,fetched_at').eq('provider',WATCH_PROVIDER).gte('fetched_at',since).order('fetched_at',{ascending:false}).limit(1000),
  deps.db.from('audit_logs').select('resource_id,created_at').eq('action',WATCH_FAILURE_ACTION).gte('created_at',new Date(now.getTime()-2*86_400_000).toISOString()).limit(500),
  loadWatchSettings(deps.db),
 ]);
 if(clients.error||history.error)throw Error('competitor watch read');
 const lastAt=new Map<string,string>(),lastFailure=new Map<string,string>();
 for(const row of (history.data??[]) as {client_id:string;fetched_at:string}[])if(!lastAt.has(row.client_id))lastAt.set(row.client_id,row.fetched_at);
 for(const row of (failures.data??[]) as {resource_id:string|null;created_at:string}[])if(row.resource_id&&(!lastFailure.has(row.resource_id)||lastFailure.get(row.resource_id)!<row.created_at))lastFailure.set(row.resource_id,row.created_at);
 const settingsOf=(id:string)=>settings.byClient.get(id)??readSettings(null);
 const due=((clients.data??[]) as ClientRow[]).map(competitionTarget).filter((t):t is LocalTarget=>t!==null&&settingsOf(t.clientId).enabled&&(!options.clientId||t.clientId===options.clientId))
  .filter(t=>Boolean(options.clientId)||watchDue({lastAt:lastAt.get(t.clientId)??null,lastFailureAt:lastFailure.get(t.clientId)??null},now))
  .sort((a,b)=>(lastAt.get(a.clientId)??'').localeCompare(lastAt.get(b.clientId)??''));
 if(!due.length)return summary;
 const [target]=due;
 summary.pending=due.length-1;
 let report:WatchReport;
 try{report=await gather(deps,target,settingsOf(target.clientId),now);}
 catch{summary.failed++;await writeAudit(ACTOR,{action:WATCH_FAILURE_ACTION,resource_type:'client',resource_id:target.clientId,metadata:{kind:'gather'}}).catch(()=>undefined);return summary;}
 // Sans aucun concurrent mesuré, pas de rapport vide : nouvel essai dans 24 h (le relevé Maps de l'Agent SEO arrive chaque semaine).
 if(!report.competitors.length){summary.failed++;await writeAudit(ACTOR,{action:WATCH_FAILURE_ACTION,resource_type:'client',resource_id:target.clientId,metadata:{kind:'no_competitor',gaps:report.gaps.length}}).catch(()=>undefined);return summary;}
 const ai=await deps.synthesize(target.clientId,report).catch(()=>({summary:null,reason:'IA indisponible'}));
 if(ai.summary){report.summary=ai.summary;summary.ai++;}else report.summaryNote=ai.reason??null;
 const saved=await deps.db.from('metric_snapshots').upsert({client_id:target.clientId,provider:WATCH_PROVIDER,metric_key:WATCH_METRIC,period_start:report.periodStart,period_end:report.periodEnd,data:report,fetched_at:now.toISOString()},{onConflict:'client_id,provider,metric_key,period_start,period_end'});
 if(saved.error)throw Error('competitor watch write');
 summary.reports++;
 const canRecommend=(await clientContextDenied(agent,target.clientId).catch(()=>'illisible'))===null;
 if(canRecommend)for(const finding of report.findings){
  const created=await recordRecommendation(ACTOR,{agentId:agent.id,clientId:target.clientId,severity:finding.severity,title:`Veille concurrence : ${finding.title}`.slice(0,200),
   reason:`${finding.detail} Proposition : ${finding.action} (${finding.owner}).`,payload:{agent:'competitor-watch',code:finding.code,period_end:report.periodEnd}});
  if(created.created)summary.recommendations++;
 }
 await writeAudit(ACTOR,{action:'competitor_watch.report_ready',resource_type:'client',resource_id:target.clientId,metadata:{competitors:report.competitors.length,findings:report.findings.length,serp:report.serp.length,ai:Boolean(report.summary),recommendations:canRecommend}}).catch(()=>undefined);
 return summary;
}

async function gather(deps:CompetitorWatchDeps,target:LocalTarget,settings:WatchSettings,now:Date):Promise<WatchReport>{
 const since=(days:number)=>new Date(now.getTime()-days*86_400_000).toISOString();
 const [competition,searchConsole,ads,blog,social]=await Promise.all([
  deps.db.from('metric_snapshots').select('metric_key,fetched_at,data').eq('client_id',target.clientId).eq('provider',COMPETITION_PROVIDER).gte('fetched_at',since(45)).order('fetched_at',{ascending:false}).limit(20),
  deps.db.from('metric_snapshots').select('data').eq('client_id',target.clientId).eq('provider',SEARCH_CONSOLE_PROVIDER).order('fetched_at',{ascending:false}).limit(1),
  deps.db.from('metric_snapshots').select('id').eq('client_id',target.clientId).eq('provider','google-ads').gte('fetched_at',since(45)).limit(1),
  deps.db.from('blog_articles').select('id').eq('client_id',target.clientId).eq('status','published').gte('published_at',since(30)).limit(200),
  deps.db.from('publication_deliveries').select('id').eq('client_id',target.clientId).eq('status','published').gte('published_at',since(30)).limit(500),
 ]);
 if(competition.error)throw Error('competition read');
 const {latest,previous}=pickCompetitionPair((competition.data??[]) as {metric_key:string;fetched_at:string;data:unknown}[],now);
 const queries=(searchConsole.data?.[0] as {data?:{queries?:unknown}}|undefined)?.data?.queries;
 const keywords=watchKeywords(latest?.keyword??competitionKeyword(target),queries,target.company);
 const serp:{keyword:string;result:SerpRead|null}[]=[];
 if(deps.serp)for(const keyword of keywords){
  const response=await deps.serp(keyword).catch(()=>null);
  serp.push({keyword,result:response&&response.status===200?readOrganicSerp(response.body):null});
 }
 const domains=[...new Set([target.domain,...trackedCompetitors(settings,latest).map(row=>row.domain)].filter((d):d is string=>Boolean(d)))];
 const sites:Record<string,{url:string;lastmod:string|null}[]|null>={};
 await Promise.all(domains.map(async domain=>{sites[domain]=await readSite(deps,domain).catch(()=>null);}));
 return buildWatchReport({
  target,now,settings,latest,previous,serp,serpConfigured:Boolean(deps.serp),sites,
  blogPublished:blog.error?null:(blog.data??[]).length,socialPublished:social.error?null:(social.data??[]).length,hasGoogleAds:!ads.error&&Boolean(ads.data?.length),
 });
}

/** Pages datées d'un site : sitemaps déclarés dans robots.txt, sinon /sitemap.xml ; index suivi sur 3 sous-sitemaps. */
async function readSite(deps:CompetitorWatchDeps,domain:string):Promise<{url:string;lastmod:string|null}[]|null>{
 const home=`https://${domain}`;
 const robots=await deps.fetchPage(`${home}/robots.txt`,200_000);
 const declared=robots.status===200?readRobots(robots.body).sitemaps:[];
 let anyRead=false;
 for(const candidate of [...declared,`${home}/sitemap.xml`,`${home}/sitemap_index.xml`].slice(0,3)){
  const page=await deps.fetchPage(candidate);
  if(page.status!==200||!page.body)continue;
  anyRead=true;
  const parsed=readSitemapEntries(page.body);
  if(!parsed.index){if(parsed.entries.length)return parsed.entries;continue;}
  const children=await Promise.all(preferredChildSitemaps(parsed.entries).map(url=>deps.fetchPage(url).catch(()=>({status:null,body:''}))));
  const entries=children.flatMap(child=>child.status===200?readSitemapEntries(child.body).entries:[]);
  if(entries.length)return entries;
 }
 return anyRead?[]:null;
}

/** Rapports de plus de 30 jours bâtis sur des concurrents Google Places : noms et sites retirés (conditions Google). */
async function anonymizeExpired(db:SupabaseClient,now:Date):Promise<number>{
 const before=new Date(now.getTime()-PLACES_RETENTION_DAYS*86_400_000).toISOString();
 const {data,error}=await db.from('metric_snapshots').select('id,data').eq('provider',WATCH_PROVIDER).lt('fetched_at',before).order('fetched_at',{ascending:false}).limit(100);
 if(error)return 0;
 let done=0;
 for(const row of (data??[]) as {id:string;data:unknown}[]){
  const report=readWatchReport(row.data);if(!report||!report.placesDerived||report.anonymized)continue;
  const {error:writeError}=await db.from('metric_snapshots').update({data:anonymizeReport(report)}).eq('id',row.id);
  if(!writeError)done++;
 }
 return done;
}

/** Synthèse IA (famille stratégie), mesurée sur le budget du client ; une correction au plus si un chiffre ou un site n'est pas repris. */
export async function synthesizeWatch(clientId:string,report:WatchReport):Promise<{summary:string|null;reason?:string}>{
 if(!agentsAiConfigured())return {summary:null,reason:'IA non configurée'};
 const payload=watchSynthesisPayload(report);
 const ask=(feedback?:string)=>withAiScope({agent:'competitor-watch',clientId},()=>structuredResponse(
  withCharter('competitor-watch',WATCH_SYNTHESIS_INSTRUCTIONS),JSON.stringify(feedback?{...payload,previous_attempt_refused:feedback}:payload),
  watchSynthesisSchema,{agent:'competitor-watch',clientId,maxOutputTokens:1200}));
 try{
  let check=validateWatchSynthesis((await ask()).value,report);
  if(!check.ok&&check.reason==='ungrounded')check=validateWatchSynthesis((await ask(`éléments absents des données : ${check.detail} ; reprends uniquement ce qui figure dans les données, sans calcul`)).value,report);
  return check.ok?{summary:check.summary}:{summary:null,reason:check.reason==='ungrounded'?`synthèse IA refusée (éléments non repris des données : ${check.detail})`:'synthèse IA invalide'};
 }catch(error){
  console.error('[competitor-watch] synthèse indisponible');
  return {summary:null,reason:(error as {message?:string}|null)?.message==='ai_budget_exceeded'?'plafond IA du client atteint':'IA indisponible'};
 }
}
