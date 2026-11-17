"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requireAdmin} from "@/lib/require-admin";
import {getActiveScenario} from "@/lib/simulation/server";
import {isPublicationUuid} from "@/lib/publications/validation";
import {ensureClientPublicationsProject,saveClientPublicationSettings} from "@/lib/publications/client-setup";
import {saveChannelEditorialRules} from "@/lib/publications/channel-configuration";
import {draftAndPublishNow} from "@/lib/publications/publish-now";

// Onglet « Publications » de la fiche client (socle lot 1) : fines enveloppes admin. Le client et le projet sont
// revérifiés sur le serveur par les services et les RPC ; aucune écriture pendant une simulation.
export type ClientPublicationsState={ok?:boolean;message?:string};
const refresh=(client:string)=>{revalidatePath(`/clients/${client}`);revalidatePath("/publications");};

export async function ensureClientPublicationsAction(_state:ClientPublicationsState,form:FormData):Promise<ClientPublicationsState>{
 await requireAdmin();if(await getActiveScenario())return {ok:false,message:"Indisponible en simulation."};
 const client=form.get("client_id");const result=await ensureClientPublicationsProject(client);
 if(!result.ok)return result;
 refresh(client as string);redirect(`/clients/${client}?tab=publications&project=${result.projectId}`);
}
export async function saveClientPublicationSettingsAction(_state:ClientPublicationsState,form:FormData):Promise<ClientPublicationsState>{
 await requireAdmin();if(await getActiveScenario())return {ok:false,message:"Indisponible en simulation."};
 const client=form.get("client_id");const result=await saveClientPublicationSettings(client,form);
 if(result.ok&&isPublicationUuid(client))refresh(client);return result;
}
export async function saveChannelRulesAction(_state:ClientPublicationsState,form:FormData):Promise<ClientPublicationsState>{
 await requireAdmin();if(await getActiveScenario())return {ok:false,message:"Indisponible en simulation."};
 const project=form.get("project_id"),rules=form.get("rules");
 const result=await saveChannelEditorialRules(project,form.get("platform"),typeof rules==="string"?rules:null);
 if(result.ok&&isPublicationUuid(project)){revalidatePath(`/projects/${project}/configuration`);revalidatePath("/clients/[id]","page");}
 return result;
}

// « Rédiger et publier maintenant » : l'agent rédige, choisit la photo, l'administrateur valide par ce clic, le
// planificateur envoie. La case confirme explicitement l'appel IA et la publication sans relecture.
export type PublishNowState={ok?:boolean;message?:string;publications?:{id:string;label:string;approval:string}[]};
export async function publishNowAction(_state:PublishNowState,form:FormData):Promise<PublishNowState>{
 await requireAdmin();if(await getActiveScenario())return {ok:false,message:"Indisponible en simulation."};
 const client=form.get("client_id"),project=form.get("project_id");
 if(form.getAll("confirm").length!==1||form.get("confirm")!=="on")return {ok:false,message:"Cochez la case pour autoriser la rédaction et la publication immédiate."};
 let result;
 try{result=await draftAndPublishNow(project);}catch{return {ok:false,message:"Publication immédiate indisponible. Rien n’a été publié."};}
 if(result.ok){if(isPublicationUuid(client))refresh(client);if(isPublicationUuid(project))for(const tab of ["","/calendar","/review"])revalidatePath(`/projects/${project}${tab}`);revalidatePath("/publications/review");}
 return {ok:result.ok,message:result.message,publications:result.publications?.map(p=>({id:p.id,label:p.label,approval:p.approval}))};
}
