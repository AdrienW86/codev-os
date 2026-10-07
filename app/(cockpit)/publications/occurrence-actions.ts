"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {isPublicationUuid} from "@/lib/publications/validation";
import {ensureProjectOccurrences} from "@/lib/publications/occurrences";

// "Préparer les prochaines semaines": explicit admin action creating the missing dated occurrences (no content).
export type OccurrencePrepareState={ok?:boolean;message?:string};
export async function prepareOccurrencesAction(_state:OccurrencePrepareState,form:FormData):Promise<OccurrencePrepareState>{
 await requireAdmin();const project=form.get("project_id"),weeks=Number(form.get("weeks"));
 const result=await ensureProjectOccurrences(project,Number.isInteger(weeks)?weeks:null);
 if(result.ok&&isPublicationUuid(project)){for(const tab of ["","/calendar","/configuration"])revalidatePath(`/projects/${project}${tab}`);revalidatePath("/publications/calendar");}
 return {ok:result.ok,message:result.message};
}
