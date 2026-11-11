/**
 * BODACC (Bulletin officiel des annonces civiles et commerciales), open data DILA via
 * Opendatasoft. Repère les créations récentes d'entreprises d'un département : utile pour
 * signaler les entreprises qui viennent de démarrer (besoin probable de site, d'outils…).
 */
export const BODACC_URL = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";
export const BODACC_PAGE = 100;
/** Opendatasoft limite offset + limit à 10 000. */
export const BODACC_MAX_OFFSET = 9_900;

export type BodaccCreation = { siren: string; publishedOn: string; url: string | null; name: string | null };

export function buildBodaccUrl(input: { departement: string; since: string; offset: number }): string {
  const dep = input.departement.replace(/[^0-9AB]/gi, "").slice(0, 3);
  const since = /^\d{4}-\d{2}-\d{2}$/.test(input.since) ? input.since : "2000-01-01";
  const q = new URLSearchParams({
    where: `familleavis="creation" AND numerodepartement="${dep}" AND dateparution>=date'${since}'`,
    select: "registre,dateparution,url_complete,commercant",
    order_by: "dateparution desc", limit: String(BODACC_PAGE), offset: String(Math.max(0, Math.floor(input.offset))),
  });
  return `${BODACC_URL}?${q}`;
}

export function parseBodacc(payload: unknown): { creations: BodaccCreation[]; total: number } {
  const root = (payload ?? {}) as { results?: unknown; total_count?: unknown };
  const results = Array.isArray(root.results) ? (root.results as Record<string, unknown>[]) : [];
  const creations: BodaccCreation[] = [];
  for (const r of results) {
    const registre = Array.isArray(r.registre) ? r.registre.map(String) : typeof r.registre === "string" ? [r.registre] : [];
    const siren = registre.map((v) => v.replace(/\D/g, "")).find((v) => v.length === 9);
    const date = typeof r.dateparution === "string" ? r.dateparution.slice(0, 10) : null;
    if (!siren || !date) continue;
    const url = typeof r.url_complete === "string" && r.url_complete.startsWith("https://") ? r.url_complete : null;
    creations.push({ siren, publishedOn: date, url, name: typeof r.commercant === "string" ? r.commercant.slice(0, 180) : null });
  }
  return { creations, total: typeof root.total_count === "number" ? root.total_count : creations.length };
}
