"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {preparePublicationDelivery,retryPublicationDelivery} from "@/lib/publications/delivery/service";
import {confirmDeliveryNotPublished,processDuePublications,reconcileDelivery} from "@/lib/publications/delivery/registry";

// Drawer « Diffusion » (Lot 4.3 P10): prepare a delivery, retry a failed / blocked one. Sending happens only through
// the explicit admin trigger below (P13), behind the kill switches.
export type DeliveryActionState={ok?:boolean;message?:string;result?:'exists'|'missing'|'unknown'};
function refresh(){revalidatePath("/publications");revalidatePath("/publications/review");revalidatePath("/projects","layout");}
export async function prepareDeliveryAction(_state:DeliveryActionState,form:FormData):Promise<DeliveryActionState>{
 await requireAdmin();const result=await preparePublicationDelivery(form.get("publication_id"));if(result.ok)refresh();return result;
}
export async function retryDeliveryAction(_state:DeliveryActionState,form:FormData):Promise<DeliveryActionState>{
 await requireAdmin();const result=await retryPublicationDelivery(form.get("publication_id"),form.get("delivery_id"));if(result.ok)refresh();return result;
}
// Uncertain delivery (Lot 4.3 P11-b): read-only provider check, then explicit admin decision. Never a resend.
export async function reconcileDeliveryAction(_state:DeliveryActionState,form:FormData):Promise<DeliveryActionState>{
 await requireAdmin();const result=await reconcileDelivery(form.get("delivery_id"));if(result.ok)refresh();return {ok:result.ok,message:result.message,result:result.result};
}
// Explicit admin trigger: send the due deliveries now (bounded, kill switches checked on the server).
export async function processDuePublicationsAction():Promise<DeliveryActionState>{
 await requireAdmin();const result=await processDuePublications();if(result.ok)refresh();return {ok:result.ok,message:result.message};
}
export async function confirmNotPublishedAction(_state:DeliveryActionState,form:FormData):Promise<DeliveryActionState>{
 await requireAdmin();if(form.getAll('confirm').length!==1||form.get('confirm')!=='on')return {ok:false,message:'Confirmez explicitement que la publication n’a pas été diffusée.'};
 const result=await confirmDeliveryNotPublished(form.get("delivery_id"));if(result.ok)refresh();return result;
}
