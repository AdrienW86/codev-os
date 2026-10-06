"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {saveCadence,ensureCalendar} from "@/lib/publications/planning";
import {isPublicationUuid} from "@/lib/publications/validation";
export async function configurePlanning(_previous:{message:string},form:FormData){
 await requireAdmin();const field=(key:string)=>form.getAll(key).length===1?String(form.get(key)??""):"";const n=Number(field("posts_per_week"));
 const checkbox=(key:string)=>{const values=form.getAll(key);if(!values.length)return false;if(values.length===1&&(values[0]==="true"||values[0]==="on"))return true;return null;};
 const enabled=checkbox("enabled"),autoCreateSlots=checkbox("auto_create_slots");
 if(enabled===null||autoCreateSlots===null)return {message:"Valeur de case à cocher invalide. Rechargez le formulaire."};
 const result=await saveCadence(field("project_id"),{enabled,posts_per_week:n,preferred_weekdays:Array.from({length:n===1?1:2},(_,i)=>Number(field(`day_${i}`))),preferred_times:Array.from({length:n===1?1:2},(_,i)=>field(`time_${i}`)),timezone:field("timezone"),planning_horizon_weeks:Number(field("planning_horizon_weeks")),auto_create_slots:autoCreateSlots,require_manual_approval:true});
 if(result.ok){revalidatePath("/publications/calendar");revalidatePath(`/projects/${field("project_id")}`);}return {message:result.message};
}
export async function generatePlanning(_previous:{message:string},form:FormData){
 await requireAdmin();const project=form.get("project_id");if(!isPublicationUuid(project))return {message:"Projet invalide."};
 const result=await ensureCalendar(project,String(form.get("start_week")??""),form.get("placeholders")==="on");
 if(result.ok){revalidatePath("/publications");revalidatePath("/publications/calendar");revalidatePath(`/projects/${project}`);}return {message:result.message};
}
