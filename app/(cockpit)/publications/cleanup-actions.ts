"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {archiveFinishedPublications} from "@/lib/publications/cleanup";
import {parseCleanupCategories} from "@/lib/publications/cleanup-rules";
import {isPublicationUuid} from "@/lib/publications/validation";
export type CleanupState={ok?:boolean;message?:string};
// Bulk clean-up = audited soft archive (publication_remove: pending sends cancelled), never a hard delete: history stays in « Archivées ».
export async function cleanupBoardAction(_:CleanupState,form:FormData):Promise<CleanupState>{
 await requireAdmin();
 if(form.get("confirm")!=="on")return {ok:false,message:"Cochez la confirmation pour archiver."};
 const client=String(form.get("client_id")??"");
 const result=await archiveFinishedPublications(parseCleanupCategories(form.getAll("category")),isPublicationUuid(client)?client:"");
 if(result.archived>0){revalidatePath("/publications");revalidatePath("/publications/calendar");revalidatePath("/publications/review");}
 return {ok:result.ok,message:result.message};
}
