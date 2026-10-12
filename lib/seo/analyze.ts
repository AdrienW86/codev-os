// Totaux Search Console (pur). La détection des opportunités est dans lib/seo/opportunities.ts (moteur unique).
import type { QueryRow } from "@/lib/providers/search-console";

export function totals(rows: QueryRow[]) {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const position = impressions ? rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions : null;
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}
