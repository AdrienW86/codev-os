import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { executeLocalSql } from "./helpers/local-postgres.mjs";

const databaseUrl = process.env.CODEV_CORE_TEST_DATABASE_URL;
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("ads workspace additive migrations enforce permissions, isolation, revisions and delivery locks in PostgreSQL", { skip: databaseUrl ? false : "Local disposable database absent" }, () => {
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
  assert.ok(Number(result.stdout.match(/ADS_WORKSPACE_CHECKS=(\d+)/)?.[1]) >= 15, result.stdout);
});
