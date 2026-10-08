import {notFound} from "next/navigation";
import {AgentWorkspace} from "@/components/publications/agent-section";
import {AgentV2Section} from "@/components/publications/agent-v2-section";
import {getOpenOccurrencesForAgent} from "@/lib/publications/agent-v2/open-occurrences";
import {selectIdeaBatch} from "@/lib/publications/agent-v2/selection";
import {platformLabels} from "@/lib/publications/editor";
import {DebugDetails} from "@/components/projects/debug-details";
import {getProjectById} from "@/lib/projects/data";
import {getPublicationsAgentProject} from "@/lib/publications/agent-data";
import {getPublicationProjectChannels} from "@/lib/publications/project-channels";
import {legacyProductionBlock,projectHasPublicationsWorkspace} from "@/lib/publications/channels";
import {agentStatus,formatDay,isDebugView} from "@/lib/projects/workspace-view";
export default async function ProjectAgentPage({params,searchParams}:PageProps<"/projects/[id]/agent">){
 const {id}=await params,search=await searchParams,project=await getProjectById(id);if(!project)notFound();const capabilities=await getPublicationProjectChannels(project);if(!projectHasPublicationsWorkspace(capabilities))notFound();
 const state=await getPublicationsAgentProject(id).catch(()=>null),status=agentStatus(state);
 // Configured project (Lot 4.3 P7): Agent Publications v2 on channel occurrences. Display never writes.
 if(capabilities.source==="configured"){
  const open=(await getOpenOccurrencesForAgent(id).catch(()=>[])).filter(o=>capabilities.platforms.includes(o.platform)),batch=selectIdeaBatch(open,new Date());
  return <><AgentV2Section projectId={id} status={status} config={state?.config??null} openCount={open.length} upcoming={batch.map(o=>({key:o.occurrenceId,platformLabel:platformLabels[o.platform],date:o.date,time:o.time}))}/>
   <DebugDetails enabled={isDebugView(search)} data={{project_id:id,client_id:project.client_id,agent:"v2",config:state?.config??null,open_occurrences:open.length,batch:batch.map(o=>o.occurrenceId)}}/></>;
 }
 // Legacy project: Agent v1, unchanged.
 const blocked=legacyProductionBlock(capabilities,"agent");
 const placeholders=(state?.placeholders??[]).map(p=>({id:p.id,date:p.target_date??p.editorial_week}));
 // Two placeholders on the same day are told apart by their position, never by an identifier.
 const labelled=placeholders.map(p=>{const same=placeholders.filter(o=>o.date===p.date);return {...p,label:same.length>1?`${formatDay(p.date)} · créneau ${same.findIndex(o=>o.id===p.id)+1}`:formatDay(p.date)};});
 return <>{blocked&&<p role="status" data-channel-transition="agent" className="mb-4 rounded-lg border border-border p-3 text-sm">{blocked}</p>}<AgentWorkspace projectId={id} status={status} config={state?.config??null} placeholders={labelled}/>
 <DebugDetails enabled={isDebugView(search)} data={{project_id:id,client_id:project.client_id,ready:state?.ready??false,config:state?.config??null,placeholders,manual_run_reserve_eur:0.1}}/></>;
}
