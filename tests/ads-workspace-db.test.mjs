import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { executeLocalSql } from "./helpers/local-postgres.mjs";
import { spawn } from "node:child_process";

const databaseUrl = process.env.CODEV_CORE_TEST_DATABASE_URL;
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("ads workspace additive migrations enforce permissions, isolation, revisions and delivery locks in PostgreSQL", { skip: databaseUrl ? false : "Local disposable database absent" }, async () => {
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/codev_core_test(?:_[a-z0-9_]+)?$/);
  const env = { ...process.env, PGHOST: "127.0.0.1", PGHOSTADDR: "127.0.0.1", PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: "codev_core_test_workspace", PGCONNECT_TIMEOUT: "5" };
  delete env.PGSERVICE; delete env.PGSERVICEFILE;
  const psql = (target, sql) => executeLocalSql(process.env.CODEV_CORE_TEST_PSQL ?? "psql", target, sql);
  const created = psql({ ...env, PGDATABASE: "postgres" }, "drop database if exists codev_core_test_workspace; create database codev_core_test_workspace;");
  assert.equal(created.status, 0, created.stderr);
  const bootstrap = `create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);\n`;
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((file) => file.endsWith(".sql")).sort();
  const applied = psql(env, bootstrap + read("supabase/local/remote-schema.sql") + migrations.map((file) => read(`supabase/migrations/${file}`)).join("\n"));
  assert.equal(applied.status, 0, applied.stderr);
  const result = psql(env, read("supabase/tests/ads-workspace.sql"));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(Number(result.stdout.match(/ADS_WORKSPACE_CHECKS=(\d+)/)?.[1]), 45, result.stdout);
  const seed = psql(env, `insert into public.clients(id,name) values('aaaaaaaa-0000-4000-8000-0000000000a2','Concurrent test');
    insert into public.reports(id,client_id,kind,period_start,period_end,status,title,client_content,approved_version) values('ffffffff-0000-4000-8000-0000000000d2','aaaaaaaa-0000-4000-8000-0000000000a2','weekly','2026-10-01','2026-10-07','approved','Concurrent','{"summary":"Client only","sections":[]}',1);`);
  assert.equal(seed.status, 0, seed.stderr);
  const race = (token) => new Promise((resolve, reject) => {
    const sql = `begin; select public.codev_claim_report_delivery('ffffffff-0000-4000-8000-0000000000d2',1,'${token}','client@example.test','Concurrent','Client only','{"summary":"Client only","sections":[]}'); select pg_sleep(0.2); commit;`;
    const child = spawn(process.env.CODEV_CORE_TEST_PSQL ?? "psql", ["-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], { env: { ...env, PGCLIENTENCODING: "UTF8" }, windowsHide: true });
    let stdout = "", stderr = ""; const timer = setTimeout(() => child.kill(), 10000);
    child.stdout.on("data", (chunk) => stdout += chunk); child.stderr.on("data", (chunk) => stderr += chunk);
    child.on("error", (error) => { clearTimeout(timer); reject(error); }); child.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  const senders = await Promise.all([race("11111111-1111-4111-8111-111111111111"), race("22222222-2222-4222-8222-222222222222")]);
  senders.forEach((sender) => assert.equal(sender.status, 0, sender.stderr));
  assert.deepEqual(senders.map((sender) => sender.stdout.trim()).sort(), ["f", "t"], "Two independent PostgreSQL sessions reserve exactly one delivery");
});
