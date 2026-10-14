"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {scheduleDraft,type ScheduleResult} from "@/lib/publications/draft-scheduling";
import {recordScheduledSplit} from "@/lib/whatsapp/library";

// « Planifier ce brouillon » : rattache un brouillon non planifié aux créneaux ouverts choisis.
export type ScheduleDraftState={ok?:boolean;message?:string;publications?:{publicationId:string;platform:string}[]};
export async function scheduleDraftAction(_state:ScheduleDraftState,form:FormData):Promise<ScheduleDraftState>{
 const {userId}=await requireAdmin();const result:ScheduleResult=await scheduleDraft(form);
 if(!result.ok||!result.publications)return {ok:false,message:result.message};
 const source=String(form.get("publication_id"));
 if(result.mode==="split"&&result.clientId){
  try{await recordScheduledSplit(userId,result.clientId,source,result.publications);}catch{console.error("[publications] Historique photothèque non recopié après planification.");}
 }
 for(const path of ["/publications","/publications/calendar",`/publications/${source}`,...result.publications.map(p=>`/publications/${p.publicationId}`)])revalidatePath(path);
 if(result.projectId)for(const tab of ["","/calendar","/review"])revalidatePath(`/projects/${result.projectId}${tab}`);
 if(result.clientId)revalidatePath(`/clients/${result.clientId}`);
 return {ok:true,message:result.message,publications:result.publications.map(p=>({publicationId:p.publicationId,platform:p.platform}))};
}
