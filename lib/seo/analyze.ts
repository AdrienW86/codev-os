// Analyse SEO (pure) : comparaison de deux périodes Search Console.
import type { QueryRow } from "@/lib/providers/search-console";

export type SeoFinding = { kind: "page_drop" | "page_growth" | "emerging_query" | "low_ctr"; key: string; detail: string; severity: "low" | "medium" | "high" };

export function totals(rows: QueryRow[]) {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const position = impressions ? rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions : null;
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}

export function analyzeSeo(pagesNow: QueryRow[], pagesBefore: QueryRow[], queriesNow: QueryRow[], queriesBefore: QueryRow[]): SeoFinding[] {
  const findings: SeoFinding[] = [];
  const before = new Map(pagesBefore.map((row) => [row.keys[0], row]));
  for (const row of pagesNow) {
    const prior = before.get(row.keys[0]);
    if (prior && prior.clicks >= 20 && row.clicks <= prior.clicks * 0.7) findings.push({ kind: "page_drop", key: row.keys[0], severity: row.clicks <= prior.clicks * 0.5 ? "high" : "medium", detail: `Clics passés de ${prior.clicks} à ${row.clicks}.` });
    else if (prior && prior.clicks >= 10 && row.clicks >= prior.clicks * 1.5) findings.push({ kind: "page_growth", key: row.keys[0], severity: "low", detail: `Clics passés de ${prior.clicks} à ${row.clicks}.` });
  }
  for (const page of pagesBefore) {
    if (page.clicks >= 20 && !pagesNow.some((row) => row.keys[0] === page.keys[0])) findings.push({ kind: "page_drop", key: page.keys[0], severity: "high", detail: `Page sans clic sur la période (${page.clicks} auparavant).` });
  }
  const queriesPrior = new Map(queriesBefore.map((row) => [row.keys[0], row]));
  for (const row of queriesNow) {
    const prior = queriesPrior.get(row.keys[0]);
    if (row.impressions >= 100 && row.position >= 8 && row.position <= 20 && (!prior || row.impressions >= prior.impressions * 1.5)) findings.push({ kind: "emerging_query", key: row.keys[0], severity: "medium", detail: `${row.impressions} impressions, position ${row.position.toFixed(1)} : une page dédiée pourrait gagner la première page.` });
    else if (row.impressions >= 500 && row.position <= 5 && row.ctr < 0.02) findings.push({ kind: "low_ctr", key: row.keys[0], severity: "low", detail: `Bien positionnée (${row.position.toFixed(1)}) mais CTR de ${(row.ctr * 100).toFixed(1)} % : titre et description à retravailler.` });
  }
  return findings.slice(0, 20);
}
