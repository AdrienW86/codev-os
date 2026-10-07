"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {isPublicationUuid} from "@/lib/publications/validation";
import {confirmLegacyChannels,saveScheduleForPlatform,setChannelEnabled} from "@/lib/publications/channel-configuration";

// Project "Configuration" tab: thin admin wrappers over the channel configuration service (RPCs only).
// Each channel card submits independently; no global save.
export type ConfigurationState={ok?:boolean;message?:string};
function refresh(form:FormData){const project=form.get("project_id");if(!isPublicationUuid(project))return;
 for(const tab of ["","/configuration","/calendar","/agent","/review"])revalidatePath(`/projects/${project}${tab}`);revalidatePath("/publications");}

export async function confirmChannelsAction(_state:ConfigurationState,form:FormData):Promise<ConfigurationState>{
 await requireAdmin();const result=await confirmLegacyChannels(form.get("project_id"));if(result.ok)refresh(form);return result;
}
export async function setChannelEnabledAction(_state:ConfigurationState,form:FormData):Promise<ConfigurationState>{
 await requireAdmin();const enabled=form.get("enabled");
 const result=await setChannelEnabled(form.get("project_id"),form.get("platform"),enabled==="true"?true:enabled==="false"?false:null);if(result.ok)refresh(form);return result;
}
export async function saveChannelScheduleAction(_state:ConfigurationState,form:FormData):Promise<ConfigurationState>{
 await requireAdmin();let slots:unknown=null;
 try{const raw=form.get("slots");slots=typeof raw==="string"&&raw.length<=4000?JSON.parse(raw):null;}catch{slots=null;}
 const result=await saveScheduleForPlatform(form.get("project_id"),form.get("platform"),{enabled:form.get("enabled")==="on",timezone:form.get("timezone"),slots});
 if(result.ok)refresh(form);return result;
}
