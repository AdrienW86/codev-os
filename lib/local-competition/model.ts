// Concurrence locale (architecture des agents, lot 7, version gratuite + DataForSEO facultatif) : chaque semaine,
// pour chaque client local, la recherche « métier + ville » est relevée chez un ou deux fournisseurs :
//  - Google Places (Text Search, quota gratuit mensuel) : rang indicatif de la fiche, note et nombre d'avis des
//    concurrents. Conditions Google : seul l'identifiant de lieu peut être conservé au-delà de 30 jours, les relevés
//    Places sont donc effacés après 30 jours.
//  - DataForSEO (Google Maps, facultatif, actif dès que ses identifiants sont configurés) : vraie position Google Maps.
// Règles PURES, sans import. Jamais de position inventée : un client introuvable est « absent des N premiers ».

export type LocalSource = "dataforseo-maps" | "google-places";
export const COMPETITION_PROVIDER = "local-competition";
/** Ordre de préférence : la position Google Maps (DataForSEO) prime sur le rang indicatif Places. */
export const LOCAL_SOURCES: readonly LocalSource[] = ["dataforseo-maps", "google-places"];
export const sourceLabels: Record<LocalSource, string> = { "dataforseo-maps": "position Google Maps (DataForSEO)", "google-places": "rang indicatif Google Places" };
export const PLACES_RETENTION_DAYS = 30;
export const COMPETITION_INTERVAL_DAYS = 7;
export const COMPETITION_RETRY_HOURS = 24;
export const COMPETITION_DEPTH = 20;

/** lat / lng : coordonnées de la fiche, relevées seulement chez DataForSEO (centre de la carte de positions). */
export type LocalResult = { rank: number; name: string; placeId: string | null; rating: number | null; reviews: number | null; domain: string | null; lat?: number | null; lng?: number | null };
export type LocalTarget = { clientId: string; company: string; activity: string; city: string; domain: string | null };
export type CompetitionSnapshot = {
  version: 1; source: LocalSource; keyword: string; checkedAt: string; depth: number;
  rank: number | null; client: { name: string; rating: number | null; reviews: number | null; lat?: number | null; lng?: number | null } | null;
  competitors: LocalResult[]; medianRating: number | null; medianReviews: number | null;
};
export type CompetitionFinding = { code: CompetitionCode; severity: "medium" | "low"; title: string; detail: string; fix: string };
export const COMPETITION_CODES = ["not_visible", "rank_drop", "reviews_gap", "rating_gap"] as const;
export type CompetitionCode = (typeof COMPETITION_CODES)[number];
export const competitionFingerprint = (clientId: string, code: CompetitionCode) => `local-competition:${clientId}:${code}`;

const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const numOrNull = (value: unknown, max: number) => (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : null);
export const normalizeName = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Hôte sans « www. » d'une URL http(s) ; null sinon. */
export function hostOf(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host.slice(0, 120) : null;
  } catch { return null; }
}

/** Client local ciblable : métier et première ville de la zone ; un client national (« France ») n'en a pas. */
export function competitionTarget(client: { id: string; name?: string | null; company_name?: string | null; activity?: string | null; geographic_area?: string | null; website?: string | null }): LocalTarget | null {
  const activity = clean(client.activity ?? "", 60), area = clean(client.geographic_area ?? "", 120);
  const city = clean(area.split(/,|;|\/|\s+et\s+|\s+-\s+/i)[0] ?? "", 60);
  const company = clean(client.company_name || client.name || "", 80);
  if (!activity || !city || !company || /^(france|toute la france|national|international|europe)$/i.test(city)) return null;
  return { clientId: client.id, company, activity, city, domain: hostOf(client.website) };
}
export const competitionKeyword = (target: LocalTarget) => `${target.activity.toLowerCase()} ${target.city}`;

export function competitionDue(input: { lastAt: string | null; lastFailureAt: string | null }, now: Date) {
  const last = input.lastAt ? Date.parse(input.lastAt) : NaN, failure = input.lastFailureAt ? Date.parse(input.lastFailureAt) : NaN;
  if (Number.isFinite(failure) && now.getTime() - failure < COMPETITION_RETRY_HOURS * 3_600_000 && (!Number.isFinite(last) || failure > last)) return false;
  return !Number.isFinite(last) || now.getTime() - last >= COMPETITION_INTERVAL_DAYS * 86_400_000 - 3_600_000;
}

/** Réponse Places API (New) searchText → résultats ordonnés (fiches fermées définitivement ignorées). */
export function readPlacesResults(body: unknown): LocalResult[] {
  const places = Array.isArray(rec(body).places) ? (rec(body).places as unknown[]) : [];
  const out: LocalResult[] = [];
  for (const raw of places.slice(0, COMPETITION_DEPTH)) {
    const place = rec(raw);
    const name = typeof rec(place.displayName).text === "string" ? clean(String(rec(place.displayName).text), 80) : "";
    if (!name || place.businessStatus === "CLOSED_PERMANENTLY") continue;
    out.push({ rank: out.length + 1, name, placeId: typeof place.id === "string" ? place.id.slice(0, 200) : null, rating: numOrNull(place.rating, 5), reviews: numOrNull(place.userRatingCount, 10_000_000), domain: hostOf(place.websiteUri) });
  }
  return out;
}

const coordinate = (value: unknown, max: number) => (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= max ? Math.round(value * 1e6) / 1e6 : null);

/** Réponse DataForSEO SERP Google Maps (live/advanced) → résultats ordonnés par position. */
export function readDataForSeoResults(body: unknown): LocalResult[] | null {
  const task = rec(Array.isArray(rec(body).tasks) ? (rec(body).tasks as unknown[])[0] : null);
  // 40102 « No Search Results » : la recherche a abouti sans aucune fiche (fiche absente), pas un échec.
  if (rec(body).status_code === 20000 && task.status_code === 40102) return [];
  if (rec(body).status_code !== 20000 || task.status_code !== 20000) return null;
  const result = rec(Array.isArray(task.result) ? (task.result as unknown[])[0] : null);
  const items = Array.isArray(result.items) ? (result.items as unknown[]).map(rec).filter((item) => item.type === "maps_search") : [];
  const out: LocalResult[] = [];
  for (const item of items.slice(0, COMPETITION_DEPTH)) {
    const name = typeof item.title === "string" ? clean(item.title, 80) : "";
    if (!name) continue;
    const rating = rec(item.rating);
    const rank = typeof item.rank_group === "number" && Number.isInteger(item.rank_group) && item.rank_group > 0 ? item.rank_group : out.length + 1;
    out.push({ rank, name, placeId: typeof item.place_id === "string" ? item.place_id.slice(0, 200) : null, rating: numOrNull(rating.value, 5), reviews: numOrNull(rating.votes_count, 10_000_000), domain: hostOf(item.domain ?? item.url), lat: coordinate(item.latitude, 90), lng: coordinate(item.longitude, 180) });
  }
  return out;
}

/** Codes d'état DataForSEO (nombres seulement, jamais le texte du fournisseur) pour le journal d'échec. */
export function dataForSeoCodes(httpStatus: number | null, body: unknown): { http: number | null; api: number | null; task: number | null } {
  const task = rec(Array.isArray(rec(body).tasks) ? (rec(body).tasks as unknown[])[0] : null);
  const code = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);
  return { http: httpStatus, api: code(rec(body).status_code), task: code(task.status_code) };
}

/** Position du client : même site (domaine), sinon nom proche (60 % des mots significatifs). */
export function findClient(results: readonly LocalResult[], target: LocalTarget): LocalResult | null {
  if (target.domain) {
    const byDomain = results.find((row) => row.domain && (row.domain === target.domain || row.domain.endsWith(`.${target.domain}`) || target.domain!.endsWith(`.${row.domain}`)));
    if (byDomain) return byDomain;
  }
  const wanted = normalizeName(target.company).split(" ").filter((word) => word.length > 2);
  if (!wanted.length) return null;
  return results.find((row) => { const name = normalizeName(row.name); return wanted.filter((word) => name.includes(word)).length / wanted.length >= 0.6; }) ?? null;
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
};

export function buildCompetition(source: LocalSource, keyword: string, results: readonly LocalResult[], target: LocalTarget, now: Date): CompetitionSnapshot {
  const own = findClient(results, target);
  const competitors = results.filter((row) => row !== own).slice(0, 5);
  return {
    version: 1, source, keyword: clean(keyword, 120), checkedAt: now.toISOString(), depth: COMPETITION_DEPTH,
    rank: own?.rank ?? null, client: own ? { name: own.name, rating: own.rating, reviews: own.reviews, ...(source === "dataforseo-maps" ? { lat: own.lat ?? null, lng: own.lng ?? null } : {}) } : null, competitors,
    medianRating: median(competitors.flatMap((row) => (row.rating === null ? [] : [row.rating]))),
    medianReviews: median(competitors.flatMap((row) => (row.reviews === null ? [] : [row.reviews]))),
  };
}

/** Relecture d'un instantané archivé (null si la forme n'est pas la bonne). */
export function readCompetition(value: unknown): CompetitionSnapshot | null {
  const data = rec(value);
  if (data.version !== 1 || !LOCAL_SOURCES.includes(data.source as LocalSource) || typeof data.keyword !== "string" || typeof data.checkedAt !== "string") return null;
  const competitors = Array.isArray(data.competitors) ? (data.competitors as unknown[]).map(rec).filter((row) => typeof row.name === "string").slice(0, 5).map((row) => ({
    rank: typeof row.rank === "number" ? row.rank : 0, name: clean(String(row.name), 80), placeId: null, rating: numOrNull(row.rating, 5), reviews: numOrNull(row.reviews, 10_000_000), domain: typeof row.domain === "string" ? row.domain : null,
    lat: coordinate(row.lat, 90), lng: coordinate(row.lng, 180),
  })) : [];
  const client = rec(data.client);
  return {
    version: 1, source: data.source as LocalSource, keyword: clean(data.keyword, 120), checkedAt: data.checkedAt, depth: typeof data.depth === "number" ? data.depth : COMPETITION_DEPTH,
    rank: typeof data.rank === "number" && Number.isInteger(data.rank) && data.rank > 0 ? data.rank : null,
    client: typeof client.name === "string" ? { name: clean(client.name, 80), rating: numOrNull(client.rating, 5), reviews: numOrNull(client.reviews, 10_000_000), lat: coordinate(client.lat, 90), lng: coordinate(client.lng, 180) } : null,
    competitors, medianRating: numOrNull(data.medianRating, 5), medianReviews: numOrNull(data.medianReviews, 10_000_000),
  };
}

const fr = (value: number) => String(value).replace(".", ",");
export function evaluateCompetition(snapshot: CompetitionSnapshot, previous: CompetitionSnapshot | null): CompetitionFinding[] {
  const out: CompetitionFinding[] = [];
  const where = `« ${snapshot.keyword} » (${sourceLabels[snapshot.source]})`;
  if (snapshot.rank === null) out.push({ code: "not_visible", severity: "medium", title: `absente des ${snapshot.depth} premiers résultats locaux`,
    detail: `La fiche n'apparaît pas dans les ${snapshot.depth} premiers résultats pour ${where}.`, fix: "Vérifier la catégorie principale, l'adresse et la zone desservie de la fiche Google, puis obtenir des avis récents." });
  else if (previous && previous.source === snapshot.source && previous.rank !== null && snapshot.rank - previous.rank >= 3)
    out.push({ code: "rank_drop", severity: "medium", title: `recul de la ${previous.rank}e à la ${snapshot.rank}e place`,
      detail: `Recul de ${snapshot.rank - previous.rank} places pour ${where} depuis le relevé du ${previous.checkedAt.slice(0, 10)}.`, fix: "Comparer avec les concurrents passés devant (avis, photos, publications récentes) et relancer l'activité de la fiche." });
  const own = snapshot.client;
  if (own?.reviews !== null && own?.reviews !== undefined && snapshot.medianReviews !== null && snapshot.medianReviews >= 10 && own.reviews < snapshot.medianReviews * 0.5)
    out.push({ code: "reviews_gap", severity: "medium", title: "beaucoup moins d'avis que les concurrents",
      detail: `${own.reviews} avis contre ${fr(snapshot.medianReviews)} en médiane pour les 5 premiers concurrents sur ${where}.`, fix: "Mettre en place une demande d'avis systématique après chaque chantier (lien direct vers la fiche)." });
  if (own?.rating !== null && own?.rating !== undefined && snapshot.medianRating !== null && own.rating < snapshot.medianRating - 0.3)
    out.push({ code: "rating_gap", severity: "low", title: "note inférieure aux concurrents",
      detail: `Note ${fr(own.rating)}/5 contre ${fr(snapshot.medianRating)}/5 en médiane chez les concurrents sur ${where}.`, fix: "Répondre aux avis négatifs et solliciter les clients satisfaits." });
  return out;
}
