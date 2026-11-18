import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const weekly = loadTs("lib/performance/weekly-model.ts");
const outcome = loadTs("lib/launch/outcome.ts", { "@/lib/performance/weekly-model": weekly });
const catalog = loadTs("lib/launch/catalog.ts");

test("le résultat d'un relevé est une phrase française, jamais « collected 2, failed 0 »", () => {
  assert.equal(outcome.countSummary({ collected: 2, failed: 0, pending: 0, alerts: 0 }, ["collected", "failed", "alerts"]), "Terminé : 2 relevés enregistrés, aucune alerte.");
  assert.equal(outcome.countSummary({ audited: 1, failed: 1, alerts: 2 }, ["audited", "failed", "alerts"]), "Terminé : 1 site audité, 1 échec, 2 alertes ouvertes.");
  assert.equal(outcome.countSummary({ collected: 0, failed: 0, alerts: 0 }, ["collected", "failed", "alerts"]), "Terminé : rien de nouveau à relever.");
  assert.equal(outcome.countSummary({ disabled: "provider", collected: 0 }, ["collected"]), "Non lancé : fournisseur non configuré.");
  assert.equal(outcome.countSummary({ outside_window: 1 }, ["audited"]), "Non lancé : hors fenêtre.");
  for (const key of ["collected", "points", "audited", "checked", "findings", "opened", "alerts", "resolved", "approved", "archived", "candidates", "generated", "budget", "due", "ok", "runs", "failed"])
    assert.doesNotMatch(outcome.countSummary({ [key]: 3 }, [key]), new RegExp(`${key} \\d`));
});

test("chaque tâche lancée directement mène à l'écran de son résultat, ou détaille le résultat sur place", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(outcome.resultHref("local-geogrid", id), `/analytics?source=local&client=${id}#carte-positions`);
  assert.equal(outcome.resultHref("local-competition", id), `/analytics?source=local&client=${id}#concurrence-locale`);
  assert.equal(outcome.resultHref("local-seo", id), `/analytics?source=local&client=${id}#fiche-google`);
  assert.equal(outcome.resultHref("search-console", id), `/analytics?source=seo&client=${id}`);
  assert.equal(outcome.resultHref("lighthouse", id), "/performance");
  const detailedOnScreen = new Set(["blog", "visual", "video", "media-library", "site-health"]);
  for (const task of catalog.launchTasks.filter((t) => !t.href && !detailedOnScreen.has(t.id)))
    assert.ok(outcome.resultHref(task.id, id), `${task.id} sans écran de résultat`);
});

test("détail Lighthouse et santé technique : notes réelles, problèmes du plus grave au moins grave", () => {
  assert.deepEqual(outcome.lighthouseDetails([{ strategy: "mobile", scores: { performance: 71.6, accessibility: 90, "best-practices": 100, seo: 92 } }]),
    ["Mobile : performance 72/100, accessibilité 90/100, bonnes pratiques 100/100, SEO 92/100."]);
  const lines = outcome.siteHealthDetails({ url: "https://exemple.fr", score: 64, findings: [
    { severity: "medium", title: "Aucun sitemap lisible", fix: "Publier un sitemap.xml." },
    { severity: "critical", title: "Certificat HTTPS expiré", fix: "Renouveler le certificat." },
  ] });
  assert.equal(lines[0], "Note de santé technique de https://exemple.fr : 64/100.");
  assert.match(lines[1], /^Certificat HTTPS expiré \(critique\)/);
  assert.match(lines[2], /^Aucun sitemap lisible \(moyen\)/);
  assert.match(outcome.siteHealthDetails({ score: 100, findings: [] })[1], /Aucun problème détecté/);
  assert.match(outcome.siteHealthDetails(null)[0], /Aucun contrôle enregistré/);
});
