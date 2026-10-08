"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {isPublicationUuid} from "@/lib/publications/validation";
import {prepareNextPublications,retryAgentV2Media,type AgentV2Result} from "@/lib/publications/agent-v2/service";
import type {AgentV2MediaView} from "@/lib/publications/agent-v2/media-view";

// "Préparer les prochaines publications" (Agent Publications v2): explicit admin action with an explicit
// authorization of the real AI call. Creates drafts only; nothing is submitted, approved or published.
export type AgentV2State={ok?:boolean;message?:string;publications?:AgentV2Result["publications"];withMedia?:boolean;media?:AgentV2MediaView};
const revalidateProject=(project:string)=>{for(const path of [`/projects/${project}`,`/projects/${project}/agent`,`/projects/${project}/calendar`,`/projects/${project}/review`,"/publications","/publications/review"])revalidatePath(path);};
export async function prepareNextPublicationsAction(_state:AgentV2State,form:FormData):Promise<AgentV2State>{
 await requireAdmin();const project=form.get("project_id");
 if(!isPublicationUuid(project)||form.getAll("authorize_ai").length!==1||form.get("authorize_ai")!=="on")return {ok:false,message:"Autorisez explicitement l’appel IA pour lancer la préparation."};
 let result:AgentV2Result;
 try{result=await prepareNextPublications(project,{allowRealAI:true});}catch{return {ok:false,message:"Préparation indisponible. Aucun brouillon créé."};}
 if(result.ok)revalidateProject(project);
 return {ok:result.ok,message:result.message,publications:result.publications,withMedia:result.withMedia,media:result.media};
}
// "Réessayer l’attachement du média" (Lot 4.3 P8): media step only, same drafts, never any AI call.
export type AgentV2MediaRetryState={ok?:boolean;message?:string};
export async function retryAgentV2MediaAction(_state:AgentV2MediaRetryState,form:FormData):Promise<AgentV2MediaRetryState>{
 await requireAdmin();const run=form.get("run_id");
 if(!isPublicationUuid(run))return {ok:false,message:"Préparation invalide."};
 try{const result=await retryAgentV2Media(run);if(result.projectId)revalidateProject(result.projectId);return {ok:result.ok,message:result.message};}
 catch{return {ok:false,message:"Attachement non confirmé. Rechargez la page avant de réessayer."};}
}
