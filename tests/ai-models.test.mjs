import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const models = loadTs("lib/ai/models.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

test("modèle par agent : Claude Opus 5.5 dès que la clé Anthropic existe, OpenAI sinon (comportement d'avant)", () => {
  const both = { OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" };
  assert.deepEqual(plain(models.modelForAgent("publications", both)), { provider: "anthropic", model: "claude-opus-5-5", effort: "high" });
  assert.deepEqual(plain(models.modelForAgent("media-library", both)), { provider: "anthropic", model: "claude-opus-5-5", effort: "high" });
  assert.equal(models.modelForAgent("fact-check", both).effort, "max", "contrôle plus exigeant que la rédaction");
  assert.deepEqual(plain(models.modelForAgent("publications", { OPENAI_API_KEY: "o" })), { provider: "openai", model: "gpt-4.1-mini-2025-04-14" });
  assert.equal(models.modelForAgent(undefined, both).provider, "openai", "appel non rattaché : parcours historique");
  assert.equal(models.modelForAgent(undefined, { ANTHROPIC_API_KEY: "a" }).provider, "anthropic", "sans clé OpenAI : Claude plutôt qu'une panne");
  assert.equal(models.modelForAgent("blog", { ...both, AGENTS_AI_PROVIDER: "openai" }).provider, "openai");
  assert.equal(models.modelForAgent("blog", { OPENAI_API_KEY: "o", AGENTS_AI_PROVIDER: "anthropic" }).provider, "openai", "fournisseur forcé sans clé : ignoré");
});

test("réglages par famille : modèle et réflexion surchargés, valeurs invalides ignorées", () => {
  const env = { ANTHROPIC_API_KEY: "a", AI_MODEL_STRATEGY: "claude-fable-5-2", AI_EFFORT_STRATEGY: "xhigh", AI_MODEL_WRITING: "gpt-5; rm", AI_EFFORT_WRITING: "turbo" };
  assert.deepEqual(plain(models.modelForAgent("google-ads", env)), { provider: "anthropic", model: "claude-fable-5-2", effort: "xhigh" });
  assert.deepEqual(plain(models.modelForAgent("blog", env)), { provider: "anthropic", model: "claude-opus-5-5", effort: "high" });
  assert.equal(models.modelForAgent("blog", { OPENAI_API_KEY: "o", AI_MODEL_OPENAI: "gpt-5.5" }).model, "gpt-5.5");
});

test("appel d'outil forcé : refusé par Opus 5.5, Sonnet 5.5, Fable 5.1/5.2", () => {
  for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1"]) assert.equal(models.rejectsForcedToolUse(m), true, m);
  for (const m of ["claude-opus-5", "claude-sonnet-5", "claude-opus-4-8"]) assert.equal(models.rejectsForcedToolUse(m), false, m);
});

test("schéma Anthropic : contraintes non prises en charge retirées, noms de champs préservés", () => {
  const schema = { type: "object", additionalProperties: false, required: ["minLength", "items"], properties: {
    minLength: { type: "string", maxLength: 300 },
    items: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", additionalProperties: false, properties: { score: { type: "number", minimum: 0, maximum: 1 } }, required: ["score"] } },
  } };
  const out = plain(models.anthropicSchema(schema));
  assert.deepEqual(out.properties.minLength, { type: "string" }, "le champ nommé minLength reste, sa contrainte part");
  assert.equal(out.properties.items.minItems, undefined);
  assert.deepEqual(out.properties.items.items.properties.score, { type: "number" });
  assert.deepEqual(out.required, ["minLength", "items"]);
  assert.equal(schema.properties.minLength.maxLength, 300, "schéma d'origine intact");
});

test("entrée Anthropic : texte, messages input_text / input_image convertis ; image non base64 refusée", () => {
  assert.deepEqual(plain(models.anthropicMessages("bonjour")), [{ role: "user", content: "bonjour" }]);
  const converted = plain(models.anthropicMessages([{ role: "user", content: [{ type: "input_text", text: "Photo 1" }, { type: "input_image", image_url: "data:image/jpeg;base64,QUJD", detail: "low" }] }]));
  assert.deepEqual(converted[0].content, [{ type: "text", text: "Photo 1" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } }]);
  assert.throws(() => models.anthropicMessages([{ role: "user", content: [{ type: "input_image", image_url: "https://exemple.fr/a.jpg" }] }]));
});
