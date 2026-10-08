"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {currentRevision,saveDraft,submitOrReview,uploadImage,type StagedMedia} from "@/lib/publications/workspace";
import {isPublicationUuid} from "@/lib/publications/validation";
import {workflowSucceeded} from "@/lib/publications/workflow-result";
import {deliveryLock} from "@/lib/publications/drawer";
import {archivePublication} from "@/lib/publications/archive";

// Drawer mutations: thin wrappers over the existing audited workflow (saveDraft, uploadImage, submitOrReview).
// The status is never updated directly and an old revision is never modified.
export type DrawerState={ok?:boolean;message?:string;staged?:StagedMedia};
const MIN_REASON=10,MAX_REASON=3000;
const stale="La publication a changé. Rechargez avant de valider.";
function refresh(form:FormData){const project=form.get("project_id"),id=form.get("publication_id");revalidatePath("/publications");revalidatePath("/publications/review");revalidatePath("/publications/calendar");
 if(isPublicationUuid(id))revalidatePath(`/publications/${id}`);if(isPublicationUuid(project))for(const tab of ["","/calendar","/review","/history"])revalidatePath(`/projects/${project}${tab}`);}
// Read-only publications (any non-cancelled delivery) are refused before any workflow call.
async function locked(form:FormData):Promise<string|null>{return deliveryLock(String(form.get("publication_id")??""));}
function ids(form:FormData,decision:string){const f=new FormData();f.set("publication_id",String(form.get("publication_id")??""));f.set("revision_id",String(form.get("revision_id")??""));f.set("decision",decision);return f;}

export async function saveFromDrawerAction(_state:DrawerState,form:FormData):Promise<DrawerState>{
 await requireAdmin();const lock=await locked(form);if(lock)return {ok:false,message:lock};const result=await saveDraft(form);if(!result.id)return {ok:false,message:result.message??"Sauvegarde non confirmée."};
 refresh(form);return {ok:true,message:"Nouvelle version enregistrée en brouillon."};
}
export async function stageMediaAction(_state:DrawerState,form:FormData):Promise<DrawerState>{
 await requireAdmin();const lock=await locked(form);if(lock)return {ok:false,message:lock};const result=await uploadImage(form);
 if(!result.staged)return {ok:false,message:result.message.startsWith("Opération non confirmée")?"Upload refusé : l’image n’a pas pu être enregistrée.":result.message};
 return {ok:true,message:"Nouvelle image — modifications non enregistrées.",staged:result.staged};
}
// draft → submit first; pending_review → decision directly. Every step re-checks the expected revision.
async function ensurePending(form:FormData):Promise<{ok:true;submitted:boolean}|{ok:false;message:string}>{
 const id=form.get("publication_id"),revision=form.get("revision_id");
 if(!isPublicationUuid(id)||!isPublicationUuid(revision))return {ok:false,message:"Publication invalide."};
 const current=await currentRevision(id);
 if(!current)return {ok:false,message:"Publication introuvable."};
 if(current.revision_id!==revision)return {ok:false,message:stale};
 if(current.status==="pending_review")return {ok:true,submitted:false};
 if(current.status!=="draft")return {ok:false,message:"Cette publication n’est pas en attente de validation."};
 const submitted=await submitOrReview(ids(form,"submit"));
 return workflowSucceeded(submitted.message)?{ok:true,submitted:true}:{ok:false,message:"Soumission non confirmée. Rechargez la publication."};
}
async function decide(form:FormData,decision:"approved"|"rejected",reason?:string):Promise<DrawerState>{
 const lock=await locked(form);if(lock)return {ok:false,message:lock};
 const pending=await ensurePending(form);if(!pending.ok)return {ok:false,message:pending.message};
 const f=ids(form,decision);if(reason)f.set("reason",reason);const result=await submitOrReview(f);refresh(form);
 if(workflowSucceeded(result.message))return {ok:true,message:decision==="approved"?"Publication passée à « À publier ».":"Publication rejetée."};
 const detail=/^(Validation impossible|Cette publication cible|Vérification des canaux)/.test(result.message)?result.message:decision==="approved"?"Validation non confirmée.":"Rejet non confirmé.";
 return {ok:false,message:pending.submitted?`${detail} La version reste à valider : un nouveau clic relancera uniquement la décision.`:detail};
}
export async function approveFromDrawerAction(_state:DrawerState,form:FormData):Promise<DrawerState>{await requireAdmin();return decide(form,"approved");}
export async function rejectFromDrawerAction(_state:DrawerState,form:FormData):Promise<DrawerState>{
 await requireAdmin();const reason=form.get("reason");
 if(typeof reason!=="string"||reason.trim().length<MIN_REASON||reason.length>MAX_REASON)return {ok:false,message:"Indiquez un motif de rejet (10 caractères minimum)."};
 return decide(form,"rejected",reason.trim());
}
// Lot 4.3 P5: one-way archive, with an explicit confirmation. The publication stays readable (« Archivées »).
export async function archiveFromDrawerAction(_state:DrawerState,form:FormData):Promise<DrawerState>{
 await requireAdmin();if(form.getAll("confirm").length!==1||form.get("confirm")!=="on")return {ok:false,message:"Cochez la confirmation : l’archivage est définitif."};
 const result=await archivePublication(form.get("publication_id"));if(result.ok)refresh(form);return result;
}
