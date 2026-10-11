import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

test("GitHub SEO context maps a public route to the real source file and extracts visible metadata", async () => {
  const calls = [];
  const providerJson = async (_provider, url) => {
    calls.push(url);
    if (url.endsWith("/repos/acme/site")) return { default_branch: "main" };
    if (url.includes("/git/trees/main?recursive=1")) return { tree: [
      { path: "src/app/services/toiture/page.tsx", type: "blob", size: 2000, sha: "abc" },
      { path: "src/app/page.tsx", type: "blob", size: 1000, sha: "home" },
    ] };
    if (url.includes("/contents/src/app/services/toiture/page.tsx")) {
      const source = `export const metadata = { title: "Couvreur Perpignan", description: "Réparation et rénovation de toiture." };
export default function Page(){ return <main><h1>Couvreur à Perpignan</h1></main> }`;
      return { encoding: "base64", content: Buffer.from(source).toString("base64"), sha: "full-sha" };
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  class ProviderError extends Error {}
  const github = loadTs("lib/providers/github.ts", {
    "node:buffer": { Buffer },
    "@/lib/providers/api": { providerJson },
    "@/lib/providers/errors": { ProviderError },
  });
  const rows = await github.readSeoPageContexts("acme/site", ["https://example.fr/services/toiture"], { env: { GITHUB_TOKEN: "token" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, "src/app/services/toiture/page.tsx");
  assert.equal(rows[0].title, "Couvreur Perpignan");
  assert.equal(rows[0].description, "Réparation et rénovation de toiture.");
  assert.equal(rows[0].h1, "Couvreur à Perpignan");
  assert.equal(rows[0].sha, "full-sha");
  assert.ok(calls.some((url) => url.includes("/git/trees/main")));
});

test("GitHub SEO context refuses malformed repositories before any API call", async () => {
  let calls = 0;
  const github = loadTs("lib/providers/github.ts", {
    "node:buffer": { Buffer },
    "@/lib/providers/api": { providerJson: async () => { calls++; return {}; } },
    "@/lib/providers/errors": { ProviderError: class ProviderError extends Error { constructor(provider, kind){ super(kind); this.kind = kind; } } },
  });
  await assert.rejects(() => github.readSeoPageContexts("../secret", ["https://example.fr/"], { env: { GITHUB_TOKEN: "token" } }));
  assert.equal(calls, 0);
});
