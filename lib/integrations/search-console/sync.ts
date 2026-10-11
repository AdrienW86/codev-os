import "server-only";
// Synchronisation Search Console d'un client : données consolidées (« final ») de la propriété associée au client,
// période alignée sur le dernier jour consolidé, période précédente de même durée, requêtes, pages, pays, appareils.
// Écrit un instantané `metric_snapshots` (clé = période demandée par l'interface) et l'historique quotidien
// `search_console_daily_metrics`. Une erreur garde le type normalisé (ProviderError), jamais la réponse de Google.
import { recordSync } from "@/lib/connections/sync";
import { ProviderError } from "@/lib/providers/errors";
import { searchAnalytics, type QueryRow, type SearchDimension } from "@/lib/providers/search-console";
import { presetPeriod } from "@/lib/analytics/view-model";
import { productionSearchConsoleDeps, searchConsoleAccess, type SearchConsoleDeps } from "@/lib/integrations/search-console/connection";
import {
  SEARCH_CONSOLE_METRIC_KEY, SEARCH_CONSOLE_PROVIDER, SEARCH_CONSOLE_SNAPSHOT_VERSION, addDays, aggregate, alignPeriod, dayCount, isPeriod, normalizeProperty,
  type DailyMetrics, type DimensionRow, type Metrics, type Period, type SearchConsoleSnapshot, type SectionKey,
} from "@/lib/integrations/search-console/model";
import type { Json } from "@/lib/supabase/database.types";
import type { SearchConsoleSyncTrigger } from "@/lib/supabase/search-console.types";

type Db = SearchConsoleDeps["db"];
export type SyncResult = { ok: true; snapshot: SearchConsoleSnapshot; warning: string | null } | { ok: false; reason: "not_connected" | "no_property" | "invalid" | "unavailable"; error: string | null };

const MAX_DAYS = 366;
const errorKind = (error: unknown) => error instanceof ProviderError ? error.kind : "internal";
const errorMessage = (error: unknown) => error instanceof ProviderError ? error.message : "Synchronisation Search Console indisponible.";
const metricsOf = (row: QueryRow): Metrics => ({ clicks: row.clicks, impressions: row.impressions, ctr: row.impressions > 0 ? row.clicks / row.impressions : null, position: row.impressions > 0 && row.position >= 1 ? row.position : null });

/** Propriété associée au client (jamais celle d'un autre client), ou null. */
export async function clientProperty(db: Db, clientId: string): Promise<string | null> {
  const { data, error } = await db.from("client_connections").select("metadata").eq("client_id", clientId).eq("provider", SEARCH_CONSOLE_PROVIDER).maybeSingle();
  if (error) throw new Error("search console property read");
  const raw = data?.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? (data.metadata as Record<string, unknown>).property : null;
  return normalizeProperty(raw);
}

/** Série quotidienne complète : un jour consolidé absent de la réponse Google n'a eu aucune impression (0, pas une estimation). */
export function dailySeries(rows: QueryRow[], period: Period): DailyMetrics[] {
  const byDate = new Map(rows.flatMap((row) => typeof row.keys[0] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.keys[0]) ? [[row.keys[0], row] as const] : []));
  const days: DailyMetrics[] = [];
  for (let date = period.start; date <= period.end; date = addDays(date, 1)) {
    const row = byDate.get(date);
    days.push(row ? { date, clicks: row.clicks, impressions: row.impressions, position: row.impressions > 0 && row.position >= 1 ? row.position : null } : { date, clicks: 0, impressions: 0, position: null });
  }
  return days;
}

/** Lignes d'une dimension avec, si disponible, la même clé sur la période précédente. */
export function dimensionRows(current: QueryRow[], previous: QueryRow[] | null, limit: number): DimensionRow[] {
  const before = previous ? new Map(previous.map((row) => [row.keys[0], row])) : null;
  return current.filter((row) => typeof row.keys[0] === "string" && row.keys[0].length > 0).slice(0, limit).map((row) => {
    const prior = before?.get(row.keys[0]);
    return { key: row.keys[0].slice(0, 500), ...metricsOf(row), previous: before ? (prior ? metricsOf(prior) : { clicks: 0, impressions: 0, ctr: null, position: null }) : null };
  });
}

/** Exécute des tâches avec une concurrence bornée (quota par minute de l'API). */
async function limited<T>(tasks: (() => Promise<T>)[], concurrency = 3): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await tasks[index]() }; } catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}

export async function syncSearchConsole(clientId: string, requested: Period, trigger: SearchConsoleSyncTrigger, deps: SearchConsoleDeps = productionSearchConsoleDeps(), options: { runId?: string | null } = {}): Promise<SyncResult> {
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !isPeriod(requested) || dayCount(requested) > MAX_DAYS) return { ok: false, reason: "invalid", error: "Période invalide." };
  const db = deps.db;
  const property = await clientProperty(db, clientId);
  if (!property) return { ok: false, reason: "no_property", error: null };
  const access = await searchConsoleAccess(deps);
  if (!access) return { ok: false, reason: "not_connected", error: null };
  const now = new Date((deps.now ?? Date.now)());
  const today = now.toISOString().slice(0, 10);
  // runId : trace déjà réservée (quotidienne) ; null : pas de trace propre (période complémentaire d'une même synchronisation).
  const run = options.runId !== undefined ? options.runId : await startRun(db, clientId, property, trigger, today);
  const call = (period: Period, dimensions: SearchDimension[], rowLimit: number) => searchAnalytics(property, { startDate: period.start, endDate: period.end, dimensions, rowLimit, dataState: "final" }, { accessToken: access.accessToken, fetchImpl: deps.fetchImpl, env: deps.env });
  try {
    // Dernier jour consolidé (seulement si la période demandée touche les jours récents, encore incomplets).
    let lastAvailable: string | null = null;
    if (requested.end > addDays(today, -10)) {
      const probe = await call({ start: addDays(today, -10), end: today }, ["date"], 20);
      lastAvailable = probe.map((row) => row.keys[0]).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort().at(-1) ?? null;
    }
    const aligned = alignPeriod(requested, lastAvailable, today);
    const daily = dailySeries(await call(aligned.period, ["date"], MAX_DAYS + 5), aligned.period);
    const [previousDaily, queries, previousQueries, pages, previousPages, countries, devices] = await limited<QueryRow[]>([
      () => call(aligned.previous, ["date"], MAX_DAYS + 5),
      () => call(aligned.period, ["query"], 250), () => call(aligned.previous, ["query"], 1000),
      () => call(aligned.period, ["page"], 250), () => call(aligned.previous, ["page"], 1000),
      () => call(aligned.period, ["country"], 50), () => call(aligned.period, ["device"], 10),
    ]);
    // Accès refusé ou quota épuisé : la synchronisation entière échoue, rien de partiel n'est enregistré.
    for (const result of [previousDaily, queries, previousQueries, pages, previousPages, countries, devices]) {
      if (result.status === "rejected" && result.reason instanceof ProviderError && ["unauthorized", "rate_limited", "not_configured"].includes(result.reason.kind)) throw result.reason;
    }
    const value = (result: PromiseSettledResult<QueryRow[]>) => result.status === "fulfilled" ? result.value : null;
    const sections: SearchConsoleSnapshot["sections"] = { daily: { ok: true } };
    const mark = (key: SectionKey, result: PromiseSettledResult<QueryRow[]>) => { sections[key] = result.status === "fulfilled" ? { ok: true } : { ok: false, error: errorMessage(result.reason) }; };
    mark("previousDaily", previousDaily); mark("queries", queries); mark("pages", pages); mark("countries", countries); mark("devices", devices);
    const previousSeries = value(previousDaily) ? dailySeries(value(previousDaily)!, aligned.previous) : [];
    const snapshot: SearchConsoleSnapshot = {
      version: SEARCH_CONSOLE_SNAPSHOT_VERSION, property, requested, period: aligned.period, previousPeriod: aligned.previous,
      lastAvailableDate: lastAvailable ?? daily.filter((row) => row.impressions > 0).at(-1)?.date ?? null,
      totals: aggregate(daily), previousTotals: value(previousDaily) ? aggregate(previousSeries) : null, daily, previousDaily: previousSeries,
      queries: dimensionRows(value(queries) ?? [], value(previousQueries), 250), pages: dimensionRows(value(pages) ?? [], value(previousPages), 250),
      countries: dimensionRows(value(countries) ?? [], null, 50), devices: dimensionRows(value(devices) ?? [], null, 10), sections,
    };
    const { error: writeError } = await db.from("metric_snapshots").upsert({
      client_id: clientId, provider: SEARCH_CONSOLE_PROVIDER, metric_key: SEARCH_CONSOLE_METRIC_KEY, period_start: requested.start, period_end: requested.end, data: snapshot as unknown as Json, fetched_at: now.toISOString(),
    }, { onConflict: "client_id,provider,metric_key,period_start,period_end" });
    if (writeError) throw new Error("search console snapshot write");
    // Historique quotidien (jours consolidés uniquement) : remplacement à l'identique, jamais de doublon.
    const history = [...daily, ...previousSeries].filter((row) => !snapshot.lastAvailableDate || row.date <= snapshot.lastAvailableDate)
      .map((row) => ({ client_id: clientId, property, date: row.date, clicks: row.clicks, impressions: row.impressions, position: row.position, fetched_at: now.toISOString() }));
    if (history.length) {
      const { error: historyError } = await db.from("search_console_daily_metrics").upsert(history, { onConflict: "client_id,property,date" });
      if (historyError) throw new Error("search console history write");
    }
    const failed = Object.entries(sections).filter(([, status]) => status && !status.ok).map(([key]) => key);
    const warning = failed.length ? `Search Console : blocs non récupérés (${failed.join(", ")}).` : null;
    await recordSync(clientId, SEARCH_CONSOLE_PROVIDER, null, { warning });
    await finishRun(db, run, null);
    return { ok: true, snapshot, warning };
  } catch (failure) {
    await recordSync(clientId, SEARCH_CONSOLE_PROVIDER, failure instanceof ProviderError ? failure : new Error("Synchronisation Search Console indisponible."));
    await finishRun(db, run, failure);
    if (!(failure instanceof ProviderError)) console.error("[search-console] sync", { kind: "internal" });
    return { ok: false, reason: "unavailable", error: errorMessage(failure) };
  }
}

async function startRun(db: Db, clientId: string, property: string, trigger: SearchConsoleSyncTrigger, syncDate: string): Promise<string | null> {
  const { data, error } = await db.from("search_console_sync_runs").insert({ client_id: clientId, property, trigger, sync_date: syncDate }).select("id").maybeSingle();
  return error || !data ? null : data.id; // Trace best effort, sauf pour la réservation quotidienne (claimDailyRun).
}
async function finishRun(db: Db, id: string | null, failure: unknown) {
  if (!id) return;
  await db.from("search_console_sync_runs").update({ status: failure ? "failed" : "succeeded", error_kind: failure ? errorKind(failure) : null, finished_at: new Date().toISOString() }).eq("id", id).then(() => undefined, () => undefined);
}

/** Réservation de la synchronisation quotidienne d'un client : unique par jour (index partiel en base). */
async function claimDailyRun(db: Db, clientId: string, property: string, syncDate: string): Promise<string | null> {
  const { count } = await db.from("search_console_sync_runs").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("trigger", "daily").eq("sync_date", syncDate).eq("status", "failed");
  if ((count ?? 0) >= 3) return null; // 3 échecs le même jour : on attend le lendemain (quota, accès).
  const { data, error } = await db.from("search_console_sync_runs").insert({ client_id: clientId, property, trigger: "daily", sync_date: syncDate }).select("id").maybeSingle();
  return error || !data ? null : data.id;
}

/** Périodes préparées chaque jour : celles proposées par « Données et performances ». */
export const DAILY_PRESETS = [7, 30, 90] as const;

/**
 * Synchronisation quotidienne automatique (appelée par le planificateur) : chaque client ayant une propriété est
 * synchronisé au plus une fois par jour (jour de Paris), dans un budget de temps borné ; les suivants passent au tick suivant.
 */
export async function syncDueSearchConsole(now = new Date(), options: { budgetMs?: number; deps?: SearchConsoleDeps } = {}) {
  const summary = { synced: 0, failed: 0, pending: 0 };
  const deps = options.deps ?? productionSearchConsoleDeps();
  if (!await searchConsoleAccess(deps)) return summary;
  const started = Date.now(), budget = options.budgetMs ?? 90_000;
  const syncDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const { data, error } = await deps.db.from("client_connections").select("client_id,metadata,last_sync_at").eq("provider", SEARCH_CONSOLE_PROVIDER).not("client_id", "is", null).order("last_sync_at", { ascending: true, nullsFirst: true }).limit(200);
  if (error) throw new Error("search console clients read");
  for (const row of data ?? []) {
    const property = normalizeProperty((row.metadata as Record<string, unknown> | null)?.property);
    if (!row.client_id || !property) continue;
    if (Date.now() - started > budget) { summary.pending++; continue; }
    const run = await claimDailyRun(deps.db, row.client_id, property, syncDate);
    if (!run) continue;
    let failure: string | null = null;
    for (const days of DAILY_PRESETS) {
      const result = await syncSearchConsole(row.client_id, presetPeriod(days, now), "daily", deps, { runId: null });
      if (!result.ok) { failure = result.error ?? result.reason; break; }
    }
    await finishRun(deps.db, run, failure ? new ProviderError("search-console", "unavailable") : null);
    const ok = !failure;
    if (ok) summary.synced++; else summary.failed++;
  }
  return summary;
}
