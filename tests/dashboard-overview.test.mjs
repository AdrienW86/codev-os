import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const overview = loadTs("lib/dashboard/overview.ts");
const json = (v) => JSON.parse(JSON.stringify(v));

test("bloc décisions : seules les sections cruciales avec une décision, 3 éléments au plus ; boîte illisible = null", () => {
  const items = [1, 2, 3, 4].map((i) => ({ id: `i${i}`, title: `T${i}`, client: "Alpha", at: "", href: "/x" }));
  const inbox = { manualTotal: 4, unavailable: 0, superseded: [], sections: [
    { id: "ads", label: "Google Ads", href: "/advertising", crucial: "ads-spend", status: "available", count: 4, manual: 4, note: null, items },
    { id: "prospection", label: "Prospection", href: "/acquisition", crucial: "third-party-email", status: "available", count: 0, manual: 0, note: null, items: [] },
    { id: "reports", label: "Rapports internes", href: "/reports", crucial: null, status: "available", count: 9, manual: 0, note: "auto", items: [] },
  ] };
  const cards = overview.decisionCards(inbox);
  assert.deepEqual(cards.map((c) => c.id), ["ads"]);
  assert.equal(cards[0].items.length, 3);
  assert.equal(overview.decisionCards(null), null);
});

test("bloc activité : pas de zéro affiché, une source illisible est comptée à part, un module absent est ignoré", () => {
  const { lines, unreadable } = overview.activityLines({ published: 3, reportsBuilt: 0, reportsAutoApproved: 1, runsSucceeded: null, runsFailed: 2, imagesGenerated: undefined, incidentsResolved: 0 });
  assert.deepEqual(json(lines.map((l) => [l.key, l.text, l.tone])), [
    ["published", "3 publications diffusées sur les réseaux", "neutral"],
    ["auto-approved", "1 rapport approuvé automatiquement", "neutral"],
    ["failed", "2 analyses en échec (relancées au prochain passage ou à la main)", "red"],
  ]);
  assert.equal(unreadable, 1);
});

test("bloc agents : état le plus grave par équipe et agents à regarder", () => {
  const teams = overview.teamStatuses([
    { id: "contenu", name: "Contenu", members: [{ name: "Agent Blog", state: "ok" }, { name: "Agent Photo", state: "failed" }, { name: "Agent Vidéo", state: "attention" }] },
    { id: "veille", name: "Veille", members: [{ name: "Agent Veille", state: "manual" }] },
    { id: "vide", name: "Vide", members: [] },
  ]);
  assert.deepEqual(json(teams), [
    { id: "contenu", name: "Contenu", state: "failed", problems: ["Agent Photo", "Agent Vidéo"] },
    { id: "veille", name: "Veille", state: "manual", problems: [] },
  ]);
});
