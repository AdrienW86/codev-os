"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {isPublicationUuid} from "@/lib/publications/validation";
import {ensureProjectOccurrences} from "@/lib/publications/occurrences";
import {redirect} from "next/navigation";
import {validDate} from "@/lib/publications/calendar";
import {parseCreationForm} from "@/lib/publications/occurrence-creation-model";
import {createPublicationFromOccurrence,skipOccurrence} from "@/lib/publications/occurrence-publications";

// "Préparer les prochaines semaines": explicit admin action creating the missing dated occurrences (no content).
export type OccurrencePrepareState={ok?:boolean;message?:string};
export async function prepareOccurrencesAction(_state:OccurrencePrepareState,form:FormData):Promise<OccurrencePrepareState>{
 await requireAdmin();const project=form.get("project_id"),weeks=Number(form.get("weeks"));
 const result=await ensureProjectOccurrences(project,Number.isInteger(weeks)?weeks:null);
 if(result.ok&&isPublicationUuid(project)){for(const tab of ["","/calendar","/configuration"])revalidatePath(`/projects/${project}${tab}`);revalidatePath("/publications/calendar");}
 return {ok:result.ok,message:result.message};
}

// Lot 4.3 P4-b: create ONE mono-platform draft from an occurrence (optional new / existing editorial group),
// then return to the calendar week of the occurrence; or skip an open occurrence (explicit, one-way).
export type OccurrencePublicationState={ok?:boolean;message?:string};
export async function createFromOccurrenceAction(_state:OccurrencePublicationState,form:FormData):Promise<OccurrencePublicationState>{
 await requireAdmin();const input=parseCreationForm(form),project=form.get("project_id"),date=form.get("date");
 if(!input||!isPublicationUuid(project)||typeof date!=="string"||!validDate(date))return {ok:false,message:"Vérifiez le sujet, le texte et le groupe éditorial."};
 const result=await createPublicationFromOccurrence(input);if(!result.ok)return result;
 for(const tab of ["","/calendar","/review"])revalidatePath(`/projects/${project}${tab}`);revalidatePath("/publications");revalidatePath("/publications/calendar");
 redirect(`/projects/${project}/calendar?date=${date}`);
}
export async function skipOccurrenceAction(_state:OccurrencePublicationState,form:FormData):Promise<OccurrencePublicationState>{
 await requireAdmin();const project=form.get("project_id");
 if(form.getAll("confirm").length!==1||form.get("confirm")!=="on")return {ok:false,message:"Cochez la confirmation : un créneau ignoré ne peut pas être rétabli."};
 const result=await skipOccurrence(form.get("occurrence_id"),form.get("reason"));
 if(result.ok&&isPublicationUuid(project)){revalidatePath(`/projects/${project}/calendar`);revalidatePath(`/projects/${project}`);revalidatePath("/publications/calendar");}
 return result;
}
