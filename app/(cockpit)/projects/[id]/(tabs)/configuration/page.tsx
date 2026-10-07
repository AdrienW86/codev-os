import {notFound} from "next/navigation";
import {requireAdmin} from "@/lib/require-admin";
import {ChannelConfiguration} from "@/components/publications/channel-configuration";
import {DebugDetails} from "@/components/projects/debug-details";
import {getProjectById} from "@/lib/projects/data";
import {getPublicationProjectChannels} from "@/lib/publications/project-channels";
import {projectHasPublicationsWorkspace} from "@/lib/publications/channels";
import {loadChannelConfiguration} from "@/lib/publications/channel-configuration";
import {isDebugView} from "@/lib/projects/workspace-view";
// Projet → Publications → Configuration: channels and weekly schedules. Reading this page never writes.
export default async function ProjectConfigurationPage({params,searchParams}:PageProps<"/projects/[id]/configuration">){
 await requireAdmin();const {id}=await params,search=await searchParams,project=await getProjectById(id);if(!project)notFound();
 const capabilities=await getPublicationProjectChannels(project);if(!projectHasPublicationsWorkspace(capabilities))notFound();
 const loaded=await loadChannelConfiguration(project,capabilities).catch(()=>null);
 return <><ChannelConfiguration projectId={id} view={loaded?.view??null}/><DebugDetails enabled={isDebugView(search)} data={loaded?.debug??{project_id:id,configuration:'unavailable'}}/></>;
}
