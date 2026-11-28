import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const model = loadTs("lib/reports/documents/model.ts");
const bilan = loadTs("lib/reports/bilan.ts", { "./documents/model": model });
const preview = loadTs("lib/reports/email-preview.ts", { "./recipient": loadTs("lib/reports/recipient.ts"), "./documents/model": model });
const coverage = loadTs("lib/agents/coverage.ts");
const inbox = loadTs("lib/review/inbox.ts", { "./crucial": loadTs("lib/review/crucial.ts") });
const charter = loadTs("lib/harness/charter.ts");
const plan = loadTs("lib/harness/client-plan.ts", { "./charter": charter });
const briefing = loadTs("lib/harness/briefing.ts");
// Valeurs créées dans le contexte isolé du module : comparées après copie dans ce contexte.
const plain = (value) => JSON.parse(JSON.stringify(value));

const period = { start: "2026-11-01", end: "2026-11-30" };
const input = {
  client: { id: "c", name: "Jrenov" }, period, projects: [], recommendations: [], runs: [], metrics: [],
  tasks: [
    { title: "Refonte de la page devis", status: "Terminé", priority: "Normale", due_date: null, completed_at: "2026-11-12T10:00:00Z", created_at: "2026-11-02T10:00:00Z" },
    { title: "Tâche prévue en décembre", status: "À faire", priority: "Normale", due_date: "2026-12-10", completed_at: null, created_at: "2026-11-20T10:00:00Z" },
  ],
  publications: [{ subject: "À valider", status: "pending_review", updated_at: "2026-11-20T10:00:00Z", target_date: "2026-11-21" }],
  actions: [{ label: "Mot-clé négatif ajouté", status: "executed", created_at: "2026-11-05T10:00:00Z", executed_at: "2026-11-06T10:00:00Z" }, { label: "Hausse de budget", status: "pending_approval", created_at: "2026-11-05T10:00:00Z", executed_at: null }],
  incidents: [{ title: "Site lent", status: "resolved", severity: "medium", detected_at: "2026-11-03T10:00:00Z", resolved_at: "2026-11-03T12:00:00Z" }],
  siteChecks: [{ ok: true, response_ms: 200, checked_at: "2026-11-02T07:00:00Z" }, { ok: true, response_ms: 220, checked_at: "2026-11-03T07:00:00Z" }, { ok: false, response_ms: null, checked_at: "2026-11-04T07:00:00Z" }, { ok: true, response_ms: 210, checked_at: "2026-11-05T07:00:00Z" }],
  extras: {
    analytics: null, lighthouse: [],
    deliveries: [
      { platform: "instagram", published_at: "2026-11-04T09:00:00Z", subject: "Chantier" }, { platform: "facebook", published_at: "2026-11-04T09:00:00Z", subject: "Chantier" },
      { platform: "instagram", published_at: "2026-11-18T09:00:00Z", subject: "Conseil" }, { platform: "instagram", published_at: "2026-10-28T09:00:00Z", subject: "Hors période" },
    ],
    articles: [{ title: "Isoler ses combles avant l’hiver", slug: "combles", published_at: "2026-11-10T08:00:00Z", target_query: null }],
    newsletters: [{ subject: "Novembre", sent_at: "2026-11-25T08:00:00Z", sent_count: 120 }],
  },
};
const client = { summary: "En novembre, nous avons diffusé 3 publications et publié un article sur votre blog.", highlights: [], empty: false,
  sections: [{ title: "Nos priorités pour la suite", lines: ["Accélérer le chargement mobile du site."] }, { title: "À venir", lines: ["Refonte de la galerie"] }] };
const search = { key: "search", title: "Référencement Google", summary: "Clics en hausse.", kpis: [{ label: "Clics Google", value: "340", change: "+12 %", trend: "up", good: true }, { label: "Position moyenne", value: "18,4" }], charts: [], tables: [], notes: [] };

test("bilan : seul le travail livré dans la période est compté, jamais le prévu ni l'à valider", () => {
  const work = bilan.bilanWork(input, period);
  const byDomain = Object.fromEntries(work.map((item) => [item.domain, item]));
  assert.equal(byDomain["Réseaux sociaux"].count, 3, "la publication d'octobre n'est pas comptée");
  assert.match(byDomain["Réseaux sociaux"].done, /Instagram 2, Facebook 1/);
  assert.equal(byDomain.Blog.count, 1);
  assert.match(byDomain.Newsletter.done, /120 destinataires/);
  assert.equal(byDomain.Interventions.count, 2, "tâche terminée + action exécutée, pas la tâche prévue ni l'action à approuver");
  assert.doesNotMatch(byDomain.Interventions.done, /prévue|budget/i);
  assert.match(byDomain["Surveillance du site"].done, /4 contrôles .* 75 %/);
  assert.equal(byDomain.Incidents.count, 1);
});

test("bilan : chiffres clés repris des documents à l'identique, priorités en notes, document valide", () => {
  const doc = bilan.buildClientBilan({ clientName: "Jrenov", period, input, client, documents: [search] });
  assert.equal(doc.key, "bilan");
  assert.equal(doc.title, "Bilan de novembre 2026");
  assert.equal(doc.summary, client.summary);
  model.reportDocumentSchema.parse(doc);
  const results = doc.tables.find((table) => table.title === model.BILAN_RESULTS_TABLE);
  assert.deepEqual(plain(results.rows[0]), ["Référencement", "Clics Google", "340", "+12 %"]);
  assert.deepEqual(plain(results.rows[1]), ["Référencement", "Position moyenne", "18,4", "—"]);
  assert.ok(doc.kpis.some((kpi) => kpi.label === "Clics Google" && kpi.value === "340" && kpi.change === "+12 %"));
  assert.deepEqual(plain(doc.notes), ["Prochaine étape : Accélérer le chargement mobile du site.", "Prochaine étape : Refonte de la galerie"]);
  model.reportDocumentsSchema.parse([doc, search]);
});

test("bilan : rapport vide → aucun bilan ; sans document d'agent, les résultats client passent en notes", () => {
  assert.equal(bilan.buildClientBilan({ clientName: "X", period, input, client: { ...client, empty: true }, documents: [] }), null);
  const legacy = bilan.buildClientBilan({ clientName: "X", period, input, client: { ...client, sections: [{ title: "Résultats", lines: ["Disponibilité du site : 75 %"] }] }, documents: [] });
  assert.ok(legacy.notes.includes("Disponibilité du site : 75 %"));
});

test("e-mail du rapport mensuel avec bilan : lisible sans pièce jointe, mêmes chiffres, rien d'interne", () => {
  const doc = bilan.buildClientBilan({ clientName: "Jrenov", period, input, client, documents: [search] });
  const report = { title: "Rapport mensuel — Jrenov — novembre 2026", version: 2, kind: "monthly", period_start: "2026-11-01", period_end: "2026-11-30",
    client_content: { summary: client.summary, sections: [], documents: [doc, search] } };
  const email = preview.reportEmailPreview(report);
  assert.match(email.text, /^Bonjour,\n\nEn novembre, nous avons diffusé 3 publications/);
  assert.match(email.text, /Ce que nous avons fait pour vous\n• Réseaux sociaux : 3 publications diffusées/);
  assert.match(email.text, /Référencement · Clics Google : 340 \(\+12 %\)/);
  assert.match(email.text, /Nos priorités pour la suite\n• Accélérer le chargement mobile du site\./);
  assert.match(email.text, /Le détail en pièces jointes : Bilan du mois, Référencement Google\./);
  assert.match(email.html, /Votre bilan du mois/);
  assert.match(email.html, /Novembre 2026/);
  // Un rapport hebdomadaire ou sans bilan garde l'e-mail générique.
  const weekly = preview.reportEmailPreview({ ...report, kind: "weekly", client_content: { summary: "x", sections: [], documents: [search] } });
  assert.match(weekly.text, /Vous trouverez ci-joint votre rapport hebdomadaire/);
});

test("supervision : les rapports hebdomadaires ne couvrent pas les mensuels (bilans clients)", () => {
  const agents = [{ id: "r", name: "Agent Rapport", agent_type: "report", enabled: true, status: "Actif" }];
  const weeklyOnly = coverage.computeAgentCoverage({ agents, automations: [{ run_type: "report.generate", client_id: null, status: "active", config: { kind: "weekly" } }], assignments: [] });
  assert.deepEqual(plain(weeklyOnly.map((gap) => [gap.presetId, gap.kind])), [["monthly-reports", "missing_automation"]]);
  const legacyWeekly = coverage.computeAgentCoverage({ agents, automations: [{ run_type: "report.generate", client_id: null, status: "active" }], assignments: [] });
  assert.deepEqual(plain(legacyWeekly.map((gap) => gap.presetId)), ["monthly-reports"], "sans config.kind, l'automatisation est hebdomadaire");
  const both = coverage.computeAgentCoverage({ agents, automations: [{ run_type: "report.generate", client_id: null, status: "active", config: { kind: "weekly" } }, { run_type: "report.generate", client_id: null, status: "active", config: { kind: "monthly" } }], assignments: [] });
  assert.equal(both.length, 0);
});

test("À valider : les bilans du mois écoulé sont une confirmation cruciale (e-mail à un tiers)", () => {
  assert.equal(inbox.previousMonthStart(new Date("2026-12-03T08:00:00Z")), "2026-11-01");
  assert.equal(inbox.previousMonthStart(new Date("2026-01-01T00:30:00+01:00")), "2025-12-01");
  const base = { clients: [{ id: "c", name: "Jrenov" }], reports: [], recommendations: [], actions: [], ads: [], publications: [], autoApproveClients: null, prospection: [], seo: [], seoAgentId: null, photos: [], alerts: [] };
  const box = inbox.buildInbox({ ...base, bilans: [{ id: "r1", client_id: "c", period_start: "2026-11-01" }] });
  const section = box.sections.find((item) => item.id === "client-bilans");
  assert.equal(section.crucial, "third-party-email");
  assert.equal(section.agent, "client-bilan");
  assert.equal(section.manual, 1);
  assert.deepEqual(plain(section.items[0]), { id: "r1", title: "Bilan de novembre 2026", client: "Jrenov", at: "2026-11-01", href: "/reports/r1" });
  assert.equal(inbox.buildInbox(base).sections.some((item) => item.id === "client-bilans"), false, "lecture absente : pas de section");
});

test("chef de projet : le siège Bilan client exige les rapports mensuels et l'e-mail du client", () => {
  const facts = { clientId: "c", website: null, services: [], assignedTypes: new Set(), activeTypes: new Set(["report"]), publication: null, blog: null, visual: null, video: null, mediaLibrary: null };
  const seat = (extra) => plan.buildClientPlan({ ...facts, ...extra }).seats.find((item) => item.agent === "client-bilan");
  assert.equal(seat({ automations: [{ run_type: "report.generate", client_id: null, status: "active", config: { kind: "weekly" } }] }).state, "needs_setup");
  const monthly = [{ run_type: "report.generate", client_id: null, status: "active", config: { kind: "monthly" } }];
  assert.equal(seat({ automations: monthly, hasEmail: false }).state, "needs_setup");
  const ok = seat({ automations: monthly, hasEmail: true });
  assert.equal(ok.state, "working");
  assert.deepEqual(plain(ok.settings), ["Destinataire : e-mail de la fiche client"]);
  assert.ok(charter.getCharter("client-bilan").never.some((rule) => /sans action de l’administrateur/.test(rule)));
});

test("briefing : bilans préparés, envoyés et en attente ; écart si aucun bilan sur 40 jours", () => {
  const now = new Date("2026-12-05T10:00:00Z");
  const signals = briefing.bilanSignals([
    { kind: "monthly", status: "sent", created_at: "2026-12-03T07:00:00Z", sent_at: "2026-12-04T09:00:00Z" },
    { kind: "monthly", status: "approved", created_at: "2026-12-03T07:00:00Z" },
    { kind: "weekly", status: "approved", created_at: "2026-12-01T07:00:00Z" },
  ], now);
  assert.deepEqual(plain(signals.facts.map((fact) => fact.statement)), ["2 bilans mensuels préparés sur 40 jours.", "1 bilan envoyé au client.", "1 bilan attend votre envoi."]);
  assert.equal(briefing.bilanSignals([], now).gaps.length, 1);
});
