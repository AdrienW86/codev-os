import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { executeLocalSql } from "./helpers/local-postgres.mjs";

// Base locale jetable uniquement : postgres://user@127.0.0.1:port/codev_core_test[_suffixe]
const databaseUrl = process.env.CODEV_CORE_TEST_DATABASE_URL;
const skip = databaseUrl ? false : "CODEV_CORE_TEST_DATABASE_URL absent : tests SQL du noyau non exécutés.";

function environment(database) {
  const url = new URL(databaseUrl);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "loopback only");
  assert.match(url.pathname, /^\/codev_core_test(?:_[a-z0-9_]+)?$/, "dedicated test database only");
  const env = { ...process.env, PGHOST: "127.0.0.1", PGHOSTADDR: "127.0.0.1", PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: database ?? url.pathname.slice(1), PGCONNECT_TIMEOUT: "5" };
  delete env.PGSERVICE; delete env.PGSERVICEFILE;
  return env;
}
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const psql = (env, sql) => executeLocalSql(process.env.CODEV_CORE_TEST_PSQL ?? "psql", env, sql);

function rebuild() {
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
  const sql = bootstrap + read("supabase/local/remote-schema.sql") + migrations.map((file) => read(`supabase/migrations/${file}`)).join("\n");
  const result = psql(target, sql);
  assert.equal(result.status, 0, result.stderr);
  return target;
}

test("core migration replays on the production schema and passes every SQL check", { skip }, () => {
  const env = rebuild();
  const result = psql(env, read("supabase/tests/codev-core.sql"));
  assert.equal(result.status, 0, result.stderr);
  const count = Number(result.stdout.match(/CORE_CHECKS=(\d+)/)?.[1]);
  assert.ok(count >= 45, `SQL checks: ${count}`);
});

test("concurrent workers never claim the same job", { skip }, async () => {
  const env = rebuild();
  const seed = psql(env, `insert into public.jobs(run_type, idempotency_key) select 'news.fetch', 'concurrency-' || n from generate_series(1, 40) n;`);
  assert.equal(seed.status, 0, seed.stderr);
  const claim = (worker) => new Promise((resolve, reject) => {
    const child = spawn(process.env.CODEV_CORE_TEST_PSQL ?? "psql", ["-X", "-At", "-c", `select id from public.codev_claim_jobs('${worker}', 15, 60)`], { env });
    let output = ""; child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(output.split("\n").filter(Boolean)) : reject(new Error(`psql ${code}`)));
  });
  const results = await Promise.all(["w1", "w2", "w3", "w4"].map(claim));
  const ids = results.flat();
  assert.equal(new Set(ids).size, ids.length, "no job claimed twice");
  assert.equal(ids.length, 40, "all due jobs claimed exactly once");
});
