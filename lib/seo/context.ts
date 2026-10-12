// Contexte métier du client pour l'analyse SEO (pur) : prestations, zones d'intervention, exclusions et marque.
// Sources : fiche client (activité, zone géographique, site) et contexte métier renseigné pour Google Ads.
// Rien n'est déduit ni inventé : une liste vide signifie « non renseigné ».
import type { BusinessContext } from "@/lib/seo/opportunities";

export type ClientFacts = { name: string; company_name?: string | null; activity?: string | null; geographic_area?: string | null; website?: string | null };
export type StoredBusinessContext = { priorityServices?: unknown; areas?: unknown; exclusions?: unknown } | null;

/** Découpe une saisie libre (virgules, points-virgules, retours à la ligne, puces) en éléments distincts. */
export function splitList(value: unknown, max = 12) {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(/[\n,;•·|]+|\s+-\s+/).map((item) => item.replace(/^[\s*-]+/, "").trim()).filter((item) => item.length >= 3 && item.length <= 80))].slice(0, max);
}

function domainLabel(website: string | null | undefined) {
  if (!website) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "");
    const label = host.split(".")[0];
    return label && label.length >= 3 ? label.replace(/-/g, " ") : null;
  } catch { return null; }
}

export function buildBusinessContext(client: ClientFacts, stored: StoredBusinessContext): BusinessContext {
  const brandTerms = [client.name, client.company_name ?? "", domainLabel(client.website) ?? ""].map((value) => value.trim()).filter((value) => value.length >= 3);
  const services = [...splitList(stored?.priorityServices), ...splitList(client.activity, 4)];
  const areas = [...splitList(stored?.areas), ...splitList(client.geographic_area, 6)];
  return {
    brandTerms: [...new Set(brandTerms)],
    services: [...new Set(services)].slice(0, 12),
    areas: [...new Set(areas)].slice(0, 8),
    exclusions: splitList(stored?.exclusions),
  };
}
