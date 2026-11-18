// Carte de positions Google Maps (lot 7, DataForSEO) : grille 7 × 7 autour de la fiche, une position par point,
// jamais de position inventée ; rendu dans le Rapport (ligne + PDF) et l'onglet Local.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const g = loadTs("lib/local-geogrid/model.ts");
const insights = loadTs("lib/reports/insights.ts");
const b = loadTs("lib/harness/briefing.ts");
const now = new Date("2026-11-18T10:00:00.000Z");
const plain = (value) => JSON.parse(JSON.stringify(value));

test("keywords: activity first, then non-brand Search Console queries containing the activity, 3 at most", () => {
  const kws = g.geogridKeywords({ activity: "Couvreur", company: "Couverture Catalane", queries: [
    { query: "couverture catalane avis", impressions: 900 }, { query: "couvreur perpignan", impressions: 500 }, { query: "plombier perpignan", impressions: 400 },
    { query: "couvreur zingueur perpignan", impressions: 120 }, { query: "couvreur pas cher", impressions: 50 }, { query: "Couvreur", impressions: 30 }] });
  assert.deepEqual(plain(kws), ["couvreur", "couvreur perpignan", "couvreur zingueur perpignan"]);
  assert.deepEqual(plain(g.geogridKeywords({ activity: "", company: "x", queries: [] })), []);
  assert.equal(g.geogridKey("Couvreur Perpignan"), "k:couvreur-perpignan");
});

test("center: listing coordinates first, else competitors' barycentre, else nothing", () => {
  assert.deepEqual(plain(g.geogridCenter({ client: { lat: 42.7, lng: 2.89 }, competitors: [] })), { lat: 42.7, lng: 2.89, origin: "listing" });
  assert.deepEqual(plain(g.geogridCenter({ client: null, competitors: [{ lat: 42.6, lng: 2.8 }, { lat: 42.8, lng: 3.0 }] })), { lat: 42.7, lng: 2.9, origin: "competitors" });
  assert.equal(g.geogridCenter({ client: { lat: null }, competitors: [{ lat: 1, lng: 1 }] }), null);
});

test("points: 49 points, north-west first, 1.5 km apart, centre in the middle", () => {
  const pts = g.geogridPoints({ lat: 42.7, lng: 2.9 });
  assert.equal(pts.length, 49);
  assert.deepEqual(plain(pts[24]), { lat: 42.7, lng: 2.9 });
  assert.ok(pts[0].lat > 42.7 && pts[0].lng < 2.9, "first point is north-west");
  assert.ok(Math.abs((pts[0].lat - pts[7].lat) * 111.32 - 1.5) < 0.01, "rows 1.5 km apart");
  assert.ok(Math.abs((pts[1].lng - pts[0].lng) * 111.32 * Math.cos(42.7 * Math.PI / 180) - 1.5) < 0.01, "columns 1.5 km apart");
});

test("grid: found / top 3 / average on found points; failed points are never counted as absent", () => {
  const ranks = Array(49).fill(null); ranks[24] = 1; ranks[23] = 2; ranks[25] = 5; ranks[0] = 15; ranks[48] = undefined; ranks[47] = 99;
  const grid = g.buildGeogrid({ keyword: "couvreur", center: { lat: 42.7, lng: 2.9, origin: "listing" }, ranks, now });
  assert.equal(grid.found, 4); assert.equal(grid.top3, 2); assert.equal(grid.average, 5.8);
  assert.deepEqual(plain(grid.failed), [48]); assert.equal(grid.cells[47], null, "beyond the depth = absent");
  assert.equal(g.readGeogrid(plain(grid)).found, 4);
  assert.equal(g.readGeogrid({ ...plain(grid), cells: [1, 2] }), null);
  assert.equal(g.geogridTone(2, false), "top"); assert.equal(g.geogridTone(7, false), "mid"); assert.equal(g.geogridTone(14, false), "low");
  assert.equal(g.geogridTone(null, false), "none"); assert.equal(g.geogridTone(null, true), "unknown");
  assert.equal(g.geogridDue({ lastAt: "2026-11-14T10:00:00Z", lastFailureAt: null }, now), false);
  assert.equal(g.geogridDue({ lastAt: null, lastFailureAt: null }, now), true);
});

test("report line and briefing fact state the measured points, never a fake zero", () => {
  const grid = { keyword: "couvreur", checkedAt: "2026-11-16T10:00:00Z", size: 7, spacingKm: 1.5, cells: Array(49).fill(null).map((_, i) => (i < 10 ? 2 : null)), failed: [48], found: 10, top3: 10, average: 2 };
  const lines = insights.geogridLines([grid]);
  assert.match(lines[0], /Carte Google Maps « couvreur » \(7 × 7 points sur 9 km autour de la fiche, relevé du 16 novembre\) : top 3 sur 10 points sur 48, présente sur 10, position moyenne 2 là où elle apparaît/);
  assert.equal(insights.geogridLines([{ ...grid, failed: Array.from({ length: 49 }, (_, i) => i) }]).length, 0);
  const facts = b.geogridSignals([{ metric_key: "k:couvreur", fetched_at: now.toISOString(), data: grid }]);
  assert.match(facts[0].statement, /top 3 sur 10 point\(s\) sur 48/);
  assert.equal(b.geogridSignals(null).length, 0);
});

test("wiring: DataForSEO only, coordinate search, step registered, PDF grid schema, Local tab", () => {
  const service = readFileSync("lib/local-geogrid/service.ts", "utf8");
  assert.match(service, /process\.env\.DATAFORSEO_LOGIN[\s\S]*process\.env\.DATAFORSEO_PASSWORD/);
  assert.match(service, /if\(!deps\.transport\.dataforseo\)return \{\.\.\.summary,disabled:'provider'\}/);
  assert.match(readFileSync("lib/integrations/local-competition.ts", "utf8"), /location_coordinate:`\$\{coordinate\.lat\.toFixed\(6\)\},\$\{coordinate\.lng\.toFixed\(6\)\},14z`/);
  assert.match(readFileSync("app/api/internal/scheduler/tick/route.ts", "utf8"), /step\("local_geogrid", \(\) => runLocalGeogridTick\(new Date\(\)\)/);
  assert.match(readFileSync("lib/reports/documents/model.ts", "utf8"), /grids: z\.array\(gridSchema\)\.max\(3\)\.optional\(\)/);
  assert.match(readFileSync("app/(cockpit)/analytics/page.tsx", "utf8"), /Local · Google Maps/);
  assert.doesNotMatch(readFileSync("components/analytics/local-dashboard.tsx", "utf8"), /#[0-9a-f]{3,6}\b|rgb\(/i, "design tokens only");
});

test("report document: grids attached to the search document (or alone), validated and drawn in the PDF", () => {
  const model = loadTs("lib/reports/documents/model.ts");
  const preview = loadTs("lib/reports/email-preview.ts", { "./recipient": loadTs("lib/reports/recipient.ts"), "./documents/model": model });
  const pdf = loadTs("lib/reports/pdf.ts", { "./email-preview": preview });
  const build = loadTs("lib/reports/documents/build.ts");
  const documentPdf = loadTs("lib/reports/documents/pdf.ts", { "../pdf": pdf, "./model": model });
  const cells = Array(49).fill(null).map((_, i) => (i % 3 === 0 ? (i % 20) + 1 : null));
  const grids = build.geogridDocumentGrids([{ keyword: "couvreur", checkedAt: "2026-11-16T10:00:00Z", size: 7, spacingKm: 1.5, cells, failed: [48], found: 17, top3: 4, average: 8.4 }]);
  assert.match(grids[0].caption, /7 × 7 points sur 9 km autour de la fiche, relevé du 16\/11 : top 3 sur 4 points sur 48, présente sur 17, position moyenne 8,4/);
  const alone = build.withGeogrids(null, grids);
  assert.equal(alone.key, "search"); assert.equal(alone.grids.length, 1);
  assert.equal(build.withGeogrids(null, []), null, "no grid, no invented document");
  model.reportDocumentSchema.parse(alone);
  assert.throws(() => model.reportDocumentSchema.parse({ ...alone, grids: [{ ...grids[0], cells: [1, 2, 3] }] }));
  const buffer = documentPdf.renderReportDocumentPdf({ clientName: "Client", kindLabel: "Rapport mensuel", periodLabel: "novembre 2026", version: 1, finalized: true }, alone);
  assert.ok(buffer.length > 1000);
  assert.match(buffer.toString("latin1"), /re f/);
});
