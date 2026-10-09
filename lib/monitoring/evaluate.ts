// Évaluation (pure) d'un contrôle HTTP de site.
export type CheckResult = { ok: boolean; status: number | null; ms: number | null; errorKind: string | null };
export type CheckVerdict = { state: "up" | "slow" | "down" | "blocked"; label: string };

export const SLOW_MS = 4000;

/** Normalise le site saisi sur la fiche client (« exemple.fr » → « https://exemple.fr/ »). */
export function siteUrl(website: string | null | undefined): string | null {
  const value = website?.trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try { const url = new URL(withScheme); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; } catch { return null; }
}

export function evaluateCheck(result: CheckResult): CheckVerdict {
  if (result.errorKind === "blocked") return { state: "blocked", label: "Adresse refusée par la politique réseau" };
  if (result.status === null || result.status >= 500) return { state: "down", label: result.status ? `Erreur ${result.status}` : result.errorKind === "timeout" ? "Pas de réponse (délai dépassé)" : "Injoignable" };
  if (result.status >= 400) return { state: "down", label: `Erreur ${result.status}` };
  if (result.ms !== null && result.ms > SLOW_MS) return { state: "slow", label: `Lent (${result.ms} ms)` };
  return { state: "up", label: `En ligne (${result.status}, ${result.ms ?? "?"} ms)` };
}
