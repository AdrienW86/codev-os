import type {Json} from "@/lib/supabase/database.types";
import type {ClientMonthlySummaryContext,SummaryInput,SummaryActivity,SummaryIncident,SummaryMetric} from "./types";
import {summaryPeriod} from "./period";
function object(value:Json):Record<string,Json|undefined>|null {return value!==null && typeof value==="object" && !Array.isArray(value) ? value : null;}
function unique<T extends {id:string}>(rows:T[]):T[] {return [...new Map(rows.map(row=>[row.id,row])).values()].sort((a,b)=>a.id.localeCompare(b.id));}
function validDay(value:string):boolean {const date=new Date(`${value}T00:00:00Z`);return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
export function aggregateClientMonthlySummary(input:SummaryInput,month:string):ClientMonthlySummaryContext {
 const period=summaryPeriod(month),clientId=input.client.id;
 const within=(value:string|null)=>value!==null && Number.isFinite(Date.parse(value)) && Date.parse(value)>=Date.parse(period.start) && Date.parse(value)<Date.parse(period.endExclusive);
 const beforeEnd=(value:string)=>Date.parse(value)<Date.parse(period.endExclusive);
 const scoped=<T extends {id:string;client_id:string|null}>(rows:T[])=>unique(rows.filter(row=>row.client_id===clientId));
 const projects=scoped(input.projects),projectIds=new Set(projects.map(p=>p.id));
 const publications=scoped(input.publications),pubIds=new Set(publications.map(p=>p.id));
 const revisions=unique(input.revisions.filter(r=>r.client_id===clientId && pubIds.has(r.publication_id))),revMap=new Map(revisions.map(r=>[r.id,r]));
 const variants=unique(input.variants.filter(v=>v.client_id===clientId && pubIds.has(v.publication_id) && revMap.has(v.revision_id))),variantMap=new Map(variants.map(v=>[v.id,v]));
 const deliveries=scoped(input.deliveries).filter(d=>pubIds.has(d.publication_id)&&variantMap.has(d.variant_id));
 const deliveryProject=(d:typeof deliveries[number]|undefined)=>d ? revMap.get(variantMap.get(d.variant_id)!.revision_id)?.project_id??null : null;
 const jobs=unique(input.jobs.filter(j=>pubIds.has(j.publication_id))),jobMap=new Map(jobs.map(j=>[j.id,j]));
 const jobProject=(j:typeof jobs[number])=> j.revision_id ? revMap.get(j.revision_id)?.project_id??null : j.delivery_id ? deliveryProject(deliveries.find(d=>d.id===j.delivery_id)!) : null;
 const runs=scoped(input.runs),recs=scoped(input.recommendations),actions=scoped(input.actions),tasks=scoped(input.tasks);
 const incidents:SummaryIncident[]=[];
 for (const row of runs) if(row.status==="failed" && within(row.completed_at)) incidents.push({id:row.id,source:"run",project_id:row.project_id,status:row.status,occurred_at:row.completed_at!});
 for (const row of actions) if(row.status==="failed" && within(row.updated_at)) incidents.push({id:row.id,source:"action",project_id:row.project_id,status:row.status,occurred_at:row.updated_at});
 for (const row of jobs) if(row.status==="failed" && within(row.updated_at)) incidents.push({id:row.id,source:"publication_job",project_id:jobProject(row),status:row.status,occurred_at:row.updated_at});
 for(const row of unique(input.attempts.filter(a=>jobMap.has(a.job_id)))) if(within(row.created_at) && ["failed","retryable_error","uncertain"].includes(row.result)) incidents.push({id:row.id,source:"publication_attempt",project_id:jobProject(jobMap.get(row.job_id)!),status:row.result,occurred_at:row.created_at});
 const metricMap=new Map<string,SummaryMetric>();
 for(const rec of [...recs].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))) {
  if (!beforeEnd(rec.created_at)) continue;
  const payload=object(rec.payload),totals=payload?.totals ? object(payload.totals) : null,p=payload?.period ? object(payload.period) : null;
  if(payload?.source!=="google_ads_read_only" || typeof payload.account_id!=="string" || !totals || !p || typeof p.start!=="string" || typeof p.end!=="string" || !validDay(p.start) || !validDay(p.end) || p.start>period.lastDay || p.end<period.firstDay || p.start>p.end) continue;
  const values:Record<string,number>={};
  for(const key of ["impressions","clicks","cost","conversions","conversionValue","ctr","averageCpc","costPerConversion"]) if(typeof totals[key]==="number" && Number.isFinite(totals[key])) values[key]=totals[key] as number;
  if(!Object.keys(values).length) continue;
  const metric:SummaryMetric={source:"google_ads_read_only",recommendation_id:rec.id,project_id:rec.project_id,account_id:payload.account_id,currency:typeof payload.currency==="string" ? payload.currency : null,period:{start:p.start,end:p.end},coverage:p.start===period.firstDay && p.end===period.lastDay ? "full_month" : "partial_period",values};
  metricMap.set(`${rec.project_id??"client"}:${payload.account_id}:${p.start}:${p.end}`,metric);
 }
 const metrics=[...metricMap.values()];
 const activity=(projectId:string|null):SummaryActivity=>({
  runs:runs.filter(r=>r.project_id===projectId && within(r.started_at)),recommendations:recs.filter(r=>r.project_id===projectId && within(r.created_at)),
  openRecommendations:recs.filter(r=>r.project_id===projectId && beforeEnd(r.created_at) && ["pending","accepted"].includes(r.status)),
  executedActions:actions.filter(r=>r.project_id===projectId && r.status==="executed" && within(r.executed_at)),
  completedTasks:tasks.filter(r=>r.project_id===projectId && r.status==="Terminé" && within(r.completed_at)),
  upcomingTasks:tasks.filter(r=>r.project_id===projectId && r.status!=="Terminé" && r.due_date!==null && r.due_date>period.lastDay),
  publications:publications.filter(r=>r.project_id===projectId && within(r.created_at)),
  scheduled:deliveries.filter(d=>deliveryProject(d)===projectId && ["scheduled","processing","published","retryable_error","uncertain"].includes(d.status) && within(d.scheduled_for)),
  published:deliveries.filter(d=>deliveryProject(d)===projectId && within(d.published_at)),
  failed:deliveries.filter(d=>deliveryProject(d)===projectId && ["retryable_error","uncertain"].includes(d.status) && within(d.updated_at)),
  incidents:incidents.filter(i=>i.project_id===projectId),metrics:metrics.filter(m=>m.project_id===projectId),
 });
 const projectContexts=projects.map(project=>({project,activity:activity(project.id)})),clientActivity=activity(null),all=[clientActivity,...projectContexts.map(p=>p.activity)];
 const sum=(key:"runs"|"recommendations"|"executedActions"|"completedTasks"|"scheduled"|"published"|"failed"|"incidents")=>all.reduce((n,a)=>n+a[key].length,0);
 const historical=[...runs,...recs,...actions,...tasks,...publications];
 return {period,client:{id:input.client.id,name:input.client.name,notes:input.client.notes},projects:projectContexts,clientActivity,
  totals:{runs:sum("runs"),recommendations:sum("recommendations"),executedActions:sum("executedActions"),completedTasks:sum("completedTasks"),scheduled:sum("scheduled"),published:sum("published"),failed:sum("failed"),incidents:sum("incidents")},
  dataQuality:{undatedCompletedTasks:tasks.filter(t=>t.status==="Terminé"&&!t.completed_at).map(t=>t.id),undatedPublishedDeliveries:deliveries.filter(d=>d.status==="published"&&!d.published_at).map(d=>d.id),unassignedHistoricalRecords:historical.filter(r=>!r.project_id).length,missingProjectRecords:historical.filter(r=>r.project_id&&!projectIds.has(r.project_id)).map(r=>r.id)},
  limitations:["Dates mensuelles : Europe/Paris, intervalle début inclus / fin exclue.","Statuts et tâches à venir reflètent le stockage actuel, pas une reconstruction historique à la fin du mois.","Incidents d’action et de job datés par updated_at ; les tentatives de publication conservent leur date propre.","Les métriques sont des observations déjà persistées : les périodes partielles et comptes client ne sont ni extrapolés ni répartis entre projets.","Les données réalisées sans date fiable ne sont pas comptées dans les réalisations du mois."]};
}
