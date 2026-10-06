import Link from "next/link";
import {ClientAgenticActivity} from "@/components/clients/client-agentic-activity";
import {listAgentRuns} from "@/lib/agent-runs/data";
import {listRecommendations} from "@/lib/recommendations/data";
import {listActions} from "@/lib/actions/data";
import {listPublications} from "@/lib/publications/data";
import {listAgentProjectAssignments} from "@/lib/agents/project-assignments";
import type {ProjectRow} from "@/lib/supabase/database.types";
export async function ProjectActivity({project}:{project:ProjectRow}) {
 const [runs,recommendations,actions,assignments,publications]=await Promise.all([
  listAgentRuns({clientId:project.client_id,projectId:project.id,limit:5}),listRecommendations({clientId:project.client_id,projectId:project.id,limit:5}),listActions({clientId:project.client_id,projectId:project.id,limit:5}),listAgentProjectAssignments({clientId:project.client_id,projectId:project.id}),listPublications(project.client_id,project.id),
 ]);
 return <><div className="mt-4 text-sm"><h3 className="font-medium">Agents spécialistes autorisés</h3>{assignments.some(a=>a.enabled)?<ul className="mt-2 flex flex-wrap gap-4">{assignments.filter(a=>a.enabled).map(a=><li key={a.agent_id}><Link className="text-accent" href={`/agents/${a.agent_id}`}>{a.agent?.name??"Agent indisponible"}</Link></li>)}</ul>:<p className="mt-2 text-muted">Aucun agent autorisé.</p>}</div><ClientAgenticActivity runs={runs} recommendations={recommendations} actions={actions}/>
 <div className="mt-5"><h3 className="font-medium">Publications du projet</h3>{publications.length?<ul className="mt-3 space-y-2">{publications.map(p=><li key={p.id} className="text-sm">{p.subject} · {p.editorial_week} · {p.status}</li>)}</ul>:<p className="mt-2 text-sm text-muted">Aucune publication rattachée.</p>}</div></>;
}
