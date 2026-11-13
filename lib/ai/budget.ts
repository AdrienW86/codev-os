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

/**
 * Coût estimé d'un appel de l'assistant serveur (OpenAI ou Anthropic), en euros. Tarifs publics par million de jetons
 * (entrée, sortie) pour les modèles connus ; un modèle inconnu est compté au tarif prudent (le plus élevé),
 * jamais à zéro. Même marge de change et de sécurité (× 1,25) que la passerelle Publications.
 */
const PRICES_PER_MILLION: readonly [RegExp, number, number][] = [
  [/^gpt-4\.1-nano/i, 0.1, 0.4],
  [/^gpt-4\.1-mini/i, 0.4, 1.6],
  [/^gpt-4\.1/i, 2, 8],
  // Claude (tarifs publics Anthropic, novembre 2026). Les plus précis d'abord.
  [/^claude-fable-5-2|^claude-mythos-5-2/i, 8, 40],
  [/^claude-fable|^claude-mythos/i, 10, 50],
  [/^claude-opus-5-5/i, 4, 20],
  [/^claude-opus/i, 5, 25],
  [/^claude-sonnet-4/i, 3, 15],
  [/^claude-sonnet/i, 2, 10],
  [/^claude-haiku-5-5/i, 0.1, 0.5],
  [/^claude-haiku/i, 1, 5],
];
/** Modèle inconnu : tarif le plus élevé de la table, jamais sous-estimé. */
const PRUDENT_PRICE: [number, number] = [10, 50];
export function estimateCallCostEur(model: string, inputTokens: number, outputTokens: number): number {
  const known = PRICES_PER_MILLION.find(([pattern]) => pattern.test(model));
  const [input, output] = known ? [known[1], known[2]] : PRUDENT_PRICE;
  const tokens = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
  return Math.ceil((tokens(inputTokens) * input + tokens(outputTokens) * output) * 1.25) / 1_000_000;
}

const round = (value: number) => Math.round(value * 10000) / 10000;
