import {notFound} from "next/navigation";
import {ReviewQueue} from "@/components/publications/review-queue";
import {getProjectById} from "@/lib/projects/data";
import {listPublications} from "@/lib/publications/data";
import {buildReviewCards} from "@/lib/publications/review-cards";
import {getPublicationProjectChannels} from "@/lib/publications/project-channels";
import {projectHasPublicationsWorkspace} from "@/lib/publications/channels";
import {isDebugView} from "@/lib/projects/workspace-view";
export default async function ProjectReviewPage({params,searchParams}:PageProps<"/projects/[id]/review">){
 const {id}=await params,search=await searchParams,project=await getProjectById(id);if(!project||!projectHasPublicationsWorkspace(await getPublicationProjectChannels(project)))notFound();
 const cards=await buildReviewCards(await listPublications(project.client_id,id),{debug:isDebugView(search)});
 return <ReviewQueue cards={cards}/>;
}
