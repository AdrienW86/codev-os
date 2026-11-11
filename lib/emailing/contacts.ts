// Import de contacts (pur) : une adresse par ligne (ou séparées par virgule / point-virgule), dédoublonnées.
import { normalizeEmail } from "./policy";

export const CONSENT_BASES = [
  { id: "opt_in", label: "Inscription volontaire (case cochée, formulaire)" },
  { id: "double_opt_in", label: "Double confirmation par e-mail" },
  { id: "customer", label: "Client existant (prestations analogues)" },
  { id: "b2b_interest", label: "Contact professionnel (message lié à sa fonction)" },
] as const;
export type ConsentBasis = (typeof CONSENT_BASES)[number]["id"];
export const isConsentBasis = (v: unknown): v is ConsentBasis => CONSENT_BASES.some((b) => b.id === v);
export const IMPORT_MAX = 5000;

export function parseContactLines(text: string): { emails: string[]; invalid: number } {
  const parts = text.split(/[\n,;]+/).map((p) => p.replace(/^.*<([^>]+)>.*$/, "$1").trim()).filter(Boolean);
  const emails = new Set<string>();
  let invalid = 0;
  for (const part of parts.slice(0, IMPORT_MAX * 2)) {
    const email = normalizeEmail(part);
    if (email) emails.add(email); else invalid++;
  }
  return { emails: [...emails].slice(0, IMPORT_MAX), invalid };
}
