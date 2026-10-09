import Link from "next/link";
import {ClientAgenticActivity} from "@/components/clients/client-agentic-activity";
import {Badge} from "@/components/ui/primitives";
import {formatDay,publicationStatusLabel} from "@/lib/projects/workspace-view";
import type {AgentRunRecord} from "@/lib/agent-runs/types";
import type {RecommendationRecord} from "@/lib/recommendations/types";
import type {InternalActionRecord} from "@/lib/actions/types";
import type {ProjectRow} from "@/lib/supabase/database.types";
import {listAgentRuns} from "@/lib/agent-runs/data";
import {listRecommendations} from "@/lib/recommendations/data";
import {listActions} from "@/lib/actions/data";
import {listPublications} from "@/lib/publications/data";
import {listAgentProjectAssignments} from "@/lib/agents/project-assignments";
type Assignment={agent_id:string;enabled:boolean;agent:{name:string}|null};
type PublicationItem={id:string;subject:string;status:string;target_date:string|null;editorial_week:string};
// Used by the client page: same queries and limits as before, rendered through the shared view.
export async function ProjectActivity({project}:{project:ProjectRow}){
 const [runs,recommendations,actions,assignments,publications]=await Promise.all([
  listAgentRuns({clientId:project.client_id,projectId:project.id,limit:5}),listRecommendations({clientId:project.client_id,projectId:project.id,limit:5}),listActions({clientId:project.client_id,projectId:project.id,limit:5}),listAgentProjectAssignments({clientId:project.client_id,projectId:project.id}),listPublications(project.client_id,project.id),
 ]);
 return <ProjectActivityView runs={runs} recommendations={recommendations} actions={actions} assignments={assignments} publications={publications}/>;
}
export function ProjectActivityView({runs,recommendations,actions,assignments,publications}:{runs:AgentRunRecord[];recommendations:RecommendationRecord[];actions:InternalActionRecord[];assignments:Assignment[];publications:PublicationItem[]}){
 const enabled=assignments.filter(a=>a.enabled);
 return <><div className="mt-4 text-sm"><h3 className="font-medium">Agents spécialistes autorisés</h3>{enabled.length?<ul className="mt-2 flex flex-wrap gap-4">{enabled.map(a=><li key={a.agent_id}><Link className="text-accent" href={`/agents/${a.agent_id}`}>{a.agent?.name??"Agent indisponible"}</Link></li>)}</ul>:<p className="mt-2 text-muted">Aucun agent autorisé.</p>}</div><ClientAgenticActivity runs={runs} recommendations={recommendations} actions={actions}/>
 <div className="mt-5"><h3 className="font-medium">Publications du projet</h3>{publications.length?<ul className="mt-3 divide-y divide-border">{publications.map(p=><li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><Link className="hover:text-accent" href={`/publications/${p.id}`}>{p.subject}</Link><span className="flex items-center gap-2 text-muted">{formatDay(p.target_date??p.editorial_week)}<Badge>{publicationStatusLabel(p.status)}</Badge></span></li>)}</ul>:<p className="mt-2 text-sm text-muted">Aucune publication rattachée.</p>}</div></>;
}
