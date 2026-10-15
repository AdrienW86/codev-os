import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";

const databaseUrl = process.env.CODEV_SCOPED_TEST_DATABASE_URL;
if (!databaseUrl) {
  test("native scoped claims require a dedicated disposable PostgreSQL", { skip: "CODEV_SCOPED_TEST_DATABASE_URL absent; native SQL checks not executed" }, () => {});
} else {

// Disposable native PostgreSQL only. This test rebuilds exactly this database;
// it never starts PostgreSQL, loads .env files, or connects to a remote host.
const DATABASE = "codev_core_test_scoped_jobs";
const REPOSITORY = process.env.CODEV_CORE_TEST_REPOSITORY ?? process.cwd();
const PSQL = process.env.CODEV_CORE_TEST_PSQL ?? "psql";
const LEASE_SECONDS = 300;
const url = new URL(databaseUrl);
assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "PostgreSQL URL required");
assert.equal(url.hostname, "127.0.0.1", "hostname must be exactly 127.0.0.1");
assert.equal(url.pathname, `/${DATABASE}`, "dedicated scoped-jobs test database required");
assert.equal(url.search, "", "URL connection overrides are prohibited");
assert.equal(url.hash, "", "URL fragments are prohibited");
assert.ok(url.username, "explicit local PostgreSQL user required");

function environment(database = DATABASE, app = "scoped-jobs-test") {
  assert.ok([DATABASE, "postgres"].includes(database), "test or maintenance database only");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG")));
  return { ...env, PGHOST: "127.0.0.1", PGHOSTADDR: "127.0.0.1", PGPORT: url.port || "5432",
    PGDATABASE: database, PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGAPPNAME: app, PGCONNECT_TIMEOUT: "5", PGCLIENTENCODING: "UTF8",
    PGOPTIONS: "-c statement_timeout=10000 -c lock_timeout=8000" };
}
const args = ["-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1"];
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function sql(text, database = DATABASE) {
  const result = spawnSync(PSQL, args, { env: environment(database), input: text, encoding: "utf8",
    timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function startSql(text, app) {
  const child = spawn(PSQL, args, { env: environment(DATABASE, app), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  const timer = setTimeout(() => child.kill("SIGTERM"), 20_000);
  const completed = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Local psql failed (${code}): ${stderr}`));
    });
  });
  if (text !== undefined) child.stdin.end(text);
  return { child, completed };
}

const read = (path) => readFileSync(join(REPOSITORY, path), "utf8");

before(() => {
  // Same checked-out schema replay used by tests/codev-core-db.test.mjs. Run
  // from the repository root, or select it with CODEV_CORE_TEST_REPOSITORY.
  sql(`drop database if exists ${DATABASE}; create database ${DATABASE};`, "postgres");
  const files = readdirSync(join(REPOSITORY, "supabase/migrations"))
    .filter((path) => path.endsWith(".sql")).sort().map((path) => `supabase/migrations/${path}`);
  assert.ok(files.includes("supabase/migrations/20261015000000_codev_os_core.sql"));
  const bootstrap = `do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create schema if not exists storage;
  create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);\n`;
  sql(bootstrap + read("supabase/local/remote-schema.sql") + files.map(read).join("\n"));
  // A CI service exposes PostgreSQL on the runner's loopback, while PostgreSQL
  // sees its private Docker address. The client endpoint remains hard-pinned
  // to 127.0.0.1 above; verify the dedicated database rather than that server IP.
  assert.equal(sql("select current_database();"), DATABASE);
  console.log(`Existing schema and ${files.length} existing migrations replayed into ${DATABASE}.`);
});

function seed({ attempts = 0, maxAttempts = 3, status = "queued", due = true, startedAt = null } = {}) {
  const id = randomUUID();
  sql(`insert into public.jobs(id, run_type, idempotency_key, attempts, max_attempts, status, scheduled_for, started_at)
    values (${quote(id)}, 'news.fetch', ${quote(`scoped-cas-${id}`)}, ${attempts}, ${maxAttempts}, ${quote(status)},
      now() ${due ? "-" : "+"} interval '1 hour', ${startedAt ? `${quote(startedAt)}::timestamptz` : "null"});`);
  return snapshot(id);
}

function snapshot(id) {
  return JSON.parse(sql(`select row_to_json(j) from public.jobs j where id=${quote(id)};`));
}

// Exact SQL equivalent of the scoped PostgREST conditional UPDATE. The caller
// reads only queued candidates, rejects exhausted candidates before issuing an
// update, then compares id/status/old attempts/old budget/due date atomically.
function claimSql(candidate, worker, now) {
  assert.ok(Number.isInteger(candidate.attempts) && candidate.attempts >= 0);
  assert.ok(Number.isInteger(candidate.max_attempts) && candidate.max_attempts >= 1);
  const startedAt = candidate.started_at ?? now.toISOString();
  return `begin; set local role service_role;
    with claimed as (
      update public.jobs set status='running', worker_id=${quote(worker)}, attempts=${candidate.attempts + 1},
        lease_expires_at=${quote(now.toISOString())}::timestamptz + interval '${LEASE_SECONDS} seconds',
        started_at=${quote(startedAt)}::timestamptz
      where id=${quote(candidate.id)} and status='queued' and attempts=${candidate.attempts}
        and max_attempts=${candidate.max_attempts}
        and scheduled_for <= ${quote(now.toISOString())}::timestamptz
      returning *
    ) select row_to_json(claimed) from claimed;
    commit;`;
}

async function claim(candidate, worker, now = new Date()) {
  if (!candidate || candidate.attempts >= candidate.max_attempts) return null;
  const output = await startSql(claimSql(candidate, worker, now), `scoped-jobs-${worker}`).completed;
  return output ? JSON.parse(output) : null;
}

test("eight native PostgreSQL connections race one scoped CAS: exactly one winner and another queued job is unchanged", async () => {
  const candidate = seed(), unrelated = seed();
  const now = new Date();
  const prefix = `cas-${randomUUID()}`;
  // Hold the row until all eight independent sessions are actually blocked on
  // its lock. This guarantees a real database race rather than sequential calls.
  const blocker = startSql(undefined, `${prefix}-blocker`);
  const locked = new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("row lock barrier was not acquired")), 5000);
    blocker.child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("ROW_LOCKED")) { clearTimeout(timer); resolve(); }
    });
    blocker.child.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
  blocker.child.stdin.write(`begin; select id from public.jobs where id=${quote(candidate.id)} for update; select 'ROW_LOCKED';\n`);
  let results;
  try {
    await locked;
    const contenders = Array.from({ length: 8 }, (_, index) => startSql(
      claimSql(candidate, `${prefix}-${index}`, now), `${prefix}-${index}`).completed);
    let waiting = 0;
    const deadline = Date.now() + 5000;
    while (waiting < 8 && Date.now() < deadline) {
      waiting = Number(sql(`select count(*) from pg_stat_activity where datname=${quote(DATABASE)}
        and application_name like ${quote(`${prefix}-%`)} and application_name <> ${quote(`${prefix}-blocker`)}
        and wait_event_type='Lock';`));
      if (waiting < 8) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    blocker.child.stdin.end("commit;\n");
    await blocker.completed;
    results = await Promise.all(contenders);
    assert.equal(waiting, 8, "all eight native SQL connections must overlap on the row lock");
  } finally {
    if (!blocker.child.stdin.writableEnded) blocker.child.stdin.end("rollback;\n");
    await blocker.completed;
  }
  const winners = results.filter(Boolean).map((result) => JSON.parse(result));
  assert.equal(winners.length, 1, "exactly one conditional UPDATE returns a job");
  const persisted = snapshot(candidate.id), winner = winners[0];
  assert.deepEqual(persisted, winner, "returned row is the committed winning row");
  assert.equal(persisted.status, "running");
  assert.equal(persisted.attempts, 1);
  assert.ok(persisted.worker_id.startsWith(`${prefix}-`));
  assert.equal(Date.parse(persisted.started_at), now.getTime());
  assert.equal(Date.parse(persisted.lease_expires_at), now.getTime() + LEASE_SECONDS * 1000);
  assert.deepEqual(snapshot(unrelated.id), unrelated, "a scoped claim must never reserve another queued job");
});

test("a queued retry consumes exactly one more attempt and preserves its first started_at", async () => {
  const firstStartedAt = new Date(Date.now() - 3_600_000).toISOString();
  const candidate = seed({ attempts: 1, startedAt: firstStartedAt });
  const now = new Date();
  const result = await claim(candidate, "scoped-retry", now);
  assert.ok(result);
  assert.equal(result.status, "running");
  assert.equal(result.attempts, 2);
  assert.equal(result.worker_id, "scoped-retry");
  assert.equal(Date.parse(result.started_at), Date.parse(firstStartedAt));
  assert.equal(Date.parse(result.lease_expires_at), now.getTime() + LEASE_SECONDS * 1000);
});

test("future, running, failed, and exhausted candidates are rejected without changing their rows", async () => {
  for (const candidate of [seed({ due: false }), seed({ status: "running", attempts: 1 }), seed({ status: "failed", attempts: 1 }), seed({ attempts: 3 })]) {
    assert.equal(await claim(candidate, "scoped-ineligible"), null);
    assert.deepEqual(snapshot(candidate.id), candidate);
  }
});

test("a stale attempts snapshot loses the CAS even when the current row is queued and due", async () => {
  const candidate = seed();
  sql(`update public.jobs set attempts=attempts+1 where id=${quote(candidate.id)};`);
  const current = snapshot(candidate.id);
  assert.equal(current.status, "queued");
  assert.equal(current.attempts, 1);
  assert.equal(await claim(candidate, "scoped-stale"), null);
  assert.deepEqual(snapshot(candidate.id), current);
});

test("a job rescheduled after the candidate read loses the CAS and keeps its new schedule", async () => {
  const candidate = seed();
  sql(`update public.jobs set scheduled_for=now()+interval '1 hour' where id=${quote(candidate.id)};`);
  const current = snapshot(candidate.id);
  assert.equal(current.status, "queued");
  assert.equal(current.attempts, candidate.attempts);
  assert.ok(Date.parse(current.scheduled_for) > Date.now());
  assert.equal(await claim(candidate, "scoped-rescheduled"), null);
  assert.deepEqual(snapshot(candidate.id), current);
});

test("a retry budget changed after the candidate read loses the CAS and keeps the new budget", async () => {
  const candidate = seed({ attempts: 1, maxAttempts: 3 });
  sql(`update public.jobs set max_attempts=1 where id=${quote(candidate.id)};`);
  const current = snapshot(candidate.id);
  assert.equal(current.status, "queued");
  assert.equal(current.attempts, 1);
  assert.equal(current.max_attempts, 1);
  assert.equal(await claim(candidate, "scoped-budget-changed"), null);
  assert.deepEqual(snapshot(candidate.id), current);
});

}
