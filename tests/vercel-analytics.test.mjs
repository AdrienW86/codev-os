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
    if (path.endsWith("/visits/aggregate") && by === "day") return { data: [
      { timestamp: "2026-09-01T00:00:00.000Z", pageviews: 100, visitors: 60 },
      { timestamp: "2026-09-02T00:00:00.000Z", pageviews: 130, visitors: 75 },
    ] };
    if (path.endsWith("/visits/aggregate") && ["route","country","deviceType","osName","browserName"].includes(by)) return { data: [
      { [by]: by === "country" ? "FR" : by === "deviceType" ? "mobile" : by === "osName" ? "Android" : by === "browserName" ? "Chrome" : "/", pageviews: 200, visitors: 150 },
    ] };
    if (path.endsWith("/events/aggregate") && by === "day") return { data: [
      { timestamp: "2026-09-01T00:00:00.000Z", count: 4, visitors: 3 },
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
  assert.equal(data.browsers[0].label, "Chrome");
  assert.equal(data.trend[0].timestamp, "2026-09-01T00:00:00.000Z");
  assert.equal(data.eventTrend[0].count, 4);
  // 9 requêtes simples + séries quotidiennes (visites, événements) découpées en 2 fenêtres de ≤ 25 jours.
  assert.equal(calls.length, 13);
  assert.deepEqual({ ...data.sections.trend }, { ok: true });
  for (const url of calls) {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("projectId"), "prj_ABCDEF123");
    assert.equal(parsed.searchParams.get("teamId"), "team_123");
    assert.ok(Number(parsed.searchParams.get("limit") ?? 0) <= 25, "limit ≤ 25");
    if (parsed.searchParams.get("by") === "day") continue;
    assert.equal(parsed.searchParams.get("since"), "2026-09-01T00:00:00.000Z");
    assert.equal(parsed.searchParams.get("until"), "2026-09-30T23:59:59.999Z");
  }
  const windows = calls.map((url) => new URL(url)).filter((url) => url.pathname.endsWith("/visits/aggregate") && url.searchParams.get("by") === "day")
    .map((url) => [url.searchParams.get("since"), url.searchParams.get("until")]);
  assert.deepEqual(windows, [["2026-09-01T00:00:00.000Z", "2026-09-25T23:59:59.999Z"], ["2026-09-26T00:00:00.000Z", "2026-09-30T23:59:59.999Z"]]);
});

function loadVercel(providerJson) {
  class ProviderError extends Error {
    constructor(provider, kind, status = null, code = null) { super(`${provider} : ${kind}`); this.kind = kind; this.status = status; this.code = code; this.scopes = []; }
  }
  return { ProviderError, vercel: loadTs("lib/providers/vercel.ts", { "@/lib/providers/api": { providerJson }, "@/lib/providers/errors": { ProviderError } }, { URL, URLSearchParams }) };
}

test("Vercel analytics rejects absent or malformed mandatory counters instead of inventing zero", async () => {
  const period = { start: "2026-10-01", end: "2026-10-03" };
  const options = { env: { VERCEL_TOKEN: "isolated-token" } };
  for (const response of [null, {}, { data: null }, { data: [] }, { data: {} }]) {
    const { vercel } = loadVercel(async () => response);
    await assert.rejects(() => vercel.webAnalyticsCount("prj_ABCDEF123", period, options), error => error.kind === "malformed");
  }
  for (const field of ["pageviews", "visitors"]) {
    for (const invalid of [undefined, null, "0", "12", NaN, Infinity, -Infinity, -1]) {
      const { vercel } = loadVercel(async () => ({ data: { pageviews: 12, visitors: 6, [field]: invalid } }));
      await assert.rejects(() => vercel.webAnalyticsCount("prj_ABCDEF123", period, options), error => error.kind === "malformed");
    }
  }
  const { vercel } = loadVercel(async (_provider, url) => url.includes("/visits/count") ? { data: {} } : { data: [] });
  await assert.rejects(() => vercel.webAnalyticsSummary("prj_ABCDEF123", period, options), error => error.kind === "malformed");
});

test("Vercel analytics keeps explicit zero counters and empty successful dimensions", async () => {
  const { vercel } = loadVercel(async (_provider, url) => url.includes("/visits/count")
    ? { data: { pageviews: 0, visitors: 0 } } : { data: [] });
  const data = await vercel.webAnalyticsSummary("prj_ABCDEF123", { start: "2026-10-01", end: "2026-10-03" }, { env: { VERCEL_TOKEN: "isolated-token" } });
  assert.equal(data.visitors, 0); assert.equal(data.pageviews, 0);
  assert.equal(data.sections.topPages.ok, true); assert.equal(data.topPages.length, 0);
  assert.equal(data.sections.events.ok, true); assert.equal(data.events.length, 0);
});

test("Vercel analytics isolates malformed dimension counters while keeping verified totals", async () => {
  for (const row of [{ requestPath: "/contact", pageviews: 2 }, { requestPath: "/contact", pageviews: -1, visitors: 1 }, { requestPath: "/contact", pageviews: 2, visitors: "1" }, null, { pageviews: 2, visitors: 1 }]) {
    const { vercel } = loadVercel(async (_provider, url) => {
      if (url.includes("/visits/count")) return { data: { pageviews: 12, visitors: 6 } };
      if (new URL(url).searchParams.get("by") === "requestPath") return { data: [row] };
      return { data: [] };
    });
    const data = await vercel.webAnalyticsSummary("prj_ABCDEF123", { start: "2026-10-01", end: "2026-10-03" }, { env: { VERCEL_TOKEN: "isolated-token" } });
    assert.equal(data.visitors, 6); assert.equal(data.pageviews, 12);
    assert.equal(data.sections.topPages.ok, false); assert.match(data.sections.topPages.error, /malformed/);
    assert.equal(data.topPages.length, 0); assert.equal(data.sections.events.ok, true);
  }
});

test("Vercel analytics never zero-fills malformed daily or event counters", async () => {
  const { vercel } = loadVercel(async (_provider, url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/visits/count")) return { data: { pageviews: 12, visitors: 6 } };
    if (parsed.searchParams.get("by") === "day") return { data: [{ day: "2026-10-01", visitors: 1 }] };
    if (parsed.searchParams.get("by") === "eventName") return { data: [{ eventName: "phone_click", visitors: 1, count: null }] };
    return { data: [] };
  });
  const data = await vercel.webAnalyticsSummary("prj_ABCDEF123", { start: "2026-10-01", end: "2026-10-03" }, { env: { VERCEL_TOKEN: "isolated-token" } });
  assert.equal(data.visitors, 6);
  for (const section of ["trend", "eventTrend", "events"]) {
    assert.equal(data.sections[section].ok, false); assert.match(data.sections[section].error, /malformed/);
    assert.equal(data[section].length, 0);
  }
  assert.equal(data.sections.topPages.ok, true);
});

test("Vercel analytics: a refused complementary query is isolated with its cause, never fatal or zero-filled silently", async () => {
  let ProviderErrorRef;
  const { ProviderError, vercel } = loadVercel(async (_provider, url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/visits/count")) return { data: { pageviews: 200, visitors: 84 } };
    if (parsed.searchParams.get("by") === "day") throw new ProviderErrorRef("vercel", "rejected", 400, "invalid_query");
    return { data: [] };
  });
  ProviderErrorRef = ProviderError;
  const data = await vercel.webAnalyticsSummary("prj_ABCDEF123", { start: "2026-10-05", end: "2026-10-11" }, { env: { VERCEL_TOKEN: "secret-token" }, now: new Date("2026-10-11T12:00:00Z") });
  assert.equal(data.visitors, 84);
  assert.equal(data.trend.length, 0);
  assert.equal(data.sections.trend.ok, false);
  assert.match(data.sections.trend.error, /HTTP 400, invalid_query/);
  assert.doesNotMatch(JSON.stringify(data), /secret-token/);
  assert.equal(data.sections.events.ok, true);
});

test("Vercel analytics: the visit count stays mandatory and until is capped at now", async () => {
  const urls = [];
  const { ProviderError, vercel } = loadVercel(async (_provider, url) => {
    urls.push(new URL(url));
    if (url.includes("/visits/count")) throw new ProviderError("vercel", "unauthorized", 403, "forbidden");
    return { data: [] };
  });
  await assert.rejects(() => vercel.webAnalyticsSummary("prj_ABCDEF123", { start: "2026-10-05", end: "2026-10-11" }, { env: { VERCEL_TOKEN: "t" }, now: new Date("2026-10-11T12:00:00Z") }));
  assert.equal(urls.find((url) => url.pathname.endsWith("/visits/count")).searchParams.get("until"), "2026-10-11T12:00:00.000Z");
  assert.equal(vercel.describeVercelError(new ProviderError("vercel", "unauthorized", 403, "forbidden")), "vercel : unauthorized (HTTP 403, forbidden)");
});

test("Vercel analytics: daily windows cover the period without gaps and merge rows by date", async () => {
  const { vercel } = loadVercel(async (_provider, url) => {
    const since = new URL(url).searchParams.get("since").slice(0, 10);
    return { data: [{ timestamp: `${since}T00:00:00.000Z`, pageviews: 2, visitors: 1 }, { day: since, pageviews: 3, visitors: 2 }] };
  });
  const windows = vercel.periodWindows({ start: "2026-07-14", end: "2026-10-11" });
  assert.equal(windows.length, 4);
  assert.equal(windows[0].start, "2026-07-14");
  assert.equal(windows.at(-1).end, "2026-10-11");
  const trend = await vercel.dailyTrend("prj_ABCDEF123", { start: "2026-07-14", end: "2026-10-11" }, { env: { VERCEL_TOKEN: "t" } });
  assert.deepEqual(trend.map((point) => point.timestamp.slice(0, 10)), windows.map((window) => window.start));
  assert.equal(trend[0].pageviews, 3);
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

test("Vercel sync stores the snapshot with its format version, records partial failures and surfaces fatal causes", async () => {
  const upserts = [];
  const recorded = [];
  const db = {
    from: (table) => table === "client_connections"
      ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { metadata: { project_id: "prj_ABCDEF123" } }, error: null }) }) }) }) }
      : { upsert: async (row) => { upserts.push(row); return { error: null }; } },
  };
  class ProviderError extends Error { constructor(kind) { super(`vercel : ${kind}`); this.kind = kind; } }
  let countFails = false;
  const providers = {
    analyticsSectionLabels: { trend: "série quotidienne", events: "événements personnalisés" },
    describeVercelError: (error) => `${error.message} (HTTP 400, invalid_query)`,
    webAnalyticsSummary: async (_project, period) => {
      if (countFails) throw new ProviderError("rejected");
      return { projectId: "prj_ABCDEF123", period, visitors: 84, pageviews: 200, trend: [], eventTrend: [], topPages: [], topReferrers: [], routes: [], countries: [], devices: [], operatingSystems: [], browsers: [], events: [], sections: { trend: { ok: false, error: "vercel : rejected (HTTP 400, invalid_query)" }, events: { ok: true } } };
    },
    webAnalyticsCount: async () => ({ visitors: 70, pageviews: 150 }),
    dailyTrend: async () => { throw new ProviderError("rejected"); },
    webAnalyticsEvents: async () => [],
  };
  const sync = loadTs("lib/vercel-analytics/sync.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => db },
    "@/lib/providers/vercel": providers,
    "@/lib/connections/sync": { recordSync: async (...args) => { recorded.push(args); } },
  });
  const result = await sync.syncVercelAnalytics("client-1", { start: "2026-10-05", end: "2026-10-11" });
  assert.equal(result.ok, true);
  assert.equal(upserts[0].data.version, sync.VERCEL_SNAPSHOT_VERSION);
  assert.equal(upserts[0].data.previous.visitors, 70);
  assert.equal(upserts[0].data.previous.trend, undefined, "série précédente non récupérée : absente, pas vide");
  assert.equal(upserts[0].data.previous.period.start, "2026-09-28");
  assert.match(recorded[0][3].warning, /Synchronisation partielle — série quotidienne : .*HTTP 400/);
  assert.ok(upserts[0].data.insights.some((item) => item.title === "Aucun événement personnalisé collecté"));

  countFails = true;
  const failure = await sync.syncVercelAnalytics("client-1", { start: "2026-10-05", end: "2026-10-11" });
  assert.equal(failure.ok, false);
  assert.match(failure.error, /comptage des visites.*HTTP 400/);
  assert.equal(recorded.at(-1)[2].message, failure.error);
});
