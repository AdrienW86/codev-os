// Contrôles indépendants (socle éditorial, lot 4) : vérification des faits et anti-doublon, fermés par défaut.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const text = loadTs("lib/publications/editorial-text.ts");
const m = loadTs("lib/editorial-review/model.ts", { "@/lib/publications/editorial-text": text });
const facts = "Couverture Catalane\nCouvreur à Perpignan\nDémoussage de toiture\nChantier réalisé par l’entreprise : réfection de toiture en tuiles à Elne (septembre 2026).";

test("faits : preuve exigée mot pour mot, sinon l'affirmation n'est pas étayée", () => {
  const r = m.readFactCheck({ claims: [
    { claim: "L’entreprise est couvreur à Perpignan", status: "supported", evidence: "Couvreur à Perpignan" },
    { claim: "Chantier à Elne", status: "supported", evidence: "réfection de toiture en tuiles à Elne" },
    { claim: "Garantie décennale", status: "supported", evidence: "garantie décennale sur tous les travaux" },
    { claim: "La mousse retient l’humidité", status: "general", evidence: null },
  ] }, facts);
  assert.equal(r.passed, false);
  assert.deepEqual([...r.claims.map((c) => c.status)], ["supported", "supported", "unsupported", "general"]);
  assert.match(r.problems[0], /non étayé : « Garantie décennale »/);
});

test("faits : contredit, interdit ou statut inconnu font échouer ; réponse illisible refusée", () => {
  assert.equal(m.readFactCheck({ claims: [{ claim: "Intervient à Lyon", status: "contradicted", evidence: null }] }, facts).passed, false);
  assert.match(m.readFactCheck({ claims: [{ claim: "Devis gratuit", status: "excluded", evidence: null }] }, facts).problems[0], /interdit par le client/);
  assert.equal(m.readFactCheck({ claims: [{ claim: "x y z", status: "maybe", evidence: null }] }, facts).passed, false);
  assert.equal(m.readFactCheck({ claims: [{ claim: "Conseil général", status: "general", evidence: null }] }, facts).passed, true);
  assert.throws(() => m.readFactCheck({ verdict: "pass" }, facts));
});

test("anti-doublon : numéro vérifié contre le registre fourni", () => {
  const register = [{ topic: "Démoussage : erreurs à éviter" }, { topic: "Isolation des combles" }];
  assert.equal(m.readDuplicateCheck({ duplicate_of: null, reason: "Nouveau sujet." }, register).passed, true);
  const dup = m.readDuplicateCheck({ duplicate_of: 0, reason: "Même angle." }, register);
  assert.equal(dup.passed, false); assert.equal(dup.duplicateOf, "Démoussage : erreurs à éviter");
  assert.throws(() => m.readDuplicateCheck({ duplicate_of: 5, reason: "x" }, register));
  assert.throws(() => m.readDuplicateCheck({ reason: "x" }, register));
  assert.match(m.reviewMessage(null, dup), /Anti-doublon : sujet déjà traité/);
});

function service(respond) {
  const calls = [];
  let current = null;
  const metered = {
    withAiScope: async (scope, work) => { const prev = current; current = scope; try { return await work(); } finally { current = prev; } },
    structuredResponse: async (instructions, input, schema) => { const scope = current; calls.push({ agent: scope.agent, input: JSON.parse(input), schema }); return { value: await respond(scope.agent, JSON.parse(input)) }; },
    isBudgetExceeded: (e) => e?.message === "ai_budget_exceeded",
  };
  const s = loadTs("lib/editorial-review/service.ts", { "@/lib/harness/charter": { withCharter: (id, text) => `[${id}] ${text}` }, "@/lib/ai/metered": metered, "@/lib/core/audit": { writeAudit: async () => undefined }, "./model": m });
  return { s, calls };
}
const C = "11111111-1111-4111-8111-111111111111";
const base = { clientId: C, channel: "blog", title: "Démousser avant l’hiver", text: "Couvreur à Perpignan, nous démoussons.", facts, exclusions: ["Devis gratuit"],
  register: [{ channel: "blog", topic: "Démoussage : erreurs à éviter", date: "2026-10-01T00:00:00Z", status: "used", ref: "blog:1" }, { channel: "social", topic: "Autre canal", date: "2026-10-02T00:00:00Z", status: "used", ref: "p:1" }] };

test("contrôle : deux agents distincts, chacun sa tâche ; registre limité au même canal", async () => {
  const { s, calls } = service((agent) => agent === "fact-check" ? { claims: [{ claim: "Couvreur à Perpignan", status: "supported", evidence: "Couvreur à Perpignan" }] } : { duplicate_of: null, reason: "Nouveau." });
  const r = await s.reviewContent(base);
  assert.equal(r.ok, true);
  assert.deepEqual([...calls.map((c) => c.agent)].sort(), ["editorial-review", "fact-check"]);
  const dup = calls.find((c) => c.agent === "editorial-review").input;
  assert.deepEqual([...dup.register.map((e) => e.topic)], ["Démoussage : erreurs à éviter"]);
  assert.deepEqual([...calls.find((c) => c.agent === "fact-check").input.client_exclusions_never_write], ["Devis gratuit"]);
});

test("contrôle : texte refusé si une affirmation n'est pas étayée ou si le sujet est un doublon", async () => {
  let { s } = service((agent) => agent === "fact-check" ? { claims: [{ claim: "Garantie décennale", status: "unsupported", evidence: null }] } : { duplicate_of: 0, reason: "Même angle." });
  const r = await s.reviewContent(base);
  assert.equal(r.ok, false); assert.equal(r.reason, "rejected");
  assert.match(r.message, /non étayé : « Garantie décennale »/); assert.match(r.message, /Anti-doublon/);
});

test("contrôle fermé par défaut : IA en échec, plafond atteint ou réponse illisible font refuser le texte", async () => {
  for (const [error, pattern] of [[new Error("AI request failed"), /indisponible/], [new Error("ai_budget_exceeded"), /plafond IA/]]) {
    const { s } = service((agent) => { if (agent === "fact-check") throw error; return { duplicate_of: null, reason: "x" }; });
    const r = await s.reviewContent(base);
    assert.equal(r.ok, false); assert.equal(r.reason, "unavailable"); assert.match(r.message, pattern);
  }
  const { s } = service((agent) => agent === "fact-check" ? { claims: [] } : { duplicate_of: 99, reason: "x" });
  assert.equal((await s.reviewContent(base)).reason, "unavailable");
  const { s: noRegister, calls } = service(() => ({ claims: [] }));
  assert.equal((await noRegister.reviewContent({ ...base, register: [] })).ok, true);
  assert.equal(calls.length, 1, "pas d'appel anti-doublon sans registre du canal");
});

test("branchements : Blog et Newsletter passent par les contrôles avant tout enregistrement ; agents de la famille contrôle", () => {
  const blog = readFileSync("lib/blog-agent/service.ts", "utf8");
  assert.ok(blog.indexOf("reviewContent({clientId,channel:'blog'") < blog.indexOf(".upload(path,photo.bytes"), "contrôle avant l'envoi de l'image");
  const newsletter = readFileSync("lib/emailing/newsletter-service.ts", "utf8");
  assert.ok(newsletter.indexOf("reviewContent({ clientId, channel: \"newsletter\"") < newsletter.indexOf("db().from(\"email_newsletters\").insert("));
  const models = readFileSync("lib/ai/models.ts", "utf8");
  assert.match(models, /"fact-check": "review", "editorial-review": "review"/);
  assert.match(models, /review: "max"/);
});
