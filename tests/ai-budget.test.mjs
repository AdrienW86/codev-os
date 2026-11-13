import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as asyncHooks from "node:async_hooks";
import { loadTs } from "./helpers/load-ts.mjs";

const recurrence = loadTs("lib/scheduler/recurrence.ts");
const budget = loadTs("lib/ai/budget.ts", { "@/lib/scheduler/recurrence": recurrence });
const C = "11111111-1111-4111-8111-111111111111";

test("plafond mensuel : défaut de sécurité, marge avant appel, dépense par agent, saisie bornée", () => {
  const empty = budget.budgetOf([], null);
  assert.equal(empty.cap, budget.DEFAULT_MONTHLY_CAP_EUR);
  assert.equal(empty.capIsDefault, true);
  assert.equal(empty.allowed, true);
  const lines = [{ source: "metered", agent: "blog", eur: 0.5 }, { source: "metered", agent: "blog", eur: 0.25 }, { source: "publications", agent: "publications", eur: 0.2 }, { source: "metered", agent: "visual", eur: -3 }];
  const b = budget.budgetOf(lines, 1);
  assert.equal(b.spent, 0.95);
  assert.equal(b.byAgent.blog, 0.75);
  assert.equal(b.byAgent.visual, 0, "valeur négative ignorée");
  assert.equal(b.allowed, true, "0,95 + marge 0,02 ≤ 1 €");
  assert.equal(budget.budgetOf(lines, 0.96).allowed, false, "0,95 + marge 0,02 > 0,96 € : appel refusé");
  assert.equal(budget.budgetOf(lines, 0.97).allowed, true, "égalité acceptée, sans erreur d'arrondi");
  assert.equal(budget.budgetOf([], 0).allowed, false, "plafond 0 = IA coupée pour ce client");
  assert.equal(budget.parseCap("12,5"), 12.5);
  assert.equal(budget.parseCap("0"), 0);
  assert.equal(budget.parseCap("250"), null);
  assert.equal(budget.parseCap("-1"), null);
  assert.equal(budget.parseCap("abc"), null);
  // Mois civil de Paris : le 1er novembre à 00:00 heure de Paris = 31 octobre 23:00 UTC.
  assert.equal(budget.monthStart(new Date("2026-11-11T20:00:00Z")).toISOString(), "2026-10-31T23:00:00.000Z");
});

function gateway({ usageRows = [], cap = null, missing = false, failRead = false, raw }) {
  const inserted = [];
  const query = (table) => {
    const chain = {
      select: () => chain, eq: () => chain, gte: () => chain, limit: () => chain,
      maybeSingle: () => Promise.resolve(table === "client_ai_budgets" ? { data: cap === null ? null : { monthly_cap_eur: cap }, error: null } : { data: null, error: null }),
      insert: (row) => { inserted.push(row); return Promise.resolve({ error: missing ? { code: "42P01" } : null }); },
      then: (resolve) => resolve(table === "ai_usage"
        ? (missing ? { data: null, error: { code: "42P01" } } : failRead ? { data: null, error: { code: "500" } } : { data: usageRows, error: null })
        : { data: [], error: null }),
    };
    return chain;
  };
  const db = { from: query, rpc: () => Promise.resolve({ data: 0, error: null }) };
  const metered = loadTs("lib/ai/metered.ts", {
    "node:async_hooks": asyncHooks,
    "@/lib/supabase/server": { getSupabaseServerClient: () => db },
    "@/lib/integrations/publications-openai": { structuredResponse: raw },
    "./budget": budget,
  });
  return { metered, inserted };
}

test("passerelle mesurée : appel refusé au-delà du plafond, journal après appel, hors périmètre inchangé", async () => {
  let calls = 0;
  const raw = async () => { calls++; return { value: { ok: 1 }, usage: { input_tokens: 10, output_tokens: 5, estimated_cost_eur: 0.001, model: "m" } }; };
  // Sous le plafond : appel lancé puis journalisé avec l'agent et le client du périmètre.
  const ok = gateway({ usageRows: [{ agent: "blog", estimated_cost_eur: 0.1 }], cap: 1, raw });
  await ok.metered.withAiScope({ agent: "blog", clientId: C }, () => ok.metered.structuredResponse("i", {}, {}));
  assert.equal(calls, 1);
  assert.equal(ok.inserted.length, 1);
  assert.equal(ok.inserted[0].agent, "blog");
  assert.equal(ok.inserted[0].client_id, C);
  // Plafond atteint : aucun appel au fournisseur, erreur reconnaissable.
  const over = gateway({ usageRows: [{ agent: "visual", estimated_cost_eur: 0.99 }], cap: 1, raw });
  await assert.rejects(over.metered.withAiScope({ agent: "visual", clientId: C }, () => over.metered.structuredResponse("i", {}, {})), (e) => over.metered.isBudgetExceeded(e));
  assert.equal(calls, 1, "aucun appel facturé au-delà du plafond");
  // Dépense illisible : refus (jamais d'appel à l'aveugle).
  const broken = gateway({ failRead: true, raw });
  await assert.rejects(broken.metered.withAiScope({ agent: "video", clientId: C }, () => broken.metered.structuredResponse("i", {}, {})));
  assert.equal(calls, 1);
  // Migration non appliquée : comportement d'avant (appel lancé, rien de bloqué).
  const legacy = gateway({ missing: true, raw });
  await legacy.metered.withAiScope({ agent: "blog", clientId: C }, () => legacy.metered.structuredResponse("i", {}, {}));
  assert.equal(calls, 2);
  // Hors périmètre (Publications, Photothèque) : appel direct, ni contrôle ni journal.
  const direct = gateway({ usageRows: [{ agent: "blog", estimated_cost_eur: 9 }], cap: 1, raw });
  await direct.metered.structuredResponse("i", {}, {});
  assert.equal(calls, 3);
  assert.equal(direct.inserted.length, 0);
});

test("Blog, Visuels et Vidéo passent par la passerelle mesurée, chacun dans son périmètre", () => {
  for (const [file, agent, fn] of [["lib/blog-agent/service.ts", "blog", "generateBlogArticle"], ["lib/visual-agent/service.ts", "visual", "generateVisual"], ["lib/video-agent/service.ts", "video", "generateAgentVideo"]]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /from '@\/lib\/ai\/metered'/, file);
    assert.doesNotMatch(source, /from '@\/lib\/integrations\/publications-openai'/, file);
    assert.match(source, new RegExp(`export function ${fn}\\([^)]*\\):Promise<\\w+>\\{return withAiScope\\(\\{agent:'${agent}',clientId\\}`), file);
  }
});

test("coût estimé d'un appel d'assistant : tarif connu, tarif prudent pour un modèle inconnu, jamais négatif", () => {
  // gpt-4.1-mini : 0,40 / 1,60 par million, marge × 1,25 (comme Publications).
  assert.equal(budget.estimateCallCostEur("gpt-4.1-mini", 1_000_000, 0), 0.5);
  assert.equal(budget.estimateCallCostEur("gpt-4.1-mini-2025", 0, 1_000_000), 2);
  assert.equal(budget.estimateCallCostEur("gpt-4.1", 1_000_000, 0), 2.5);
  assert.equal(budget.estimateCallCostEur("modele-inconnu", 1_000_000, 0), 12.5, "inconnu : tarif le plus élevé, jamais zéro");
  assert.equal(budget.estimateCallCostEur("claude-opus-5-5", 1_000_000, 1_000_000), 30, "Opus 5.5 : 4 $ + 20 $ × 1,25");
  assert.equal(budget.estimateCallCostEur("claude-sonnet-5-5", 0, 1_000_000), 12.5);
  assert.equal(budget.estimateCallCostEur("claude-sonnet-4-6", 1_000_000, 0), 3.75);
  assert.equal(budget.estimateCallCostEur("claude-fable-5-2", 1_000_000, 0), 10);
  assert.equal(budget.estimateCallCostEur("gpt-4.1-mini", -5, Number.NaN), 0);
});

test("assistant mesuré (Google Ads, SEO, Photothèque) : plafond avant l'appel, jetons journalisés après", async () => {
  let calls = 0;
  const provider = { id: "openai", model: "gpt-4.1-mini", ping: async () => {}, complete: async () => { calls++; return { text: "ok", toolCalls: [], usage: { inputTokens: 1000, outputTokens: 200 } }; } };
  const ok = gateway({ usageRows: [], cap: 1, raw: async () => ({}) });
  const wrapped = ok.metered.meteredProvider(provider);
  assert.equal(ok.metered.meteredProvider(null), null);
  const response = await ok.metered.withAiScope({ agent: "google-ads", clientId: C }, () => wrapped.complete({ system: "s", messages: [], tools: [] }));
  assert.equal(response.text, "ok");
  assert.equal(ok.inserted.length, 1);
  assert.equal(ok.inserted[0].agent, "google-ads");
  assert.equal(ok.inserted[0].input_tokens, 1000);
  assert.equal(ok.inserted[0].model, "gpt-4.1-mini");
  assert.ok(ok.inserted[0].estimated_cost_eur > 0);
  // Hors périmètre (assistant du cockpit) : ni contrôle ni journal.
  await wrapped.complete({ system: "s", messages: [], tools: [] });
  assert.equal(ok.inserted.length, 1);
  // Au plafond : aucun appel au fournisseur.
  const over = gateway({ usageRows: [{ agent: "seo", estimated_cost_eur: 1 }], cap: 1, raw: async () => ({}) });
  const blocked = over.metered.meteredProvider(provider);
  await assert.rejects(over.metered.withAiScope({ agent: "seo", clientId: C }, () => blocked.complete({ system: "s", messages: [], tools: [] })), (e) => over.metered.isBudgetExceeded(e));
  assert.equal(calls, 2);
  // Fournisseur sans jetons renvoyés : rien n'est inventé.
  const silent = gateway({ usageRows: [], cap: 1, raw: async () => ({}) });
  const quiet = silent.metered.meteredProvider({ ...provider, complete: async () => ({ text: "", toolCalls: [] }) });
  await silent.metered.withAiScope({ agent: "seo", clientId: C }, () => quiet.complete({ system: "s", messages: [], tools: [] }));
  assert.equal(silent.inserted.length, 0);
});

test("Google Ads, SEO et Photothèque appellent l'assistant via la passerelle mesurée", () => {
  for (const [file, agent] of [["lib/integrations/google-ads/recommendation-core.ts", "google-ads"], ["lib/seo/conversation.ts", "seo"], ["lib/whatsapp/library.ts", "media-library"]]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /meteredProvider\(selectAIProvider\(\)\)/, file);
    assert.match(source, new RegExp(`withAiScope\\(\\{ agent: "${agent}", clientId`), file);
  }
});
