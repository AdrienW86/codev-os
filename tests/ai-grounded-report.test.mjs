import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
const grounded = loadTs("lib/ai/grounded.ts");
const synthesis = loadTs("lib/reports/synthesis.ts", { "@/lib/ai/grounded": grounded });

test("nombres normalisés : milliers, virgule décimale, zéros finaux", () => {
  assert.deepEqual([...grounded.numbersOf("1 234 visites, 12,50 € et 3.5 %")].sort(), ["1234", "12.5", "3.5"].sort());
  assert.deepEqual([...grounded.ungroundedNumbers("Vous avez eu 1 234 visites (+15 %).", "Sessions : 1234.")], ["15"]);
  assert.equal(grounded.ungroundedNumbers("Aucun chiffre ici.", "").length, 0);
  assert.equal(grounded.cleanAiText("<b>x</b>", 100), null);
  assert.equal(grounded.cleanAiText("Texte propre.", 100), "Texte propre.");
});

const source = { clientName: "Jrenov", kind: "monthly", period: { start: "2026-10-01", end: "2026-10-31" }, highlights: ["12 publications diffusées sur les réseaux"],
  sections: [{ title: "Résultats", lines: ["Search Console : 340 clics, 12 500 impressions, position moyenne 18,4."] }], documents: [{ title: "Référencement", summary: "Position moyenne 18,4 sur 30 requêtes." }] };
const long = "Ce mois-ci, nous avons diffusé 12 publications sur vos réseaux et suivi votre référencement de près. ";

test("synthèse du rapport : chiffres repris des données acceptés, chiffre inventé ou calculé refusé", () => {
  const ok = synthesis.validateSynthesis({ summary: `${long}Votre site a obtenu 340 clics pour 12 500 impressions, avec une position moyenne de 18,4.` }, source);
  assert.equal(ok.ok, true);
  const invented = synthesis.validateSynthesis({ summary: `${long}Le trafic progresse de 25 % grâce à nos actions.` }, source);
  assert.deepEqual({ ok: invented.ok, reason: invented.reason, detail: invented.detail }, { ok: false, reason: "ungrounded", detail: "25" });
  assert.equal(synthesis.validateSynthesis({ summary: "Trop court." }, source).ok, false);
  assert.equal(synthesis.validateSynthesis(null, source).ok, false);
  assert.match(synthesis.REPORT_SYNTHESIS_INSTRUCTIONS, /aucun chiffre/);
});
