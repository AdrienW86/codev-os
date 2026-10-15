import "server-only";
// Collecte destinée aux rapports personnalisés : client et période explicites, providers
// existants en lecture seule. Aucun envoi, aucune approbation et aucune mutation Google Ads.
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { gatherReportInput } from "./service";
import { buildReport, searchConsoleReportLines, type ReportInput } from "./build";
import { buildGoogleAdsReport } from "./google-ads";
import { loadCampaignDashboard } from "@/lib/integrations/google-ads/service";
import { DEFAULT_FILTERS, sumCampaigns } from "@/lib/integrations/google-ads/dashboard";
import { storeScope } from "@/lib/integrations/google-ads/scope";
import { buildAdsFindings } from "@/lib/integrations/google-ads/findings";
import { addDays, dayCount, normalizeProperty, SEARCH_CONSOLE_SNAPSHOT_VERSION } from "@/lib/integrations/search-console/model";
import { syncVercelAnalytics, VERCEL_SNAPSHOT_VERSION } from "@/lib/vercel-analytics/sync";
import {
  professionalReportSchema, type ProfessionalReportRequest, type ProfessionalReportSource,
  type ProfessionalSourceResult,
} from "./professional";

const db = () => getSupabaseServerClient();
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const number = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
const bounds = (input: ProfessionalReportRequest) => ({ since: `${input.start}T00:00:00Z`, until: `${addDays(input.end, 1)}T00:00:00Z` });
const inPeriod = (date: string | null | undefined, input: ProfessionalReportRequest) => Boolean(date) && date!.slice(0, 10) >= input.start && date!.slice(0, 10) <= input.end;
const failure = (source: ProfessionalReportSource, message: string): ProfessionalSourceResult => ({ source, state: "unavailable", lines: [message], evidence: [] });

async function connection(input: ProfessionalReportRequest, provider: string) {
  const result = await db().from("client_connections").select("client_id,status,external_account_id,metadata,last_sync_at").eq("client_id", input.clientId).eq("provider", provider).maybeSingle();
  if (result.error) throw new Error("Source indisponible.");
  if (result.data && result.data.client_id !== input.clientId) throw new Error("Périmètre client incohérent.");
  return result.data;
}

async function googleAds(input: ProfessionalReportRequest): Promise<ProfessionalSourceResult> {
  const linked = await connection(input, "google_ads");
  if (!linked?.external_account_id || linked.status !== "connected") return { source: "google_ads", state: "not_connected", lines: ["Associez et testez le compte Google Ads de ce client pour inclure ses résultats."], evidence: [] };
  const loaded = await loadCampaignDashboard(input.clientId, {
    ...DEFAULT_FILTERS, period: { preset: "custom", start: input.start, end: input.end }, status: "all", includeUntracked: true,
  });
  if (!loaded.ok) return failure("google_ads", loaded.message);
  const data = loaded.data;
  if (data.account.id !== linked.external_account_id || data.period.start !== input.start || data.period.end !== input.end) return failure("google_ads", "Le compte ou la période a changé pendant la collecte : préparez à nouveau le rapport.");
  // La sélection est explicite : toutes les campagnes renvoyées pour le seul compte associé
  // au client, tous statuts. Aucun filtre de la page et aucun périmètre d’un autre client.
  if (!data.campaigns.length) return { source: "google_ads", state: "available", lines: ["Aucune campagne renvoyée par Google Ads pour ce compte et cette période ; aucune dépense ou conversion n’a été supposée."], evidence: [`Compte : ${data.account.id}. Fuseau : ${data.account.timezone}.`, `Période : ${input.start} → ${input.end}. Lecture le ${data.fetchedAt}.`] };
  const scope = storeScope({ start: input.start, end: input.end, status: "all", types: [], campaignIds: data.campaigns.map(row => row.id) }, data.campaigns, {
    accountId: data.account.id, timezone: data.account.timezone, currency: data.account.currency, days: data.period.days,
  });
  if (!scope) return failure("google_ads", "Le périmètre Google Ads n’a pas pu être figé ; aucun total publié.");
  const built = buildGoogleAdsReport({ clientName: "Ce client", accountName: data.account.name ?? "Compte sans nom", scope, rows: data.campaigns, leads: data.leads, includesToday: data.period.includesToday });
  const findings = buildAdsFindings(data.campaigns, scope);
  const recommendations = { title: "Recommandations fondées sur les résultats", lines: findings.length
    ? findings.slice(0, 12).map(row => `${row.priority === "high" ? "Priorité haute" : row.priority === "medium" ? "Priorité moyenne" : "À examiner"} — ${row.title}. ${row.detail} Action proposée : ${row.nextStep}`)
    : ["Aucun signal prioritaire n’a été identifié par les règles déterministes sur ce périmètre. Ce constat ne prouve pas l’absence d’opportunité."] };
  built.internal.sections.push(recommendations);
  built.client.sections.push(recommendations);
  if (findings.length > 12) built.client.sections.push({ title: "Périmètre des recommandations", lines: [`Les 12 premiers contrôles sur ${findings.length} sont présentés, dans l’ordre de priorité.`] });
  const partial = data.period.includesToday || sumCampaigns(data.campaigns).incomplete.length > 0 || (data.campaigns.some(row => row.localServices) && !data.leads?.available);
  // Le builder existant sépare Search et Local Services et conserve les nulls des métriques
  // non renvoyées. Les lignes de détail et leur contexte sont figées dans cette version.
  return {
    source: "google_ads", state: partial ? "partial" : "available",
    lines: [`${data.campaigns.length} campagne(s) du compte associé, tous statuts et tous types. Google Ads consulté en lecture seule.`],
    evidence: [`Compte : ${data.account.id}. Devise : ${data.account.currency}. Fuseau : ${data.account.timezone}.`, `Période : ${input.start} → ${input.end}. Lecture le ${data.fetchedAt}.`],
    internalSections: built.internal.sections, clientSections: built.client.sections,
  };
}

/** Dimensions stockées uniquement si propriété ET période effectivement mesurée correspondent. */
async function searchConsoleDetails(input: ProfessionalReportRequest, property: string) {
  const snapshot = await db().from("metric_snapshots").select("data,fetched_at").eq("client_id", input.clientId).eq("provider", "search-console").eq("metric_key", "performance")
    .eq("period_start", input.start).eq("period_end", input.end).order("fetched_at", { ascending: false }).limit(1);
  const data = record(snapshot.data?.[0]?.data);
  const exact = !snapshot.error && data.version === SEARCH_CONSOLE_SNAPSHOT_VERSION && data.property === property && record(data.period).start === input.start && record(data.period).end === input.end;
  const lines: string[] = [], evidence: string[] = [];
  let partial = !exact;
  if (!exact) lines.push("Requêtes et pages SEO : aucun instantané vérifiable pour cette propriété et cette période exacte. Les périodes décalées par le délai de consolidation Google ne sont pas substituées.");
  else {
    const sections = record(data.sections);
    for (const [key, label] of [["queries", "Requêtes principales"], ["pages", "Pages les plus visibles"]] as const) {
      const rows = Array.isArray(data[key]) ? (data[key] as unknown[]).map(record).filter(row => typeof row.key === "string" && finite(row.clicks) && finite(row.impressions)) : [];
      if (record(sections[key]).ok !== true) { lines.push(`${label} : indisponibles dans cet instantané.`); partial = true; continue; }
      if (!rows.length) { lines.push(`${label} : aucune ligne renvoyée ; certaines requêtes peuvent être anonymisées par Google.`); continue; }
      lines.push(`${label} (5 premiers résultats, liste non exhaustive) : ${rows.slice(0, 5).map(row => `${row.key} — ${number(row.clicks as number)} clics, ${number(row.impressions as number)} impressions${finite(row.position) ? `, position ${number(row.position)}` : ""}`).join(" ; ")}.`);
    }
    evidence.push(`Dimensions Search Console enregistrées le ${snapshot.data![0].fetched_at}.`);
  }
  // La propriété n’existe pas sur la ligne d’opportunité : passer par l’analyse est
  // indispensable pour exclure celles d’une ancienne propriété rattachée au même client.
  const analyses = await db().from("seo_opportunity_analyses").select("id").eq("client_id", input.clientId).eq("property", property).eq("status", "succeeded")
    .eq("period_start", input.start).eq("period_end", input.end).order("finished_at", { ascending: false }).limit(20);
  if (analyses.error) { lines.push("Opportunités SEO V2 : stockage indisponible ; le rapport conserve les données Search Console disponibles."); partial = true; }
  else if (!analyses.data?.length) { lines.push("Aucune analyse d’opportunités SEO enregistrée pour cette propriété et ces dates ; aucune recommandation artificielle n’a été ajoutée."); partial = true; }
  else {
    const opportunities = await db().from("seo_keyword_opportunities").select("keyword,priority,confidence,verified,rationale,recommended_action,metrics,last_analysis_id,status")
      .eq("client_id", input.clientId).eq("period_start", input.start).eq("period_end", input.end).in("last_analysis_id", analyses.data.map(row => row.id))
      .order("last_detected_at", { ascending: false }).limit(51);
    if (opportunities.error) { lines.push("Opportunités SEO : lecture indisponible pour cette période."); partial = true; }
    else {
      const priority = { high: 0, medium: 1, low: 2 };
      const rows = (opportunities.data ?? []).filter(row => row.status !== "dismissed" && row.status !== "done").sort((a, b) => priority[a.priority] - priority[b.priority]);
      if (!rows.length) lines.push("Aucune opportunité SEO active dans les analyses enregistrées de cette période.");
      else for (const row of rows.slice(0, 5)) {
        const metrics = record(row.metrics);
        lines.push(`Opportunité SEO — ${row.keyword} : ${row.rationale} Action proposée : ${row.recommended_action} ${row.verified && finite(metrics.clicks) && finite(metrics.impressions) ? `Preuves Search Console : ${number(metrics.clicks)} clics, ${number(metrics.impressions)} impressions.` : "Hypothèse de contexte métier, sans métrique Google vérifiée."} Confiance ${row.confidence === "high" ? "élevée" : row.confidence === "medium" ? "moyenne" : "faible"}.`);
      }
      if ((opportunities.data?.length ?? 0) >= 51 || analyses.data.length >= 20) { lines.push("Lecture des opportunités plafonnée : sélection partielle."); partial = true; }
    }
  }
  return { lines, evidence, partial };
}

async function searchConsole(input: ProfessionalReportRequest): Promise<ProfessionalSourceResult> {
  const linked = await connection(input, "search-console");
  const property = normalizeProperty(record(linked?.metadata).property);
  if (!property) return { source: "search_console", state: "not_connected", lines: ["Aucune propriété Search Console n’est associée à ce client."], evidence: [] };
  const length = dayCount(input);
  const result = await db().from("search_console_daily_metrics").select("client_id,property,date,clicks,impressions,position,fetched_at")
    .eq("client_id", input.clientId).eq("property", property).gte("date", addDays(input.start, -length)).lte("date", input.end).order("date", { ascending: true }).limit(800);
  if (result.error) return failure("search_console", "Historique quotidien Search Console indisponible. Vérifiez la synchronisation et la migration de cette source.");
  const rows = result.data ?? [];
  if (rows.some(row => row.client_id !== input.clientId || row.property !== property)) return failure("search_console", "L’historique reçu ne correspond pas au client et à sa propriété ; aucune donnée publiée.");
  const valid = rows.filter(row => finite(row.clicks) && finite(row.impressions) && (row.position === null || finite(row.position)));
  const unique = [...new Map(valid.map(row => [row.date, row])).values()];
  const current = unique.filter(row => row.date >= input.start && row.date <= input.end);
  if (!current.length) return failure("search_console", "Aucun jour synchronisé dans la période demandée. Les résultats d’une autre période ne sont pas utilisés.");
  const lines = searchConsoleReportLines({ property, days: unique }, input);
  if (valid.length !== rows.length) lines.push("Certaines lignes étaient incomplètes ou invalides et ont été exclues.");
  if (rows.length >= 800) lines.push("Limite de lecture atteinte (800 lignes) : l’historique peut être tronqué.");
  const details = await searchConsoleDetails(input, property);
  lines.push(...details.lines);
  const lastSync = current.map(row => row.fetched_at).filter(Boolean).sort().at(-1);
  return {
    source: "search_console", state: current.length < length || valid.length !== rows.length || rows.length >= 800 || details.partial ? "partial" : "available", lines,
    evidence: [`Propriété : ${property}.`, `Période demandée : ${input.start} → ${input.end} ; ${current.length}/${length} jours synchronisés (jours de Google Search Console, fuseau Pacifique).`, ...(lastSync ? [`Dernière collecte des jours inclus : ${lastSync}.`] : []), ...details.evidence],
  };
}

/** Contrôles échantillonnés : le ratio n’est jamais présenté comme un uptime continu. */
async function siteChecks(input: ProfessionalReportRequest) {
  const { since, until } = bounds(input);
  const rows: { ok: boolean; response_ms: number | null; checked_at: string }[] = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const result = await db().from("site_checks").select("ok,response_ms,checked_at").eq("client_id", input.clientId).gte("checked_at", since).lt("checked_at", until)
      .order("checked_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + 499);
    if (result.error) return { lines: ["Historique des contrôles du site indisponible."], partial: true, observed: false };
    rows.push(...(result.data ?? []));
    if (!result.data || result.data.length < 500) break;
  }
  const checks = rows.filter(row => inPeriod(row.checked_at, input) && typeof row.ok === "boolean");
  if (!checks.length) return { lines: ["Aucun contrôle du site enregistré dans cette période ; disponibilité non mesurée."], partial: false, observed: false };
  const successes = checks.filter(row => row.ok).length;
  const response = checks.flatMap(row => finite(row.response_ms) ? [row.response_ms] : []);
  const lines = [`Contrôles du site : ${successes}/${checks.length} réussis (${number(successes / checks.length * 100)} % des contrôles échantillonnés ; ce ratio n’est pas une mesure d’uptime continu).`];
  if (response.length) lines.push(`Temps de réponse moyen observé : ${number(response.reduce((a, b) => a + b, 0) / response.length)} ms sur ${response.length} contrôle(s).`);
  if (rows.length >= 5000) lines.push("Lecture plafonnée à 5 000 contrôles : résultats partiels.");
  return { lines, partial: rows.length >= 5000 || checks.length !== rows.length, observed: true };
}

async function website(input: ProfessionalReportRequest): Promise<ProfessionalSourceResult> {
  const checks = await siteChecks(input);
  let linked;
  try { linked = await connection(input, "vercel"); }
  catch { return { source: "website", state: checks.observed ? "partial" : "unavailable", lines: ["Association Vercel indisponible : aucune donnée Analytics reprise.", ...checks.lines], evidence: [`Période : ${input.start} → ${input.end}. Journées UTC pour les contrôles.`] }; }
  const projectId = record(linked?.metadata).project_id;
  const evidence = [`Période : ${input.start} → ${input.end}. Journées UTC pour le site et ses contrôles.`];
  if (typeof projectId !== "string" || !projectId) return {
    source: "website", state: checks.observed ? "partial" : "not_connected", lines: ["Vercel Analytics n’est pas associé à ce client.", ...checks.lines], evidence,
  };
  let payload: Record<string, unknown> | null = null;
  let stale = false;
  const synced = await syncVercelAnalytics(input.clientId, input).catch(() => null);
  if (synced?.ok) { payload = record(synced.data); evidence.push(`Lecture Analytics le ${new Date().toISOString()}.`); }
  if (!payload) {
    // Repli uniquement sur la même période, le même client ET le projet toujours associé.
    const cached = await db().from("metric_snapshots").select("data,fetched_at").eq("client_id", input.clientId).eq("provider", "vercel").eq("metric_key", "web_analytics")
      .eq("period_start", input.start).eq("period_end", input.end).order("fetched_at", { ascending: false }).limit(1);
    if (!cached.error && cached.data?.[0]) { payload = record(cached.data[0].data); stale = true; evidence.push(`Instantané enregistré le ${cached.data[0].fetched_at} ; actualisation indisponible.`); }
  }
  if (!payload || payload.version !== VERCEL_SNAPSHOT_VERSION || payload.projectId !== projectId || record(payload.period).start !== input.start || record(payload.period).end !== input.end || !finite(payload.visitors) || !finite(payload.pageviews)) {
    return { source: "website", state: checks.observed ? "partial" : "unavailable", lines: ["Aucun instantané Vercel vérifiable pour ce projet et ces dates ; aucun chiffre repris d’une autre période.", ...checks.lines], evidence };
  }
  evidence.push(`Projet Vercel : ${projectId}.`);
  const lines = [`Vercel Analytics : ${number(payload.visitors)} visiteurs et ${number(payload.pageviews)} pages vues.`, ...checks.lines];
  const sections = record(payload.sections);
  const failedBlocks = Object.entries(sections).filter(([, value]) => record(value).ok === false);
  const missingBlocks = ["topPages", "topReferrers", "devices", "events"].filter(key => record(sections[key]).ok !== true);
  if (failedBlocks.length || missingBlocks.length) lines.push("Certaines dimensions Analytics sont indisponibles ; elles ne sont pas remplacées par zéro.");
  for (const [key, label, value] of [["topPages", "Pages principales", "pageviews"], ["topReferrers", "Sources de trafic", "visitors"], ["devices", "Appareils", "visitors"], ["events", "Événements suivis", "count"]] as const) {
    if (record(sections[key]).ok !== true) { lines.push(`${label} : non disponible dans cet instantané.`); continue; }
    const raw = payload[key];
    const entries = Array.isArray(raw) ? raw.map(record).filter(row => typeof row.label === "string" && finite(row[value])) : [];
    if (entries.length) lines.push(`${label} (principaux résultats, liste limitée) : ${entries.slice(0, 5).map(row => `${row.label} (${number(row[value] as number)})`).join(", ")}.`);
    else if (key === "events") lines.push("Aucun événement personnalisé remonté par Vercel ; cela ne prouve pas l’absence de contacts ou de conversions.");
  }
  lines.push("Le taux de rebond et les conversions commerciales ne sont pas déduits des pages vues ou des événements.");
  return { source: "website", state: stale || checks.partial || failedBlocks.length > 0 || missingBlocks.length > 0 || input.end >= new Date().toISOString().slice(0, 10) ? "partial" : "available", lines, evidence };
}

async function activity(input: ProfessionalReportRequest): Promise<ProfessionalSourceResult> {
  const raw = await gatherReportInput(input.clientId, input, { syncWebsite: false });
  if (raw.client?.id !== input.clientId) return failure("activity", "L’activité collectée ne correspond pas à ce client.");
  const caps: [keyof ReportInput, number][] = [["tasks", 500], ["recommendations", 200], ["actions", 200], ["incidents", 200], ["runs", 500]];
  const capped = caps.filter(([key, cap]) => Array.isArray(raw[key]) && (raw[key] as unknown[]).length >= cap).map(([key]) => key);
  const undated = raw.tasks.filter(row => row.status === "Terminé" && !row.completed_at).length;
  // Aucune tâche sans completed_at, publication seulement approuvée, métrique d’une autre
  // période ou état actuel d’un projet n’est transformé en réalisation historique.
  const scoped: ReportInput = {
    ...raw, projects: [], publications: [], siteChecks: [], metrics: [], searchConsole: null,
    tasks: raw.tasks.filter(row => inPeriod(row.completed_at, input)),
    recommendations: raw.recommendations.filter(row => inPeriod(row.created_at, input)),
    actions: raw.actions.filter(row => row.status === "executed" && inPeriod(row.executed_at, input)),
    incidents: raw.incidents.filter(row => inPeriod(row.detected_at, input)),
    runs: raw.runs.filter(row => inPeriod(row.started_at, input)),
  };
  const built = buildReport("weekly", scoped, input.end);
  const lines = [`${scoped.tasks.length} tâche(s) terminée(s) avec date de réalisation et ${scoped.actions.length} action(s) exécutée(s) dans la période.`];
  const { since, until } = bounds(input);
  const deliveries = await db().from("publication_deliveries").select("id,publication_id,platform,published_at").eq("client_id", input.clientId).eq("status", "published")
    .gte("published_at", since).lt("published_at", until).order("published_at", { ascending: false }).limit(501);
  const deliveryRows = (deliveries.data ?? []).filter(row => inPeriod(row.published_at, input));
  if (deliveries.error) lines.push("Historique des diffusions indisponible : les contenus simplement approuvés ne sont pas comptés comme publiés.");
  else lines.push(`${deliveryRows.length} diffusion(s) avec date de publication effective${deliveryRows.length >= 501 ? " (lecture plafonnée à 501 : liste partielle)" : ""}. Les validations seules ne sont pas comptées.`);
  if (capped.length) lines.push(`Limites de collecte atteintes (${capped.join(", ")}) : l’activité présentée peut être partielle.`);
  if (undated) lines.push(`${undated} tâche(s) terminée(s) sans date de réalisation : exclue(s), car non attribuable(s) à cette période.`);
  return {
    source: "activity", state: capped.length || undated || deliveries.error || deliveryRows.length >= 501 ? "partial" : "available", lines,
    evidence: [`Activité du client ${input.clientId}, ${input.start} → ${input.end}, bornes UTC.`, "Les statuts des éléments sont leur état actuel ; seules les dates d’événement situées dans la période sont retenues."],
    internalSections: built.internal.sections, clientSections: built.client.sections,
  };
}

export async function gatherProfessionalSources(input: ProfessionalReportRequest): Promise<{ clientName: string; sources: ProfessionalSourceResult[] }> {
  await requireAdmin();
  const request = professionalReportSchema.parse(input);
  const client = await db().from("clients").select("id,name").eq("id", request.clientId).maybeSingle();
  if (client.error || !client.data || client.data.id !== request.clientId) throw new Error("Client introuvable ou indisponible ; aucun rapport préparé.");
  const readers = { google_ads: googleAds, search_console: searchConsole, website, activity };
  const sources = await Promise.all(request.sources.map(async source => {
    try { return await readers[source](request); }
    catch { return failure(source, "La collecte de cette source est indisponible. Vérifiez sa connexion et son stockage ; aucune valeur manquante n’a été remplacée par zéro."); }
  }));
  return { clientName: client.data.name, sources };
}
