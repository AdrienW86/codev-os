import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Performance AI route is admin-only, same-origin and rate limited", () => {
  const source = read("app/api/performance/explain/route.ts");
  assert.match(source, /await requireAdmin\(\)/);
  assert.match(source, /checkSameOrigin\(request.headers, request.url\)/);
  assert.match(source, /createRateLimiter\(6, 60_000\)/);
  assert.match(source, /readJsonBody\(request, 1024\)/);
  assert.match(source, /\.eq\("id", parsed.data.auditId\)/);
  assert.match(source, /\.eq\("url", audit.url\)\.eq\("strategy", audit.strategy\)/);
  assert.match(source, /selectAIProvider\(\)/);
  assert.match(source, /Aucune modification|aucune modification|Aucune modification de site/);
});

test("The model receives only business context and recorded Lighthouse evidence", () => {
  const source = read("app/api/performance/explain/route.ts");
  assert.match(source, /\.select\("name,company_name,activity,geographic_area,website"\)/);
  assert.doesNotMatch(source, /\.select\(".*email.*"\)/);
  assert.doesNotMatch(source, /\.select\(".*phone.*"\)/);
  assert.doesNotMatch(source, /\.select\(".*notes.*"\)/);
  assert.match(source, /analysisSchema.safeParse/);
  assert.match(source, /donnée non fiable/);
  assert.match(source, /maxTokens: 2200/);
});

test("An audit must be persisted before the agent runs, including from history", () => {
  const route = read("app/api/performance/route.ts");
  const ui = read("components/performance/performance-analyzer.tsx");
  const panel = read("components/performance/performance-ai-panel.tsx");
  assert.match(route, /\.select\("id"\)\.single\(\)/);
  assert.match(route, /saved, auditId/);
  assert.match(ui, /setAgentAuditId\(item.id\)/);
  assert.match(ui, /<PerformanceAgentPanel auditId=\{agentAuditId\}/);
  assert.match(panel, /"\/api\/performance\/explain"/);
  assert.match(panel, /disabled=\{!auditId \|\| loading\}/);
  assert.match(panel, /Aucun changement n&apos;est exécuté/);
});
