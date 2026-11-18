// Carte de positions Google Maps (lot 7, DataForSEO) : la même recherche est relevée depuis 49 points (grille 7 × 7,
// 1,5 km entre deux points) autour de la fiche du client, pour voir où elle apparaît dans le top 3, plus loin, ou pas
// du tout. Règles PURES, sans import. Une position absente est « au-delà de 20 », jamais un chiffre inventé.

export const GEOGRID_PROVIDER = "local-geogrid";
export const GEOGRID_SIZE = 7;
export const GEOGRID_SPACING_KM = 1.5;
export const GEOGRID_DEPTH = 20;
export const GEOGRID_MAX_KEYWORDS = 3;
export const GEOGRID_INTERVAL_DAYS = 7;
export const GEOGRID_RETRY_HOURS = 24;

export type GeoPoint = { lat: number; lng: number };
export type GeogridSnapshot = {
  version: 1; keyword: string; checkedAt: string; size: number; spacingKm: number; depth: number;
  center: GeoPoint & { origin: "listing" | "competitors" };
  /** Position par point, ligne par ligne du nord au sud, d'ouest en est ; null = au-delà de 20 ou non relevé. */
  cells: (number | null)[];
  /** Points dont le relevé a échoué (comptés à part, jamais comme « absent »). */
  failed: number[];
  found: number; top3: number; average: number | null;
};

const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const norm = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const finite = (value: unknown, max: number): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= max;

/** Clé de stockage stable d'une recherche (metric_key) : « k:couvreur-perpignan ». */
export const geogridKey = (keyword: string) => `k:${norm(keyword).replace(/ /g, "-").slice(0, 70)}`;

/**
 * Recherches suivies (3 au plus) : le métier, puis les requêtes Search Console du client qui contiennent le métier
 * (les plus vues d'abord), sans celles qui citent le nom de l'entreprise (recherche de marque).
 */
export function geogridKeywords(input: { activity: string; company: string; queries: readonly { query: string; impressions: number }[] }): string[] {
  const activity = clean(input.activity.toLowerCase(), 60);
  if (!activity) return [];
  const stem = norm(activity).split(" ").filter((word) => word.length >= 4).map((word) => word.slice(0, 5));
  const brand = norm(input.company).split(" ").filter((word) => word.length > 3);
  const out = [activity];
  const seen = new Set([norm(activity)]);
  for (const row of [...input.queries].sort((a, b) => b.impressions - a.impressions)) {
    if (out.length >= GEOGRID_MAX_KEYWORDS) break;
    const q = clean(row.query.toLowerCase(), 60), n = norm(q);
    if (q.length < 4 || seen.has(n) || !stem.some((s) => n.includes(s)) || brand.some((word) => n.includes(word))) continue;
    seen.add(n); out.push(q);
  }
  return out;
}

/** Centre : coordonnées de la fiche (relevé DataForSEO), sinon barycentre des concurrents relevés ; null sinon. */
export function geogridCenter(snapshot: unknown): (GeoPoint & { origin: "listing" | "competitors" }) | null {
  const data = snapshot && typeof snapshot === "object" ? snapshot as Record<string, unknown> : {};
  const client = data.client && typeof data.client === "object" ? data.client as Record<string, unknown> : {};
  if (finite(client.lat, 90) && finite(client.lng, 180)) return { lat: client.lat, lng: client.lng, origin: "listing" };
  const points = (Array.isArray(data.competitors) ? data.competitors : []).flatMap((row) => {
    const r = row && typeof row === "object" ? row as Record<string, unknown> : {};
    return finite(r.lat, 90) && finite(r.lng, 180) ? [{ lat: r.lat, lng: r.lng }] : [];
  });
  if (points.length < 2) return null;
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return { lat: round(points.reduce((s, p) => s + p.lat, 0) / points.length), lng: round(points.reduce((s, p) => s + p.lng, 0) / points.length), origin: "competitors" };
}

/** 49 points, du nord-ouest au sud-est, espacés de spacingKm (correction de longitude selon la latitude). */
export function geogridPoints(center: GeoPoint, size = GEOGRID_SIZE, spacingKm = GEOGRID_SPACING_KM): GeoPoint[] {
  const half = (size - 1) / 2, dLat = spacingKm / 111.32, dLng = spacingKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  const out: GeoPoint[] = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) out.push({ lat: round(center.lat + (half - row) * dLat), lng: round(center.lng + (col - half) * dLng) });
  return out;
}

export function geogridDue(input: { lastAt: string | null; lastFailureAt: string | null }, now: Date) {
  const last = input.lastAt ? Date.parse(input.lastAt) : NaN, failure = input.lastFailureAt ? Date.parse(input.lastFailureAt) : NaN;
  if (Number.isFinite(failure) && now.getTime() - failure < GEOGRID_RETRY_HOURS * 3_600_000 && (!Number.isFinite(last) || failure > last)) return false;
  return !Number.isFinite(last) || now.getTime() - last >= GEOGRID_INTERVAL_DAYS * 86_400_000 - 3_600_000;
}

/** Synthèse : points où la fiche apparaît, points en top 3, position moyenne sur les points où elle apparaît. */
export function buildGeogrid(input: { keyword: string; center: GeoPoint & { origin: "listing" | "competitors" }; ranks: (number | null | undefined)[]; now: Date }): GeogridSnapshot {
  const cells: (number | null)[] = [], failed: number[] = [];
  input.ranks.forEach((rank, i) => {
    if (rank === undefined) { failed.push(i); cells.push(null); return; }
    cells.push(typeof rank === "number" && Number.isInteger(rank) && rank >= 1 && rank <= GEOGRID_DEPTH ? rank : null);
  });
  const ranked = cells.filter((cell): cell is number => cell !== null);
  return {
    version: 1, keyword: clean(input.keyword, 60), checkedAt: input.now.toISOString(), size: GEOGRID_SIZE, spacingKm: GEOGRID_SPACING_KM, depth: GEOGRID_DEPTH,
    center: input.center, cells, failed, found: ranked.length, top3: ranked.filter((rank) => rank <= 3).length,
    average: ranked.length ? Math.round((ranked.reduce((a, b) => a + b, 0) / ranked.length) * 10) / 10 : null,
  };
}

/** Relecture d'un instantané archivé ; null si la forme n'est pas la bonne. */
export function readGeogrid(value: unknown): GeogridSnapshot | null {
  const d = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!d || d.version !== 1 || typeof d.keyword !== "string" || typeof d.checkedAt !== "string" || !Array.isArray(d.cells)) return null;
  const size = typeof d.size === "number" && Number.isInteger(d.size) && d.size >= 3 && d.size <= 9 ? d.size : null;
  if (!size || d.cells.length !== size * size) return null;
  const c = d.center && typeof d.center === "object" ? d.center as Record<string, unknown> : {};
  if (!finite(c.lat, 90) || !finite(c.lng, 180)) return null;
  const cells = d.cells.map((cell) => (typeof cell === "number" && Number.isInteger(cell) && cell >= 1 && cell <= 100 ? cell : null));
  const failed = Array.isArray(d.failed) ? d.failed.filter((i): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < cells.length) : [];
  const ranked = cells.filter((cell): cell is number => cell !== null);
  return {
    version: 1, keyword: clean(d.keyword, 60), checkedAt: d.checkedAt, size, spacingKm: finite(d.spacingKm, 50) ? d.spacingKm : GEOGRID_SPACING_KM, depth: typeof d.depth === "number" ? d.depth : GEOGRID_DEPTH,
    center: { lat: c.lat, lng: c.lng, origin: c.origin === "listing" ? "listing" : "competitors" }, cells, failed,
    found: ranked.length, top3: ranked.filter((rank) => rank <= 3).length, average: ranked.length ? Math.round((ranked.reduce((a, b) => a + b, 0) / ranked.length) * 10) / 10 : null,
  };
}

/** Classe de couleur d'une case : top 3, 4 à 10, 11 à 20, absente, non relevée. */
export function geogridTone(rank: number | null, failed: boolean): "top" | "mid" | "low" | "none" | "unknown" {
  if (failed) return "unknown";
  if (rank === null) return "none";
  return rank <= 3 ? "top" : rank <= 10 ? "mid" : "low";
}
