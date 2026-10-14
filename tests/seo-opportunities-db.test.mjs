import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { executeLocalSql } from "./helpers/local-postgres.mjs";

// Base locale jetable uniquement : postgres://user@127.0.0.1:port/codev_core_test[_suffixe] (même variable que le noyau).
const databaseUrl = process.env.CODEV_CORE_TEST_DATABASE_URL;
const skip = databaseUrl ? false : "CODEV_CORE_TEST_DATABASE_URL absent : tests SQL opportunités SEO non exécutés.";

function environment(database) {
  const url = new URL(databaseUrl);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "loopback only");
  assert.match(url.pathname, /^\/codev_core_test(?:_[a-z0-9_]+)?$/, "dedicated test database only");
  const env = { ...process.env, PGHOST: "127.0.0.1", PGHOSTADDR: "127.0.0.1", PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: database ?? `${url.pathname.slice(1)}_seo_opportunities`, PGCONNECT_TIMEOUT: "5" };
  delete env.PGSERVICE; delete env.PGSERVICEFILE;
  return env;
}
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const psql = (env, sql) => executeLocalSql(process.env.CODEV_CORE_TEST_PSQL ?? "psql", env, sql);

test("SEO opportunities migration replays on the production schema and passes every SQL check", { skip }, () => {
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
  const replay = psql(target, bootstrap + read("supabase/local/remote-schema.sql") + migrations.map((file) => read(`supabase/migrations/${file}`)).join("\n"));
  assert.equal(replay.status, 0, replay.stderr);
  const result = psql(target, read("supabase/tests/seo-opportunities.sql"));
  assert.equal(result.status, 0, result.stderr);
  const count = Number(result.stdout.match(/SEO_OPPORTUNITY_CHECKS=(\d+)/)?.[1]);
  assert.ok(count >= 19, `SQL checks: ${count}`);
});

test("SEO opportunities migration is additive: no drop, no alter of an existing object", () => {
  const sql = read("supabase/migrations/20261109000000_seo_keyword_opportunities.sql").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\bdrop\s+(table|column|constraint|function|index|trigger|schema)\b/i);
  assert.doesNotMatch(sql, /\balter\s+table\s+public\.(?!seo_)/i);
  assert.doesNotMatch(sql, /\b(delete\s+from|truncate|update)\s+public\./i);
});
