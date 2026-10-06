"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requireAdmin} from "@/lib/require-admin";
import {saveDraft,submitOrReview,uploadImage} from "@/lib/publications/workspace";
export type PublicationFormState={message?:string};
function refresh(form:FormData){revalidatePath("/publications");revalidatePath("/publications/calendar");const id=form.get("publication_id");if(typeof id==="string")revalidatePath(`/publications/${id}`);}
export async function savePublicationAction(_state:PublicationFormState,form:FormData):Promise<PublicationFormState>{await requireAdmin();const result=await saveDraft(form);if(!result.id)return {message:result.message};refresh(form);redirect(`/publications/${result.id}`);}
export async function reviewPublicationAction(_state:PublicationFormState,form:FormData):Promise<PublicationFormState>{await requireAdmin();const result=await submitOrReview(form);refresh(form);return result;}
export async function uploadPublicationImageAction(_state:PublicationFormState,form:FormData):Promise<PublicationFormState>{await requireAdmin();const result=await uploadImage(form);refresh(form);return result;}
