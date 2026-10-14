import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Ads business context form needs only one disclosure and remains editable", () => {
  const page = read("app/(cockpit)/advertising/page.tsx");
  const editor = read("components/google-ads/business-context-editor.tsx");
  assert.ok(page.includes("Contexte commercial de l’agent"), "parent disclosure is present");
  assert.ok(!editor.includes("<details") && !editor.includes("<summary"), "the editor must not hide inside another disclosure");
  assert.ok(editor.includes('<section aria-label="Formulaire de contexte commercial"'));
  assert.ok(editor.includes("<form onSubmit={submit}"));
  assert.ok(editor.includes("saveAdsContextAction(clientId, input, revision)"));
  assert.ok(editor.includes("advertisingMonthlyBudget"));
  assert.ok(editor.includes("targetCostPerLead"));
});
