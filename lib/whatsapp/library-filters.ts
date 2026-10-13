// Filtres de la photothèque (onglet Photothèque de la fiche client) : lecture des paramètres d'URL, charge utile de la
// RPC whatsapp_library_search et liens de pagination. Pur et testable : aucune valeur non reconnue n'est transmise.
import type { AssetOrigin } from "./types";

export const statusViews = ["active", "to_review", "publishable", "validated", "used", "quarantined", "rejected", "archived", "all"] as const;
export type StatusView = (typeof statusViews)[number];
export const statusViewLabels: Record<StatusView, string> = {
  active: "En cours (hors archivées, quarantaine et rejetées)", to_review: "À examiner", publishable: "Publiables", validated: "Validées", used: "Déjà utilisées",
  quarantined: "Quarantaine", rejected: "Rejetées", archived: "Archivées", all: "Toutes",
};
export const originLabels: Record<AssetOrigin, string> = { whatsapp: "WhatsApp", whatsapp_export: "Export WhatsApp", drive: "Dossier Drive" };
export const LIBRARY_PAGE_SIZE = 24;

export type LibraryFilters = { status: StatusView; origin: AssetOrigin | null; service: string | null; q: string | null; used: "yes" | "no" | null; from: string | null; to: string | null; page: number };
export const defaultFilters: LibraryFilters = { status: "active", origin: null, service: null, q: null, used: null, from: null, to: null, page: 0 };

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const text = (value: string | string[] | undefined) => { const v = one(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120); return v || null; };
const day = (value: string | string[] | undefined) => { const v = one(value); return /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) ? v : null; };
// Ancien lien « ?status=… » (statuts de la photothèque) : traduit vers la vue correspondante.
const legacy: Record<string, StatusView> = { received: "to_review", to_review: "to_review", validated: "validated", used: "used", archived: "archived", quarantined: "quarantined", rejected: "rejected" };

export function parseLibraryFilters(params: Params): LibraryFilters {
  const status = one(params.status);
  const origin = one(params.origin);
  const used = one(params.used);
  const page = Number(one(params.page));
  let from = day(params.from), to = day(params.to);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    status: (statusViews as readonly string[]).includes(status) ? status as StatusView : legacy[status] ?? "active",
    origin: origin === "whatsapp" || origin === "whatsapp_export" || origin === "drive" ? origin : null,
    service: text(params.service), q: text(params.q),
    used: used === "yes" || used === "no" ? used : null,
    from, to,
    page: Number.isInteger(page) && page >= 0 && page <= 400 ? page : 0,
  };
}

/** Charge utile de whatsapp_library_search : uniquement les clés connues de la RPC. */
export function searchPayload(filters: LibraryFilters) {
  const payload: Record<string, string> = { status: filters.status };
  for (const key of ["origin", "service", "q", "used", "from", "to"] as const) { const value = filters[key]; if (value) payload[key] = value; }
  return payload;
}

/** Lien de la photothèque avec les filtres donnés (page remise à zéro sauf mention contraire). */
export function libraryHref(clientId: string, filters: LibraryFilters, change: Partial<LibraryFilters> = {}) {
  const next = { ...filters, page: 0, ...change };
  const query = new URLSearchParams({ tab: "media" });
  if (next.status !== "active") query.set("status", next.status);
  for (const key of ["origin", "service", "q", "used", "from", "to"] as const) { const value = next[key]; if (value) query.set(key, value); }
  if (next.page > 0) query.set("page", String(next.page));
  return `/clients/${clientId}?${query.toString()}`;
}

export const activeFilterCount = (filters: LibraryFilters) => ["origin", "service", "q", "used", "from", "to"].filter(key => filters[key as keyof LibraryFilters]).length + (filters.status !== "active" ? 1 : 0);
