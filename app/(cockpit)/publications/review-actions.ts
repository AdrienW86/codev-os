"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {currentRevision,saveDraft,submitOrReview} from "@/lib/publications/workspace";
import {workflowSucceeded} from "@/lib/publications/workflow-result";
import {isPublicationUuid} from "@/lib/publications/validation";
import {MAX_GROUP_APPROVALS} from "@/lib/publications/review-groups";
export type ReviewCardState={message?:string;ok?:boolean};
const MIN_REASON=10;
// Thin wrappers around the existing manual workflow: the review card never writes revisions or decisions itself.
function refresh(form:FormData){
 revalidatePath("/publications");revalidatePath("/publications/review");revalidatePath("/publications/calendar");
 const id=form.get("publication_id"),project=form.get("project_id");if(isPublicationUuid(id))revalidatePath(`/publications/${id}`);
 if(isPublicationUuid(project))for(const tab of ["","/review","/calendar","/history"])revalidatePath(`/projects/${project}${tab}`);
}
const succeeded=workflowSucceeded;
export async function approveFromCardAction(_state:ReviewCardState,form:FormData):Promise<ReviewCardState>{
 await requireAdmin();form.set("decision","approved");form.delete("reason");const result=await submitOrReview(form);refresh(form);return {message:result.message,ok:succeeded(result.message)};
}
export async function rejectFromCardAction(_state:ReviewCardState,form:FormData):Promise<ReviewCardState>{
 await requireAdmin();const reason=form.get("reason");
 if(typeof reason!=="string"||reason.trim().length<MIN_REASON||reason.length>3000)return {message:`Indiquez un motif de rejet d’au moins ${MIN_REASON} caractères.`,ok:false};
 form.set("decision","rejected");const result=await submitOrReview(form);refresh(form);return {message:result.message,ok:succeeded(result.message)};
}
// A text change creates a new manual revision (old revisions stay immutable), then submits it to human review.
export async function editFromCardAction(_state:ReviewCardState,form:FormData):Promise<ReviewCardState>{
 await requireAdmin();const saved=await saveDraft(form);if(!saved.id)return {message:saved.message??"Modification non enregistrée.",ok:false};
 const current=await currentRevision(saved.id);refresh(form);
 if(!current?.revision_id||current.revision_id===form.get("revision_id"))return {message:"Nouvelle version non confirmée. Rechargez la publication.",ok:false};
 const submit=new FormData();submit.set("publication_id",saved.id);submit.set("revision_id",current.revision_id);submit.set("decision","submit");
 const result=await submitOrReview(submit);refresh(form);
 return succeeded(result.message)?{message:"Nouvelle version enregistrée et soumise à validation.",ok:true}:{message:"Nouvelle version enregistrée en brouillon, mais sa soumission a échoué. Ouvrez la publication pour la soumettre.",ok:false};
}
// Validation simplifiée : « Tout approuver » d'un post = la même décision humaine que « Valider », répétée pour chaque
// publication sœur (un réseau chacune), chacune sur SA version courante et avec SES contrôles (média, verrou de canal).
// Aucune approbation implicite : seules les publications affichées sur la carte et envoyées par le formulaire.
const PLATFORM_LABELS:Record<string,string>={facebook:"Facebook",instagram:"Instagram",google_business_profile:"Google Business Profile"};
export async function approveGroupFromCardAction(_state:ReviewCardState,form:FormData):Promise<ReviewCardState>{
 await requireAdmin();
 const items=form.getAll("item").map(v=>typeof v==="string"?v.split("|"):[]);
 if(!items.length||items.length>MAX_GROUP_APPROVALS||items.some(i=>i.length!==3||!isPublicationUuid(i[0])||!isPublicationUuid(i[1])||!PLATFORM_LABELS[i[2]])||new Set(items.map(i=>i[0])).size!==items.length)
  return {message:"Sélection invalide. Rechargez la file de validation.",ok:false};
 const failed:string[]=[];
 for(const [publication,revision,platform] of items){
  const one=new FormData();one.set("publication_id",publication);one.set("revision_id",revision);one.set("decision","approved");
  const project=form.get("project_id");if(typeof project==="string")one.set("project_id",project);
  const result=await submitOrReview(one);if(!succeeded(result.message))failed.push(`${PLATFORM_LABELS[platform]} : ${result.message}`);
 }
 refresh(form);
 const done=items.length-failed.length;
 if(!failed.length)return {message:`${done>1?`${done} publications approuvées`:"Publication approuvée"}.`,ok:true};
 return {message:`${done} approuvée(s) sur ${items.length}. ${failed.join(" ")}`,ok:false};
}
