// Budget IA (harness) : règles pures du plafond mensuel par client. Aucune lecture, aucun appel.
import { zonedToUtc } from "@/lib/scheduler/recurrence";

/** Plafond appliqué tant qu'aucun plafond n'est réglé pour le client (filet de sécurité, en euros par mois). */
export const DEFAULT_MONTHLY_CAP_EUR = 5;
/** Marge réservée avant chaque appel : un appel n'est lancé que s'il ne peut pas faire dépasser le plafond. */
export const CALL_GUARD_EUR = 0.02;

/** Début du mois civil en cours, heure de Paris (même borne que la Photothèque). */
export function monthStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value), month = Number(parts.find((p) => p.type === "month")?.value);
  return zonedToUtc(year, month, 1, 0, 0, "Europe/Paris");
}

export type SpendLine = { source: "metered" | "publications" | "media-library"; agent: string; eur: number };
export type Budget = { cap: number; capIsDefault: boolean; spent: number; byAgent: Record<string, number>; remaining: number; allowed: boolean };

export function budgetOf(lines: readonly SpendLine[], cap: number | null): Budget {
  const byAgent: Record<string, number> = {};
  let spent = 0;
  for (const line of lines) {
    const eur = Number.isFinite(line.eur) && line.eur > 0 ? line.eur : 0;
    byAgent[line.agent] = round((byAgent[line.agent] ?? 0) + eur);
    spent += eur;
  }
  const effective = cap !== null && Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_MONTHLY_CAP_EUR;
  spent = round(spent);
  return { cap: effective, capIsDefault: cap === null, spent, byAgent, remaining: round(Math.max(0, effective - spent)), allowed: round(spent + CALL_GUARD_EUR) <= effective };
}

/** Saisie du plafond : nombre en euros, 0 à 200, deux décimales (virgule acceptée). */
export function parseCap(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const cap = Number(text);
  return cap >= 0 && cap <= 200 ? cap : null;
}

const round = (value: number) => Math.round(value * 10000) / 10000;
