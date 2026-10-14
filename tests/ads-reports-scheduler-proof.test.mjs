import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("recurring Ads settings require observable scheduler proof rather than claiming active delivery", () => {
  const page = readFileSync(new URL("../app/(cockpit)/advertising/page.tsx", import.meta.url), "utf8");
  assert.match(page, /await requireAdmin\(\)/);
  assert.match(page, /getSchedulerHeartbeat\(\)/);
  assert.match(page, /Aucun passage du planificateur enregistré/);
  assert.match(page, /État du planificateur indisponible/);
  assert.match(page, /dernier passage réussi/);
  assert.match(page, /\/settings\/diagnostic/);
  assert.match(page, /<RecurringReportsPanel/);
});
