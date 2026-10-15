import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { executeLocalSql } from "./helpers/local-postgres.mjs";

// The disposable target MUST be loopback PostgreSQL with a dedicated test-only name.
// No production credentials or Supabase environment variables are used.
const urlString = process.env.CODEV_CORE_TEST_DATABASE_URL;
const targetName = "codev_core_test_seo_live_contract";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function env(database) {
  const url = new URL(urlString);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "loopback only");
  assert.match(url.pathname, /^\/codev_core_test(?:_[a-z0-9_]+)?$/, "test database only");
  const result = { ...process.env, PGHOST: "127.0.0.1", PGHOSTADDR: "127.0.0.1", PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: database, PGCONNECT_TIMEOUT: "5" };
  delete result.PGSERVICE; delete result.PGSERVICEFILE;
  return result;
}
const psql = (e, sql) => executeLocalSql(process.env.CODEV_CORE_TEST_PSQL ?? "psql", e, sql);

test("SEO V2 migration replays against the 15 October live dependency contract and service_role can write", {
  skip: !urlString && "Requires local disposable PostgreSQL. Never point at production.",
}, () => {
  const admin = psql(env("postgres"), `drop database if exists ${targetName}; create database ${targetName};`);
  assert.equal(admin.status, 0, admin.stderr);
  const db = env(targetName);
  const bootstrap = `
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
`;
  const schema = read("supabase/local/seo-v2-live-dependencies-20261015.sql");
  const migration = read("supabase/migrations/20261109000000_seo_keyword_opportunities.sql");
  const replay = psql(db, bootstrap + "\n" + schema + "\n" + migration);
  assert.equal(replay.status, 0, replay.stderr);

  const checks = psql(db, read("supabase/tests/seo-opportunities.sql"));
  assert.equal(checks.status, 0, checks.stderr);
  assert.ok(Number(checks.stdout.match(/SEO_OPPORTUNITY_CHECKS=(\d+)/)?.[1]) >= 19, checks.stdout);

  const roleCheck = psql(db, `
BEGIN;
INSERT INTO public.clients(id,name) VALUES('dddddddd-0000-4000-8000-000000000001','Synthetic local test client');
SET LOCAL ROLE service_role;
INSERT INTO public.seo_opportunity_analyses(client_id,depth,trigger,analysis_date)
  VALUES('dddddddd-0000-4000-8000-000000000001','daily','manual','2026-10-15');
INSERT INTO public.seo_keyword_opportunities(
  id,client_id,fingerprint,category,keyword,target_status,intent,priority,confidence,
  data_source,verified,metrics,rationale,recommended_action,action_kind
) VALUES (
  'dddddddd-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000001',
  'query:seo-live-contract','striking_distance','devis couvreur','existing','transactional',
  'medium','high','search_console',true,
  '{"clicks":3,"impressions":200,"ctr":0.015,"position":8.6}',
  'Observed Search Console query','Review existing landing page','optimize_page'
);
UPDATE public.seo_keyword_opportunities SET status='to_review' WHERE id='dddddddd-0000-4000-8000-000000000002';
INSERT INTO public.seo_opportunity_interventions(opportunity_id,client_id,keyword,created_by)
  VALUES('dddddddd-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000001','devis couvreur','test_admin');
SELECT 'SEO_SERVICE_ROLE_WRITES_OK' WHERE current_user='service_role';
RESET ROLE;
ROLLBACK;
`);
  assert.equal(roleCheck.status, 0, roleCheck.stderr);
  assert.match(roleCheck.stdout, /SEO_SERVICE_ROLE_WRITES_OK/);
});

test("live contract fixture is strictly schema-only and references no remote secrets", () => {
  const sql = read("supabase/local/seo-v2-live-dependencies-20261015.sql");
  for (const table of ["clients","agent_runs","recommendations","actions"]) assert.ok(sql.includes(`CREATE TABLE public.${table}`));
  assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|copy|drop)\s+(into\s+|from\s+)?public\./i);
  assert.doesNotMatch(sql, /postgres(ql)?:\/\//i);
  assert.doesNotMatch(sql, /service_role[^\n]*=(?:[^\n]*key)/i);
});
