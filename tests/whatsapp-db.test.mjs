import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { executeLocalSql } from "./helpers/local-postgres.mjs";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const databaseUrl = process.env.CODEV_CORE_TEST_DATABASE_URL;
test("WhatsApp SQL: idempotence, fixed scope, rights, folder isolation, leases, retries and RLS", { skip: !databaseUrl ? "No dedicated loopback PostgreSQL configured." : false }, () => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.match(target.pathname, /^\/codev_[a-z0-9_]*test[a-z0-9_]*$/);
  const base = { ...process.env, PGHOST: target.hostname, PGHOSTADDR: target.hostname === "[::1]" ? "::1" : "127.0.0.1", PGPORT: target.port || "5432", PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password) };
  const env = { ...base, PGDATABASE: "codev_whatsapp_test" };
  const psql = (e, sql) => executeLocalSql(process.env.CODEV_PSQL ?? "psql", e, sql);
  const reset = psql({ ...base, PGDATABASE: "postgres" }, `drop database if exists ${env.PGDATABASE}; create database ${env.PGDATABASE};`);
  assert.equal(reset.status, 0, reset.stderr);
  const migration = readdirSync(new URL("../supabase/migrations", import.meta.url)).find(f => f.endsWith("_whatsapp_drive_ingestion.sql"));
  const result = psql(env, `do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create table public.clients(id uuid primary key,name text not null); create table public.publication_agent_projects(client_id uuid,drive_folder_id text); create table public.publication_drive_media(client_id uuid,drive_folder_id text);\n` + read(`supabase/migrations/${migration}`) + read("supabase/tests/whatsapp-drive.sql"));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WHATSAPP_CHECKS=16/);
});
