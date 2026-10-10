"use server";

import { requireAdmin } from "@/lib/require-admin";
import { runGoogleAdsAnalysis } from "@/lib/integrations/google-ads/service";
import { readFormText } from "@/lib/integrations/google-ads/validation";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/integrations/google-ads/periods";
import { revalidatePath } from "next/cache";
import type { AdsFormState } from "@/lib/integrations/google-ads/types";

const formPresets = PERIOD_PRESETS.filter((preset) => preset !== "day" && preset !== "custom");

/** Analyse réelle depuis la page agent : période choisie, campagnes actuellement actives. */
export async function runGoogleAdsAnalysisAction(_previous: AdsFormState, form: FormData): Promise<AdsFormState> {
  await requireAdmin();
  const preset = readFormText(form, "period") ?? "last_30";
  if (!(formPresets as readonly string[]).includes(preset)) return { message: "Période invalide." };
  const mode = readFormText(form, "mode") ?? "deterministic";
  if (mode !== "ai" && mode !== "deterministic") return { message: "Mode invalide." };
  const result = await runGoogleAdsAnalysis(readFormText(form, "agent_id") ?? "", readFormText(form, "client_id") ?? "", { period: { preset: preset as PeriodPreset }, mode });
  revalidatePath("/agents", "layout");
  revalidatePath("/clients", "layout");
  revalidatePath("/recommendations", "layout");
  revalidatePath("/dashboard");
  return result;
}
