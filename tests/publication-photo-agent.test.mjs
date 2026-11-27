// Publications découpées (lot 4) : Agent Photo (image générée seulement sans photo, toujours validée par l'administrateur)
// et Agent Contrôle (cohérence texte / image, fermé par défaut). Modèle pur et services avec mocks, aucun réseau.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const m = loadTs("lib/publications/photo-agent/model.ts");
const b = loadTs("lib/harness/briefing.ts");
const charter = loadTs("lib/harness/charter.ts");
const now = new Date("2026-11-18T10:00:00.000Z");
const today = "2026-11-18";
const ago = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
const plain = (value) => JSON.parse(JSON.stringify(value));
const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PUB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", REV = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const run = (over = {}) => ({ id: RUN, client_id: CLIENT, status: "completed", media_status: "none", media_attempts: 0, created_at: ago(60), publication_ids: [PUB], ...over });
const pub = (over = {}) => ({ id: PUB, status: "draft", archived_at: null, target_date: "2026-12-01", ...over });

test("photo candidates: only finished preparations without any photo, old enough, still draft and upcoming", () => {
  assert.equal(m.photoCandidates([run()], [pub()], [], now, today).length, 1);
  assert.deepEqual(plain(m.photoCandidates([run()], [pub()], [], now, today)[0]), { runId: RUN, clientId: CLIENT, publicationIds: [PUB] });
  assert.equal(m.photoCandidates([run({ media_status: "attached" })], [pub()], [], now, today).length, 0, "a real photo was found");
  assert.equal(m.photoCandidates([run({ media_status: "needs_media", media_attempts: 1 })], [pub()], [], now, today).length, 0, "media recovery still running");
  assert.equal(m.photoCandidates([run({ media_status: "needs_media", media_attempts: 3 })], [pub()], [], now, today).length, 1, "media recovery gave up");
  assert.equal(m.photoCandidates([run({ created_at: ago(5) })], [pub()], [], now, today).length, 0, "too recent");
  assert.equal(m.photoCandidates([run({ status: "running" })], [pub()], [], now, today).length, 0);
  assert.equal(m.photoCandidates([run()], [pub({ status: "pending_review" })], [], now, today).length, 0, "already submitted");
  assert.equal(m.photoCandidates([run()], [pub({ archived_at: ago(1) })], [], now, today).length, 0);
  assert.equal(m.photoCandidates([run()], [pub({ target_date: "2026-11-01" })], [], now, today).length, 0, "past slot");
  assert.equal(m.photoCandidates([run({ publication_ids: [] })], [pub()], [], now, today).length, 0);
});

test("photo candidates: one pending proposal at a time, no retry after a decision, at most 3 proposals", () => {
  for (const status of ["pending_review", "approved", "skipped", "attach_failed"])
    assert.equal(m.photoCandidates([run()], [pub()], [{ run_id: RUN, status }], now, today).length, 0, status);
  assert.equal(m.photoCandidates([run()], [pub()], [{ run_id: RUN, status: "rejected" }], now, today).length, 1, "a refusal allows a new proposal");
  const three = [1, 2, 3].map(() => ({ run_id: RUN, status: "rejected" }));
  assert.equal(m.photoCandidates([run()], [pub()], three, now, today).length, 0, "refusal cap");
});

test("photo prompt: illustrative only, forbidden elements refused unless negated, format bounded", () => {
  const words = "a close view of fresh white plaster on an interior wall with a trowel resting on a wooden board in soft daylight";
  assert.deepEqual(plain(m.readPhotoPrompt({ feasible: true, prompt: words, reason: "Enduit." })), { ok: true, prompt: words, reason: "Enduit." });
  assert.equal(m.readPhotoPrompt({ feasible: true, prompt: `${words}, no text, no logo, without faces`, reason: "" }).ok, true, "negations are allowed");
  assert.equal(m.readPhotoPrompt({ feasible: true, prompt: `${words} with the company logo on the van`, reason: "" }).ok, false);
  assert.equal(m.readPhotoPrompt({ feasible: true, prompt: `${words} and a smiling portrait of the owner`, reason: "" }).ok, false);
  assert.equal(m.readPhotoPrompt({ feasible: true, prompt: "a wall", reason: "" }).ok, false, "too short");
  const refused = m.readPhotoPrompt({ feasible: false, prompt: "", reason: "Personne nommée." });
  assert.deepEqual(plain(refused), { ok: false, reason: "Personne nommée." });
  assert.equal(m.readPhotoPrompt(null).ok, false);
  assert.match(m.IMAGE_SAFETY_SUFFIX, /No text/);
  assert.match(m.PHOTO_PROMPT_INSTRUCTIONS, /jamais une réalisation précise du client/);
});

test("coherence verdict: unreadable or unjustified incoherence is null (fail-closed)", () => {
  assert.deepEqual(plain(m.readCoherence({ coherent: true, issues: [] })), { coherent: true, issues: [] });
  assert.deepEqual(plain(m.readCoherence({ coherent: false, issues: ["L’image montre une toiture, le texte parle d’une salle de bains.", 4] })), { coherent: false, issues: ["L’image montre une toiture, le texte parle d’une salle de bains."] });
  assert.equal(m.readCoherence({ coherent: false, issues: [] }), null);
  assert.equal(m.readCoherence({ coherent: "yes", issues: [] }), null);
  assert.equal(m.readCoherence(undefined), null);
  assert.equal(m.coherenceText([{ platform: "instagram", text_content: "x".repeat(9000) }]).length, 6000);
});

test("charters: Writer, Photo and Check agents have separate roles; generated images always need the administrator", () => {
  const writer = charter.getCharter("publications"), photo = charter.getCharter("publication-photo"), check = charter.getCharter("publication-check");
  assert.match(writer.name, /Rédacteur/);
  assert.deepEqual(plain(writer.triggers), [{ kind: "step", step: "publication_preparation" }]);
  assert.deepEqual(plain(photo.triggers), [{ kind: "step", step: "publication_photo" }]);
  assert.match(photo.never.join(" "), /sans la validation explicite de l’administrateur/);
  assert.deepEqual(plain(check.triggers.map((t) => t.step)), ["publication_auto_approval", "publication_delivery_prepare", "publication_delivery_send", "publication_stats"]);
  const steps = readFileSync("lib/scheduler/heartbeat.ts", "utf8");
  assert.ok(steps.indexOf('"publication_photo"') > steps.indexOf('"publication_preparation"'), "photo step runs after preparation");
  const models = readFileSync("lib/ai/models.ts", "utf8");
  assert.match(models, /"publication-photo": "writing"/);
  assert.match(models, /"publication-check": "review"/);
});

test("briefing: photo and check agents report pending images, decisions and incoherent verdicts; missing migration is a gap", () => {
  const photo = b.photoSignals([
    { status: "pending_review", created_at: ago(60), decided_at: null },
    { status: "approved", created_at: ago(3000), decided_at: ago(2000) },
    { status: "rejected", created_at: ago(3000), decided_at: ago(2500) },
  ], now);
  assert.match(photo.facts[0].statement, /1 image générée attend ta validation/);
  assert.equal(photo.facts[0].href, "/publications/images");
  assert.match(photo.facts[1].statement, /1 image validée, 1 refusée/);
  assert.match(b.photoSignals(null, now).gaps[0], /non installé/);
  const check = b.coherenceSignals([{ coherent: true, checked_at: ago(100) }, { coherent: false, checked_at: ago(50) }], now);
  assert.match(check.facts[0].statement, /2 publications contrôlées sur 30 jours, 1 jugée incohérente/);
  assert.match(b.coherenceSignals(null, now).gaps[0], /sans lui/);
  assert.match(b.coherenceSignals([], now).gaps[0], /Aucun contrôle/);
});

function coherenceWith({ cached = null, cacheError = null, links = [{ asset_id: "e1" }], mime = "image/jpeg", provenance = null, value = { coherent: false, issues: ["Autre prestation."] }, aiThrows = false } = {}) {
  const calls = [];
  const chain = (table) => {
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q,
      limit: async () => ({ data: links, error: null }),
      maybeSingle: async () => table === "publication_coherence_checks" ? { data: cached, error: cacheError } : { data: { storage_path: "c/p/a", mime_type: mime, provenance }, error: null },
      upsert: async (row) => { calls.push(["cache", row]); return { error: null }; },
      then: (resolve) => resolve({ data: [{ id: "v1", platform: "instagram", text_content: "Rénovation de salle de bains." }], error: null }),
    };
    return q;
  };
  const db = { from: chain, storage: { from: () => ({ download: async () => ({ data: { arrayBuffer: async () => new ArrayBuffer(4) }, error: null }) }) } };
  const mod = loadTs("lib/publications/photo-agent/coherence.ts", {
    "server-only": {},
    "@/lib/supabase/server": { getSupabaseServerClient: () => db },
    "@/lib/ai/metered": { withAiScope: async (scope, fn) => { calls.push(["scope", scope]); return fn(); }, structuredResponse: async (_i, input) => { calls.push(["ai", input]); if (aiThrows) throw Error("timeout"); return { value, usage: { model: "m" } }; } },
    "@/lib/harness/charter": { withCharter: (_id, text) => text },
    "../editor": { mediaBucket: () => "publication-media" },
    "../media/transform": { visionPreview: async () => new Uint8Array([1, 2]) },
    "./model": m,
  });
  return { check: () => mod.checkRevisionCoherence({ publicationId: PUB, revisionId: REV, clientId: CLIENT }), calls };
}

test("coherence check: cached verdict reused, AI failure blocks (error), video and missing table pass through", async () => {
  const cached = coherenceWith({ cached: { coherent: false, issues: ["Texte faux."] } });
  assert.deepEqual(plain(await cached.check()), { state: "incoherent", issues: ["Texte faux."] });
  assert.equal(cached.calls.filter(([k]) => k === "ai").length, 0, "no new AI call for a checked revision");
  const fresh = coherenceWith({ provenance: "Image d’illustration générée par IA (Agent Photo)" });
  assert.deepEqual(plain(await fresh.check()), { state: "incoherent", issues: ["Autre prestation."] });
  assert.deepEqual(plain(fresh.calls.find(([k]) => k === "scope")[1]), { agent: "publication-check", clientId: CLIENT });
  assert.match(JSON.stringify(fresh.calls.find(([k]) => k === "ai")[1]), /image_generated_by_ai\\":true/);
  assert.equal(fresh.calls.find(([k]) => k === "cache")[1].coherent, false);
  assert.deepEqual(plain(await coherenceWith({ aiThrows: true }).check()), { state: "error" });
  assert.deepEqual(plain(await coherenceWith({ value: { coherent: false, issues: [] } }).check()), { state: "error" });
  assert.deepEqual(plain(await coherenceWith({ mime: "video/mp4" }).check()), { state: "coherent" });
  assert.deepEqual(plain(await coherenceWith({ links: [] }).check()), { state: "no_image" });
  assert.deepEqual(plain(await coherenceWith({ cacheError: { code: "42P01" } }).check()), { state: "not_installed" });
});

test("photo agent service: never attaches without an administrator, generated bucket private, provenance says AI", () => {
  const service = readFileSync("lib/publications/photo-agent/service.ts", "utf8");
  assert.match(service, /requireAdmin\(\)/);
  assert.match(service, /status:'pending_review'|'pending_review'/);
  assert.match(service, /générée par IA/);
  assert.match(service, /Ce n’est pas une photo d’un chantier du client/);
  const sql = readFileSync("supabase/migrations/20261214000000_publication_photo_and_check_agents.sql", "utf8");
  assert.match(sql, /'publication-generated',false/);
  assert.match(sql, /\(status in \('approved','rejected','attach_failed'\)\) = \(decided_by is not null\)/);
});

test("photo prompt filter: no false positives on brand-new, roof face, surface; still refuses positive requests", () => {
  const base = "Close-up of terracotta canal tiles on a pitched roof in bright Mediterranean light, roofer's gloved hands fitting a tile, scaffold rail in the foreground";
  for (const ok of [`${base}, a brand-new zinc gutter.`, `${base}. The south roof face catches the sun.`, `${base}, smooth surface.`,
    `${base}. There are no visible faces, people, text or logos in the scene.`, `${base}. Avoid any signage; logo-free and text-free.`, `${base}. Without lettering or watermark.`])
    assert.equal(m.readPhotoPrompt({ feasible: true, prompt: ok, reason: "" }).ok, true, ok);
  for (const bad of [`${base}. The van shows the company logo.`, `${base}. A sign reading "Toiture" on the wall.`, `${base}. Portrait of the smiling owner.`, `${base}. Brand names on the tool box.`])
    assert.equal(m.readPhotoPrompt({ feasible: true, prompt: bad, reason: "" }).ok, false, bad);
});

test("image self-check: below 70 or refused never passes; unreadable output is null", () => {
  assert.deepEqual(plain(m.readImageQa({ pass: true, score: 86, issues: [] })), { pass: true, score: 86, issues: [] });
  assert.equal(m.readImageQa({ pass: true, score: 60, issues: [] }).pass, false, "score under the threshold");
  assert.equal(m.readImageQa({ pass: false, score: 90, issues: ["mains déformées"] }).pass, false);
  assert.equal(m.readImageQa({ pass: true, issues: [] }), null);
  assert.equal(m.readImageQa(null), null);
  assert.equal(m.IMAGE_ATTEMPTS, 2, "one regeneration at most");
});

test("photo agent: brief-guided prompt, portrait high quality, self-check before proposing, never attached without validation", () => {
  const service = readFileSync("lib/publications/photo-agent/service.ts", "utf8");
  assert.match(service, /clientVisualBrief\(candidate\.clientId,'publication-photo'\)/);
  assert.match(service, /imageStyleSuffix\(brief\)/);
  assert.match(service, /reviewImage\(generated\.bytes,brief,texts\)/);
  assert.match(service, /status:'pending_review'/);
  const transport = readFileSync("lib/integrations/publications-openai-images.ts", "utf8");
  assert.match(transport, /size:'1024x1536'/);
  assert.match(transport, /AI_IMAGE_QUALITY/);
});
