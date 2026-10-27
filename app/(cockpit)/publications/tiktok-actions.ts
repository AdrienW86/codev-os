"use server";
import type {TikTokCreatorInfo} from "@/lib/publications/tiktok-settings";

// Lecture des informations du créateur TikTok à l'affichage de l'écran de validation (aucune écriture).
// Imports différés : l'écran qui référence cette action ne charge le code serveur TikTok qu'à l'appel.
export async function tiktokCreatorInfoAction(publicationId:string):Promise<{ok:true;info:TikTokCreatorInfo}|{ok:false;message:string}>{
 const {requireAdmin}=await import("@/lib/require-admin");await requireAdmin();
 const {loadTikTokCreatorInfo}=await import("@/lib/publications/tiktok-review");return loadTikTokCreatorInfo(publicationId);
}
