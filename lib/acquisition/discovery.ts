import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PRESCRIBER_SEGMENTS, resolveTradeProfile, type PrescriberSegmentId } from "./prescribers";
import { buildCommuneLookupUrl, discoverPrescribers, parseCommuneLookup, type ScoredProspect } from "./sirene";
import { nextPhase, type EnrichmentSource } from "./background";
import { findPlace, PLACES_MAX_PER_RUN, placesExpiryThreshold } from "./places";

export const MAX_PROSPECTS_PER_RUN = 150;

export type DiscoveryOutcome =
  | { ok: true; found: number; inserted: number; location: string }
  | { ok: false; reason: "workspace_missing" | "schema_missing" | "no_place" | "location_not_found" | "source_unavailable" | "storage" | "busy" };

function db(): SupabaseClient { return getSupabaseServerClient() as unknown as SupabaseClient; }

export function prospectRow(workspaceId: string, p: ScoredProspect, checkedAt: string) {
  const distance = p.distanceKm === null ? "distance inconnue" : `à ${p.distanceKm.toLocaleString("fr-FR")} km`;
  return {
    workspace_id: workspaceId, company_name: p.name.slice(0, 180), category: "prescriber", stage: "discovered",
    score: p.score, explanation: `${p.segmentLabel} — ${p.reason}`.slice(0, 2000),
    source_url: p.sourceUrl, source_checked_at: checkedAt, data_source: "sirene",
    siren: p.siren, siret: p.siret && /^\d{14}$/.test(p.siret) ? p.siret : null, naf_code: p.naf, segment: p.segment,
    address: p.address, postal_code: p.postalCode, city: p.city, distance_km: p.distanceKm,
    employee_range: p.employeeRange, is_sole_proprietor: p.isSoleProprietor,
    _observation: `Entreprise active au registre Sirene, NAF ${p.naf ?? "inconnu"}, ${p.city ?? "commune inconnue"}, ${distance}.`,
  };
}

/**
 * Lance une recherche de prescripteurs pour l'espace d'un client. Lecture seule
 * côté sources publiques ; n'écrit que dans les tables Acquisition. Aucun contact.
 */
export async function runPrescriberDiscovery(input: {
  workspaceId: string; activity?: string; place?: string; radiusKm: number; maxPerSegment: number; segments?: PrescriberSegmentId[];
  /** Enrichissements à poursuivre en tâche de fond (migration multi-sources requise). */
  sources?: EnrichmentSource[];
}): Promise<DiscoveryOutcome> {
  const client = db();
  const { data: workspace, error } = await client.from("acquisition_workspaces").select("id,client_id").eq("id", input.workspaceId).maybeSingle();
  if (error || !workspace) return { ok: false, reason: "workspace_missing" };
  let activity = input.activity?.trim() ?? ""; let place = input.place?.trim() ?? "";
  if (workspace.client_id && (!activity || !place)) {
    const { data: c } = await client.from("clients").select("activity,geographic_area").eq("id", workspace.client_id).maybeSingle();
    activity ||= c?.activity ?? ""; place ||= c?.geographic_area ?? "";
  }
  // « Lyon et alentours » → « Lyon » : première commune citée.
  place = place.split(/[,;/]| et | - /i)[0]?.trim() ?? "";
  if (!place) return { ok: false, reason: "no_place" };
  const profile = resolveTradeProfile(activity);
  const segments = input.segments?.filter((s) => s in PRESCRIBER_SEGMENTS);

  const { data: existing, error: existingError } = await client.from("acquisition_prospects").select("siren").eq("workspace_id", workspace.id).not("siren", "is", null).limit(5000);
  if (existingError) return { ok: false, reason: "schema_missing" };
  const { data: run, error: runError } = await client.from("acquisition_discovery_runs").insert({
    workspace_id: workspace.id, trade_profile: profile.id, place: place.slice(0, 120), radius_km: input.radiusKm,
    segments: segments?.length ? segments : profile.targets.map((t) => t.segment),
  }).select("id").single();
  if (runError?.code === "23505") return { ok: false, reason: "busy" };
  if (runError || !run) return { ok: false, reason: "schema_missing" };

  const finish = (patch: Record<string, unknown>) =>
    client.from("acquisition_discovery_runs").update({ ...patch, ...(patch.status === "enriching" ? {} : { finished_at: new Date().toISOString() }) }).eq("id", run.id);
  const result = await discoverPrescribers({
    profile, place, radiusKm: input.radiusKm, maxPerSegment: input.maxPerSegment,
    segments: segments?.length ? segments : undefined,
    excludeSirens: new Set((existing ?? []).map((row: { siren: string }) => row.siren)),
  });
  if (!result.ok) {
    await finish({ status: "failed", error: result.detail.slice(0, 500) });
    return { ok: false, reason: result.kind === "location_not_found" ? "location_not_found" : "source_unavailable" };
  }
  const checkedAt = new Date().toISOString();
  const rows = result.prospects.slice(0, MAX_PROSPECTS_PER_RUN).map((p) => prospectRow(workspace.id, p, checkedAt));
  let inserted = 0;
  if (rows.length) {
    const { data: saved, error: insertError } = await client.from("acquisition_prospects")
      .upsert(rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "_observation"))), { onConflict: "workspace_id,siren", ignoreDuplicates: true })
      .select("id,siren");
    if (insertError) { await finish({ status: "failed", error: "storage", found_count: result.prospects.length, api_requests: result.requests }); return { ok: false, reason: "storage" }; }
    inserted = saved?.length ?? 0;
    const observations = new Map(rows.map((r) => [r.siren, r]));
    const evidence = (saved ?? []).map((s: { id: string; siren: string }) => ({
      workspace_id: workspace.id, prospect_id: s.id, signal_type: "sirene_registry",
      source_url: observations.get(s.siren)?.source_url ?? "", observation: observations.get(s.siren)?._observation ?? "",
    })).filter((e) => e.source_url);
    if (evidence.length) await client.from("acquisition_evidence").insert(evidence);
  }
  const sources = input.sources ?? [];
  const background = sources.length
    ? { status: "enriching", phase: nextPhase("sirene_zone", sources), options: { sources }, lat: result.location.lat, lon: result.location.lon, departement: result.location.departement }
    : { status: "succeeded" };
  await finish({ ...background, commune_code: result.location.codeInsee, found_count: result.prospects.length, inserted_count: inserted, api_requests: result.requests });
  return { ok: true, found: result.prospects.length, inserted, location: result.location.commune };
}

export function placesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

/** Efface site et téléphone issus de Google Places au-delà de 30 jours (place_id conservé). */
export async function purgeExpiredPlacesData(client: SupabaseClient = db()) {
  await client.from("acquisition_prospects").update({ places_website: null, places_phone: null })
    .lt("places_enriched_at", placesExpiryThreshold()).or("places_website.not.is.null,places_phone.not.is.null");
}

export type EnrichOutcome = { ok: true; enriched: number; checked: number } | { ok: false; reason: "places_not_configured" | "schema_missing" | "source_unavailable" };

/** Complète site et téléphone des meilleurs prospects non enrichis (borné pour maîtriser le coût). */
export async function enrichWithPlaces(workspaceId: string): Promise<EnrichOutcome> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { ok: false, reason: "places_not_configured" };
  const client = db();
  await purgeExpiredPlacesData(client);
  const { data, error } = await client.from("acquisition_prospects")
    .select("id,company_name,postal_code,city").eq("workspace_id", workspaceId).eq("data_source", "sirene")
    .is("places_enriched_at", null).order("score", { ascending: false, nullsFirst: false }).limit(PLACES_MAX_PER_RUN);
  if (error) return { ok: false, reason: "schema_missing" };
  let enriched = 0;
  for (const row of (data ?? []) as { id: string; company_name: string; postal_code: string | null; city: string | null }[]) {
    try {
      const match = await findPlace({ name: row.company_name, postalCode: row.postal_code, city: row.city }, apiKey, fetch as never);
      await client.from("acquisition_prospects").update({
        google_place_id: match?.placeId ?? null, places_website: match?.website ?? null, places_phone: match?.phone ?? null,
        places_enriched_at: new Date().toISOString(),
      }).eq("id", row.id);
      if (match) enriched += 1;
    } catch {
      return enriched ? { ok: true, enriched, checked: data?.length ?? 0 } : { ok: false, reason: "source_unavailable" };
    }
  }
  return { ok: true, enriched, checked: data?.length ?? 0 };
}

export const ZONE_MAX_OPTIONS = [5_000, 20_000, 50_000, 200_000] as const;

/**
 * Met en file un balayage complet de la zone (toutes les entreprises actives du rayon),
 * exécuté par le planificateur. Ne fait qu'une requête (géolocalisation) dans l'action.
 */
export async function queueZoneScan(input: {
  workspaceId: string; place?: string; radiusKm: number; maxCompanies: number;
  excludeNonOperating: boolean; excludeSoleProprietors: boolean; sources: EnrichmentSource[];
}): Promise<{ ok: true; location: string } | { ok: false; reason: "workspace_missing" | "schema_missing" | "no_place" | "location_not_found" | "source_unavailable" | "busy" }> {
  const client = db();
  const { data: workspace, error } = await client.from("acquisition_workspaces").select("id,client_id").eq("id", input.workspaceId).maybeSingle();
  if (error || !workspace) return { ok: false, reason: "workspace_missing" };
  let place = input.place?.trim() ?? "";
  if (!place && workspace.client_id) {
    const { data: c } = await client.from("clients").select("geographic_area").eq("id", workspace.client_id).maybeSingle();
    place = c?.geographic_area ?? "";
  }
  place = place.split(/[,;/]| et | - /i)[0]?.trim() ?? "";
  if (!place) return { ok: false, reason: "no_place" };
  let location;
  try {
    const res = await fetch(buildCommuneLookupUrl(place), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, reason: "source_unavailable" };
    location = parseCommuneLookup(await res.json(), place);
  } catch { return { ok: false, reason: "source_unavailable" }; }
  if (!location) return { ok: false, reason: "location_not_found" };
  const { error: insertError } = await client.from("acquisition_discovery_runs").insert({
    workspace_id: workspace.id, mode: "zone", phase: "sirene_zone", status: "queued", trade_profile: "zone",
    place: location.commune.slice(0, 120), commune_code: location.codeInsee, radius_km: input.radiusKm,
    lat: location.lat, lon: location.lon, departement: location.departement,
    options: { maxCompanies: input.maxCompanies, excludeNonOperating: input.excludeNonOperating, excludeSoleProprietors: input.excludeSoleProprietors, sources: input.sources },
  });
  if (insertError?.code === "23505") return { ok: false, reason: "busy" };
  if (insertError) return { ok: false, reason: "schema_missing" };
  return { ok: true, location: location.commune };
}

export async function cancelDiscoveryRun(runId: string): Promise<boolean> {
  const { error } = await db().from("acquisition_discovery_runs")
    .update({ status: "cancelled", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", runId).in("status", ["queued", "running", "enriching"]);
  return !error;
}
