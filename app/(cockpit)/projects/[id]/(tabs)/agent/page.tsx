import {notFound} from "next/navigation";
import {AgentWorkspace} from "@/components/publications/agent-section";
import {DebugDetails} from "@/components/projects/debug-details";
import {getProjectById} from "@/lib/projects/data";
import {getPublicationsAgentProject} from "@/lib/publications/agent-data";
import {getPublicationProjectChannels} from "@/lib/publications/project-channels";
import {legacyProductionBlock,projectHasPublicationsWorkspace} from "@/lib/publications/channels";
import {agentStatus,formatDay,isDebugView} from "@/lib/projects/workspace-view";
export default async function ProjectAgentPage({params,searchParams}:PageProps<"/projects/[id]/agent">){
 const {id}=await params,search=await searchParams,project=await getProjectById(id);if(!project)notFound();const capabilities=await getPublicationProjectChannels(project);if(!projectHasPublicationsWorkspace(capabilities))notFound();
 // TRANSITIONAL (P7): the server refuses the preparation too; this notice only explains why.
 const blocked=legacyProductionBlock(capabilities,"agent");
 const state=await getPublicationsAgentProject(id).catch(()=>null),status=agentStatus(state);
 const placeholders=(state?.placeholders??[]).map(p=>({id:p.id,date:p.target_date??p.editorial_week}));
 // Two placeholders on the same day are told apart by their position, never by an identifier.
 const labelled=placeholders.map(p=>{const same=placeholders.filter(o=>o.date===p.date);return {...p,label:same.length>1?`${formatDay(p.date)} · créneau ${same.findIndex(o=>o.id===p.id)+1}`:formatDay(p.date)};});
 return <>{blocked&&<p role="status" data-channel-transition="agent" className="mb-4 rounded-lg border border-border p-3 text-sm">{blocked}</p>}<AgentWorkspace projectId={id} status={status} config={state?.config??null} placeholders={labelled}/>
 <DebugDetails enabled={isDebugView(search)} data={{project_id:id,client_id:project.client_id,ready:state?.ready??false,config:state?.config??null,placeholders,manual_run_reserve_eur:0.1}}/></>;
}
