import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const schema = loadTs("lib/seo/schema-availability.ts");
const source = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("fallback is allowed only for a demonstrably missing SEO V2 table", () => {
  assert.equal(schema.missingSeoSchema({code:"PGRST205"}),true);
  assert.equal(schema.missingSeoSchema({code:"42P01"}),true);
  for (const code of ["42501","PGRST301","57014","PGRST116","08006",undefined]) {
    assert.equal(schema.missingSeoSchema({code}),false,String(code));
  }
  assert.equal(schema.missingSeoSchema(null),false);
});
test("SEO V2 rollout preserves legacy analysis until SQL is approved and applied", () => {
  const run = source("lib/seo/run.ts");
  const ui = source("app/(cockpit)/agents/[id]/opportunities/page.tsx");
  const store = source("lib/seo/opportunity-service.ts");
  assert.match(run, /if \(missingSeoSchema\(schema\.error\)\) return legacyAnalyzeSeoRun\(args\)/);
  assert.match(run, /Disponibilité du stockage SEO V2 non vérifiable/);
  assert.match(store, /seoV2SchemaReady/);
  assert.match(ui, /Stockage SEO V2 non installé/);
  assert.match(ui, /disabled=\{!active \|\| !schemaReady\}/);
});
