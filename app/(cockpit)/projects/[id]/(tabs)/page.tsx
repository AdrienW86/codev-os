import {notFound} from "next/navigation";
import {ProjectOverview,type OverviewPublications} from "@/components/projects/project-overview";
import {getProjectById} from "@/lib/projects/data";
import {listTasksByProject} from "@/lib/tasks/data";
import {listPublications} from "@/lib/publications/data";
import {getPublicationsAgentProject} from "@/lib/publications/agent-data";
import {getCalendar,getProjectCadence} from "@/lib/publications/planning";
import {addDays,parisToday} from "@/lib/publications/calendar";
import {getPublicationProjectChannels} from "@/lib/publications/project-channels";
import {projectHasPublicationsWorkspace} from "@/lib/publications/channels";
import {agentStatus,isDebugView,projectAlerts,slotDisplay} from "@/lib/projects/workspace-view";
export default async function ProjectOverviewPage({params,searchParams}:PageProps<"/projects/[id]">){
 const {id}=await params,debug=isDebugView(await searchParams),project=await getProjectById(id);if(!project)notFound();
 const tasks=await listTasksByProject(id);let publications:OverviewPublications|null=null;const technical:Record<string,unknown>={project_id:project.id,client_id:project.client_id,project_type:project.type};
 if(projectHasPublicationsWorkspace(await getPublicationProjectChannels(project))){
  const today=parisToday();
  const [list,agent,cadence,calendar]=await Promise.all([listPublications(project.client_id,id),getPublicationsAgentProject(id).catch(()=>null),getProjectCadence(id).catch(()=>undefined),getCalendar({from:today,to:addDays(today,56),project:id}).catch(()=>null)]);
  const upcoming=(calendar??[]).map(e=>({...e,display:slotDisplay(e)})).sort((a,b)=>a.date.localeCompare(b.date)||(a.time??"").localeCompare(b.time??""));
  const next=upcoming.find(e=>e.display!=="empty")??upcoming[0]??null,pending=list.filter(p=>p.status==="pending_review"),status=agentStatus(agent);
  publications={next:next&&{date:next.date,time:next.time,subject:next.subject,display:next.display,publicationId:next.publication_id},pendingCount:pending.length,agent:status,
   alerts:projectAlerts({today,agent:status,cadenceEnabled:cadence===undefined?null:cadence?.enabled??false,upcoming,pending,calendarUnavailable:calendar===null})};
  Object.assign(technical,{agent_config:agent?.config??null,cadence:cadence??null,pending_publication_ids:pending.map(p=>p.id),next_entry:next?{key:next.key,publication_id:next.publication_id,status:next.status,revision:next.revision}:null});
 }
 return <ProjectOverview projectId={id} progress={project.progress} status={project.status} tasks={tasks} publications={publications} debug={{enabled:debug,data:technical}}/>;
}
