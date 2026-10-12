"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {cookies} from "next/headers";
import {OAUTH_VIEW_COOKIE} from "@/lib/publications/oauth/model";
import {requireAdmin} from "@/lib/require-admin";
import {isPublicationUuid} from "@/lib/publications/validation";
import {assignPublicationAccountToChannel,disconnectConnection} from "@/lib/publications/connections/service";
import {startOAuth,verifyConnection} from "@/lib/publications/oauth/service";

// Publication connections (Lot 4.3 P9): thin admin wrappers. The browser only sends the project, the platform /
// provider and an account id; the server resolves the client and re-checks everything through the RPCs.
export type ConnectionActionState={ok?:boolean;message?:string};
function refresh(project:unknown){if(!isPublicationUuid(project))return;
 for(const tab of ["","/configuration","/calendar","/agent","/review"])revalidatePath(`/projects/${project}${tab}`);revalidatePath("/publications");revalidatePath("/clients/[id]","page");}

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
// « Connecter / Reconnecter » (Lot 4.3 P11-a): the server resolves the client from the project, stores a single-use
// state and redirects to the official consent page. Server Action: same-origin only (Next.js CSRF protection).
// Socle lot 1: started from the client page, a 10-minute cookie (closed value, callback path only) brings the admin
// back to the client « Publications » tab; the client and project still come from the consumed state.
export async function startOAuthAction(_state:ConnectionActionState,form:FormData):Promise<ConnectionActionState>{
 await requireAdmin();const result=await startOAuth(form.get("provider"),form.get("project_id"));
 if(!result.ok)return result;
 const jar=await cookies();
 if(form.get("return_view")==="client")jar.set(OAUTH_VIEW_COOKIE,"client",{httpOnly:true,secure:true,sameSite:"lax",path:"/api/publications/oauth",maxAge:600});
 else jar.delete({name:OAUTH_VIEW_COOKIE,path:"/api/publications/oauth"});
 redirect(result.url);
}
// « Vérifier la connexion »: refresh when needed, validation and resync, on explicit request only.
export async function verifyConnectionAction(_state:ConnectionActionState,form:FormData):Promise<ConnectionActionState>{
 await requireAdmin();const project=form.get("project_id");const result=await verifyConnection(project,form.get("provider"));
 refresh(project);return result;
}
