import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";
// Reprise Drive : le curseur relu en base (« +00:00 ») ne bloque plus la synchronisation d'un dossier.
test("backfill cursor read back from Postgres is normalized, an invalid one is still refused", async () => {
  const urls = [];
  const listing = loadTs("lib/media-intelligence/drive-listing.ts", { "@/lib/integrations/google-drive-oauth": { driveCredentials: () => ({}), driveAccessTokenSource: () => async () => "token" } },
    { fetch: async (url) => { urls.push(String(url)); return { ok: true, json: async () => ({ files: [{ id: "file_abcdefghij", modifiedTime: "2026-08-21T10:00:00.000Z", mimeType: "image/jpeg", size: "1200" }] }) }; } });
  const backfill = listing.driveFolderBackfill();
  const page = await backfill("folder_abcdefghij", "2026-08-20 13:10:34.063+00");
  assert.equal(page.files.length, 1);
  assert.match(decodeURIComponent(urls[0]).replaceAll('+', ' '), /modifiedTime > '2026-08-20T13:10:34\.063Z'/);
  await backfill("folder_abcdefghij", "2026-08-20T13:10:34.063+00:00");
  assert.match(decodeURIComponent(urls[1]).replaceAll('+', ' '), /modifiedTime > '2026-08-20T13:10:34\.063Z'/);
  await assert.rejects(() => backfill("folder_abcdefghij", "' or 1=1"), /Invalid cursor/);
});
