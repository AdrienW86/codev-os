"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {decideGeneratedImage,type ImageDecision} from "@/lib/publications/photo-agent/service";
export type ImageDecisionState={message?:string;ok?:boolean};
// Validation des images générées par l'Agent Photo : seule voie pour qu'une image générée rejoigne une publication.
export async function decideGeneratedImageAction(_state:ImageDecisionState,form:FormData):Promise<ImageDecisionState>{
 await requireAdmin();
 const id=form.get("image_id"),decision=form.get("decision"),reason=form.get("reason");
 if(typeof id!=="string"||typeof decision!=="string"||!["approve","approve_publish","reject"].includes(decision))return {message:"Demande invalide.",ok:false};
 const result=await decideGeneratedImage(id,decision as ImageDecision,typeof reason==="string"?reason:undefined);
 revalidatePath("/publications/images");revalidatePath("/publications");revalidatePath("/publications/review");
 return {message:result.message,ok:result.ok};
}
