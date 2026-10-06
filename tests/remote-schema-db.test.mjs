import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {test} from "node:test";
import {executeLocalSql} from "./helpers/local-postgres.mjs";

const databaseUrl = process.env.REMOTE_SCHEMA_TEST_DATABASE_URL;
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
import {catalogChecks} from "./helpers/remote-schema-catalog.mjs";

test("Remote schema replay: faithful catalogs, historical data, four migrations and destructive interactions (two rebuilds)", {
  skip: !databaseUrl ? "No dedicated loopback PostgreSQL configured for remote schema replay." : false,
}, () => {
  const url = new URL(databaseUrl);
  assert.ok(["postgres:","postgresql:"].includes(url.protocol));
  assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));
  assert.match(url.pathname,/^\/remote_schema_test(?:_[a-z0-9_]+)?$/);
  assert.equal(url.search,""); assert.equal(url.hash,"");
  const loopback = url.hostname === "[::1]" ? "::1" : "127.0.0.1";
  const env = {...process.env, PGHOST:loopback, PGHOSTADDR:loopback, PGPORT:url.port||"5432", PGDATABASE:url.pathname.slice(1), PGUSER:decodeURIComponent(url.username), PGPASSWORD:decodeURIComponent(url.password), PGOPTIONS:"", PGCONNECT_TIMEOUT:"5"};
  delete env.PGSERVICE; delete env.PGSERVICEFILE;
  const snapshot = JSON.parse(read("supabase/local/remote-schema-snapshot.json"));
  const migrations = readdirSync(new URL("../supabase/migrations/",import.meta.url)).filter(f=>/^2026100500000[0-3]_.*\.sql$/.test(f)).sort();
  assert.equal(migrations.length,4);
  const bootstrap = `begin;
    do $$ begin
     if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')) or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') or exists(select 1 from pg_namespace where nspname in ('publications_private','agent_scope_private')) then raise exception 'Replay requires an empty local database'; end if;
     if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
     if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
     if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
  `;
  const sql = bootstrap + read("supabase/local/remote-schema.sql") + read("supabase/tests/remote-replay-helpers.sql")
    + catalogChecks(snapshot) + "\\echo Historical catalogs exactly match read-only snapshot\n"
    + read("supabase/tests/remote-replay-fixtures.sql")
    + read("supabase/tests/remote-replay-before-migrations.sql")
    + "set local role postgres;\n"
    + migrations.map(f=>read(`supabase/migrations/${f}`)+`\n\\echo MIGRATION_APPLIED=${f}\n`).join("\n")
    + "reset role;\n" + read("supabase/tests/remote-replay-after-migrations.sql")
    + read("supabase/tests/publications.sql")
    + "\ndrop function pg_temp.assert_true(boolean,text); drop function pg_temp.expect_failure(text,text);\n"
    + read("supabase/tests/agent-scope.sql")
    + read("supabase/tests/remote-replay-interactions.sql")
    + `\nselect 'REPLAY_OBSERVATIONS='||coalesce(jsonb_object_agg(label,result),'{}'::jsonb)::text from pg_temp.remote_observations;
       select 'SQL_CHECKS='||((select passed from pg_temp.remote_replay)+(select sum(passed) from pg_temp.sql_validation_counts));
       rollback;
       do $$ begin
        if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')) or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') or exists(select 1 from pg_namespace where nspname in ('publications_private','agent_scope_private')) or exists(select 1 from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public') then raise exception 'Replay rebuild failed to restore empty catalogs'; end if;
       end $$;`;
  let previous;
  for (let rebuild=1;rebuild<=2;rebuild++) {
    const result=executeLocalSql(process.env.REMOTE_SCHEMA_TEST_PSQL??"psql",env,sql);
    if (result.stderr) console.log(result.stderr);
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stderr);
    const count=result.stdout.match(/SQL_CHECKS=(\d+)/)?.[1];
    const observations=result.stdout.match(/REPLAY_OBSERVATIONS=(\{[^\r\n]*\})/)?.[1];
    assert.ok(count); assert.ok(observations);
    const migrationsApplied=result.stdout.match(/MIGRATION_APPLIED=[^\r\n]+/g);
    assert.equal(migrationsApplied?.length,4);
    const signature=JSON.stringify({count,observations,migrationsApplied});
    if(previous) assert.equal(signature,previous,"Both rebuilds must have identical outcomes");
    previous=signature;
    console.log(migrationsApplied.join("\n"));
    console.log(`SQL_CHECKS=${count}; REPLAY_OBSERVATIONS=${observations}`);
    console.log(`Faithful remote schema rebuild ${rebuild}/2 passed; historical catalogs, functions, default ACLs and data verified; returned to empty DB.`);
  }
});
