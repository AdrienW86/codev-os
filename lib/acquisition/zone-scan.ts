/**
 * Balayage complet d'une zone (toutes les entreprises actives dans un rayon) via l'API
 * Recherche d'entreprises. L'API plafonne chaque requête à 10 000 résultats : la zone est
 * découpée par section NAF, puis par sous-classe NAF si une section dépasse le plafond.
 * État sérialisable (curseur JSON) pour reprendre d'un passage du planificateur à l'autre.
 */
import { NAF_CODES, NAF_SECTIONS, NON_OPERATING_NAF, nafCodesOfSection, sectionOfNaf } from "./naf";
import { PRESCRIBER_SEGMENTS } from "./prescribers";
import { SIRENE_API_BASE, MAX_RADIUS_KM, parseSireneResults, type FetchLike, type SireneCompany } from "./sirene";

export const API_RESULT_CAP = 10_000;
export const PER_PAGE = 25;

export type ZonePartition = { filter: "section" | "naf"; value: string; page: number; totalPages: number | null; totalResults: number | null };
export type ZoneScanState = {
  lat: number; lon: number; radiusKm: number;
  queue: ZonePartition[];
  /** Partitions dont le total dépasse le plafond de l'API, même au niveau sous-classe : résultats incomplets. */
  truncated: string[];
  requests: number; collected: number; estimatedTotal: number;
};
export type ZoneScanOptions = { excludeNonOperating: boolean; excludeSoleProprietors: boolean; maxCompanies: number };

/** Cœur de métier ciblé : sections NAF entières et/ou sous-classes. Vide = tous les métiers. */
export type ZoneScope = { sections: string[]; nafCodes: string[] };

/**
 * Construit le périmètre d'un balayage à partir des choix du formulaire : grands secteurs
 * (sections), métiers prescripteurs connus (segments) et codes NAF saisis. Les codes déjà
 * couverts par une section choisie sont retirés ; les valeurs inconnues sont ignorées.
 */
export function resolveZoneScope(input: { sections?: unknown[]; segments?: unknown[]; nafCodes?: unknown[] }): ZoneScope {
  const sections = [...new Set((input.sections ?? []).filter((s): s is string => typeof s === "string" && NAF_SECTIONS.includes(s)))];
  const known = new Set(NAF_CODES);
  const codes = new Set<string>();
  for (const id of input.segments ?? []) {
    const segment = typeof id === "string" && Object.hasOwn(PRESCRIBER_SEGMENTS, id) ? PRESCRIBER_SEGMENTS[id as keyof typeof PRESCRIBER_SEGMENTS] : null;
    segment?.nafCodes.forEach((code) => codes.add(code));
  }
  for (const code of input.nafCodes ?? []) if (typeof code === "string" && known.has(code)) codes.add(code);
  const nafCodes = [...codes].filter((code) => !sections.includes(sectionOfNaf(code) ?? "")).sort();
  return { sections: sections.sort(), nafCodes };
}

export function initialZoneScan(input: { lat: number; lon: number; radiusKm: number; scope?: Partial<ZoneScope> | null }): ZoneScanState {
  const scope = resolveZoneScope({ sections: input.scope?.sections, nafCodes: input.scope?.nafCodes });
  const everything = !scope.sections.length && !scope.nafCodes.length;
  const queue: ZonePartition[] = everything
    ? NAF_SECTIONS.map((value) => ({ filter: "section", value, page: 1, totalPages: null, totalResults: null }))
    : [
      ...scope.sections.map((value): ZonePartition => ({ filter: "section", value, page: 1, totalPages: null, totalResults: null })),
      ...scope.nafCodes.map((value): ZonePartition => ({ filter: "naf", value, page: 1, totalPages: null, totalResults: null })),
    ];
  return {
    lat: input.lat, lon: input.lon, radiusKm: Math.min(Math.max(input.radiusKm, 1), MAX_RADIUS_KM),
    queue,
    truncated: [], requests: 0, collected: 0, estimatedTotal: 0,
  };
}

export function zonePartitionUrl(state: ZoneScanState, part: ZonePartition): string {
  const q = new URLSearchParams({
    lat: String(state.lat), long: String(state.lon), radius: String(state.radiusKm), etat_administratif: "A",
    page: String(part.page), per_page: String(PER_PAGE),
  });
  q.set(part.filter === "section" ? "section_activite_principale" : "activite_principale", part.value);
  return `${SIRENE_API_BASE}/near_point?${q}`;
}

export function keepCompany(company: SireneCompany, options: ZoneScanOptions): boolean {
  if (options.excludeNonOperating && company.naf && NON_OPERATING_NAF.includes(company.naf)) return false;
  if (options.excludeSoleProprietors && company.isSoleProprietor) return false;
  return true;
}

export function zoneScanDone(state: ZoneScanState, options: ZoneScanOptions): boolean {
  return state.queue.length === 0 || state.collected >= options.maxCompanies;
}

/**
 * Traite une page de la première partition de la file. Retourne les entreprises retenues
 * et le nouvel état (l'entrée n'est jamais modifiée).
 */
export async function zoneScanStep(state: ZoneScanState, options: ZoneScanOptions, fetchJson: (url: string) => Promise<unknown>): Promise<{ state: ZoneScanState; companies: SireneCompany[] }> {
  if (zoneScanDone(state, options)) return { state, companies: [] };
  const [head, ...rest] = state.queue;
  const payload = await fetchJson(zonePartitionUrl(state, head)) as { total_results?: unknown };
  const requests = state.requests + 1;
  const total = typeof payload?.total_results === "number" ? payload.total_results : 0;
  if (head.page === 1 && head.filter === "section" && total >= API_RESULT_CAP) {
    const codes = nafCodesOfSection(head.value).filter((code) => !(options.excludeNonOperating && NON_OPERATING_NAF.includes(code)));
    const split: ZonePartition[] = codes.map((value) => ({ filter: "naf", value, page: 1, totalPages: null, totalResults: null }));
    return { state: { ...state, requests, queue: [...split, ...rest] }, companies: [] };
  }
  const parsed = parseSireneResults(payload);
  const truncated = head.page === 1 && total >= API_RESULT_CAP ? [...state.truncated, head.value] : state.truncated;
  const estimatedTotal = head.page === 1 ? state.estimatedTotal + Math.min(total, API_RESULT_CAP) : state.estimatedTotal;
  const room = Math.max(0, options.maxCompanies - state.collected);
  const companies = parsed.companies.filter((c) => keepCompany(c, options)).slice(0, room);
  const maxPages = Math.min(parsed.totalPages, Math.floor(API_RESULT_CAP / PER_PAGE));
  const next: ZonePartition | null = head.page < maxPages && parsed.companies.length > 0
    ? { ...head, page: head.page + 1, totalPages: maxPages, totalResults: total } : null;
  return {
    state: { ...state, requests, truncated, estimatedTotal, collected: state.collected + companies.length, queue: next ? [next, ...rest] : rest },
    companies,
  };
}

/** Type de `fetch` minimal partagé avec les autres sources. */
export type { FetchLike };
