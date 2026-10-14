"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {reschedulePublication,suspendClientAutomation,suspendPublicationDelivery} from "@/lib/publications/supervision";

// Socle Publications, lot 7 : actions du tableau de supervision. Une RPC chacune, re-vérifiée en base. Aucune ne
// publie : « Reprogrammer » remet l'approbation à zéro, « Suspendre » annule ou arrête, jamais l'inverse.
export type SupervisionActionState={ok?:boolean;message?:string};
const refresh=()=>{for(const path of ["/publications","/publications/supervision","/publications/review","/publications/calendar"])revalidatePath(path);};
export async function rescheduleAction(_state:SupervisionActionState,form:FormData):Promise<SupervisionActionState>{
 await requireAdmin();const r=await reschedulePublication(form.get("publication_id"),form.get("revision_id"),form.get("occurrence_id"));if(r.ok)refresh();return {ok:r.ok,message:r.message};
}
export async function suspendDeliveryAction(_state:SupervisionActionState,form:FormData):Promise<SupervisionActionState>{
 await requireAdmin();const r=await suspendPublicationDelivery(form.get("publication_id"));if(r.ok)refresh();return {ok:r.ok,message:r.message};
}
export async function suspendClientAction(_state:SupervisionActionState,form:FormData):Promise<SupervisionActionState>{
 await requireAdmin();const client=form.get("client_id");const r=await suspendClientAutomation(client);
 if(r.ok){refresh();if(typeof client==="string")revalidatePath(`/clients/${client}`);}return {ok:r.ok,message:r.message};
}
