"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {setAgentScope,setAgentProjectAssignment} from "@/lib/agents/project-assignments";
import {getProjectById} from "@/lib/projects/data";
import {createInternalTestRun} from "@/lib/agent-runs/data";
import type {AgentTestRunState} from "@/lib/agents/types";
function field(form:FormData,key:string):string {const entries=form.getAll(key);return entries.length===1&&typeof entries[0]==="string"?entries[0]:"";}
function refresh(agentId:string){revalidatePath(`/agents/${agentId}`);revalidatePath("/clients","layout");revalidatePath("/projects","layout");}
export async function changeScopeAction(_state:AgentTestRunState,form:FormData):Promise<AgentTestRunState> {
 await requireAdmin();const id=field(form,"agent_id"),result=await setAgentScope(id,field(form,"scope"));if(!result.ok)return {message:result.message};refresh(id);return {message:"Portée confirmée et auditée."};
}
export async function assignProjectAction(_state:AgentTestRunState,form:FormData):Promise<AgentTestRunState> {
 await requireAdmin();const id=field(form,"agent_id"),enabled=field(form,"enabled");if(!["true","false"].includes(enabled))return {message:"Activation invalide."};
 const result=await setAgentProjectAssignment(id,field(form,"project_id"),enabled==="true");if(!result.ok)return {message:result.message};refresh(id);return {message:"Autorisation projet enregistrée et auditée."};
}
export async function createProjectTestRunAction(_state:AgentTestRunState,form:FormData):Promise<AgentTestRunState> {
 await requireAdmin();const id=field(form,"agent_id"),project=await getProjectById(field(form,"project_id"));if(!project)return {message:"Projet indisponible."};
 const result=await createInternalTestRun(id,project.client_id,project.id);if(!result.ok)return {message:result.message};refresh(id);revalidatePath("/recommendations");return {message:"Run de test interne terminé sur le projet autorisé.",recommendationId:result.recommendationId};
}
