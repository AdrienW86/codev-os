import Link from "next/link";
import {notFound} from "next/navigation";
import {Panel} from "@/components/ui/primitives";
import {ProjectActivityView} from "@/components/projects/project-activity";
import {DebugDetails} from "@/components/projects/debug-details";
import {getProjectById} from "@/lib/projects/data";
import {listAgentRuns} from "@/lib/agent-runs/data";
import {listRecommendations} from "@/lib/recommendations/data";
import {listActions} from "@/lib/actions/data";
import {listPublications} from "@/lib/publications/data";
import {listAgentProjectAssignments} from "@/lib/agents/project-assignments";
import {buildClientMonthlySummaryContext} from "@/lib/reporting/data";
import {previousSummaryMonth} from "@/lib/reporting/period";
import {isDebugView} from "@/lib/projects/workspace-view";
export default async function ProjectHistoryPage({params,searchParams}:PageProps<"/projects/[id]/history">){
 const {id}=await params,search=await searchParams,project=await getProjectById(id);if(!project)notFound();
 const month=previousSummaryMonth(),scope={clientId:project.client_id,projectId:id};
 const [runs,recommendations,actions,assignments,publications,summary]=await Promise.all([listAgentRuns({...scope,limit:10}),listRecommendations({...scope,limit:10}),listActions({...scope,limit:10}),listAgentProjectAssignments(scope),listPublications(project.client_id,id),buildClientMonthlySummaryContext(project.client_id,month)]);
 const metrics=summary.projects.find(p=>p.project.id===id)?.activity.metrics??[];
 const past=[...publications].sort((a,b)=>(b.target_date??b.editorial_week).localeCompare(a.target_date??a.editorial_week));
 return <><Panel className="mt-6 p-6"><h2 className="font-semibold">Activité du projet</h2><ProjectActivityView runs={runs} recommendations={recommendations} actions={actions} assignments={assignments} publications={past}/></Panel>
 <Panel className="mt-6 p-6"><h2 className="font-semibold">Métriques enregistrées — {month}</h2>{metrics.length?<ul className="mt-3 space-y-3 text-sm">{metrics.map(m=><li key={`${m.account_id}:${m.period.start}:${m.period.end}`}><p>Compte {m.account_id} · {m.period.start} → {m.period.end} · {m.coverage==="full_month"?"Mois complet":"Période partielle"} · {m.currency??"Devise inconnue"}</p><dl className="mt-2 flex flex-wrap gap-4">{Object.entries(m.values).map(([key,value])=><div key={key}><dt className="text-xs text-muted">{key}</dt><dd>{value}</dd></div>)}</dl></li>)}</ul>:<p className="mt-3 text-sm text-muted">Aucune métrique persistée pour ce projet et ce mois. Les métriques d’un compte Ads au niveau client restent au niveau client.</p>}<Link className="mt-3 inline-block text-accent" href={`/clients/${project.client_id}/summary`}>Consulter la synthèse mensuelle</Link></Panel>
 <DebugDetails enabled={isDebugView(search)} data={{project_id:id,runs:runs.map(r=>({id:r.id,status:r.status,summary:r.summary,input_tokens:r.input_tokens,output_tokens:r.output_tokens,estimated_cost_eur:r.estimated_cost_eur})),recommendation_ids:recommendations.map(r=>r.id),action_ids:actions.map(a=>a.id),publication_ids:publications.map(p=>p.id)}}/></>;
}
