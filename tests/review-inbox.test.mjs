import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const inbox = loadTs("lib/review/inbox.ts");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const json = (value) => JSON.parse(JSON.stringify(value));
const base = {
  clients: [{ id: A, name: "Alpha" }, { id: B, name: "Beta" }],
  reports: [], recommendations: [], actions: [], ads: [], publications: [], autoApproveClients: new Set(), prospection: [], seo: [], seoAgentId: null, photos: [], alerts: [],
};

test("rapports remplacés : seul le plus récent par client et type reste à relire (hebdo, mensuel), jamais Google Ads", () => {
  const reports = [
    { id: "w1", client_id: A, kind: "weekly", period_start: "2026-10-19" },
    { id: "w2", client_id: A, kind: "weekly", period_start: "2026-10-26" },
    { id: "w3", client_id: A, kind: "weekly", period_start: "2026-11-02" },
    { id: "b1", client_id: B, kind: "weekly", period_start: "2026-11-02" },
    { id: "m1", client_id: A, kind: "monthly", period_start: "2026-09-01" },
    { id: "g1", client_id: A, kind: "google_ads", period_start: "2026-09-11" },
    { id: "g2", client_id: A, kind: "google_ads", period_start: "2026-10-30" },
  ];
  assert.deepEqual(json(inbox.supersededReports(reports)).sort(), ["w1", "w2"]);
  const result = inbox.buildInbox({ ...base, reports });
  const section = result.sections.find((s) => s.id === "reports");
  assert.equal(section.manual, 7);
  assert.match(section.note, /2 rapport\(s\) remplacé\(s\)/);
  assert.equal(section.items[0].id, "m1", "les plus anciens d’abord");
  assert.deepEqual(json(result.superseded).sort(), ["w1", "w2"]);
});

test("publications : la validation automatique choisie pour un client n'est pas comptée comme une décision à prendre", () => {
  const publications = [
    { id: "p1", client_id: A, created_at: "2026-11-01T10:00:00Z" }, { id: "p2", client_id: A, created_at: "2026-11-02T10:00:00Z" },
    { id: "p3", client_id: B, created_at: "2026-11-03T10:00:00Z" },
  ];
  const result = inbox.buildInbox({ ...base, publications, autoApproveClients: new Set([A]) });
  const section = result.sections.find((s) => s.id === "publications");
  assert.equal(section.count, 3);
  assert.equal(section.manual, 1);
  assert.match(section.note, /2 validée\(s\) automatiquement/);
  assert.deepEqual(json(section.items.map((i) => [i.client, i.title])), [["Beta", "1 publication(s)"]]);
  assert.equal(result.manualTotal, 1);
});

test("une source illisible est signalée, jamais comptée comme vide", () => {
  const result = inbox.buildInbox({ ...base, seo: null, recommendations: [{ id: "r1", client_id: A, title: "Corriger la balise", created_at: "2026-11-10T08:00:00Z" }] });
  const seo = result.sections.find((s) => s.id === "seo");
  assert.equal(seo.status, "unavailable");
  assert.equal(result.unavailable, 1);
  assert.equal(result.sections[0].id, "recommendations", "les sections avec une décision à prendre d'abord");
  assert.equal(result.sections[0].items[0].href, "/recommendations/r1");
  // Une action qui n'exige pas d'approbation n'est pas une décision.
  const actions = inbox.buildInbox({ ...base, actions: [{ id: "a1", client_id: A, action_type: "x", created_at: "2026-11-10T08:00:00Z", requires_approval: false }] });
  assert.equal(actions.sections.find((s) => s.id === "actions").count, 0);
});

test("la boîte est dans la navigation et l'archivage des rapports remplacés n'envoie rien", () => {
  const service = readFileSync("lib/review/inbox-service.ts", "utf8");
  assert.match(service, /archiveReport\(actor, id\)/);
  assert.doesNotMatch(service, /sendReport|transportApprovedReport|approveReport/);
  assert.match(readFileSync("components/layout/navigation.tsx", "utf8"), /href: "\/validation", label: "À valider"/);
});
