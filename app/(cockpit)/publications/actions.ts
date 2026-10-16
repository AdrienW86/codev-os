"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requireAdmin} from "@/lib/require-admin";
import {saveDraft,saveUnscheduledDraft,submitOrReview,uploadImage} from "@/lib/publications/workspace";
export type PublicationFormState={message?:string};
function refresh(form:FormData){revalidatePath("/publications");revalidatePath("/publications/calendar");const id=form.get("publication_id");if(typeof id==="string")revalidatePath(`/publications/${id}`);}
export async function savePublicationAction(_state:PublicationFormState,form:FormData):Promise<PublicationFormState>{
 await requireAdmin();const modes=form.getAll("creation_mode"),mode=modes[0];
 if(modes.length>1||(modes.length===1&&mode!=="unscheduled"&&mode!=="scheduled")||(form.has("publication_id")&&modes.length))return {message:"Mode de création invalide. Rechargez le formulaire."};
 const result=mode==="unscheduled"?await saveUnscheduledDraft(form):await saveDraft(form);
 if(!result.id)return {message:result.message};refresh(form);redirect(`/publications/${result.id}`);
}
export async function reviewPublicationAction(_state:PublicationFormState,form:FormData):Promise<PublicationFormState>{await requireAdmin();const result=await submitOrReview(form);refresh(form);return result;}
export async function uploadPublicationImageAction(_state:PublicationFormState,form:FormData):Promise<PublicationFormState>{await requireAdmin();const result=await uploadImage(form);refresh(form);return result;}
