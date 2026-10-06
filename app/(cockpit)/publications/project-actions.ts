"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {setPublicationProject} from "@/lib/publications/data";
function field(form:FormData,key:string):string|null{const entries=form.getAll(key);return entries.length===1&&typeof entries[0]==="string"?entries[0]:null;}
export async function changePublicationProjectAction(_state:{message?:string},form:FormData):Promise<{message?:string}> {
 await requireAdmin();const id=field(form,"publication_id"),revision=field(form,"revision_id"),project=field(form,"project_id");
 if(id===null||revision===null||project===null)return {message:"Rattachement invalide."};
 const result=await setPublicationProject(id,revision||null,project||null);if(!result.ok)return {message:result.message};
 revalidatePath("/publications");revalidatePath("/clients","layout");revalidatePath("/projects","layout");return {message:"Rattachement audité. Le contenu doit être validé à nouveau."};
}
