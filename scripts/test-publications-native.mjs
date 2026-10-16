// Native PostgreSQL only, on a dedicated disposable local cluster. No .env is loaded.
// Usage: PUBLICATIONS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/publications_lot1_test
//        PUBLICATIONS_TEST_PSQL=/path/to/psql node scripts/test-publications-native.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeLocalSql } from "../tests/helpers/local-postgres.mjs";

export const DATABASES = Object.freeze({
  PUBLICATIONS_TEST_DATABASE_URL: "publications_lot1_test",
  PUBLICATIONS_AGENT_TEST_DATABASE_URL: "publications_agent_test",
  PUBLICATIONS_CALENDAR_TEST_DATABASE_URL: "publications_calendar_test",
  PUBLICATIONS_CHANNELS_TEST_DATABASE_URL: "publications_channels_test",
  PUBLICATIONS_CHAOS_TEST_DATABASE_URL: "publications_chaos_test",
  PUBLICATIONS_GROUPS_TEST_DATABASE_URL: "publications_groups_test",
  PUBLICATIONS_OCCURRENCES_TEST_DATABASE_URL: "publications_occurrences_test",
  PUBLICATIONS_P4B_TEST_DATABASE_URL: "publications_p4b_test",
  PUBLICATIONS_P5_TEST_DATABASE_URL: "publications_p5_test",
  PUBLICATIONS_P7_TEST_DATABASE_URL: "publications_p7_test",
  PUBLICATIONS_P8_TEST_DATABASE_URL: "publications_p8_test",
  PUBLICATIONS_P9_TEST_DATABASE_URL: "publications_p9_test",
  PUBLICATIONS_P10_TEST_DATABASE_URL: "publications_p10_test",
  PUBLICATIONS_P11_TEST_DATABASE_URL: "publications_p11_test",
  PUBLICATIONS_P11B_TEST_DATABASE_URL: "publications_p11b_test",
  PUBLICATIONS_P12_TEST_DATABASE_URL: "publications_p12_test",
  PUBLICATIONS_P13_TEST_DATABASE_URL: "publications_p13_test",
  PUBLICATIONS_SCHEDULE_TEST_DATABASE_URL: "publications_schedule_test",
  PUBLICATIONS_SCHEDULES_TEST_DATABASE_URL: "publications_schedules_test",
  PUBLICATIONS_SOCLE_TEST_DATABASE_URL: "publications_socle_test",
  PUBLICATIONS_UNSCHEDULED_TEST_DATABASE_URL: "publications_unscheduled_test",
  PUBLICATIONS_WORKSPACE_TEST_DATABASE_URL: "publications_workspace_test",
});

export const SUITES = Object.freeze([
  "publications-account-exclusivity-db.test.mjs", "publications-agent-db.test.mjs",
  "publications-agent-v2-db.test.mjs", "publications-agent-v2-media-db.test.mjs",
  "publications-archiving-db.test.mjs", "publications-calendar-db.test.mjs",
  "publications-checked-reconciliation-db.test.mjs",
  "publications-channels-db.test.mjs", "publications-chaos-db.test.mjs",
  "publications-connections-db.test.mjs", "publications-db.test.mjs",
  "publications-delivery-engine-db.test.mjs", "publications-editorial-groups-db.test.mjs",
  "publications-editorial-selection-db.test.mjs", "publications-gbp-publisher-db.test.mjs",
  "publications-load-db.test.mjs", "publications-meta-publisher-db.test.mjs",
  "publications-oauth-db.test.mjs", "publications-occurrence-publications-db.test.mjs",
  "publications-occurrences-db.test.mjs", "publications-schedule-drafts-db.test.mjs",
  "publications-scheduled-flow-db.test.mjs", "publications-schedules-db.test.mjs",
  "publications-socle-db.test.mjs", "publications-unscheduled-drafts-db.test.mjs",
  "publications-workspace-db.test.mjs",
]);

export function parseDatabaseUrl(value) {
  const invalid = () => new Error("PUBLICATIONS_TEST_DATABASE_URL must name the disposable publications_lot1_test database on 127.0.0.1, without connection options.");
  let url;
  try { url = new URL(value); } catch { throw invalid(); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1"
    || url.pathname !== "/publications_lot1_test" || url.search || url.hash
    || !url.username || (url.port && Number(url.port) < 1)) throw invalid();
  let user, password;
  try { user = decodeURIComponent(url.username); password = decodeURIComponent(url.password); } catch { throw invalid(); }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(user) || /[\0\r\n]/.test(password)) throw invalid();
  return Object.freeze({ port: url.port || "5432", user, password });
}

export function nativeEnvironment(source, config) {
  // URL values supplied for other suites and every libpq override are ignored.
  // In particular PGSERVICE, PGHOSTADDR, PGPASSFILE and PGOPTIONS cannot redirect a connection.
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith("PG")
    && !/^PUBLICATIONS_.*TEST_(?:DATABASE_URL|PSQL)$/.test(key)));
  Object.assign(env, { PGHOST: "127.0.0.1", PGHOSTADDR: "127.0.0.1", PGPORT: config.port,
    PGUSER: config.user, PGPASSWORD: config.password, PGDATABASE: "postgres", PGOPTIONS: "",
    PGCONNECT_TIMEOUT: "5", PGCLIENTENCODING: "UTF8" });
  for (const [key, database] of Object.entries(DATABASES)) {
    const url = new URL(`postgres://127.0.0.1:${config.port}/${database}`);
    url.username = config.user; url.password = config.password;
    env[key] = url.href;
    env[key.replace("DATABASE_URL", "PSQL")] = source.PUBLICATIONS_TEST_PSQL || "psql";
  }
  return env;
}

export function withLocalPasswordFile(env, config, run) {
  // Historical suites explicitly clear PGPASSWORD. Supply their validated local
  // password through an owned private file, never an inherited user's .pgpass.
  const directory = mkdtempSync(join(tmpdir(), "codev-publications-pgpass-"));
  const path = join(directory, "pgpass");
  const escape = value => value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
  try {
    writeFileSync(path, `127.0.0.1:${config.port}:*:${escape(config.user)}:${escape(config.password)}\n`, { mode: 0o600 });
    return run({ ...env, PGPASSFILE: path });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export function main(source = process.env) {
  const config = parseDatabaseUrl(source.PUBLICATIONS_TEST_DATABASE_URL);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files = readdirSync(resolve(root, "tests")).filter(name => /^publications.*db\.test\.mjs$/.test(name)).sort();
  if (JSON.stringify(files) !== JSON.stringify([...SUITES].sort())) {
    throw new Error("Native Publications suite inventory changed; update the fixed database/suite list before running.");
  }
  const environment = nativeEnvironment(source, config);
  return withLocalPasswordFile(environment, config, env => {
    const psql = env.PUBLICATIONS_TEST_PSQL;
    const sql = (statement) => {
      const result = executeLocalSql(psql, env, statement);
      // Never print libpq diagnostics: these may contain credentials from invalid local configuration.
      if (result.error || result.status !== 0) throw new Error("Local PostgreSQL setup failed; verify the disposable cluster, psql path and local database-creation privileges.");
      return result.stdout;
    };
    const identity = sql("select 'CONNECTED=' || current_database();");
    if (!/^\s*CONNECTED=postgres\s*$/m.test(identity)) throw new Error("Local PostgreSQL maintenance database could not be verified.");
    sql(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;`);
    for (const database of Object.values(DATABASES)) {
      // All identifiers and literals come from the fixed whitelist above. No DROP is issued by this runner.
      const present = sql(`select 'EXISTS=' || exists(select 1 from pg_database where datname='${database}');`);
      if (!present.includes("EXISTS=true")) sql(`create database ${database};`);
    }
    console.log(`Running ${SUITES.length} native Publications suites sequentially on dedicated loopback PostgreSQL databases. Existing suites rebuild their own disposable fixtures.`);
    const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...SUITES.map(name => `tests/${name}`)],
      { cwd: root, env, stdio: "inherit", windowsHide: true });
    if (result.error) throw new Error("Unable to start native Publications tests.");
    return result.status ?? 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
