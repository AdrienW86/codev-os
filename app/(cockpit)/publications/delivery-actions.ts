"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {preparePublicationDelivery,retryPublicationDelivery} from "@/lib/publications/delivery/service";
import {confirmDeliveryNotPublished,reconcileDelivery} from "@/lib/publications/delivery/registry";

// Drawer « Diffusion » (Lot 4.3 P10): prepare a delivery, retry a failed / blocked one. No action executes a job or
// calls a provider: the engine only runs locally with the simulated publisher.
export type DeliveryActionState={ok?:boolean;message?:string};
function refresh(){revalidatePath("/publications");revalidatePath("/publications/review");revalidatePath("/projects","layout");}
export async function prepareDeliveryAction(_state:DeliveryActionState,form:FormData):Promise<DeliveryActionState>{
 await requireAdmin();const result=await preparePublicationDelivery(form.get("publication_id"));if(result.ok)refresh();return result;
}
export async function retryDeliveryAction(_state:DeliveryActionState,form:FormData):Promise<DeliveryActionState>{
 await requireAdmin();const result=await retryPublicationDelivery(form.get("publication_id"),form.get("delivery_id"));if(result.ok)refresh();return result;
}
// Uncertain delivery (Lot 4.3 P11-b): read-only provider check, then explicit admin decision. Never a resend.
export async function reconcileDeliveryAction(_state:DeliveryActionState,form:FormData):Promise<DeliveryActionState>{
 await requireAdmin();const result=await reconcileDelivery(form.get("delivery_id"));if(result.ok)refresh();return {ok:result.ok,message:result.message};
}
export async function confirmNotPublishedAction(_state:DeliveryActionState,form:FormData):Promise<DeliveryActionState>{
 await requireAdmin();const result=await confirmDeliveryNotPublished(form.get("delivery_id"));if(result.ok)refresh();return result;
}
