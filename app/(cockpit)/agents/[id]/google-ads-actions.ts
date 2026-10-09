"use server";

import { requireAdmin } from "@/lib/require-admin";
import { runGoogleAdsAnalysis } from "@/lib/integrations/google-ads/service";
import { readFormText } from "@/lib/integrations/google-ads/validation";
import { revalidatePath } from "next/cache";
import type { AdsFormState } from "@/lib/integrations/google-ads/types";

export async function runGoogleAdsAnalysisAction(_previous: AdsFormState, form: FormData): Promise<AdsFormState> {
  await requireAdmin();
  const result = await runGoogleAdsAnalysis(readFormText(form, "agent_id") ?? "", readFormText(form, "client_id") ?? "");
  revalidatePath("/agents", "layout");
  revalidatePath("/clients", "layout");
  revalidatePath("/recommendations", "layout");
  revalidatePath("/dashboard");
  return result;
}
