import assert from "node:assert/strict";
import { test } from "node:test";
import { executeLocalSql } from "./helpers/local-postgres.mjs";
import { whatsappChecks, whatsappMigrations, whatsappPrerequisites, whatsappRoles } from "./helpers/whatsapp-sql-fixture.mjs";
const databaseUrl = process.env.CODEV_CORE_TEST_DATABASE_URL;
test("WhatsApp SQL: idempotence, fixed scope, rights, folder isolation, leases, retries, assignment, library, notifications and RLS", { skip: !databaseUrl ? "No dedicated loopback PostgreSQL configured." : false }, () => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.match(target.pathname, /^\/codev_[a-z0-9_]*test[a-z0-9_]*$/);
  const base = { ...process.env, PGHOST: target.hostname, PGHOSTADDR: target.hostname === "[::1]" ? "::1" : "127.0.0.1", PGPORT: target.port || "5432", PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password) };
  const env = { ...base, PGDATABASE: "codev_whatsapp_test" };
  const psql = (e, sql) => executeLocalSql(process.env.CODEV_PSQL ?? "psql", e, sql);
  const reset = psql({ ...base, PGDATABASE: "postgres" }, `drop database if exists ${env.PGDATABASE}; create database ${env.PGDATABASE};`);
  assert.equal(reset.status, 0, reset.stderr);
  const result = psql(env, whatsappRoles + whatsappPrerequisites + whatsappMigrations() + whatsappChecks());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WHATSAPP_CHECKS=16/);
  assert.match(result.stdout, /WHATSAPP_LIBRARY_CHECKS=14/);
});
