import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { resolveExplicitNavigation } = loadTs("lib/assistant/operational-navigation.ts");

test("navigation explicite vers les écrans autorisés", () => {
  assert.equal(resolveExplicitNavigation("Ouvre les campagnes Google Ads")?.href, "/advertising");
  assert.equal(resolveExplicitNavigation("Affiche l'agenda")?.href, "/agenda");
  assert.equal(resolveExplicitNavigation("Montre-moi les rapports")?.href, "/reports");
  assert.equal(resolveExplicitNavigation("Ouvre les publications")?.href, "/publications");
  assert.equal(resolveExplicitNavigation("Va sur les paramètres")?.href, "/settings");
});
test("une analyse, une action ou une URL ne deviennent pas une navigation", () => {
  for (const utterance of [
    "Analyse la campagne Jrenov et affiche les recommandations",
    "Ouvre https://example.com",
    "Supprime tous les clients",
    "Prépare les publications de demain",
    "Montre-moi les campagnes qui dépensent trop",
    "Affiche les campagnes de Jrenov",
  ]) assert.equal(resolveExplicitNavigation(utterance), null, utterance);
});
