// Agent Veille recentré sur l'IA et le SEO : sources, pertinence (français compris), suivi des sources injoignables.
import test from "node:test";
import assert from "node:assert/strict";
import { load, src } from "./helpers/ts-load.mjs";

const sources = load("lib/news/sources.ts"), rank = load("lib/news/rank.ts");

test("sources: IA and SEO only, https, unique ids, official sources first, French sources included", () => {
  const list = sources.newsSources;
  assert.ok(list.length >= 10);
  for (const id of ["search-engine-land", "search-engine-roundtable"]) assert.ok(!list.some((s) => s.id === id), `${id} refuse la collecte`);
  assert.deepEqual([...new Set(list.map((s) => s.category))].sort(), ["IA", "SEO"]);
  assert.equal(new Set(list.map((s) => s.id)).size, list.length);
  for (const s of list) { assert.match(s.url, /^https:\/\//, s.id); assert.ok(s.weight > 0 && s.weight <= 1, s.id); }
  for (const id of ["openai", "google-deepmind", "mistral", "google-search-central"]) assert.ok(list.some((s) => s.id === id), id);
  assert.ok(list.some((s) => s.language === "fr" && s.category === "IA") && list.some((s) => s.language === "fr" && s.category === "SEO"));
});

test("ranking: French AI and SEO wording counts as relevant", () => {
  const now = new Date("2026-11-04T00:00:00Z"), at = "2026-11-03T00:00:00Z";
  const fr = rank.scoreItem({ title: "Google étend AI Overviews et le référencement local", summary: "", publishedAt: at }, "SEO", 1, now);
  const off = rank.scoreItem({ title: "Recette de cuisine", summary: "", publishedAt: at }, "SEO", 1, now);
  assert.ok(fr > off);
  assert.ok(rank.scoreItem({ title: "Mistral publie un nouveau modèle", summary: "", publishedAt: at }, "IA", 1, now) > rank.scoreItem({ title: "Météo", summary: "", publishedAt: at }, "IA", 1, now));
});

test("wiring: unreachable sources are listed in the run, the feed page is admin-only and linked from the home page", () => {
  assert.match(src("lib/news/run.ts"), /data: \{ stored, failedSources, failedIds \}/);
  assert.match(src("app/(cockpit)/news/page.tsx"), /await requireAdmin\(\)/);
  assert.match(src("components/dashboard/tech-news.tsx"), /href="\/news"/);
});
