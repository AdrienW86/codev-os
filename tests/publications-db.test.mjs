import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {executeLocalSql} from "./helpers/local-postgres.mjs";
import { test } from "node:test";

// No .env loading, no Supabase project reference, no remote connection possible.
const databaseUrl = process.env.PUBLICATIONS_TEST_DATABASE_URL;
test("Publications SQL: fresh schema, permissions, constraints and atomic RPCs (two rebuilds)", {
  skip: !databaseUrl ? "No isolated local PostgreSQL configured; SQL integration tests not executed." : false,
}, () => {
  const url = new URL(databaseUrl);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Local loopback only");
  assert.match(url.pathname, /^\/publications_lot1_test(?:_[a-z0-9_]+)?$/, "Dedicated empty test database only");
  assert.equal(url.search, "", "No connection-option overrides");
  assert.equal(url.hash, "");
  const command = process.env.PUBLICATIONS_TEST_PSQL ?? "psql";
  // Connection parameters are supplied separately; never print credentials.
  const loopback = url.hostname === "[::1]" ? "::1" : "127.0.0.1";
  const env = { ...process.env, PGHOST: loopback, PGHOSTADDR: loopback, PGPORT: url.port || "5432",
    PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGOPTIONS: "", PGCONNECT_TIMEOUT: "5" };
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((file) => /^2026100500000[01]_.*\.sql$/.test(file)).sort();
  assert.equal(migrations.length, 2);
  const bootstrap = `begin;
    do $$ begin
      if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','p'))
        or exists(select 1 from pg_namespace where nspname='publications_private') then
        raise exception 'Test database must be empty';
      end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create table public.clients(id uuid primary key, name text not null);
    grant usage on schema public to anon,authenticated,service_role;
  `;
  const sql = bootstrap + migrations.map((file) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8")).join("\n")
    + "\n" + readFileSync(new URL("../supabase/tests/publications.sql", import.meta.url), "utf8") + `
      select 'SQL_CHECKS=' || sum(passed) from pg_temp.sql_validation_counts;
      rollback;
      do $$ begin
        if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','p'))
          or exists(select 1 from pg_namespace where nspname='publications_private') then
          raise exception 'Reconstruction did not leave the dedicated database empty';
        end if;
      end $$;
    `;
  for (let rebuild = 0; rebuild < 2; rebuild++) {
    const result = executeLocalSql(command,env,sql);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const count=result.stdout.match(/SQL_CHECKS=(\d+)/);
    assert.ok(count,"SQL assertions must be counted by PostgreSQL");
    console.log(`${count[0]} (assertions and expected rejections actually executed)`);
    console.log(`Lot 1 SQL reconstruction ${rebuild+1}/2 passed; database returned to empty state.`);
  }
});
