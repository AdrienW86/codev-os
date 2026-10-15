import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

test("recurring Ads reports display scheduler health, not just a historical success", () => {
  const page = readFileSync(new URL("../app/(cockpit)/advertising/page.tsx", import.meta.url), "utf8");
  assert.match(page, /await requireAdmin\(\)/);
  assert.match(page, /getSchedulerHeartbeat\(\)/);
  assert.match(page, /classifyScheduler\(/);
  assert.match(page, /DIAGNOSTIC_STATUS_LABELS/);
  assert.match(page, /La préparation et l’envoi automatiques ne sont pas confirmés/);
  assert.match(page, /\/settings\/diagnostic/);
  assert.match(page, /<RecurringReportsPanel/);
});

test("failed or expired scheduler passage never proves automatic reports operational", () => {
  const model = loadTs("lib/system/diagnostic-model.ts");
  const now = new Date("2026-10-15T09:00:00Z");
  const beat = {
    startedAt: "2026-10-11T08:00:00Z",
    finishedAt: "2026-10-11T08:01:00Z",
    lastSuccessAt: "2026-10-11T08:01:00Z",
    lastFailureAt: null,
    ok: true,
    steps: [],
  };
  assert.equal(model.classifyScheduler(true, beat, now).status, "error");
  assert.equal(model.classifyScheduler(false, beat, now).status, "disabled");
  assert.notEqual(model.classifyScheduler(true, null, now).status, "operational");
  const recent = { ...beat, startedAt: "2026-10-15T08:00:00Z", finishedAt: "2026-10-15T08:01:00Z", lastSuccessAt: "2026-10-15T08:01:00Z" };
  assert.equal(model.classifyScheduler(true, recent, now).status, "operational");
});
