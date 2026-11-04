// Calendrier des publications (vue mobile) : filtres d'URL, regroupement, grille du mois, puces intelligentes.
import test from "node:test";
import assert from "node:assert/strict";
import { load, src, json } from "./helpers/ts-load.mjs";

const m = load("lib/publications/published-model.ts");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const item = (o) => ({ key: o.key, publicationId: o.pub ?? o.key, groupKey: o.group ?? o.key, clientId: o.client ?? A, clientName: o.client === B ? "Beta" : "Alpha",
  platform: o.platform ?? "facebook", status: o.status ?? "published", at: o.at, text: o.text ?? null, imagePath: o.image ?? null, remoteId: o.remote ?? null, errorCode: null });

test("filters: read from the URL, unknown values fall back to defaults, day kept only inside the month", () => {
  const f = m.parsePublishedFilters({ view: "problems", client: A.toUpperCase(), platform: "instagram", month: "2026-10", day: "2026-10-31" }, "2026-11-04");
  assert.deepEqual(json(f), { view: "problems", client: A, platform: "instagram", month: "2026-10", day: "2026-10-31" });
  assert.deepEqual(json(m.parsePublishedFilters({ view: "x", client: "nope", platform: "myspace", month: "2026-13", day: "2026-11-31" }, "2026-11-04")),
    { view: "published", client: null, platform: null, month: "2026-11", day: null });
  assert.equal(m.parsePublishedFilters({ month: "2026-10", day: "2026-11-02" }, "2026-11-04").day, null, "jour hors du mois ignoré");
  assert.deepEqual(json(m.monthRange("2026-02")), { from: "2026-02-01", to: "2026-02-28" });
  assert.equal(m.shiftMonth("2026-01", -1), "2025-12"); assert.equal(m.shiftMonth("2026-12", 1), "2027-01");
  assert.equal(m.monthLabel("2026-11"), "Novembre 2026");
});

test("links: changing view, client, network or month clears the day; defaults are omitted", () => {
  const f = { view: "published", client: A, platform: null, month: "2026-11", day: "2026-11-03" };
  assert.equal(m.calendarHref(f, { platform: "instagram" }), `/publications/published?client=${A}&platform=instagram&month=2026-11`);
  assert.equal(m.calendarHref(f, { day: "2026-11-04" }), `/publications/published?client=${A}&month=2026-11&day=2026-11-04`);
  assert.equal(m.calendarHref({ ...f, client: null, day: null }, { view: "upcoming" }), "/publications/published?view=upcoming&month=2026-11");
});

test("cards: one card per editorial group and Paris day, networks ordered, Facebook post link only when published", () => {
  const items = [
    item({ key: "fb", group: "g1", platform: "facebook", at: "2026-11-03T08:00:10Z", text: "Texte #tag", remote: "123456_7890123", image: "a/1.jpg" }),
    item({ key: "ig", group: "g1", platform: "instagram", at: "2026-11-03T08:00:40Z" }),
    item({ key: "late", group: "g2", platform: "google_business_profile", at: "2026-11-03T23:30:00Z" }),
  ];
  const cards = m.buildCards(items, "published");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].date, "2026-11-04", "23 h 30 UTC = le lendemain à Paris, plus récent d'abord");
  const g1 = cards[1];
  assert.deepEqual(g1.networks.map((n) => n.platform), ["facebook", "instagram"]);
  assert.equal(g1.time, "09:00"); assert.equal(g1.imagePath, "a/1.jpg");
  assert.equal(g1.networks[0].url, "https://www.facebook.com/123456_7890123"); assert.equal(g1.networks[1].url, null);
  assert.equal(m.buildCards(items, "upcoming")[0].date, "2026-11-03", "à venir : du plus proche au plus lointain");
  assert.equal(m.excerpt("Bonjour #toiture   le   monde"), "Bonjour le monde");
});

test("month grid: Monday first, whole weeks, dots per network, today and problems flagged", () => {
  const cards = m.buildCards([item({ key: "x", at: "2026-11-03T08:00:00Z", status: "failed", platform: "instagram" })], "problems");
  const weeks = m.monthGrid("2026-11", cards, "2026-11-04");
  assert.equal(weeks[0][0].date, "2026-10-26"); assert.equal(weeks.at(-1).at(-1).date, "2026-12-06");
  assert.ok(weeks.every((w) => w.length === 7));
  const cell = weeks.flat().find((c) => c.date === "2026-11-03");
  assert.deepEqual(json(cell), { date: "2026-11-03", inMonth: true, count: 1, platforms: ["instagram"], today: false, problem: true });
  assert.equal(weeks.flat().find((c) => c.date === "2026-11-04").today, true);
});

test("smart chips: each chip counts what it would show given the other filter; totals follow both", () => {
  const items = [item({ key: "1", client: A, platform: "facebook", at: "2026-11-01T08:00:00Z" }), item({ key: "2", client: A, platform: "instagram", at: "2026-11-01T08:00:00Z" }),
    item({ key: "3", client: B, platform: "facebook", at: "2026-11-02T08:00:00Z" })];
  const c = m.chipCounts(items, { client: A, platform: "facebook" });
  assert.deepEqual(json([...c.clients.entries()]), [[A, { name: "Alpha", count: 1 }], [B, { name: "Beta", count: 1 }]], "clients comptés pour le réseau choisi");
  assert.deepEqual(json([...c.platforms.entries()]), [["facebook", 1], ["instagram", 1]], "réseaux comptés pour le client choisi");
  assert.equal(c.total, 1);
  assert.equal(m.applyFilters(items, { client: null, platform: "facebook" }).length, 2);
});

test("wiring: read-only loader, admin guard, reachable from the sidebar, the Publications views and the client page", () => {
  const loader = src("lib/publications/published.ts");
  assert.match(loader, /await requireAdmin\(\)/);
  assert.doesNotMatch(loader, /\.(insert|update|upsert|delete|rpc)\(/, "lecture seule");
  assert.match(loader, /eq\('status','published'\)\.gte\('published_at',start\)/);
  assert.match(src("app/(cockpit)/publications/published/page.tsx"), /await requireAdmin\(\)/);
  assert.match(src("components/layout/navigation.tsx"), /href="\/publications\/published"/);
  assert.match(src("components/publications/publications-board.tsx"), /item\('published','Publiées','\/publications\/published'\)/);
  assert.match(src("components/clients/client-publications-panel.tsx"), /\/publications\/published\?client=\$\{clientId\}/);
});
