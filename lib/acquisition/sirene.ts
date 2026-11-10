/**
 * Accès en lecture à l'API publique « Recherche d'entreprises » (Sirene/INSEE,
 * https://recherche-entreprises.api.gouv.fr) et à l'API Géo (geo.api.gouv.fr).
 * Gratuites, sans clé. Fonctions pures + `fetch` injectable pour les tests.
 * Les dirigeants (personnes physiques) ne sont jamais conservés.
 */
import { segmentForNaf, type PrescriberSegmentId, type SegmentPriority, type TradeProfile, PRESCRIBER_SEGMENTS } from "./prescribers";

export const SIRENE_API_BASE = "https://recherche-entreprises.api.gouv.fr";
export const GEO_API_BASE = "https://geo.api.gouv.fr";
export const MAX_RADIUS_KM = 50;

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type ResolvedLocation = { commune: string; codeInsee: string; departement: string; lat: number; lon: number };

export type SireneCompany = {
  siren: string; siret: string | null; name: string; naf: string | null;
  address: string | null; postalCode: string | null; city: string | null;
  lat: number | null; lon: number | null; employeeRange: string | null;
  createdOn: string | null; isSoleProprietor: boolean;
  sourceUrl: string;
};

export type ScoredProspect = SireneCompany & {
  segment: PrescriberSegmentId; segmentLabel: string; priority: SegmentPriority;
  reason: string; distanceKm: number | null; score: number;
};

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => { const n = typeof v === "string" ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) ? n : null; };

export function buildCommuneLookupUrl(place: string): string {
  const q = new URLSearchParams({ nom: place, fields: "nom,code,codeDepartement,centre", boost: "population", limit: "1" });
  return `${GEO_API_BASE}/communes?${q}`;
}

export function parseCommuneLookup(payload: unknown): ResolvedLocation | null {
  const first = Array.isArray(payload) ? (payload[0] as Json | undefined) : undefined;
  const centre = first?.centre as { coordinates?: unknown[] } | undefined;
  const lon = num(centre?.coordinates?.[0]); const lat = num(centre?.coordinates?.[1]);
  const commune = str(first?.nom); const codeInsee = str(first?.code); const departement = str(first?.codeDepartement);
  if (!commune || !codeInsee || !departement || lat === null || lon === null) return null;
  return { commune, codeInsee, departement, lat, lon };
}

/** Requête « entreprises actives autour d'un point » filtrée par codes NAF. */
export function buildNearPointUrl(input: { lat: number; lon: number; radiusKm: number; nafCodes: string[]; page: number; perPage: number }): string {
  const radius = Math.min(Math.max(input.radiusKm, 1), MAX_RADIUS_KM);
  const q = new URLSearchParams({
    lat: String(input.lat), long: String(input.lon), radius: String(radius),
    activite_principale: input.nafCodes.join(","), etat_administratif: "A",
    page: String(Math.max(1, Math.floor(input.page))), per_page: String(Math.min(Math.max(input.perPage, 1), 25)),
  });
  return `${SIRENE_API_BASE}/near_point?${q}`;
}

/** Convertit une réponse Sirene en entreprises, sans dirigeants ni données personnelles superflues. */
export function parseSireneResults(payload: unknown): { companies: SireneCompany[]; totalPages: number } {
  const root = (payload ?? {}) as Json;
  const results = Array.isArray(root.results) ? (root.results as Json[]) : [];
  const companies: SireneCompany[] = [];
  for (const r of results) {
    const siren = str(r.siren);
    if (!siren || !/^\d{9}$/.test(siren)) continue;
    if (str(r.etat_administratif) && r.etat_administratif !== "A") continue;
    const matching = Array.isArray(r.matching_etablissements) ? (r.matching_etablissements as Json[]) : [];
    const est = (matching.find((e) => !e.etat_administratif || e.etat_administratif === "A") ?? r.siege ?? {}) as Json;
    const name = str(r.nom_complet) ?? str(r.nom_raison_sociale);
    if (!name) continue;
    const siret = str(est.siret);
    companies.push({
      siren, siret, name,
      naf: str(est.activite_principale) ?? str(r.activite_principale),
      address: str(est.adresse), postalCode: str(est.code_postal), city: str(est.libelle_commune),
      lat: num(est.latitude), lon: num(est.longitude),
      employeeRange: str(r.tranche_effectif_salarie), createdOn: str(r.date_creation),
      isSoleProprietor: Boolean((r.complements as Json | undefined)?.est_entrepreneur_individuel),
      sourceUrl: `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`,
    });
  }
  const totalPages = Math.max(0, Math.floor(num(root.total_pages) ?? 0));
  return { companies, totalPages };
}

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/** Tranches INSEE : « 00 » = 0 salarié, « NN » = non renseigné, ≥ « 11 » = 10 salariés et plus. */
function sizePoints(range: string | null): number {
  if (!range || range === "NN" || range === "00") return 0;
  if (range >= "21") return 15; // 50 salariés et plus
  if (range >= "11") return 10; // 10 à 49
  return 5; // 1 à 9
}

/**
 * Score explicable sur 100 : priorité du segment (≤ 55), proximité (≤ 30), taille (≤ 15).
 * Aucune donnée inconnue n'est inventée : une valeur manquante rapporte 0 point.
 */
export function scoreProspect(company: SireneCompany, priority: SegmentPriority, origin: { lat: number; lon: number }) {
  const segmentPoints = priority === 1 ? 55 : priority === 2 ? 40 : 25;
  const distance = company.lat !== null && company.lon !== null ? distanceKm(origin, { lat: company.lat, lon: company.lon }) : null;
  const proximity = distance === null ? 0 : distance <= 5 ? 30 : distance <= 15 ? 20 : distance <= 30 ? 10 : 0;
  return { score: Math.min(100, segmentPoints + proximity + sizePoints(company.employeeRange)), distanceKm: distance };
}

/** Rattache chaque entreprise au segment ciblé correspondant, dédoublonne par SIREN et trie. */
export function rankProspects(companies: SireneCompany[], profile: TradeProfile, origin: { lat: number; lon: number }, excludeSirens: Set<string> = new Set()): ScoredProspect[] {
  const bySiren = new Map<string, ScoredProspect>();
  for (const c of companies) {
    if (excludeSirens.has(c.siren)) continue;
    const segment = segmentForNaf(c.naf);
    const target = segment && profile.targets.find((tg) => tg.segment === segment.id);
    if (!segment || !target) continue;
    const { score, distanceKm: d } = scoreProspect(c, target.priority, origin);
    const candidate: ScoredProspect = { ...c, segment: segment.id, segmentLabel: PRESCRIBER_SEGMENTS[segment.id].label, priority: target.priority, reason: target.reason, distanceKm: d, score };
    const prev = bySiren.get(c.siren);
    if (!prev || candidate.score > prev.score) bySiren.set(c.siren, candidate);
  }
  return [...bySiren.values()].sort((a, b) => b.score - a.score || (a.distanceKm ?? 999) - (b.distanceKm ?? 999) || a.name.localeCompare(b.name, "fr"));
}

export type DiscoveryResult =
  | { ok: true; location: ResolvedLocation; prospects: ScoredProspect[]; requests: number }
  | { ok: false; kind: "location_not_found" | "temporary" | "permanent"; detail: string };

/**
 * Recherche complète : géolocalise la zone puis interroge Sirene segment par segment.
 * Séquentiel et borné (≤ 7 requêtes/s imposées par l'API).
 */
export async function discoverPrescribers(input: {
  profile: TradeProfile; place: string; radiusKm: number; maxPerSegment: number;
  segments?: PrescriberSegmentId[]; excludeSirens?: Set<string>; fetchImpl?: FetchLike; delayMs?: number;
}): Promise<DiscoveryResult> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  const headers = { accept: "application/json" };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let requests = 0;
  const get = async (url: string) => {
    requests += 1;
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { temporary: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  try {
    const location = parseCommuneLookup(await get(buildCommuneLookupUrl(input.place)));
    if (!location) return { ok: false, kind: "location_not_found", detail: `Commune introuvable : « ${input.place} ».` };
    const targets = input.profile.targets.filter((tg) => !input.segments || input.segments.includes(tg.segment));
    const all: SireneCompany[] = [];
    const perSegment = Math.min(Math.max(input.maxPerSegment, 1), 100);
    for (const target of targets) {
      let page = 1; let collected = 0; let totalPages = 1;
      while (collected < perSegment && page <= totalPages && page <= 4) {
        const url = buildNearPointUrl({ lat: location.lat, lon: location.lon, radiusKm: input.radiusKm, nafCodes: PRESCRIBER_SEGMENTS[target.segment].nafCodes, page, perPage: 25 });
        const parsed = parseSireneResults(await get(url));
        all.push(...parsed.companies.slice(0, perSegment - collected));
        collected += parsed.companies.length; totalPages = parsed.totalPages; page += 1;
        await wait(input.delayMs ?? 200);
      }
    }
    return { ok: true, location, prospects: rankProspects(all, input.profile, location, input.excludeSirens), requests };
  } catch (error) {
    const temporary = Boolean((error as { temporary?: boolean }).temporary) || (error as Error).name === "TimeoutError";
    return { ok: false, kind: temporary ? "temporary" : "permanent", detail: `API Recherche d'entreprises indisponible (${(error as Error).message}).` };
  }
}
