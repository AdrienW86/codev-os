"use server";

import { requireAdmin } from "@/lib/require-admin";
import { diagnoseAIProvider } from "@/lib/ai/diagnostics";
import type { MutationState } from "@/lib/core/mutation";

/** Test de connexion du fournisseur d'IA (lecture seule, sans génération). */
export async function testAIProviderAction(): Promise<MutationState> {
  await requireAdmin();
  return diagnoseAIProvider();
}
