"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {isPublicationUuid} from "@/lib/publications/validation";
import {assignPublicationAccountToChannel,disconnectConnection} from "@/lib/publications/connections/service";

// Publication connections (Lot 4.3 P9): thin admin wrappers. The browser only sends the project, the platform /
// provider and an account id; the server resolves the client and re-checks everything through the RPCs.
export type ConnectionActionState={ok?:boolean;message?:string};
function refresh(project:unknown){if(!isPublicationUuid(project))return;
 for(const tab of ["","/configuration","/calendar","/agent","/review"])revalidatePath(`/projects/${project}${tab}`);revalidatePath("/publications");}

export async function assignPublicationAccountAction(_state:ConnectionActionState,form:FormData):Promise<ConnectionActionState>{
 await requireAdmin();const project=form.get("project_id"),account=form.get("account_id");
 const result=await assignPublicationAccountToChannel(project,form.get("platform"),account===""?null:account);
 if(result.ok)refresh(project);return result;
}
export async function disconnectPublicationConnectionAction(_state:ConnectionActionState,form:FormData):Promise<ConnectionActionState>{
 await requireAdmin();const project=form.get("project_id");
 if(form.get("confirm")!=="on")return {ok:false,message:"Cochez la confirmation pour déconnecter."};
 const result=await disconnectConnection(project,form.get("provider"));
 if(result.ok)refresh(project);return result;
}
