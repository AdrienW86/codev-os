"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {isPublicationUuid} from "@/lib/publications/validation";
import {prepareNextPublications,retryAgentV2Media,type AgentV2Result} from "@/lib/publications/agent-v2/service";
import type {AgentV2MediaView} from "@/lib/publications/agent-v2/media-view";
import {submitDrafts} from "@/lib/publications/automation/scheduled";

// "Préparer les prochaines publications" (Agent Publications v2): explicit admin action with an explicit
// authorization of the real AI call. Validation simplifiée : un contenu refusé par les gardes est régénéré UNE fois
// (nouveau run, même budget), puis les brouillons complets (photo attachée) passent directement « À valider »,
// comme la préparation planifiée. Jamais d'approbation ni de diffusion ici : la validation humaine reste requise.
export type AgentV2State={ok?:boolean;message?:string;publications?:AgentV2Result["publications"];withMedia?:boolean;media?:AgentV2MediaView};
const revalidateProject=(project:string)=>{for(const path of [`/projects/${project}`,`/projects/${project}/agent`,`/projects/${project}/calendar`,`/projects/${project}/review`,"/publications","/publications/review"])revalidatePath(path);};
export async function prepareNextPublicationsAction(_state:AgentV2State,form:FormData):Promise<AgentV2State>{
 const {userId}=await requireAdmin();const project=form.get("project_id");
 if(!isPublicationUuid(project)||form.getAll("authorize_ai").length!==1||form.get("authorize_ai")!=="on")return {ok:false,message:"Autorisez explicitement l’appel IA pour lancer la préparation."};
 let result:AgentV2Result,retried=false;
 try{
  result=await prepareNextPublications(project,{allowRealAI:true});
  if(!result.ok&&result.refused){retried=true;result=await prepareNextPublications(project,{allowRealAI:true,retryFeedback:result.refusalDetail});}
 }catch{return {ok:false,message:"Préparation indisponible. Aucun brouillon créé."};}
 let message=result.message;
 if(result.ok&&result.withMedia){
  let submitted=0;
  try{submitted=(await submitDrafts(userId,result.publications.map(p=>p.id))).submitted.length;}catch{/* drafts stay drafts */}
  message=submitted===result.publications.length?`${submitted>1?`${submitted} publications prêtes`:"Publication prête"} : à valider dans la file de validation.`
   :`${message} Soumission à validation incomplète : soumettez les brouillons restants depuis leur fiche.`;
 }
 if(retried)message=(result.ok?"Premier contenu refusé, régénéré automatiquement. ":"Contenu refusé deux fois. ")+message;
 if(result.ok)revalidateProject(project);
 return {ok:result.ok,message,publications:result.publications,withMedia:result.withMedia,media:result.media};
}
// "Réessayer l’attachement du média" (Lot 4.3 P8): media step only, same drafts, never any AI call.
export type AgentV2MediaRetryState={ok?:boolean;message?:string};
export async function retryAgentV2MediaAction(_state:AgentV2MediaRetryState,form:FormData):Promise<AgentV2MediaRetryState>{
 await requireAdmin();const run=form.get("run_id");
 if(!isPublicationUuid(run))return {ok:false,message:"Préparation invalide."};
 try{const result=await retryAgentV2Media(run);if(result.projectId)revalidateProject(result.projectId);return {ok:result.ok,message:result.message};}
 catch{return {ok:false,message:"Attachement non confirmé. Rechargez la page avant de réessayer."};}
}
