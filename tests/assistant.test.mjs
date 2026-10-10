import assert from "node:assert/strict";
import { test } from "node:test";
import * as zod from "zod";
import { loadRegistry, loadTs } from "./helpers/load-ts.mjs";

const periods = loadTs("lib/integrations/google-ads/periods.ts");
const text = loadTs("lib/assistant/text.ts");
const adsIntents = loadTs("lib/assistant/ads-intents.ts", { "@/lib/assistant/text": text });
const tools = loadTs("lib/assistant/tools.ts", { zod, "@/lib/integrations/google-ads/periods": periods });
const intents = loadTs("lib/assistant/intents.ts", { "@/lib/assistant/text": text, "@/lib/assistant/ads-intents": adsIntents });
const orchestrator = loadTs("lib/assistant/orchestrator.ts", { "@/lib/assistant/tools": tools, "@/lib/assistant/intents": intents, "@/lib/assistant/ads-intents": adsIntents });
const errors = loadTs("lib/providers/errors.ts");
const api = loadTs("lib/providers/api.ts", { "@/lib/providers/errors": errors });
const ai = loadTs("lib/ai/providers.ts", { "@/lib/providers/api": api, "@/lib/providers/errors": errors });
const guard = loadTs("lib/core/request-guard.ts", {}, { Headers, Request });
const plain = (value) => JSON.parse(JSON.stringify(value));
const TODAY = "2026-10-09";

function deps(overrides = {}) {
  const calls = [];
  return { calls, deps: { provider: null, today: TODAY, execute: async (name, input) => { calls.push([name, plain(input)]); return { ok: true, text: `résultat ${name}`, links: [{ label: "x", href: "/work" }] }; }, ...overrides } };
}
const user = (content) => [{ role: "user", content }];

test("tool registry: strict inputs, unknown tools refused, JSON schemas closed", () => {
  assert.equal(tools.parseToolInput("shell", {}).ok, false);
  assert.equal(tools.parseToolInput("create_task", { client: "A", title: "Appeler", extra: "x" }).ok, false, "unknown keys refused");
  assert.equal(tools.parseToolInput("create_task", { client: "A", title: "Appeler", due_date: "demain" }).ok, false);
  assert.equal(tools.parseToolInput("run_check", { check: "shell.exec" }).ok, false);
  const ok = tools.parseToolInput("generate_report", { client: "Jrenov" });
  assert.equal(ok.ok, true);
  assert.equal(ok.input.kind, "weekly");
  for (const spec of tools.toolSpecs()) {
    assert.equal(spec.parameters.type, "object", spec.name);
    assert.equal(spec.parameters.additionalProperties, false, spec.name);
    assert.equal(spec.parameters.$schema, undefined);
  }
  const writes = Object.entries(tools.toolDefinitions).filter(([, item]) => item.kind === "write").map(([name]) => name).sort();
  assert.deepEqual(writes, ["ads_prepare_report", "ads_run_analysis", "create_task", "generate_report", "run_check", "schedule_check"]);
  assert.equal(tools.parseToolInput("schedule_check", { check: "seo.analyze", date: "2026-10-13", time: "25:00" }).ok, false);
  assert.match(tools.describeProposal("create_task", { client: "Jrenov", title: "Relancer", priority: "Haute" }), /Créer la tâche « Relancer » pour Jrenov, priorité haute/);
});

test("deterministic intents (French)", () => {
  const cases = [
    ["Quelles sont mes urgences ?", "get_priorities", {}],
    ["Génère le rapport mensuel pour Boulangerie Martin", "generate_report", { client: "Boulangerie Martin", kind: "monthly" }],
    ["Prépare le rapport hebdo de Jrenov.", "generate_report", { client: "Jrenov", kind: "weekly" }],
    ["Montre les rapports", "list_reports", {}],
    ["Vérifie les sites", "run_check", { check: "monitoring.check_sites" }],
    ["Lance une analyse SEO pour Jrenov", "run_check", { check: "seo.analyze", client: "Jrenov" }],
    ["Quoi de neuf dans la veille ?", "list_news", {}],
    ["Mon agenda d'aujourd'hui", "agenda_today", {}],
    ["Crée une tâche Relancer le devis pour Jrenov demain", "create_task", { title: "Relancer le devis", client: "Jrenov", due_date: "2026-10-10", priority: "Moyenne" }],
    ["Où en est le client Jrenov ?", "client_overview", { client: "Jrenov" }],
    ["Montre-moi les actions à valider", "list_pending_actions", {}],
    ["Quels clients nécessitent mon attention ?", "clients_attention", {}],
    ["Planifie un audit SEO de Jrenov mardi à 9h", "schedule_check", { check: "seo.analyze", client: "Jrenov", date: "2026-10-13", time: "09:00" }],
    ["Programme le contrôle des sites demain 14h30", "schedule_check", { check: "monitoring.check_sites", date: "2026-10-10", time: "14:30" }],
  ];
  for (const [text, tool, input] of cases) assert.deepEqual(plain(intents.parseIntent(text, TODAY)), { tool, input }, text);
  assert.equal(intents.parseIntent("Écris-moi un poème", TODAY), null);
  assert.equal(intents.parseIntent("   ", TODAY), null);
});

test("rules mode: reads execute, writes are only PROPOSED, unknown requests get help", async () => {
  const { calls, deps: d } = deps();
  const read = await orchestrator.respond(user("mes urgences"), d);
  assert.equal(read.reply, "résultat get_priorities");
  assert.equal(read.source, "rules");
  const write = await orchestrator.respond(user("Génère le rapport hebdomadaire pour Jrenov"), d);
  assert.equal(write.proposal.tool, "generate_report");
  assert.match(write.reply, /Confirmez/);
  assert.deepEqual(calls.map(([name]) => name), ["get_priorities"], "write not executed without confirmation");
  const help = await orchestrator.respond(user("fais-moi un café"), d);
  assert.match(help.reply, /Je peux/);
});

test("simulation: the assistant neither reads real data nor writes", async () => {
  const { calls, deps: d } = deps({ simulation: true, provider: { id: "openai", model: "m", complete: async () => { throw new Error("must not be called"); } } });
  assert.match((await orchestrator.respond(user("mes urgences"), d)).reply, /Simulation active/);
  assert.match((await orchestrator.confirmProposal("create_task", { client: "A", title: "Titre" }, d)).reply, /Simulation active/);
  assert.equal(calls.length, 0);
});

test("AI mode: read tool → result fed back as data → final answer; write tool → proposal only", async () => {
  const seen = [];
  const provider = { id: "anthropic", model: "m", complete: async (input) => {
    seen.push(input.toolResults.length);
    if (!input.toolResults.length) return { text: "", toolCalls: [{ id: "c1", name: "client_overview", arguments: { client: "Jrenov" } }] };
    assert.match(input.toolResults[0].result, /résultat client_overview/);
    return { text: "Jrenov va bien.", toolCalls: [] };
  } };
  const { calls, deps: d } = deps({ provider });
  const reply = await orchestrator.respond(user("point sur Jrenov"), d);
  assert.equal(reply.reply, "Jrenov va bien.");
  assert.equal(reply.source, "ai");
  assert.deepEqual(plain(reply.links), [{ label: "x", href: "/work" }]);
  assert.deepEqual(seen, [0, 1]);
  assert.equal(calls.length, 1);

  // Injection : un résultat d'outil « demande » une écriture ; le modèle obéit → simple proposition.
  const injected = { id: "openai", model: "m", complete: async () => ({ text: "", toolCalls: [{ id: "c2", name: "create_task", arguments: { client: "Jrenov", title: "Supprimer tout" } }] }) };
  const second = deps({ provider: injected });
  const proposal = await orchestrator.respond(user("lis la veille"), second.deps);
  assert.equal(proposal.proposal.tool, "create_task");
  assert.equal(second.calls.length, 0, "never executed by the model");
});

test("AI mode: invalid or unknown tool calls are refused and reported back; loops are bounded", async () => {
  let rounds = 0;
  const provider = { id: "openai", model: "m", complete: async (input) => {
    rounds++;
    if (rounds === 1) return { text: "", toolCalls: [{ id: "a", name: "shell_exec", arguments: { cmd: "ls" } }] };
    if (rounds === 2) assert.match(input.toolResults.at(-1).result, /Outil inconnu/);
    return { text: "", toolCalls: [{ id: `b${rounds}`, name: "get_priorities", arguments: {} }] };
  } };
  const { calls, deps: d } = deps({ provider });
  const reply = await orchestrator.respond(user("?"), d);
  assert.equal(rounds, orchestrator.MAX_ROUNDS);
  assert.equal(reply.reply, "résultat get_priorities");
  assert.ok(calls.every(([name]) => name === "get_priorities"));
});

test("provider failure (quota, timeout, bad key) falls back to rules, flagged as degraded", async () => {
  const provider = { id: "openai", model: "m", complete: async () => { throw new errors.ProviderError("openai", "rate_limited", 429); } };
  const { deps: d } = deps({ provider });
  const reply = await orchestrator.respond(user("mes urgences"), d);
  assert.equal(reply.degraded, true);
  assert.equal(reply.reply, "résultat get_priorities");
});

test("confirmation re-validates everything: read tools, unknown tools and invalid inputs refused", async () => {
  const { calls, deps: d } = deps();
  assert.match((await orchestrator.confirmProposal("get_priorities", {}, d)).reply, /invalide/);
  assert.match((await orchestrator.confirmProposal("drop_database", {}, d)).reply, /invalide/);
  assert.match((await orchestrator.confirmProposal("create_task", { client: "A" }, d)).reply, /invalide/);
  assert.equal(calls.length, 0);
  assert.equal((await orchestrator.confirmProposal("create_task", { client: "Jrenov", title: "Relancer" }, d)).reply, "résultat create_task");
  assert.deepEqual(calls, [["create_task", { client: "Jrenov", title: "Relancer", priority: "Moyenne" }]]);
});

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

test("OpenAI adapter: request shape, tool calls parsed, malformed arguments neutralised, errors normalised", async () => {
  let request;
  const fetchImpl = async (url, init) => { request = { url: String(url), init, body: JSON.parse(init.body) }; return jsonResponse(200, { choices: [{ message: { content: null, tool_calls: [{ id: "t", function: { name: "get_priorities", arguments: "{}" } }, { id: "u", function: { name: "create_task", arguments: "{oops" } }] } }] }); };
  const provider = ai.createOpenAIProvider("sk-test", "model-x", fetchImpl);
  const result = await provider.complete({ system: "S", messages: [{ role: "user", content: "hi" }], tools: tools.toolSpecs() });
  assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, "Bearer sk-test");
  assert.equal(request.body.model, "model-x");
  assert.equal(request.body.messages[0].role, "system");
  assert.equal(request.body.tools.length, Object.keys(tools.toolDefinitions).length);
  assert.deepEqual(plain(result.toolCalls[1].arguments), { __invalid: true });
  assert.equal(tools.parseToolInput("create_task", result.toolCalls[1].arguments).ok, false);
  const failing = ai.createOpenAIProvider("sk-test", "m", async () => jsonResponse(401, {}));
  await assert.rejects(() => failing.complete({ system: "", messages: [], tools: [] }), (error) => error.kind === "unauthorized");
  const empty = ai.createOpenAIProvider("sk-test", "m", async () => jsonResponse(200, { choices: [] }));
  await assert.rejects(() => empty.complete({ system: "", messages: [], tools: [] }), (error) => error.kind === "malformed");
});

test("Anthropic adapter: tool_use blocks and text parsed; tool results sent as tool_result", async () => {
  let body;
  const fetchImpl = async (_url, init) => { body = JSON.parse(init.body); assert.equal(init.headers["x-api-key"], "ak"); return jsonResponse(200, { content: [{ type: "text", text: "Je regarde." }, { type: "tool_use", id: "tu1", name: "list_news", input: {} }] }); };
  const provider = ai.createAnthropicProvider("ak", "claude-x", fetchImpl);
  const result = await provider.complete({ system: "S", messages: [{ role: "user", content: "veille" }], tools: tools.toolSpecs(), toolResults: [{ call: { id: "p", name: "get_priorities", arguments: {} }, result: "{}" }] });
  assert.equal(body.system, "S");
  assert.equal(body.messages.at(-1).content[0].type, "tool_result");
  assert.ok(body.tools[0].input_schema);
  assert.equal(result.text, "Je regarde.");
  assert.equal(result.toolCalls[0].name, "list_news");
});

test("provider selection: AI_PROVIDER preference, fallback to the other key, none → deterministic mode", () => {
  assert.equal(ai.selectAIProvider({}), null);
  assert.equal(ai.selectAIProvider({ OPENAI_API_KEY: "a" }).id, "openai");
  assert.equal(ai.selectAIProvider({ ANTHROPIC_API_KEY: "b" }).id, "anthropic");
  assert.equal(ai.selectAIProvider({ OPENAI_API_KEY: "a", ANTHROPIC_API_KEY: "b", AI_PROVIDER: "anthropic" }).id, "anthropic");
  assert.equal(ai.selectAIProvider({ ANTHROPIC_API_KEY: "b", AI_PROVIDER: "openai" }).id, "anthropic");
  assert.equal(ai.selectAIProvider({ OPENAI_API_KEY: "a", ASSISTANT_OPENAI_MODEL: "custom" }).model, "custom");
  assert.equal(ai.selectAIProvider({ OPENAI_API_KEY: "   " }), null);
});

test("request guard: strict same origin, JSON only, bounded size, malformed JSON, rate limit", async () => {
  const url = "https://os.code-v.fr/api/assistant";
  const h = (entries) => new Headers(entries);
  assert.equal(guard.checkSameOrigin(h({ origin: "https://os.code-v.fr", "sec-fetch-site": "same-origin" }), url).ok, true);
  assert.equal(guard.checkSameOrigin(h({ origin: "https://evil.example" }), url).status, 403);
  assert.equal(guard.checkSameOrigin(h({}), url).status, 403, "missing Origin refused");
  assert.equal(guard.checkSameOrigin(h({ origin: "https://os.code-v.fr", "sec-fetch-site": "cross-site" }), url).status, 403);
  assert.equal(guard.checkSameOrigin(h({ origin: "https://os.code-v.fr.evil.io" }), url).status, 403);
  assert.equal(guard.checkSameOrigin(h({ origin: "http://127.0.0.1:3200", host: "127.0.0.1:3200" }), "http://localhost:3200/api/assistant").ok, true, "host header seen by the server");
  assert.equal(guard.checkSameOrigin(h({ origin: "https://os.code-v.fr", "x-forwarded-host": "os.code-v.fr" }), "http://internal:3000/api").ok, true, "behind the hosting proxy");
  assert.equal(guard.checkSameOrigin(h({ origin: "https://evil.example", host: "os.code-v.fr" }), url).status, 403);
  assert.equal(guard.checkSameOrigin(h({ origin: "null" }), url).status, 403, "opaque origin refused");
  assert.equal(guard.checkSameOrigin(h({ origin: "https://os.code-v.fr/path" }), url).status, 403, "malformed origin refused");
  const req = (body, type = "application/json") => new Request(url, { method: "POST", headers: { "content-type": type }, body });
  assert.equal((await guard.readJsonBody(req("{}", "text/plain"), 100)).status, 415);
  assert.equal((await guard.readJsonBody(req("x".repeat(200)), 100)).status, 413);
  assert.equal((await guard.readJsonBody(req("{oops"), 100)).status, 400);
  assert.deepEqual(plain((await guard.readJsonBody(req("{\"a\":1}"), 100)).value), { a: 1 });
  const limiter = guard.createRateLimiter(2, 1000);
  assert.equal(limiter("u", 0), true); assert.equal(limiter("u", 10), true); assert.equal(limiter("u", 20), false);
  assert.equal(limiter("other", 20), true);
  assert.equal(limiter("u", 1500), true, "window slides");
});

test("every assistant tool named by the agent registry exists in the tool registry", () => {
  const { registry } = loadRegistry();
  for (const definition of Object.values(registry.agentDefinitions)) for (const tool of definition.tools) assert.ok(tools.isToolName(tool), `${definition.type}: ${tool}`);
});

test("regression: « Crée une tâche pour vérifier le référencement de … lundi à 9 h » proposes a TASK, never an SEO analysis", () => {
  // TODAY = vendredi 2026-10-09 → lundi = 2026-10-12.
  assert.deepEqual(plain(intents.parseIntent("Crée une tâche pour vérifier le référencement de Couverture Catalane lundi à 9 h", TODAY)), {
    tool: "create_task", input: { title: "Vérifier le référencement de Couverture Catalane", client: "Couverture Catalane", due_date: "2026-10-12", due_time: "09:00", priority: "Moyenne" },
  });
  const seoWords = ["Ajoute une tâche : audit SEO de Jrenov demain", "Créer une tâche lancer l’analyse Google Ads pour Jrenov", "Note une tâche vérifier le site de Boulangerie Martin le 2026-10-20 à 14h30"];
  for (const text of seoWords) assert.equal(intents.parseIntent(text, TODAY).tool, "create_task", text);
  assert.deepEqual(plain(intents.parseIntent("Note une tâche vérifier le site de Boulangerie Martin le 2026-10-20 à 14h30", TODAY).input), { title: "Vérifier le site de Boulangerie Martin", client: "Boulangerie Martin", due_date: "2026-10-20", due_time: "14:30", priority: "Moyenne" });
  assert.equal(intents.parseIntent("Lance une analyse SEO pour Jrenov", TODAY).tool, "run_check", "analysis requests are unchanged");
});

test("task creation asks for precision when client or date is missing or ambiguous", () => {
  const clarify = (text) => intents.parseIntent(text, TODAY).clarify;
  assert.match(clarify("Crée une tâche pour vérifier le référencement lundi à 9 h"), /Pour quel client/);
  assert.match(clarify("Crée une tâche pour Jrenov la semaine prochaine"), /date précise/);
  assert.match(clarify("Crée une tâche relancer le devis de Jrenov à 9h"), /Pour quel jour à 09:00/);
  assert.match(clarify("Crée une tâche relancer Jrenov le 12"), /date exacte/);
  assert.match(clarify("Crée une tâche"), /intitulé/);
  assert.match(clarify("Crée une tâche appeler Jrenov à 25h"), /heure/);
});

test("proposals are pre-validated: unknown client → question, no proposal; canonical client name otherwise", async () => {
  const prepare = async (_name, input) => input.client === "Couverture Catalane" ? { ok: false, question: "Aucun client ne correspond à « Couverture Catalane ». Précisez le client." } : { ok: true, input: { ...input, client: "Jrenov SAS" } };
  const { calls, deps: d } = deps({ prepare });
  const unknown = await orchestrator.respond(user("Crée une tâche pour vérifier le référencement de Couverture Catalane lundi à 9 h"), d);
  assert.equal(unknown.proposal, undefined, "nothing to confirm");
  assert.match(unknown.reply, /Précisez le client/);
  const known = await orchestrator.respond(user("Crée une tâche relancer le devis pour jrenov demain"), d);
  assert.equal(known.proposal.tool, "create_task");
  assert.equal(known.proposal.input.client, "Jrenov SAS");
  assert.match(known.proposal.summary, /Créer la tâche « Relancer le devis » pour Jrenov SAS, échéance 2026-10-10/);
  assert.equal(calls.length, 0, "confirmation still required");
  const refused = await orchestrator.confirmProposal("create_task", { client: "Couverture Catalane", title: "X y" }, { ...d, prepare });
  assert.match(refused.reply, /Précisez le client/);
  assert.equal(calls.length, 0);
});

test("a failing TOOL is not reported as an AI outage; a failing PROVIDER is, with a sanitized reason and log", async () => {
  const logs = [];
  const log = (message, details) => logs.push([message, plain(details)]);
  const toolCall = { id: "openai", model: "gpt-4.1-mini", complete: async () => ({ text: "", toolCalls: [{ id: "c", name: "get_priorities", arguments: {} }] }) };
  const broken = deps({ provider: toolCall, log, execute: async () => { throw new Error("health read"); } }).deps;
  const toolFailure = await orchestrator.respond(user("urgences"), broken);
  assert.equal(toolFailure.degraded, undefined, "not an AI outage");
  assert.match(toolFailure.reply, /n’a pas pu aboutir/);
  assert.deepEqual(logs.at(-1), ["[assistant] Outil en échec", { tool: "get_priorities", error: "health read" }]);

  for (const [error, reason] of [
    [new errors.ProviderError("openai", "rate_limited", 429, "insufficient_quota"), /quota OpenAI épuisé/],
    [new errors.ProviderError("openai", "unauthorized", 401, "invalid_api_key"), /clé OpenAI invalide/],
    [new errors.ProviderError("openai", "unauthorized", 401, "missing_scope", { type: "invalid_request_error", scopes: ["api.model.request"] }), /sans la permission requise \(api\.model\.request\)/],
    [new errors.ProviderError("openai", "unauthorized", 401, "invalid_request_error"), /refuse cette opération pour cette clé \(HTTP 401, invalid_request_error\)/],
    [new errors.ProviderError("openai", "not_found", 404, "model_not_found"), /modèle OpenAI introuvable/],
    [new errors.ProviderError("openai", "rejected", 400, "unsupported_parameter"), /requête refusée par OpenAI \(unsupported_parameter\)/],
    [new errors.ProviderError("openai", "timeout"), /n’a pas répondu à temps/],
  ]) {
    const failing = { id: "openai", model: "gpt-5-mini", complete: async () => { throw error; } };
    const reply = await orchestrator.respond(user("mes urgences"), deps({ provider: failing, log }).deps);
    assert.equal(reply.degraded, true);
    assert.match(reply.degradedReason, reason);
    assert.equal(reply.reply, "résultat get_priorities", "deterministic fallback still answers");
    const [message, details] = logs.at(-1);
    assert.equal(message, "[assistant] Fournisseur IA en échec");
    assert.deepEqual(Object.keys(details).sort(), ["code", "kind", "model", "provider", "scopes", "status", "type"]);
  }
  assert.doesNotMatch(JSON.stringify(logs), /sk-|Bearer|Authorization/i);
});

test("system prompt carries today’s date and the task / clarification rules", () => {
  const prompt = orchestrator.systemPrompt(TODAY);
  assert.match(prompt, /vendredi 2026-10-09/);
  assert.match(prompt, /create_task, même si le sujet/);
  assert.match(prompt, /question de précision/);
});

test("OpenAI request: max_completion_tokens everywhere, no temperature for reasoning models; ping costs no tokens", async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => { bodies.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null }); return jsonResponse(200, { choices: [{ message: { content: "ok" } }], id: "m" }); };
  await ai.createOpenAIProvider("sk-test", "gpt-4.1-mini", fetchImpl).complete({ system: "S", messages: [{ role: "user", content: "x" }], tools: [] });
  await ai.createOpenAIProvider("sk-test", "gpt-5-mini", fetchImpl).complete({ system: "S", messages: [{ role: "user", content: "x" }], tools: [] });
  assert.equal(bodies[0].body.max_tokens, undefined);
  assert.equal(bodies[0].body.max_completion_tokens, 800);
  assert.equal(bodies[0].body.temperature, 0.2);
  assert.equal(bodies[1].body.temperature, undefined, "gpt-5 / o* reject a custom temperature");
  assert.ok(bodies[1].body.max_completion_tokens >= 800);
  await ai.createOpenAIProvider("sk-test", "gpt-4.1-mini", fetchImpl).ping();
  assert.deepEqual(bodies.at(-1), { url: "https://api.openai.com/v1/models/gpt-4.1-mini", method: "GET", body: null });
});

test("provider error codes are extracted from the body, sanitized, and never carry the message or secrets", async () => {
  const failing = (status, body) => api.providerJson("openai", "https://api.openai.com/v1/chat/completions", { fetchImpl: async () => ({ ok: false, status, text: async () => body }) }).then(() => null, (error) => error);
  const quota = await failing(429, JSON.stringify({ error: { message: "You exceeded your quota sk-abc", type: "insufficient_quota", code: "insufficient_quota" } }));
  assert.equal(quota.kind, "rate_limited");
  assert.equal(quota.code, "insufficient_quota");
  assert.doesNotMatch(quota.message, /sk-abc|exceeded/);
  const param = await failing(400, JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens'", code: "unsupported_parameter", param: "max_tokens" } }));
  assert.equal(param.kind, "rejected");
  assert.equal(param.code, "unsupported_parameter");
  assert.equal((await failing(400, "<html>oops</html>")).code, null);
  assert.equal((await failing(401, JSON.stringify({ error: { code: "invalid key with spaces & <script>" } }))).code, null, "only identifiers are kept");
  assert.equal((await failing(401, JSON.stringify({ error: { code: "invalid_api_key" } }))).kind, "unauthorized");
});
