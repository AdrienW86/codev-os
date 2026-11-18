import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const crucial = loadTs("lib/review/crucial.ts");
const inbox = loadTs("lib/review/inbox.ts", { "./crucial": crucial });
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const json = (value) => JSON.parse(JSON.stringify(value));
const base = {
  clients: [{ id: A, name: "Alpha" }, { id: B, name: "Beta" }],
  reports: [], recommendations: [], actions: [], ads: [], publications: [], autoApproveClients: new Set(), prospection: [], seo: [], seoAgentId: null, photos: [], alerts: [],
};

test("rapports remplacés : seul le plus récent par client et type est approuvé seul, les anciens archivés ; Google Ads reste une décision", () => {
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
  const plan = inbox.planReportDecisions(reports);
  assert.deepEqual(plan.approve.map((r) => r.id).sort(), ["b1", "m1", "w3"]);
  assert.deepEqual(plan.archive.map((r) => r.id).sort(), ["w1", "w2"]);
  const result = inbox.buildInbox({ ...base, reports });
  const internal = result.sections.find((s) => s.id === "reports");
  assert.equal(internal.crucial, null);
  assert.equal(internal.manual, 0, "un rapport interne n’est plus une décision");
  assert.equal(internal.count, 5);
  const ads = result.sections.find((s) => s.id === "ads-reports");
  assert.equal(ads.crucial, "third-party-email");
  assert.equal(ads.manual, 2);
  assert.equal(ads.items[0].id, "g1", "les plus anciens d’abord");
  assert.equal(result.manualTotal, 2);
  assert.deepEqual(json(result.superseded).sort(), ["w1", "w2"]);
});

test("seules les confirmations cruciales comptent : recommandations, SEO, photos et alertes sont traitées automatiquement", () => {
  const result = inbox.buildInbox({ ...base,
    recommendations: [{ id: "r1", client_id: A, title: "Corriger la balise", created_at: "2026-11-10T08:00:00Z" }],
    seo: [{ id: "o1", client_id: A, keyword: "toiture", created_at: "2026-11-10T08:00:00Z" }],
    photos: [{ client_id: A }], alerts: [{ id: "i1", client_id: A, title: "Semaine vide", detected_at: "2026-11-10T08:00:00Z" }],
    actions: [
      { id: "a1", client_id: A, action_type: "internal.test", created_at: "2026-11-10T08:00:00Z", requires_approval: true },
      { id: "a2", client_id: A, action_type: "seo.github_pull_request", created_at: "2026-11-10T08:00:00Z", requires_approval: true },
    ],
    generatedImages: [{ id: "g", client_id: A, created_at: "2026-11-10T08:00:00Z" }],
    newsletters: [{ id: "n", client_id: B, subject: "Novembre", created_at: "2026-11-10T08:00:00Z" }],
    aiBudget: [{ client_id: B, spentEur: 5.2, capEur: 5 }],
  });
  for (const id of ["recommendations", "seo", "photos", "alerts"]) {
    const section = result.sections.find((s) => s.id === id);
    assert.equal(section.crucial, null, id); assert.equal(section.manual, 0, id); assert.equal(section.count, 1, id); assert.ok(section.note, id);
  }
  assert.equal(result.sections.find((s) => s.id === "actions").manual, 1, "une action interne n’est pas une décision");
  assert.equal(result.sections.find((s) => s.id === "generated-images").crucial, "generated-image");
  assert.equal(result.sections.find((s) => s.id === "newsletters").crucial, "third-party-email");
  assert.match(result.sections.find((s) => s.id === "ai-budget").items[0].title, /5\.20 € dépensés sur 5\.00 €/);
  assert.equal(result.manualTotal, 4);
  assert.ok(result.sections.findIndex((s) => s.crucial) < result.sections.findIndex((s) => !s.crucial), "les décisions d’abord");
  assert.equal(crucial.crucialCategoryOfAction("ads.optimization"), "ads-spend");
  assert.equal(crucial.crucialCategoryOfAction("report.send"), "third-party-email");
  assert.equal(crucial.crucialCategoryOfAction("unknown.type"), "client-site", "type inconnu : reste confirmé");
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
  const result = inbox.buildInbox({ ...base, ads: null });
  const ads = result.sections.find((s) => s.id === "ads");
  assert.equal(ads.status, "unavailable");
  assert.equal(result.unavailable, 1);
  // Une action qui n'exige pas d'approbation n'est pas une décision.
  const actions = inbox.buildInbox({ ...base, actions: [{ id: "a1", client_id: A, action_type: "x", created_at: "2026-11-10T08:00:00Z", requires_approval: false }] });
  assert.equal(actions.sections.find((s) => s.id === "actions").count, 0);
});

test("décisions automatiques : le planificateur approuve sans jamais envoyer ni toucher Google Ads", () => {
  const service = readFileSync("lib/review/auto-decisions.ts", "utf8");
  assert.doesNotMatch(service, /sendReport|transportApprovedReport|google_ads"\]/);
  assert.match(service, /\.in\("kind", \["weekly", "monthly"\]\)/);
  assert.match(service, /\.eq\("status", "ready_for_review"\)\.eq\("version", report\.version\)/);
  const route = readFileSync("app/api/internal/scheduler/tick/route.ts", "utf8");
  assert.match(route, /step\("auto_decisions"/);
});

test("la boîte est dans la navigation et l'archivage des rapports remplacés n'envoie rien", () => {
  const service = readFileSync("lib/review/inbox-service.ts", "utf8");
  assert.match(service, /archiveReport\(actor, id\)/);
  assert.doesNotMatch(service, /sendReport|transportApprovedReport|approveReport/);
  assert.match(readFileSync("components/layout/navigation.tsx", "utf8"), /href: "\/validation", label: "À valider"/);
});
