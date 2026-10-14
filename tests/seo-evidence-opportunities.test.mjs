import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const { analyzeSeo } = loadTs("lib/seo/analyze.ts");
const row = (keys, clicks, impressions, position = 8) => ({ keys, clicks, impressions, position, ctr: impressions ? clicks / impressions : 0 });

test("GSC truncated page inventory must not fabricate a lost page or zero current clicks", () => {
  const findings = analyzeSeo([], [row(["https://example.test/roof"], 30, 900)], [], []);
  assert.equal(findings.length, 0);
});

test("actual observed drop is retained with its before and after evidence", () => {
  const findings = analyzeSeo([row(["https://example.test/roof"], 9, 180)], [row(["https://example.test/roof"], 30, 900)], [], []);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "page_drop");
  assert.equal(findings[0].metrics.clicks, 9);
  assert.equal(findings[0].metrics.priorClicks, 30);
});

test("near-first-page query produces a sourced optimization suggestion without inventing a landing page", () => {
  const query = "couvreur décines";
  const result = analyzeSeo([], [], [row([query], 5, 140, 6.4)], [row([query], 5, 120, 7)], [row([query,"https://example.test/toiture"], 5, 140, 6.4)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "near_first_page");
  assert.equal(result[0].metrics.impressions, 140);
  assert.equal(result[0].targetPage, "https://example.test/toiture");
  assert.match(result[0].detail, /sans garantie/);
  const missingPage = analyzeSeo([],[],[row(["couvreur lyon"], 5, 150, 7)],[row(["couvreur lyon"], 4, 140, 7)]);
  assert.equal(missingPage[0].targetPage, undefined);
});

test("an observed low CTR takes precedence over a generic near-page-one opportunity", () => {
  const query = row(["réparation toiture"], 3, 600, 4.5);
  const result = analyzeSeo([],[],[query],[row(query.keys, 3, 600, 4.5)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "low_ctr");
});
