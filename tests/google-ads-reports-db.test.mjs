import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { executeLocalSql } from "./helpers/local-postgres.mjs";

// Base locale jetable uniquement (même convention que codev-core-db) : la migration n'est jamais appliquée à distance.
const databaseUrl = process.env.CODEV_CORE_TEST_DATABASE_URL;
const skip = databaseUrl ? false : "CODEV_CORE_TEST_DATABASE_URL absent : tests SQL des rapports Google Ads non exécutés.";

function environment(database) {
  const url = new URL(databaseUrl);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "loopback only");
  assert.match(url.pathname, /^\/codev_core_test(?:_[a-z0-9_]+)?$/, "dedicated test database only");
  const env = { ...process.env, PGHOST: "127.0.0.1", PGHOSTADDR: "127.0.0.1", PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: database ?? `${url.pathname.slice(1)}_ads`, PGCONNECT_TIMEOUT: "5" };
  delete env.PGSERVICE; delete env.PGSERVICEFILE;
  return env;
}
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const psql = (env, sql) => executeLocalSql(process.env.CODEV_CORE_TEST_PSQL ?? "psql", env, sql);

test("google_ads reports migration is additive and freezes the report scope", { skip }, () => {
  const target = environment();
  const admin = psql(environment("postgres"), `drop database if exists ${target.PGDATABASE}; create database ${target.PGDATABASE};`);
  assert.equal(admin.status, 0, admin.stderr);
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((file) => file.endsWith(".sql")).sort();
  const bootstrap = `do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create schema if not exists storage;
  create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);\n`;
  const built = psql(target, bootstrap + read("supabase/local/remote-schema.sql") + migrations.map((file) => read(`supabase/migrations/${file}`)).join("\n"));
  assert.equal(built.status, 0, built.stderr);
  const result = psql(target, read("supabase/tests/google-ads-reports.sql"));
  assert.equal(result.status, 0, result.stderr);
  const count = Number(result.stdout.match(/ADS_REPORT_CHECKS=(\d+)/)?.[1]);
  assert.ok(count >= 18, `SQL checks: ${count}`);
});
