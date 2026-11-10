/**
 * Enrichissement facultatif via Google Places API (New) — Text Search.
 * Actif uniquement si GOOGLE_PLACES_API_KEY est configurée côté serveur.
 * CGU Google : seul `place_id` peut être conservé sans limite ; le site et le
 * téléphone sont effacés après PLACES_RETENTION_DAYS jours.
 */
import { normalizeText } from "./prescribers";
import type { FetchLike } from "./sirene";

export const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
export const PLACES_RETENTION_DAYS = 30;
export const PLACES_MAX_PER_RUN = 20;
const FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber";

export type PlacesMatch = { placeId: string; website: string | null; phone: string | null };
export type PlacesTarget = { name: string; postalCode: string | null; city: string | null };

export function placesQuery(target: PlacesTarget): string {
  return [target.name, target.postalCode, target.city].filter(Boolean).join(" ");
}

function safeWebsite(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch { return null; }
}

/** Retient un résultat seulement si le nom correspond et, si connu, le code postal aussi. */
export function pickPlacesMatch(payload: unknown, target: PlacesTarget): PlacesMatch | null {
  const places = Array.isArray((payload as { places?: unknown })?.places) ? (payload as { places: Record<string, unknown>[] }).places : [];
  const wanted = normalizeText(target.name).split(" ").filter((w) => w.length > 2);
  for (const place of places) {
    const id = typeof place.id === "string" ? place.id : null;
    const name = normalizeText(String((place.displayName as { text?: unknown } | undefined)?.text ?? ""));
    const address = String(place.formattedAddress ?? "");
    if (!id || !name) continue;
    const overlap = wanted.length === 0 ? 0 : wanted.filter((w) => name.includes(w)).length / wanted.length;
    if (overlap < 0.6) continue;
    if (target.postalCode && !address.includes(target.postalCode)) continue;
    const phone = typeof place.nationalPhoneNumber === "string" ? place.nationalPhoneNumber.slice(0, 40) : null;
    return { placeId: id, website: safeWebsite(place.websiteUri), phone };
  }
  return null;
}

export async function findPlace(target: PlacesTarget, apiKey: string, fetchImpl: FetchLike): Promise<PlacesMatch | null> {
  const res = await (fetchImpl as unknown as (u: string, i: unknown) => ReturnType<FetchLike>)(PLACES_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
    body: JSON.stringify({ textQuery: placesQuery(target), languageCode: "fr", regionCode: "FR", pageSize: 3 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google Places HTTP ${res.status}`);
  return pickPlacesMatch(await res.json(), target);
}

export function placesExpiryThreshold(now: Date = new Date()): string {
  return new Date(now.getTime() - PLACES_RETENTION_DAYS * 86_400_000).toISOString();
}
