import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
const types = loadTs("lib/runs/types.ts");
const errors = loadTs("lib/providers/errors.ts");
const anomalies = loadTs("lib/ads/anomalies.ts");

test("Scheduled monitor uses persisted client tracking, freezes scope and excludes Local Services", async () => {
  const fake = createFakeSupabase({ client_connections: [{ id: "connection", client_id: "client-a", provider: "google_ads", status: "connected", external_account_id: "1234567890", metadata: {} }], agent_runs: [{ id: "run", client_id: "client-a", agent_id: "agent", status: "running" }] });
  const row = (id, type, cost) => ({ id, type, name: id, status: "ENABLED", impressions: 100, clicks: 10, cost, conversions: 1, budget: null });
  const monitor = loadTs("lib/ads/run.ts", {
    "@/lib/connections/sync": { recordSync: async () => {} }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "@/lib/providers/google-ads": { campaignMetrics: async () => [row("tracked", "SEARCH", 10), row("untracked", "SEARCH", 999), row("lsa", "LOCAL_SERVICES", 999)] },
    "@/lib/providers/errors": errors, "@/lib/ads/anomalies": anomalies, "@/lib/agents/outputs": {}, "@/lib/runs/types": types,
    "@/lib/integrations/google-ads/tracking-store": { readCampaignTracking: async () => ({ available: true, ids: ["tracked", "lsa"], revision: 3 }) },
  });
  const result = await monitor.monitorAdsRun({ job: { client_id: "client-a" }, agent: { id: "agent" }, actor: {}, now: new Date("2026-10-10T12:00:00Z"), runId: "run" });
  assert.equal(result.status, "succeeded"); assert.equal(fake.tables.metric_snapshots[0].data.cost, 10);
  assert.deepEqual(fake.tables.agent_runs[0].metadata.scope.campaignIds, ["tracked", "lsa"]); assert.equal(fake.tables.agent_runs[0].metadata.scope.trackingRevision, 3);
});

test("Missing monitor metrics fail instead of becoming zero; Local Services metrics are omitted", async () => {
  const api = { googleAccessToken: async () => "fake", providerJson: async () => ({ results: [{ campaign: { id: "123", advertisingChannelType: "SEARCH" }, metrics: { impressions: "10", clicks: "2", costMicros: "1000000" } }] }) };
  const env = { GOOGLE_ADS_CLIENT_ID: "fake", GOOGLE_ADS_CLIENT_SECRET: "fake", GOOGLE_ADS_REFRESH_TOKEN: "fake", GOOGLE_ADS_DEVELOPER_TOKEN: "fake" };
  const provider = loadTs("lib/providers/google-ads.ts", { "@/lib/providers/api": api, "@/lib/providers/errors": errors });
  await assert.rejects(() => provider.campaignMetrics("1234567890", { start: "2026-10-01", end: "2026-10-07" }, { env }), (error) => error.kind === "malformed");
  api.providerJson = async () => ({ results: [{ campaign: { id: "456", advertisingChannelType: "LOCAL_SERVICES" } }] });
  assert.equal((await provider.campaignMetrics("1234567890", { start: "2026-10-01", end: "2026-10-07" }, { env })).length, 0);
});
