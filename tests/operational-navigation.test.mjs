import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { resolveExplicitNavigation, resolveClientNavigation, resolveCampaignCommand, isDirectorBriefing } = loadTs("lib/assistant/operational-navigation.ts");

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

test("navigation client explicite, sans détourner les analyses", () => {
  assert.equal(resolveClientNavigation("Ouvre la fiche de Jrenov"), "Jrenov");
  assert.equal(resolveClientNavigation("Affiche le dossier de Couverture Catalane"), "Couverture Catalane");
  assert.equal(resolveClientNavigation("Ouvre le client Jrenov"), "Jrenov");
  assert.equal(resolveClientNavigation("Analyse les campagnes de Jrenov"), null);
  assert.equal(resolveClientNavigation("Ouvre https://example.com"), null);
});

test("campagne précise avec client explicite, sans confusion avec les demandes générales", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(resolveCampaignCommand("Ouvre la campagne Search Jrenov de Jrenov"))), { campaign: "Search Jrenov", client: "Jrenov", analyze: false });
  assert.equal(resolveCampaignCommand("Analyse la campagne Search Jrenov de Jrenov")?.analyze, true);
  assert.equal(resolveCampaignCommand("Analyse les campagnes de Jrenov"), null);
  assert.equal(resolveCampaignCommand("Ouvre la campagne https://invalid de Jrenov"), null);
});
test("le briefing est explicitement demandé", () => {
  assert.equal(isDirectorBriefing("Fais-moi un bilan global"), true);
  assert.equal(isDirectorBriefing("Prépare le briefing opérationnel"), true);
  assert.equal(isDirectorBriefing("Prépare les publications"), false);
});
