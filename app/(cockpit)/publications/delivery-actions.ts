"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {preparePublicationDelivery,retryPublicationDelivery} from "@/lib/publications/delivery/service";

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
