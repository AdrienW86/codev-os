import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const clientId = "d94e386a-653e-478b-80f1-05d442baed92", connectionId = "dcdd86a2-66c2-4714-bc20-7e50c48288de";
const connection = { id: connectionId, client_id: clientId, external_account_id: "1234567890", status: "connected", metadata: {} };
const periods = loadTs("lib/integrations/google-ads/periods.ts");
const dashboard = loadTs("lib/integrations/google-ads/dashboard.ts", { "./periods": periods });
function setup(initial = {}, options = {}, deny = false) {
  const fake = createFakeSupabase(initial, options), audits = [], reads = [];
  const service = loadTs("lib/integrations/google-ads/tracking.ts", {
    "./tracking-store": loadTs("lib/integrations/google-ads/tracking-store.ts", { "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client } }),
    "@/lib/require-admin": { requireAdmin: async () => { if (deny) throw new Error("denied"); return { userId: "admin-test" }; } },
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "@/lib/audit-logs": { writeAuditLog: async (entry) => audits.push(entry) },
    "@/lib/agents/validation": { isAgentUuid: (id) => /^[a-f0-9-]{36}$/.test(id) },
    "./validation": { getAdsPeriod: () => ({ start: "2026-10-01", end: "2026-10-07", days: 7 }) },
    "./client": { createGoogleAdsReadClient: () => ({
      getAccountSummary: async (id) => { reads.push(id); return { id, timezone: "Europe/Paris" }; },
      getCampaignPerformance: async () => ({ campaigns: [{ id: "123" }, { id: "456" }] }),
    }) },
  });
  return { ...fake, service, audits, reads };
}
test("tracking defaults and explicit empty selections are distinct; account access is explicit in the URL", () => {
  const rows = [{ id: "123", status: "ENABLED", type: "SEARCH" }, { id: "456", status: "ENABLED", type: "SEARCH" }];
  assert.equal(dashboard.filterCampaigns(rows, dashboard.DEFAULT_FILTERS, null).length, 2);
  assert.equal(dashboard.filterCampaigns(rows, dashboard.DEFAULT_FILTERS, []).length, 0);
  assert.deepEqual(Array.from(dashboard.filterCampaigns(rows, dashboard.DEFAULT_FILTERS, ["456"]), (row) => row.id), ["456"]);
  const filters = dashboard.parseFilters(new URLSearchParams("ads_scope=account"));
  assert.equal(dashboard.filterCampaigns(rows, filters, []).length, 2);
  assert.equal(dashboard.writeFilters(new URLSearchParams("client=x"), filters).get("ads_scope"), "account");
});
test("tracking reads are client/account bound, and errors never silently broaden a configured scope", async () => {
  const s = setup({ client_ads_scopes: [{ client_id: clientId, connection_id: connectionId, account_id: connection.external_account_id, revision: 3 }], client_ads_campaigns: [{ client_id: clientId, account_id: connection.external_account_id, campaign_id: "123" }, { client_id: "other", account_id: connection.external_account_id, campaign_id: "456" }] });
  const result = await s.service.loadCampaignTracking(connection);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { available: true, revision: 3, ids: ["123"] });
  await assert.rejects(s.service.loadCampaignTracking({ ...connection, external_account_id: "0000000000" }));
  const failure = setup({}, { failOn: () => ({ code: "08006" }) });
  await assert.rejects(failure.service.loadCampaignTracking(connection));
  const missing = setup({}, { failOn: () => ({ code: "42P01" }) });
  assert.equal((await missing.service.loadCampaignTracking(connection)).available, false);
});
test("unknown, duplicate and malformed campaign IDs never reach the persistence RPC", async () => {
  const s = setup();
  for (const ids of [["999"], ["123", "123"], ["123 OR 1=1"], Array(51).fill("123"), null]) assert.equal((await s.service.saveCampaignTracking(connection, ids, 0)).ok, false);
  assert.equal(s.calls.filter(([kind]) => kind === "rpc").length, 0);
});
test("the verified account and revision reach one atomic RPC; conflicts are surfaced", async () => {
  const s = setup({}, { rpc: { codev_set_ads_campaigns: (args) => { assert.equal(args.p_account_id, connection.external_account_id); assert.equal(args.p_client_id, clientId); assert.equal(args.p_revision, 2); return 3; } } });
  assert.equal((await s.service.saveCampaignTracking(connection, ["123"], 2)).ok, true);
  assert.equal(s.audits[0].metadata.revision, 3);
  const conflict = setup();
  conflict.client.rpc = async () => ({ error: { code: "23505" } });
  assert.match((await conflict.service.saveCampaignTracking(connection, ["123"], 0)).message, /autre client/);
});
test("admin denial occurs before any read or provider call", async () => {
  const s = setup({}, {}, true);
  await assert.rejects(s.service.loadCampaignTracking(connection));
  await assert.rejects(s.service.saveCampaignTracking(connection, ["123"], 0));
  assert.equal(s.calls.length + s.reads.length, 0);
});
