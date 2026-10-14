import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Ads business context form needs only one disclosure and remains editable", () => {
  const page = read("app/(cockpit)/advertising/page.tsx");
  const editor = read("components/google-ads/business-context-editor.tsx");
  assert.match(page, /<summary[^>]*>Contexte commercial de l);
  assert.doesNotMatch(editor, /<details\\b|<summary\\b/, "the parent already owns the disclosure");
  assert.match(editor, /<section aria-label="Formulaire de contexte commercial"/);
  assert.match(editor, /<form onSubmit={submit}/);
  assert.match(editor, /saveAdsContextAction\\(clientId, input, revision\\)/);
  assert.match(editor, /advertisingMonthlyBudget/);
  assert.match(editor, /targetCostPerLead/);
});
