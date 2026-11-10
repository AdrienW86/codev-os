import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PRESCRIBER_SEGMENTS, segmentForNaf } from "./prescribers";
import { scoreProspect, type SireneCompany } from "./sirene";
import { initialZoneScan, zoneScanDone, zoneScanStep, type ZoneScanOptions, type ZoneScanState } from "./zone-scan";
import { buildOverpassQuery, matchOsm, OVERPASS_URL, parseOverpass, type MatchTarget, type OsmBusiness } from "./osm";
import { BODACC_MAX_OFFSET, BODACC_PAGE, buildBodaccUrl, parseBodacc } from "./bodacc";
import { checkWebsite } from "./website";
import { safeFetchPage } from "./safe-fetch";

/**
 * Agent Prospection en tâche de fond (planificateur, toutes les 15 min) : une recherche par
 * passage, bornée dans le temps, reprise grâce à un curseur. Phases : balayage Sirene de la
 * zone → OpenStreetMap → BODACC → sites web → terminé. Aucun contact n'est jamais pris.
 */

export type EnrichmentSource = "osm" | "bodacc" | "websites";
export const ENRICHMENT_SOURCES: EnrichmentSource[] = ["osm", "bodacc", "websites"];
export type RunPhase = "sirene_zone" | EnrichmentSource | "done";
export type RunOptions = Partial<ZoneScanOptions> & { sources?: EnrichmentSource[] };

type RunRow = {
  id: string; workspace_id: string; mode: "prescribers" | "zone"; phase: RunPhase; status: string;
  options: RunOptions; cursor: Record<string, unknown>; progress: Record<string, unknown>;
  lat: number | null; lon: number | null; radius_km: number; departement: string | null;
  found_count: number; inserted_count: number; api_requests: number;
};

const TICK_BUDGET_MS = 50_000;
const SIRENE_DELAY_MS = 160; // ≤ 7 requêtes/s imposées par l'API
const WEBSITES_PER_TICK = 25;
const BODACC_MONTHS = 12;

function db(): SupabaseClient { return getSupabaseServerClient() as unknown as SupabaseClient; }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Phase suivante selon les sources choisies (ordre fixe). */
export function nextPhase(current: RunPhase, sources: EnrichmentSource[] = ENRICHMENT_SOURCES): RunPhase {
  const order: RunPhase[] = ["sirene_zone", "osm", "bodacc", "websites", "done"];
  for (const phase of order.slice(order.indexOf(current) + 1)) {
    if (phase === "done" || sources.includes(phase as EnrichmentSource)) return phase;
  }
  return "done";
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { temporary: res.status === 429 || res.status >= 500 });
  return res.json();
}

export function zoneProspectRow(workspaceId: string, c: SireneCompany, origin: { lat: number; lon: number }, checkedAt: string) {
  const segment = segmentForNaf(c.naf);
  const { score, distanceKm } = scoreProspect(c, 3, origin);
  return {
    workspace_id: workspaceId, company_name: c.name.slice(0, 180), category: "zone_company", stage: "discovered",
    score, explanation: `Entreprise active de la zone${segment ? ` — ${PRESCRIBER_SEGMENTS[segment.id].label}` : ""} (NAF ${c.naf ?? "inconnu"}).`,
    source_url: c.sourceUrl, source_checked_at: checkedAt, data_source: "sirene",
    siren: c.siren, siret: c.siret && /^\d{14}$/.test(c.siret) ? c.siret : null, naf_code: c.naf, segment: segment?.id ?? null,
    address: c.address, postal_code: c.postalCode, city: c.city, distance_km: distanceKm,
    employee_range: c.employeeRange, is_sole_proprietor: c.isSoleProprietor,
  };
}

async function save(client: SupabaseClient, run: RunRow, patch: Partial<RunRow> & Record<string, unknown>) {
  await client.from("acquisition_discovery_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", run.id);
}

async function phaseSireneZone(client: SupabaseClient, run: RunRow, until: number) {
  const options: ZoneScanOptions = {
    excludeNonOperating: run.options.excludeNonOperating !== false,
    excludeSoleProprietors: run.options.excludeSoleProprietors === true,
    maxCompanies: Math.min(Math.max(Number(run.options.maxCompanies) || 20_000, 100), 200_000),
  };
  let state = (run.cursor.zone as ZoneScanState | undefined) ?? initialZoneScan({ lat: run.lat ?? 0, lon: run.lon ?? 0, radiusKm: run.radius_km });
  let inserted = run.inserted_count;
  const origin = { lat: state.lat, lon: state.lon };
  while (Date.now() < until && !zoneScanDone(state, options)) {
    const step = await zoneScanStep(state, options, (url) => fetchJson(url));
    state = step.state;
    if (step.companies.length) {
      const checkedAt = new Date().toISOString();
      const { data, error } = await client.from("acquisition_prospects")
        .upsert(step.companies.map((c) => zoneProspectRow(run.workspace_id, c, origin, checkedAt)), { onConflict: "workspace_id,siren", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error("storage");
      inserted += data?.length ?? 0;
    }
    await wait(SIRENE_DELAY_MS);
  }
  const done = zoneScanDone(state, options);
  await save(client, run, {
    cursor: { ...run.cursor, zone: state }, inserted_count: inserted, found_count: state.collected, api_requests: state.requests,
    progress: { ...run.progress, estimated_total: state.estimatedTotal, truncated: state.truncated, partitions_left: state.queue.length },
    ...(done ? { phase: nextPhase("sirene_zone", run.options.sources), status: "enriching" } : { status: "running" }),
  });
}

async function workspaceTargets(client: SupabaseClient, workspaceId: string): Promise<MatchTarget[]> {
  const targets: MatchTarget[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await client.from("acquisition_prospects").select("id,siren,siret,company_name,postal_code")
      .eq("workspace_id", workspaceId).eq("data_source", "sirene").order("id").range(from, from + 999);
    if (error) throw new Error("storage");
    for (const r of (data ?? []) as { id: string; siren: string | null; siret: string | null; company_name: string; postal_code: string | null }[]) {
      targets.push({ id: r.id, siren: r.siren, siret: r.siret, name: r.company_name, postalCode: r.postal_code });
    }
    if (!data || data.length < 1000) break;
  }
  return targets;
}

async function phaseOsm(client: SupabaseClient, run: RunRow, until: number) {
  // Étape 1 : une requête Overpass (lourde) puis rapprochement ; étape 2 : écriture par lots.
  let pending = run.cursor.osm_pending as [string, OsmBusiness][] | undefined;
  if (!pending) {
    if (until - Date.now() < 40_000) return; // pas assez de temps pour Overpass ce passage-ci
    const payload = await fetchJson(OVERPASS_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: buildOverpassQuery({ lat: run.lat ?? 0, lon: run.lon ?? 0, radiusKm: run.radius_km }) }).toString(),
    }, 45_000);
    const places = parseOverpass(payload);
    pending = [...matchOsm(await workspaceTargets(client, run.workspace_id), places).entries()];
    run.progress = { ...run.progress, osm_places: places.length, osm_matched: pending.length };
  }
  const checkedAt = new Date().toISOString();
  while (pending.length && Date.now() < until) {
    const [id, p] = pending.shift()!;
    await client.from("acquisition_prospects").update({ osm_ref: p.ref, osm_website: p.website, osm_phone: p.phone, osm_checked_at: checkedAt, ...(p.email ? { contact_email: p.email, contact_email_source: `https://www.openstreetmap.org/${p.ref}` } : {}) }).eq("id", id);
  }
  await save(client, run, {
    cursor: { ...run.cursor, osm_pending: pending.length ? pending : undefined }, progress: run.progress,
    ...(pending.length ? {} : { phase: nextPhase("osm", run.options.sources), status: "enriching" }),
  });
}

async function phaseBodacc(client: SupabaseClient, run: RunRow, until: number) {
  if (!run.departement) { await save(client, run, { phase: nextPhase("bodacc", run.options.sources) }); return; }
  const since = new Date(Date.now() - BODACC_MONTHS * 30.5 * 86_400_000).toISOString().slice(0, 10);
  let offset = Number(run.cursor.bodacc_offset ?? 0); let matched = Number(run.progress.bodacc_matched ?? 0);
  let finished = false;
  while (Date.now() < until) {
    const { creations, total } = parseBodacc(await fetchJson(buildBodaccUrl({ departement: run.departement, since, offset })));
    if (creations.length) {
      const { data } = await client.from("acquisition_prospects").select("id,siren").eq("workspace_id", run.workspace_id).in("siren", creations.map((c) => c.siren));
      for (const row of (data ?? []) as { id: string; siren: string }[]) {
        const c = creations.find((x) => x.siren === row.siren)!;
        await client.from("acquisition_prospects").update({ bodacc_created_on: c.publishedOn, bodacc_url: c.url }).eq("id", row.id);
        matched += 1;
      }
    }
    offset += BODACC_PAGE;
    if (!creations.length || offset >= total || offset > BODACC_MAX_OFFSET) { finished = true; break; }
  }
  await save(client, run, {
    cursor: { ...run.cursor, bodacc_offset: offset }, progress: { ...run.progress, bodacc_matched: matched },
    ...(finished ? { phase: nextPhase("bodacc", run.options.sources), status: "enriching" } : {}),
  });
}

async function phaseWebsites(client: SupabaseClient, run: RunRow, until: number) {
  let checked = Number(run.progress.websites_checked ?? 0); let emails = Number(run.progress.emails_found ?? 0);
  const { data, error } = await client.from("acquisition_prospects")
    .select("id,siren,website,places_website,osm_website")
    .eq("workspace_id", run.workspace_id).is("website_checked_at", null)
    .or("website.not.is.null,places_website.not.is.null,osm_website.not.is.null")
    .order("score", { ascending: false, nullsFirst: false }).limit(WEBSITES_PER_TICK);
  if (error) throw new Error("storage");
  const rows = (data ?? []) as { id: string; siren: string | null; website: string | null; places_website: string | null; osm_website: string | null }[];
  for (const row of rows) {
    if (Date.now() >= until) break;
    const site = row.website ?? row.places_website ?? row.osm_website!;
    const result = await checkWebsite(site, safeFetchPage).catch(() => ({ status: "unreachable" as const, email: null, emailSourceUrl: null, sirens: [] as string[], pagesRead: 0 }));
    await client.from("acquisition_prospects").update({
      website_checked_at: new Date().toISOString(), website_status: result.status,
      legal_id_confirmed: result.sirens.length ? Boolean(row.siren && result.sirens.includes(row.siren)) : null,
      ...(result.email ? { contact_email: result.email, contact_email_source: result.emailSourceUrl } : {}),
    }).eq("id", row.id);
    checked += 1; if (result.email) emails += 1;
  }
  const finished = rows.length === 0;
  await save(client, run, {
    progress: { ...run.progress, websites_checked: checked, emails_found: emails },
    ...(finished ? { phase: "done", status: "succeeded", finished_at: new Date().toISOString() } : {}),
  });
}

/** Étape du planificateur : avance la plus ancienne recherche active, dans la limite du temps donné. */
export async function runAcquisitionDiscoveryTick(options: { deadline: number }): Promise<{ runs: number; phase?: string; disabled?: true }> {
  const client = db();
  const { data, error } = await client.from("acquisition_discovery_runs")
    .select("id,workspace_id,mode,phase,status,options,cursor,progress,lat,lon,radius_km,departement,found_count,inserted_count,api_requests")
    .in("status", ["queued", "running", "enriching"]).order("updated_at").limit(1);
  if (error) return { runs: 0, disabled: true }; // migration non appliquée
  const run = (data ?? [])[0] as RunRow | undefined;
  if (!run) return { runs: 0 };
  const until = Math.min(options.deadline, Date.now() + TICK_BUDGET_MS);
  const previousFailures = Number(run.progress.failures ?? 0);
  run.progress = { ...run.progress, failures: 0 }; // remis à zéro par toute phase qui aboutit
  try {
    if (run.phase === "sirene_zone") await phaseSireneZone(client, run, until);
    else if (run.phase === "osm") await phaseOsm(client, run, until);
    else if (run.phase === "bodacc") await phaseBodacc(client, run, until);
    else if (run.phase === "websites") await phaseWebsites(client, run, until);
    else await save(client, run, { status: "succeeded", finished_at: new Date().toISOString() });
  } catch (err) {
    const failures = previousFailures + 1;
    const temporary = Boolean((err as { temporary?: boolean }).temporary) || (err as Error).name === "TimeoutError";
    // Une source indisponible ne bloque pas les autres : après 3 échecs, on passe à la phase suivante.
    if (failures >= 3 && run.phase !== "sirene_zone") {
      await save(client, run, { phase: nextPhase(run.phase, run.options.sources), status: "enriching", progress: { ...run.progress, failures: 0, [`${run.phase}_error`]: (err as Error).message.slice(0, 200) } });
    } else if (failures >= 5) {
      await save(client, run, { status: "failed", error: (err as Error).message.slice(0, 200), finished_at: new Date().toISOString() });
    } else {
      await save(client, run, { progress: { ...run.progress, failures, last_error: temporary ? "temporaire" : (err as Error).message.slice(0, 200) } });
    }
  }
  return { runs: 1, phase: run.phase };
}
