import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

test("Supabase migration filenames must never reuse the same version", () => {
  const files = readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file));
  assert.ok(files.length >= 1, "no local migration files found");
  const byVersion = new Map();
  for (const file of files) {
    const version = file.slice(0, 14);
    const prior = byVersion.get(version);
    assert.equal(prior, undefined, `Duplicate migration version ${version}: ${prior} conflicts with ${file}`);
    byVersion.set(version, file);
  }
});
