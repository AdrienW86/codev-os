// Fiches photo (socle éditorial, lot 2) : visible / à vérifier / confirmé, phrase citable, saisie admin, faits par photo.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { loadTs } from "./helpers/load-ts.mjs";

const native = createRequire(import.meta.url), root = resolve(new URL("..", import.meta.url).pathname);
function load(file) {
  const cache = new Map(), find = (base) => [base + ".ts", base + ".tsx"].find((p) => existsSync(p)) ?? base;
  function read(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {}; cache.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, Map, Set, Object, JSON, Number, Date, console, require: (name) => {
      if (name.startsWith("@/")) return read(find(resolve(root, name.slice(2))));
      if (name.startsWith(".")) return read(find(resolve(dirname(path), name)));
      return native(name);
    } });
    return exports;
  }
  return read(resolve(root, file));
}

const json = (v) => JSON.parse(JSON.stringify(v));
const m = loadTs("lib/photo-records/model.ts");
const record = (extra = {}) => ({ assetId: "a", status: "validated", intervention: "Réfection de toiture en tuiles", commune: "Perpignan", workMonth: "2026-09-01", doneByClient: true, publicationAllowed: true, note: null, ...extra });

test("photoState : une fiche humaine l'emporte, une légende reste à vérifier", () => {
  assert.equal(m.photoState({ assessment: null, caption: null, record: null }), "to_analyze");
  assert.equal(m.photoState({ assessment: { verdict: "publishable", manual_verdict: null }, caption: "", record: null }), "analyzed");
  assert.equal(m.photoState({ assessment: { verdict: "publishable", manual_verdict: null }, caption: "Chantier à Elne", record: null }), "to_verify");
  assert.equal(m.photoState({ assessment: { verdict: "to_review", manual_verdict: null }, caption: null, record: null }), "to_verify");
  assert.equal(m.photoState({ assessment: { verdict: "publishable", manual_verdict: "off_topic" }, caption: null, record: null }), "excluded");
  assert.equal(m.photoState({ assessment: { verdict: "off_topic", manual_verdict: null }, caption: null, record: record() }), "validated");
});

test("confirmedJobText : citable seulement si validée, réalisée par l'entreprise et publication autorisée", () => {
  assert.equal(m.confirmedJobText(record()), "Chantier réalisé par l’entreprise : Réfection de toiture en tuiles à Perpignan (septembre 2026).");
  assert.equal(m.confirmedJobText(record({ commune: null, workMonth: null })), "Chantier réalisé par l’entreprise : Réfection de toiture en tuiles.");
  for (const bad of [{ status: "excluded" }, { doneByClient: false }, { doneByClient: null }, { publicationAllowed: false }, { intervention: null }]) assert.equal(m.confirmedJobText(record(bad)), null);
  assert.equal(m.confirmedJobText(null), null);
});

test("parsePhotoRecordInput : valider exige l'intervention et la réponse réalisé par l'entreprise ; pas de mois futur", () => {
  const today = "2026-11-13";
  assert.deepEqual(json(m.parsePhotoRecordInput({ decision: "exclude", intervention: "x", note: "  floue  " }, today)), { ok: true, value: { decision: "exclude", intervention: null, commune: null, workMonth: null, doneByClient: null, publicationAllowed: false, note: "floue" } });
  assert.equal(m.parsePhotoRecordInput({ decision: "delete" }, today).ok, false);
  assert.equal(m.parsePhotoRecordInput({ decision: "validate", intervention: "x", doneByClient: "yes" }, today).ok, false);
  assert.equal(m.parsePhotoRecordInput({ decision: "validate", intervention: "Zinguerie" }, today).ok, false);
  assert.equal(m.parsePhotoRecordInput({ decision: "validate", intervention: "Zinguerie", doneByClient: "yes", month: "2026-12" }, today).ok, false);
  assert.equal(m.parsePhotoRecordInput({ decision: "validate", intervention: "Zinguerie", doneByClient: "yes", month: "2026-13-01" }, today).ok, false);
  const ok = m.parsePhotoRecordInput({ decision: "validate", intervention: " Zinguerie  neuve ", commune: "Elne", month: "2026-11", doneByClient: "yes", publicationAllowed: "yes" }, today);
  assert.deepEqual(json(ok), { ok: true, value: { decision: "validate", intervention: "Zinguerie neuve", commune: "Elne", workMonth: "2026-11-01", doneByClient: true, publicationAllowed: true, note: null } });
  assert.equal(m.parsePhotoRecordInput({ decision: "validate", intervention: "Zinguerie", doneByClient: "no" }, today).value.publicationAllowed, false);
});

test("factsWithPhoto : le chantier confirmé n'est citable qu'avec SA photo", () => {
  const sel = load("lib/publications/agent-v2/selection.ts");
  const input = { client: { name: "Couverture", activity: null, zone: null }, project: { name: "Réseaux" }, services: [], rules: "", channelRules: [], confirmedFacts: [],
    media: [{ id: "m1", confirmedJob: "Chantier réalisé par l’entreprise : Zinguerie à Elne." }, { id: "m2" }] };
  assert.match(sel.factsWithPhoto(input, { publications: [{ mediaId: "m1" }] }), /Elne/);
  assert.doesNotMatch(sel.factsWithPhoto(input, { publications: [{ mediaId: "m2" }] }), /Elne/);
  assert.doesNotMatch(sel.factsWithPhoto(input, { publications: [{ mediaId: null }] }), /Elne/);
});

test("contexte : photos exclues retirées, chantier confirmé transmis ; migration sans accès public", () => {
  const ctx = readFileSync("lib/publications/agent-v2/context.ts", "utf8");
  assert.match(ctx, /photoRecordsOf/);
  assert.match(ctx, /confirmedJobText/);
  const sql = readFileSync("supabase/migrations/20261210000000_photo_records.sql", "utf8");
  assert.match(sql, /revoke all on public\.photo_records from public, anon, authenticated/);
  assert.match(sql, /references public\.whatsapp_assets\(id, client_id\)/);
  assert.match(readFileSync("lib/publications/agent-v2/prompt.ts", "utf8"), /confirmed_job/);
});
