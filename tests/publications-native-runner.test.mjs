import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { DATABASES, SUITES, nativeEnvironment, parseDatabaseUrl, withLocalPasswordFile } from "../scripts/test-publications-native.mjs";

const local = "postgres://postgres:local-test-only@127.0.0.1:54329/publications_lot1_test";

test("native Publications runner rejects remote URLs, other databases and connection-option injection", () => {
  for (const value of [undefined, "", "postgres://postgres@db.example.com/publications_lot1_test",
    "postgres://postgres@127.0.0.2/publications_lot1_test", "postgres://postgres@localhost/publications_lot1_test",
    "postgres://postgres@127.0.0.1/postgres", "postgres://postgres@127.0.0.1/production",
    local + "?host=db.example.com", local + "?options=-c%20search_path%3Dpublic",
    local + "#fragment", "https://postgres@127.0.0.1/publications_lot1_test",
    "postgres://127.0.0.1/publications_lot1_test", "postgres://post%00gres@127.0.0.1/publications_lot1_test",
    "postgres://postgres:password%0Ainjected@127.0.0.1/publications_lot1_test",
    "postgres://postgres@127.0.0.1:0/publications_lot1_test"]) {
    assert.throws(() => parseDatabaseUrl(value), /disposable publications_lot1_test/);
  }
});

test("native Publications password file is private, local-only, escaped and removed after an error", () => {
  const config = parseDatabaseUrl("postgres://postgres:local%3Apass%5Cword@127.0.0.1:54329/publications_lot1_test");
  let path;
  assert.throws(() => withLocalPasswordFile({ PGPASSFILE: "/ignored/inherited/file" }, config, env => {
    path = env.PGPASSFILE;
    assert.equal(readFileSync(path, "utf8"), "127.0.0.1:54329:*:postgres:local\\:pass\\\\word\n");
    if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
    throw new Error("simulated database failure");
  }), /simulated database failure/);
  assert.equal(existsSync(path), false);
});

test("native Publications runner takes local connection parameters only from its validated URL", () => {
  const config = parseDatabaseUrl(local);
  const env = nativeEnvironment({ PUBLICATIONS_TEST_PSQL: "/local/psql", PATH: "/local/bin",
    LD_LIBRARY_PATH: "/local/lib", PGHOST: "remote", PGHOSTADDR: "203.0.113.1", PGPORT: "6543",
    PGSERVICE: "remote", PGSERVICEFILE: "/tmp/remote", PGPASSFILE: "/tmp/passwords", PGOPTIONS: "-h remote",
    PGPASSWORD: "inherited-password", PGDATABASE: "production", PUBLICATIONS_P13_TEST_DATABASE_URL: "postgres://remote/production",
    PUBLICATIONS_UNKNOWN_TEST_DATABASE_URL: "postgres://remote/production", PUBLICATIONS_P13_TEST_PSQL: "/wrong/psql" }, config);
  assert.equal(env.PGHOST, "127.0.0.1"); assert.equal(env.PGHOSTADDR, "127.0.0.1");
  assert.equal(env.PGPORT, "54329"); assert.equal(env.PGDATABASE, "postgres");
  assert.equal(env.PGPASSWORD, "local-test-only"); assert.equal(env.PGOPTIONS, "");
  for (const key of ["PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PUBLICATIONS_UNKNOWN_TEST_DATABASE_URL"]) assert.equal(env[key], undefined);
  assert.equal(env.LD_LIBRARY_PATH, "/local/lib"); assert.equal(env.PATH, "/local/bin");
  assert.equal(Object.keys(DATABASES).length, 22); assert.equal(SUITES.length, 26);
  for (const [key, database] of Object.entries(DATABASES)) {
    const url = new URL(env[key]); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "54329");
    assert.equal(url.pathname, `/${database}`); assert.equal(url.search, ""); assert.equal(url.hash, "");
    assert.equal(env[key.replace("DATABASE_URL", "PSQL")], "/local/psql");
  }
});

test("native Publications CLI rejects unsafe input before launching psql and does not print credentials", () => {
  const secret = "must-never-be-logged";
  const result = spawnSync(process.execPath, ["scripts/test-publications-native.mjs"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8",
    env: { ...process.env, PUBLICATIONS_TEST_DATABASE_URL: `postgres://postgres:${secret}@remote.example/production`, PUBLICATIONS_TEST_PSQL: "/nonexistent/psql" },
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /disposable publications_lot1_test/);
  assert.ok(!result.stderr.includes(secret)); assert.ok(!result.stderr.includes("remote.example"));
});
