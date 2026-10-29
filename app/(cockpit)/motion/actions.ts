"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { parseMotionForm } from "@/lib/motion/model";
import { createMotionProject } from "@/lib/motion/service";

// Aucune génération IA, aucun rendu ni upload : création d'un brief de travail uniquement.
export async function createMotionDraftAction(formData:FormData):Promise<void>{
 await requireAdmin();
 const input=parseMotionForm(formData);
 if(!input)redirect("/motion?error=invalid");
 const result=await createMotionProject(input);
 if(!result.ok)redirect("/motion?error=storage");
 redirect("/motion/"+result.id);
}
