"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {isPublicationUuid} from "@/lib/publications/validation";
import {prepareNextPublications,type AgentV2Result} from "@/lib/publications/agent-v2/service";

// "Préparer les prochaines publications" (Agent Publications v2): explicit admin action with an explicit
// authorization of the real AI call. Creates drafts only; nothing is submitted, approved or published.
export type AgentV2State={ok?:boolean;message?:string;publications?:AgentV2Result["publications"];withMedia?:boolean};
export async function prepareNextPublicationsAction(_state:AgentV2State,form:FormData):Promise<AgentV2State>{
 await requireAdmin();const project=form.get("project_id");
 if(!isPublicationUuid(project)||form.getAll("authorize_ai").length!==1||form.get("authorize_ai")!=="on")return {ok:false,message:"Autorisez explicitement l’appel IA pour lancer la préparation."};
 let result:AgentV2Result;
 try{result=await prepareNextPublications(project,{allowRealAI:true});}catch{return {ok:false,message:"Préparation indisponible. Aucun brouillon créé."};}
 if(result.ok)for(const path of [`/projects/${project}`,`/projects/${project}/agent`,`/projects/${project}/calendar`,`/projects/${project}/review`,"/publications","/publications/review"])revalidatePath(path);
 return result;
}
