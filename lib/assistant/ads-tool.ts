import "server-only";
// Outil Google Ads de l'assistant : MÊMES services et validations que l'onglet Campagnes
// (loadCampaignDashboard → requireAdmin, client ↔ compte, période dans le fuseau du compte ;
// parseFilters / writeFilters ; filterCampaigns / sumCampaigns). Lecture seule.
// Le contexte de conversation (client + filtres) est revalidé ici ; les paramètres fournis le modifient,
// les autres sont conservés.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { resolveClient } from "@/lib/assistant/clients";
import { normalize } from "@/lib/assistant/text";
import { loadCampaignDashboard, isGoogleAdsAgent, runGoogleAdsAnalysis } from "@/lib/integrations/google-ads/service";
import { DEFAULT_FILTERS, describeScope, filterCampaigns, parseFilters, sumCampaigns, writeFilters, type DashboardFilters } from "@/lib/integrations/google-ads/dashboard";
import { describeDates, type PeriodPreset } from "@/lib/integrations/google-ads/periods";
import { parseScope } from "@/lib/integrations/google-ads/scope";
import { listAgentsForClient } from "@/lib/agents/data";
import { prepareGoogleAdsReport } from "@/lib/reports/google-ads-service";
import type { Actor } from "@/lib/core/actor";
import type { PrepareResult, ToolOutcome } from "@/lib/assistant/orchestrator";
import type { AssistantContext } from "@/lib/assistant/views";

const db = () => getSupabaseServerClient();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getClientName(id: string): Promise<string | null> {
  if (!uuid.test(id)) return null;
  const { data, error } = await db().from("clients").select("id,name").eq("id", id).maybeSingle();
  if (error) throw new Error("client read");
  return data?.name ?? null;
}

type Client = { id: string; name: string };

/** Client visé : nommé dans la demande, sinon celui de la conversation, sinon l'unique client connecté à Google Ads. */
async function targetClient(input: Record<string, unknown>, context: AssistantContext): Promise<{ ok: true; client: Client } | { ok: false; text: string }> {
  if (typeof input.client === "string") {
    const found = await resolveClient(input.client);
    return found.ok ? { ok: true, client: { id: found.id, name: found.name } } : { ok: false, text: found.message };
  }
  if (context.clientId) {
    const name = await getClientName(context.clientId);
    if (name) return { ok: true, client: { id: context.clientId, name } };
  }
  const { data, error } = await db().from("client_connections").select("client_id,client:clients(id,name)").eq("provider", "google_ads").eq("status", "connected").limit(20);
  if (error) throw new Error("connections read");
  const clients = (data ?? []).map((row) => row.client as unknown as Client | null).filter((client): client is Client => Boolean(client?.id));
  if (clients.length === 1) return { ok: true, client: clients[0] };
  if (!clients.length) return { ok: false, text: "Aucun client n’a de compte Google Ads connecté. Configurez-le depuis la fiche client → Agents." };
  return { ok: false, text: `Pour quel client ? Comptes Google Ads connectés : ${clients.slice(0, 8).map((client) => client.name).join(", ")}.` };
}

/** Filtres demandés = filtres de la vue courante (même client) + paramètres fournis. Changer de client conserve période, statut, types et comparaison, pas la sélection de campagnes. */
export function mergeAdsFilters(input: Record<string, unknown>, context: AssistantContext, clientId: string): DashboardFilters {
  const inView = context.view === "ads_campaigns" && typeof context.adsQuery === "string";
  const base = inView ? parseFilters(new URLSearchParams(context.adsQuery)) : structuredClone(DEFAULT_FILTERS);
  if (context.clientId !== clientId) { base.campaigns = []; delete base.includeUntracked; }
  if (typeof input.period === "string") {
    const preset = input.period as PeriodPreset;
    base.period = preset === "day" ? { preset, date: input.date as string | undefined } : preset === "custom" ? { preset, start: input.start as string | undefined, end: input.end as string | undefined } : { preset };
  }
  if (typeof input.compare === "boolean") base.compare = input.compare;
  if (input.status === "enabled" || input.status === "paused" || input.status === "all") base.status = input.status;
  if (Array.isArray(input.types)) base.types = [...new Set(input.types as string[])];
  return base;
}

/** Noms ou identifiants de campagnes → identifiants ; une désignation ambiguë ou inconnue est signalée, jamais devinée. */
export function resolveCampaigns(terms: string[], rows: { id: string; name: string }[]): { ok: true; ids: string[] } | { ok: false; text: string } {
  const ids: string[] = [];
  for (const term of terms) {
    const byId = rows.find((row) => row.id === term.trim());
    if (byId) { ids.push(byId.id); continue; }
    const wanted = normalize(term);
    const exact = rows.filter((row) => normalize(row.name) === wanted);
    const partial = exact.length ? exact : rows.filter((row) => normalize(row.name).includes(wanted));
    if (partial.length === 1) { ids.push(partial[0].id); continue; }
    if (!partial.length) return { ok: false, text: `Aucune campagne ne correspond à « ${term} ».` };
    return { ok: false, text: `Plusieurs campagnes correspondent à « ${term} » : ${partial.slice(0, 5).map((row) => row.name).join(", ")}. Laquelle ?` };
  }
  return { ok: true, ids: [...new Set(ids)] };
}

export async function adsCampaignsTool(input: Record<string, unknown>, context: AssistantContext): Promise<ToolOutcome> {
  const target = await targetClient(input, context);
  if (!target.ok) return { ok: false, text: target.text };
  const { client } = target;
  const filters = mergeAdsFilters(input, context, client.id);
  const loaded = await loadCampaignDashboard(client.id, filters);
  if (!loaded.ok) return { ok: false, text: `${client.name} : ${loaded.message}`, context: { clientId: client.id, clientName: client.name } };
  const { data } = loaded;
  if (Array.isArray(input.campaigns)) {
    const resolved = resolveCampaigns(input.campaigns as string[], data.campaigns);
    if (!resolved.ok) return { ok: false, text: resolved.text };
    filters.campaigns = resolved.ids;
    // Une désignation explicite est une demande de consulter ces campagnes, y compris hors suivi.
    filters.includeUntracked = true;
  }
  const rows = filterCampaigns(data.campaigns, filters, data.tracking?.ids ?? null);
  const totals = sumCampaigns(rows);
  const money = (value: number | null) => value === null ? "indisponible" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: data.account.currency }).format(value);
  const count = (value: number | null) => value === null ? "indisponible" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
  const scope = `${describeScope(rows, filters)} · ${describeDates(data.period)}`;
  const text = rows.length
    ? `${client.name} — ${scope} : ${money(totals.metrics.cost)} dépensés, ${count(totals.metrics.clicks)} clics, ${count(totals.metrics.conversions)} conversions${totals.incomplete.length ? " (total partiel)" : ""}.${filters.compare ? " Comparaison avec la période précédente affichée." : ""}${data.period.includesToday ? " Données du jour incomplètes." : ""}`
    : `${client.name} — aucune campagne ne correspond à ces filtres (${scope}).`;
  const query = writeFilters(new URLSearchParams(), filters).toString();
  return {
    ok: true, text,
    links: [{ label: "Onglet Campagnes", href: `/clients/${client.id}?tab=ads${query ? `&${query}` : ""}` }],
    view: { type: "ads_campaigns", title: `Campagnes Google Ads — ${client.name}`, clientId: client.id, clientName: client.name, filters, data, link: { label: "Ouvrir l’onglet Campagnes", href: `/clients/${client.id}?tab=ads${query ? `&${query}` : ""}` } },
    context: { clientId: client.id, clientName: client.name, view: "ads_campaigns", adsQuery: query },
  };
}

/** Avant de PROPOSER un rapport ou une analyse : périmètre strict et client existant (nom canonique repris). */
export async function prepareAdsWrite(input: Record<string, unknown>): Promise<PrepareResult> {
  const scope = parseScope({ start: input.start, end: input.end, status: input.status, types: input.types, campaignIds: input.campaignIds });
  if (!scope) return { ok: false, question: "Périmètre invalide : affichez à nouveau les campagnes puis relancez la demande." };
  const name = await getClientName(String(input.client_id));
  if (!name) return { ok: false, question: "Client introuvable : précisez le client." };
  return { ok: true, input: { ...input, ...scope, client_name: name } };
}

/** Exécution APRÈS confirmation explicite : mêmes services que l'onglet Campagnes. */
export async function runAdsWrite(actor: Actor, tool: "ads_prepare_report" | "ads_run_analysis", input: Record<string, unknown>): Promise<ToolOutcome> {
  const scope = parseScope({ start: input.start, end: input.end, status: input.status, types: input.types, campaignIds: input.campaignIds });
  const clientId = String(input.client_id);
  if (!scope || !uuid.test(clientId)) return { ok: false, text: "Périmètre invalide : rien n’a été modifié." };
  if (tool === "ads_prepare_report") {
    const outcome = await prepareGoogleAdsReport(actor, clientId, scope);
    return outcome.ok ? { ok: true, text: "Rapport Google Ads enregistré pour ce périmètre : il attend votre relecture avant tout envoi.", links: [{ label: "Relire le rapport", href: `/reports/${outcome.id}` }] } : { ok: false, text: outcome.message };
  }
  const assignment = (await listAgentsForClient(clientId)).find((item) => item.enabled && isGoogleAdsAgent(item.agent));
  if (!assignment) return { ok: false, text: "Aucun agent Google Ads (type google-ads) actif et assigné à ce client." };
  const result = await runGoogleAdsAnalysis(assignment.agent_id, clientId, { scope, ...(input.mode === "ai" ? { mode: "ai" as const } : {}) });
  return { ok: Boolean(result.ok), text: result.message ?? "Analyse terminée.", links: result.recommendationId ? [{ label: "Voir la recommandation", href: `/recommendations/${result.recommendationId}` }] : [{ label: "Agent Ads", href: `/agents/${assignment.agent_id}` }] };
}
