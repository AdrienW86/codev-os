"use server";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/require-admin";
import {setBoardVisibility} from "@/lib/publications/board-visibility";
// Board-only masking: never deletes or freezes publication history.
export async function hideFromBoardAction(form:FormData):Promise<void>{await requireAdmin();const result=await setBoardVisibility(form,true);if(result.ok)revalidatePath("/publications");}
export async function restoreToBoardAction(form:FormData):Promise<void>{await requireAdmin();const result=await setBoardVisibility(form,false);if(result.ok)revalidatePath("/publications");}
