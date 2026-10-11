import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

test("Vercel Web Analytics summary queries traffic, pages, referrers and custom events", async () => {
  const calls = [];
  const providerJson = async (_provider, url) => {
    calls.push(url);
    const parsed = new URL(url);
    const path = parsed.pathname;
    const by = parsed.searchParams.get("by");
    if (path.endsWith("/visits/count")) return { data: { pageviews: 1200, visitors: 640 } };
    if (path.endsWith("/visits/aggregate") && by === "requestPath") return { data: [
      { requestPath: "/", pageviews: 500, visitors: 350 },
      { requestPath: "/contact", pageviews: 120, visitors: 100 },
    ] };
    if (path.endsWith("/visits/aggregate") && by === "referrerHostname") return { data: [
      { referrerHostname: "google.com", pageviews: 300, visitors: 250 },
    ] };
    if (path.endsWith("/visits/aggregate") && ["route","country","deviceType","osName","clientName"].includes(by)) return { data: [
      { [by]: by === "country" ? "FR" : by === "deviceType" ? "mobile" : by === "osName" ? "Android" : by === "clientName" ? "Chrome" : "/", pageviews: 200, visitors: 150 },
    ] };
    if (path.endsWith("/events/aggregate") && by === "eventName") return { data: [
      { eventName: "lead_form_submit", count: 18, visitors: 17 },
      { eventName: "phone_click", count: 42, visitors: 35 },
    ] };
    throw new Error(`unexpected: ${url}`);
  };
  class ProviderError extends Error {}
  const vercel = loadTs("lib/providers/vercel.ts", {
    "@/lib/providers/api": { providerJson },
    "@/lib/providers/errors": { ProviderError },
  }, { URL, URLSearchParams });
  const data = await vercel.webAnalyticsSummary("prj_ABCDEF123", { start: "2026-09-01", end: "2026-09-30" }, { env: { VERCEL_TOKEN: "token", VERCEL_TEAM_ID: "team_123" } });
  assert.equal(data.pageviews, 1200);
  assert.equal(data.visitors, 640);
  assert.equal(data.topPages[0].label, "/");
  assert.equal(data.topReferrers[0].label, "google.com");
  assert.equal(data.events[0].label, "lead_form_submit");
  assert.equal(data.events[0].count, 18);
  assert.equal(data.devices[0].label, "mobile");
  assert.equal(data.countries[0].label, "FR");
  assert.equal(calls.length, 9);
  for (const url of calls) {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("projectId"), "prj_ABCDEF123");
    assert.equal(parsed.searchParams.get("teamId"), "team_123");
    assert.equal(parsed.searchParams.get("since"), "2026-09-01");
    assert.equal(parsed.searchParams.get("until"), "2026-09-30");
  }
});

test("Vercel analytics refuses malformed projects and periods before network", async () => {
  let calls = 0;
  class ProviderError extends Error { constructor(provider, kind) { super(kind); this.kind = kind; } }
  const vercel = loadTs("lib/providers/vercel.ts", {
    "@/lib/providers/api": { providerJson: async () => { calls++; return {}; } },
    "@/lib/providers/errors": { ProviderError },
  }, { URL, URLSearchParams });
  await assert.rejects(() => vercel.webAnalyticsSummary("../secret", { start: "2026-09-01", end: "2026-09-30" }, { env: { VERCEL_TOKEN: "token" } }));
  await assert.rejects(() => vercel.webAnalyticsSummary("prj_ABCDEF123", { start: "2026-10-01", end: "2026-09-30" }, { env: { VERCEL_TOKEN: "token" } }));
  assert.equal(calls, 0);
});
