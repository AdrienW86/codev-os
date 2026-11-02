// Agent Publications : photos reconnues par leur catégorie-prestation, et sujet sans photo refusé quand des photos
// disponibles illustrent des prestations (le nouvel essai est guidé vers une prestation illustrée).
import test from "node:test";
import assert from "node:assert/strict";
import { load, json, uid } from "./helpers/ts-load.mjs";

const photos = load("lib/publications/editorial-photos.ts");
const sel = load("lib/publications/agent-v2/selection.ts");
const A = n => uid("a", n), O = n => uid("5", n);
const services = ["Rénovation de toiture", "Isolation de toiture", "Fenêtres de toit"];

test("a photo filed under a service name illustrates that service, even when the name has only generic words", () => {
  const m = { id: A(1), categories: ["Rénovation de toiture", "Toiture terminée"], description: "Tuiles rouges sous un ciel bleu.", used: false };
  assert.deepEqual(json(photos.photoServices(m, services)), ["Rénovation de toiture"]);
  assert.deepEqual(json(photos.photoServices({ ...m, categories: ["Fenêtres de toit"] }, services)), ["Fenêtres de toit"]);
  assert.deepEqual(json(photos.photoServices({ ...m, categories: ["Autre"] }, services)), []);
});

const input = (media) => ({ occurrences: [{ occurrenceId: O(1), platform: "facebook", date: "2026-11-04", time: "09:00", timezone: "Europe/Paris" }], media, services,
  previousSubjects: [], previousPublications: [] });
const output = (mediaId, subject = "Isoler sa toiture pour un confort durable") => ({ idea: { subject, angle: "Confort" }, publications: [{ occurrenceId: O(1), platform: "facebook", text: "Une toiture bien entretenue protège la maison toute l’année.", cta: null, mediaId }] });

test("no photo while available photos illustrate services: refused with the illustrated services", () => {
  const media = [{ id: A(1), categories: ["Rénovation de toiture"], description: "Toit rénové.", used: false, services: ["Rénovation de toiture"] }];
  const r = json(sel.validateGeneratorOutput(input(media), output(null)));
  assert.equal(r.ok, false); assert.equal(r.reason, "photo_available"); assert.match(r.detail, /« Rénovation de toiture »/);
  assert.equal(sel.validateGeneratorOutput(input(media), output(A(1), "Une toiture rénovée, une maison protégée")).ok, true, "with the photo: accepted");
  assert.equal(sel.validateGeneratorOutput(input([{ ...media[0], services: [] }]), output(null)).ok, true, "no illustrated service: a missing photo stays allowed");
  assert.equal(sel.validateGeneratorOutput(input([{ ...media[0], used: true }]), output(null)).ok, true, "used photos do not count");
});

test("« remise en état » is work, not a commercial discount; « remise de 10 % » stays refused", () => {
  const facts = sel.factsOf({ client: { name: "Toitures", activity: "Couverture", zone: null }, project: { name: "R" }, services: ["Rénovation de toiture"], rules: "", channelRules: [], occurrences: [], media: [], previousSubjects: [], priorityTopics: [] });
  const kinds = t => json(sel.unsupportedClaims(t, facts)).map(c => c.split(":")[0]);
  assert.ok(!kinds("Remise en état de votre toiture après l’hiver.").includes("promotion"));
  assert.ok(!kinds("Une remise à neuf complète.").includes("promotion"));
  assert.ok(kinds("Profitez d’une remise sur votre devis.").includes("promotion"));
  assert.ok(kinds("Remises exceptionnelles ce mois-ci.").includes("promotion"));
});
