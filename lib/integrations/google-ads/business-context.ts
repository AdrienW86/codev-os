import { z } from "zod";
const text = z.string().trim().max(800).refine((value) => !value.includes("\0"));
const amount = z.number().finite().min(0).max(1_000_000).nullable();
export const adsBusinessSchema = z.strictObject({
  objectives: text, usefulConversion: text, priorityServices: text, exclusions: text, areas: text,
  advertisingMonthlyBudget: amount, targetCostPerLead: amount, currency: z.string().regex(/^[A-Z]{3}$/),
  schedules: text, capacity: text, seasonality: text, constraints: text,
});
export type AdsBusinessContext = z.infer<typeof adsBusinessSchema>;
export const EMPTY_ADS_CONTEXT: AdsBusinessContext = { objectives: "", usefulConversion: "", priorityServices: "", exclusions: "", areas: "", advertisingMonthlyBudget: null, targetCostPerLead: null, currency: "EUR", schedules: "", capacity: "", seasonality: "", constraints: "" };
export const businessLabels: Record<keyof Omit<AdsBusinessContext, "advertisingMonthlyBudget" | "targetCostPerLead" | "currency">, string> = {
  objectives: "Objectifs", usefulConversion: "Définition d’un prospect ou d’une conversion utile", priorityServices: "Services prioritaires", exclusions: "Services et demandes à exclure", areas: "Zones d’intervention", schedules: "Horaires", capacity: "Capacité de traitement", seasonality: "Saisonnalité", constraints: "Contraintes commerciales",
};
export type AdsInstructionSnapshot = { global: string; client: string; business: AdsBusinessContext | null };
export function validInstructionSnapshot(input: unknown): input is AdsInstructionSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return Object.keys(value).every((key) => ["global", "client", "business"].includes(key))
    && typeof value.global === "string" && value.global.length <= 10000 && typeof value.client === "string" && value.client.length <= 3000
    && (value.business === null || adsBusinessSchema.safeParse(value.business).success);
}
