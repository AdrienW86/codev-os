// Assistant central — résultats interactifs : vues structurées serveur, contexte de conversation,
// demandes de suivi, changement de client, garde-fous d'écriture et de voix, permissions.
// Fournisseurs SIMULÉS (aucun appel réseau, aucune base réelle, aucun compte Google Ads réel).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as zod from "zod";
import { loadTs } from "./helpers/load-ts.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const TODAY = "2026-10-10";
const clientA = { id: "d94e386a-653e-478b-80f1-05d442baed92", name: "Protection Nuisibles" };
const clientB = { id: "2e3bf5a8-040e-4d12-91be-6a2da2f99ef0", name: "Jrenov" };

const periods = loadTs("lib/integrations/google-ads/periods.ts");
const dashboard = loadTs("lib/integrations/google-ads/dashboard.ts", { "./periods": periods });
const scopes = loadTs("lib/integrations/google-ads/scope.ts", { "./periods": periods });
const text = loadTs("lib/assistant/text.ts");
const adsIntents = loadTs("lib/assistant/ads-intents.ts", { "@/lib/assistant/text": text });
const tools = loadTs("lib/assistant/tools.ts", { zod, "@/lib/integrations/google-ads/periods": periods });
const intents = loadTs("lib/assistant/intents.ts", { "@/lib/assistant/text": text, "@/lib/assistant/ads-intents": adsIntents });
const orchestrator = loadTs("lib/assistant/orchestrator.ts", { "@/lib/assistant/tools": tools, "@/lib/assistant/intents": intents, "@/lib/assistant/ads-intents": adsIntents });
const views = loadTs("lib/assistant/views.ts", { zod });

const adsContext = (query = "") => ({ clientId: clientA.id, clientName: clientA.name, view: "ads_campaigns", adsQuery: query });
function deps(overrides = {}) {
  const calls = [];
  return { calls, deps: { provider: null, today: TODAY, execute: async (name, input, context) => {
    calls.push([name, plain(input), plain(context ?? {})]);
    if (name === "ads_campaigns") return { ok: true, text: "Protection Nuisibles — 1 campagne Local Services active · du 3 oct. 2026 au 9 oct. 2026 : 10,00 € dépensés.", view: { type: "metrics", title: "x", items: [] }, context: adsContext("ads_period=last_7&ads_types=LOCAL_SERVICES") };
    return { ok: true, text: `résultat ${name}` };
  }, prepare: async (_name, input) => ({ ok: true, input: { ...input, client_name: "Protection Nuisibles" } }), ...overrides } };
}
const user = (content) => [{ role: "user", content }];

// --- Lecture des demandes ----------------------------------------------------------------------

test("Google Ads requests: new view, follow-ups on the current view and client change", () => {
  const parse = (message, context = {}) => plain(intents.parseIntent(message, TODAY, context));
  assert.deepEqual(parse("Montre les campagnes Google Ads de Protection Nuisibles"), { tool: "ads_campaigns", input: { client: "Protection Nuisibles" } });
  assert.deepEqual(parse("Quelles sont les dépenses Google Ads pour Jrenov sur 7 jours ?"), { tool: "ads_campaigns", input: { client: "Jrenov", period: "last_7" } });
  assert.deepEqual(parse("Affiche les campagnes de la semaine dernière"), { tool: "ads_campaigns", input: { period: "last_week" } });
  // Suites : seuls les paramètres changés sont transmis, le serveur conserve le reste.
  assert.deepEqual(parse("et sur 7 jours ?", adsContext()), { tool: "ads_campaigns", input: { period: "last_7" } });
  assert.deepEqual(parse("uniquement Local Services", adsContext()), { tool: "ads_campaigns", input: { types: ["LOCAL_SERVICES"] } });
  assert.deepEqual(parse("compare avec la période précédente", adsContext()), { tool: "ads_campaigns", input: { compare: true } });
  assert.deepEqual(parse("et en pause ?", adsContext()), { tool: "ads_campaigns", input: { status: "paused" } });
  assert.deepEqual(parse("et le mois dernier ?", adsContext()), { tool: "ads_campaigns", input: { period: "last_month" } });
  assert.deepEqual(parse("du 2026-09-01 au 2026-09-30", adsContext()), { tool: "ads_campaigns", input: { period: "custom", start: "2026-09-01", end: "2026-09-30" } });
  assert.deepEqual(parse("et pour Jrenov ?", adsContext()), { tool: "ads_campaigns", input: { client: "Jrenov" } });
  // Sans vue courante, une suite isolée n'est pas devinée.
  assert.equal(parse("et sur 7 jours ?"), null);
  assert.match(parse("sur 10 jours", adsContext()).clarify, /7, 14, 30 ou 90/);
  // Les autres intentions restent prioritaires sur leur terrain.
  assert.equal(parse("vérifie les campagnes Ads de Jrenov").tool, "run_check");
  assert.equal(parse("Crée une tâche vérifier les campagnes Ads pour Jrenov demain").tool, "create_task");
  assert.equal(parse("fais le point sur Jrenov", adsContext()).tool, "client_overview");
});

test("Google Ads changes are refused and a bare « oui » never confirms anything", () => {
  for (const message of ["Mets en pause la campagne Search", "augmente le budget de 20 %", "réactive les campagnes Ads", "baisse les enchères"]) assert.equal(adsIntents.isAdsMutationRequest(message), true, message);
  for (const message of ["affiche les campagnes en pause", "et en pause ?", "uniquement les campagnes actives", "change la période des campagnes", "crée une tâche : mettre en pause la campagne Search pour Jrenov"]) assert.equal(adsIntents.isAdsMutationRequest(message), false, message);
  for (const message of ["oui", "Oui !", "confirme", "vas-y", "ok", "je confirme"]) assert.equal(adsIntents.isBareConfirmation(message), true, message);
  assert.equal(adsIntents.isBareConfirmation("oui, affiche les campagnes"), false);
});

// --- Orchestrateur ----------------------------------------------------------------------------

test("follow-ups reuse the server-validated context and return the server view and new context", async () => {
  const { calls, deps: d } = deps({ context: adsContext("ads_period=last_30") });
  const reply = plain(await orchestrator.respond(user("uniquement Local Services"), d));
  assert.deepEqual(calls[0].slice(0, 2), ["ads_campaigns", { types: ["LOCAL_SERVICES"] }]);
  assert.equal(calls[0][2].adsQuery, "ads_period=last_30");
  assert.equal(reply.view.type, "metrics");
  assert.equal(reply.context.adsQuery, "ads_period=last_7&ads_types=LOCAL_SERVICES");
  assert.match(reply.reply, /Local Services .* du 3 oct\. 2026 au 9 oct\. 2026/);
});

test("write guards: Google Ads changes and bare confirmations execute nothing, typed or dictated", async () => {
  for (const via of ["text", "voice"]) {
    const { calls, deps: d } = deps({ via, provider: { id: "openai", model: "m", complete: async () => { throw new Error("must not be called"); } } });
    assert.match((await orchestrator.respond(user("Mets en pause la campagne Search"), d)).reply, /lecture seule/);
    const confirm = plain(await orchestrator.respond([{ role: "assistant", content: "Je propose : créer la tâche." }, { role: "user", content: "oui" }], d));
    assert.match(confirm.reply, /bouton « Confirmer »/);
    assert.equal(confirm.keepProposal, true);
    assert.equal(confirm.proposal, undefined);
    assert.equal(calls.length, 0);
  }
});

test("a dictated write is only proposed, with the transcription shown for verification", async () => {
  const { calls, deps: d } = deps({ via: "voice" });
  const reply = plain(await orchestrator.respond(user("Génère le rapport hebdomadaire pour Jrenov"), d));
  assert.equal(calls.length, 0);
  assert.equal(reply.proposal.tool, "generate_report");
  assert.equal(reply.proposal.heard, "Génère le rapport hebdomadaire pour Jrenov");
  assert.match(reply.reply, /J’ai compris : « Génère le rapport hebdomadaire pour Jrenov »/);
  // Une dictée ambiguë obtient une question, jamais une proposition.
  const vague = plain(await orchestrator.respond(user("crée une tâche relancer le devis la semaine prochaine pour Jrenov"), d));
  assert.equal(vague.proposal, undefined);
  assert.match(vague.reply, /date précise/);
});

test("AI mode: the model picks a tool and parameters with the current context; the view still comes from the server", async () => {
  const systems = [];
  const provider = { id: "openai", model: "m", complete: async (input) => {
    systems.push(input.system);
    if (!input.toolResults?.length) return { text: "", toolCalls: [{ id: "c1", name: "ads_campaigns", arguments: { period: "last_7" } }] };
    return { text: "<script>alert(1)</script> Voici les campagnes.", toolCalls: [] };
  } };
  const { calls, deps: d } = deps({ provider, context: adsContext("ads_types=SEARCH") });
  const reply = plain(await orchestrator.respond(user("et sur 7 jours ?"), d));
  assert.match(systems[0], /Vue courante : campagnes Google Ads de Protection Nuisibles \(filtres : ads_types=SEARCH\)/);
  assert.match(systems[0], /LECTURE SEULE/);
  assert.deepEqual(calls[0].slice(0, 2), ["ads_campaigns", { period: "last_7" }]);
  assert.equal(reply.view.type, "metrics"); // vue produite par l'outil serveur
  assert.equal(typeof reply.reply, "string"); // le texte du modèle reste du texte (rendu échappé par React)
  // Paramètres hors schéma (SQL, HTML) : refusés avant toute exécution.
  const injected = { id: "openai", model: "m", complete: async (input) => input.toolResults?.length ? { text: "Paramètres refusés.", toolCalls: [] } : { text: "", toolCalls: [{ id: "c2", name: "ads_campaigns", arguments: { sql: "SELECT * FROM campaign" } }] } };
  const second = deps({ provider: injected });
  await orchestrator.respond(user("campagnes"), second.deps);
  assert.equal(second.calls.length, 0);
});

test("view buttons only produce validated proposals; confirmation stays a separate explicit request", async () => {
  const { calls, deps: d } = deps();
  const scope = { client_id: clientA.id, start: "2026-09-01", end: "2026-09-30", status: "enabled", types: ["SEARCH"], campaignIds: ["123"] };
  const proposal = plain(await orchestrator.proposeFromView("ads_prepare_report", scope, d));
  assert.equal(proposal.proposal.tool, "ads_prepare_report");
  assert.match(proposal.proposal.summary, /Préparer un rapport Google Ads pour Protection Nuisibles \(1 campagne, du 1 sept\. 2026 au 30 sept\. 2026\)/);
  assert.equal(calls.length, 0);
  assert.match((await orchestrator.proposeFromView("ads_campaigns", {}, d)).reply, /invalide/);
  assert.match((await orchestrator.proposeFromView("ads_run_analysis", { ...scope, campaignIds: ["1 OR 1=1"] }, d)).reply, /invalide/);
  await orchestrator.confirmProposal("ads_prepare_report", scope, d);
  assert.deepEqual(calls.map((call) => call[0]), ["ads_prepare_report"]);
  const simulation = deps({ simulation: true });
  assert.match((await orchestrator.proposeFromView("ads_prepare_report", scope, simulation.deps)).reply, /Simulation/);
});

// --- Outil Google Ads (serveur) ---------------------------------------------------------------

const metrics = { impressions: 100, clicks: 10, cost: 25, conversions: 1, conversionValue: 0, ctr: 0.1, averageCpc: 2.5, costPerConversion: 25 };
const campaigns = [
  { id: "123", name: "Search Toulouse", status: "ENABLED", type: "SEARCH", subType: null, localServices: false, budget: { amount: 10, shared: false, period: "DAILY" }, hasActivity: true, metrics, previous: null },
  { id: "124", name: "Search Albi", status: "ENABLED", type: "SEARCH", subType: null, localServices: false, budget: { amount: 5, shared: false, period: "DAILY" }, hasActivity: true, metrics, previous: null },
  { id: "789", name: "LSA", status: "ENABLED", type: "LOCAL_SERVICES", subType: null, localServices: true, budget: { amount: null, shared: null, period: null }, hasActivity: true, metrics: { ...metrics, cost: 40, conversions: null }, previous: null },
];
function adsTool({ connected = [clientA], clients = [clientA, clientB], load = null, assignments = [] } = {}) {
  const loads = [], writes = [];
  const supabase = { from: () => {
    const filters = {};
    const query = {
      select: () => query, eq: (column, value) => { filters[column] = value; return query; }, limit: async () => ({ data: connected.map((client) => ({ client_id: client.id, client })), error: null }),
      maybeSingle: async () => ({ data: clients.find((client) => client.id === filters.id) ?? null, error: null }),
    };
    return query;
  } };
  const resolveClient = async (name) => {
    const matches = clients.filter((client) => client.name.toLowerCase().includes(name.toLowerCase()));
    return matches.length === 1 ? { ok: true, ...matches[0] } : { ok: false, message: matches.length ? `Plusieurs clients correspondent à « ${name} ».` : `Aucun client ne correspond à « ${name} ».` };
  };
  const adsModule = loadTs("lib/assistant/ads-tool.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => supabase },
    "@/lib/assistant/clients": { resolveClient },
    "@/lib/assistant/text": text,
    "@/lib/integrations/google-ads/service": {
      loadCampaignDashboard: async (clientId, filters) => { loads.push([clientId, plain(filters)]); return load ?? { ok: true, data: { account: { id: "1234567890", name: "Compte", currency: "EUR", timezone: "Europe/Paris" }, period: { start: "2026-10-03", end: "2026-10-09", days: 7, includesToday: false, today: TODAY, preset: filters.period.preset }, previousPeriod: null, campaigns, accountTotals: metrics, accountPrevious: null, leads: null, fetchedAt: "x" } }; },
      isGoogleAdsAgent: (agent) => agent?.agent_type === "google-ads",
      runGoogleAdsAnalysis: async (...args) => { writes.push(["analysis", ...plain(args)]); return { ok: true, message: "Analyse réelle (règles déterministes, sans IA)." }; },
    },
    "@/lib/integrations/google-ads/dashboard": dashboard, "@/lib/integrations/google-ads/periods": periods, "@/lib/integrations/google-ads/scope": scopes,
    "@/lib/agents/data": { listAgentsForClient: async () => assignments },
    "@/lib/reports/google-ads-service": { prepareGoogleAdsReport: async (...args) => { writes.push(["report", ...plain(args)]); return { ok: true, id: "rep-1", version: 1 }; } },
  });
  return { module: adsModule, loads, writes };
}

test("the Ads tool reuses the dashboard services, keeps the context and always states its scope", async () => {
  const { module, loads } = adsTool();
  const first = plain(await module.adsCampaignsTool({ client: "Protection", period: "last_7" }, {}));
  assert.deepEqual(loads[0], [clientA.id, { period: { preset: "last_7" }, compare: false, status: "enabled", types: [], campaigns: [] }]);
  assert.equal(first.view.type, "ads_campaigns");
  assert.equal(first.view.clientId, clientA.id);
  assert.match(first.text, /^Protection Nuisibles — 3 campagnes \(2 types\) actives · du 3 oct\. 2026 au 9 oct\. 2026 : 90,00\s€ dépensés, 30 clics, 2 conversions \(total partiel\)\.$/);
  assert.deepEqual(first.context, { clientId: clientA.id, clientName: clientA.name, view: "ads_campaigns", adsQuery: "ads_period=last_7" });
  assert.equal(first.view.link.href, `/clients/${clientA.id}?tab=ads&ads_period=last_7`);

  // « uniquement Local Services » : période conservée, type remplacé, même client.
  const follow = plain(await module.adsCampaignsTool({ types: ["LOCAL_SERVICES"] }, first.context));
  assert.deepEqual(loads[1][1], { period: { preset: "last_7" }, compare: false, status: "enabled", types: ["LOCAL_SERVICES"], campaigns: [] });
  assert.match(follow.text, /1 campagne Local Services active/);
  assert.equal(follow.context.adsQuery, "ads_period=last_7&ads_types=LOCAL_SERVICES");

  // Sélection de campagnes par nom : unique → identifiant ; ambiguë ou inconnue → question, sans vue.
  const one = plain(await module.adsCampaignsTool({ campaigns: ["toulouse"] }, first.context));
  assert.deepEqual(one.view.filters.campaigns, ["123"]);
  const ambiguous = plain(await module.adsCampaignsTool({ campaigns: ["search"] }, first.context));
  assert.match(ambiguous.text, /Plusieurs campagnes correspondent à « search » : Search Toulouse, Search Albi/);
  assert.equal(ambiguous.view, undefined);
  assert.match(plain(await module.adsCampaignsTool({ campaigns: ["Inconnue"] }, first.context)).text, /Aucune campagne/);
});

test("changing client keeps period, status, types and comparison but never the previous client's campaign selection", () => {
  const { module } = adsTool();
  const context = adsContext("ads_period=last_month&ads_compare=1&ads_status=all&ads_types=SEARCH&ads_campaigns=123");
  assert.deepEqual(plain(module.mergeAdsFilters({}, context, clientA.id)), { period: { preset: "last_month" }, compare: true, status: "all", types: ["SEARCH"], campaigns: ["123"] });
  assert.deepEqual(plain(module.mergeAdsFilters({ client: "Jrenov" }, context, clientB.id)), { period: { preset: "last_month" }, compare: true, status: "all", types: ["SEARCH"], campaigns: [] });
  assert.deepEqual(plain(module.mergeAdsFilters({ period: "custom", start: "2026-09-01", end: "2026-09-30", types: [] }, context, clientA.id)).period, { preset: "custom", start: "2026-09-01", end: "2026-09-30" });
  // Contexte d'une autre vue : filtres par défaut.
  assert.deepEqual(plain(module.mergeAdsFilters({}, { clientId: clientA.id }, clientA.id)), plain(dashboard.DEFAULT_FILTERS));
});

test("ambiguous or missing client: the tool asks instead of guessing", async () => {
  const two = adsTool({ connected: [clientA, clientB] });
  const question = plain(await two.module.adsCampaignsTool({}, {}));
  assert.match(question.text, /Pour quel client \? Comptes Google Ads connectés : Protection Nuisibles, Jrenov/);
  assert.equal(question.view, undefined);
  assert.equal(two.loads.length, 0);
  assert.match(plain(await two.module.adsCampaignsTool({ client: "e" }, {})).text, /Plusieurs clients/);
  const none = adsTool({ connected: [] });
  assert.match(plain(await none.module.adsCampaignsTool({}, {})).text, /Aucun client n’a de compte Google Ads connecté/);
  // Contexte : client de la conversation revalidé en base ; un identifiant inconnu n'est pas utilisé.
  const ctx = adsTool({ connected: [clientA, clientB] });
  await ctx.module.adsCampaignsTool({}, { clientId: clientB.id, clientName: "nom fourni par le navigateur" });
  assert.equal(ctx.loads[0][0], clientB.id);
  assert.match(plain(await ctx.module.adsCampaignsTool({}, { clientId: "aaaaaaaa-0000-4000-8000-000000000001" })).text, /Pour quel client/);
});

test("dashboard errors are relayed as text without a stale view", async () => {
  const { module } = adsTool({ load: { ok: false, message: "Quota de l’API Google Ads atteint : réessayez dans quelques minutes." } });
  const reply = plain(await module.adsCampaignsTool({ client: "Protection" }, {}));
  assert.equal(reply.ok, false);
  assert.match(reply.text, /^Protection Nuisibles : Quota/);
  assert.equal(reply.view, undefined);
});

test("Ads writes are revalidated, run the dashboard's services and require the google-ads agent", async () => {
  const scope = { client_id: clientA.id, start: "2026-09-01", end: "2026-09-30", status: "enabled", types: [], campaignIds: ["123"] };
  const none = adsTool();
  assert.match((await none.module.runAdsWrite({ kind: "assistant", userId: "u" }, "ads_run_analysis", scope)).text, /Aucun agent Google Ads/);
  assert.equal(none.writes.length, 0);
  assert.match((await none.module.runAdsWrite({ kind: "assistant", userId: "u" }, "ads_prepare_report", { ...scope, end: "2026-08-01" })).text, /Périmètre invalide/);
  const ready = adsTool({ assignments: [{ agent_id: "agent-1", enabled: true, agent: { agent_type: "google-ads", name: "Agent Ads" } }] });
  await ready.module.runAdsWrite({ kind: "assistant", userId: "u" }, "ads_run_analysis", scope);
  await ready.module.runAdsWrite({ kind: "assistant", userId: "u" }, "ads_prepare_report", scope);
  assert.deepEqual(ready.writes.map((write) => write[0]), ["analysis", "report"]);
  assert.deepEqual(ready.writes[0][3].scope.campaignIds, ["123"]);
  const prepared = plain(await ready.module.prepareAdsWrite({ ...scope, client_name: "Nom libre" }));
  assert.equal(prepared.input.client_name, "Protection Nuisibles");
  assert.equal((await ready.module.prepareAdsWrite({ ...scope, client_id: "aaaaaaaa-0000-4000-8000-000000000001" })).ok, false);
});

// --- Vues, contexte et interface ----------------------------------------------------------------

test("context from the browser is strictly parsed; view links are restricted", () => {
  assert.deepEqual(plain(views.parseContext(adsContext("ads_period=last_7"))), adsContext("ads_period=last_7"));
  for (const invalid of [{ clientId: "1 OR 1=1" }, { ...adsContext(), extra: true }, { view: "sql" }, "context", [], { adsQuery: "x".repeat(2001) }]) assert.deepEqual(plain(views.parseContext(invalid)), {});
  for (const href of ["/clients/x?tab=ads", "https://example.com/a"]) assert.equal(views.isSafeHref(href), true, href);
  for (const href of ["javascript:alert(1)", "//evil.example", "data:text/html,x", "http://plain.example", "/\\evil", " /x"]) assert.equal(views.isSafeHref(href), false, href);
});

test("the result panel is a single accessible dialog that never renders model HTML", () => {
  const dialog = read("components/assistant/result-dialog.tsx");
  assert.match(dialog, /<dialog/);
  assert.match(dialog, /showModal\(\)/);
  assert.match(dialog, /aria-labelledby/);
  assert.match(dialog, /aria-label="Fermer le panneau de résultats"/);
  assert.match(dialog, /opener\.current/); // retour du focus
  assert.match(dialog, /overflow-y-auto overscroll-contain/); // défilement interne (mobile)
  assert.match(dialog, /h-dvh/); // plein écran sur smartphone
  const box = read("components/dashboard/assistant-command-box.tsx");
  assert.equal((box.match(/<ResultDialog/g) ?? []).length, 1, "un seul panneau");
  for (const source of [box, dialog, read("components/assistant/result-view.tsx"), read("components/assistant/use-assistant.ts")]) {
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML|eval\(|new Function/);
  }
  const session = read("components/assistant/use-assistant.ts");
  // Lecture vocale : la phrase de synthèse uniquement, jamais la vue.
  assert.match(session, /speak\(text,/);
  assert.doesNotMatch(session, /speak\([^)]*view/);
  assert.match(box, /Actualisation en cours… le résultat précédent est masqué/);
});

test("the assistant route keeps admin, same-origin and strict schemas for messages, proposals and confirmations", () => {
  const route = read("app/api/assistant/route.ts");
  assert.ok(route.indexOf("await requireAdmin();") < route.indexOf("parseContext("));
  assert.match(route, /checkSameOrigin\(/);
  assert.match(route, /parseContext\(parsed\.data\.context\)/);
  assert.match(route, /via: z\.enum\(\["text", "voice"\]\)/);
  assert.match(route, /proposeFromView\(/);
  // L'action serveur utilisée par la vue Ads vérifie elle-même la session admin.
  const actions = read("app/(cockpit)/clients/[id]/google-ads-actions.ts");
  assert.match(actions, /export async function loadGoogleAdsDashboardAction\(clientId: unknown, query: unknown\): Promise<DashboardResult> \{\r?\n  await requireAdmin\(\);/);
});
