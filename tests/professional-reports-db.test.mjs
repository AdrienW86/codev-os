import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { executeLocalSql } from "./helpers/local-postgres.mjs";

const databaseUrl = process.env.CODEV_CORE_TEST_DATABASE_URL;
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("native professional reports: additive migration, private grants, concurrent deduplication and immutable approval scope", { skip: databaseUrl ? false : "Dedicated disposable loopback PostgreSQL absent" }, async () => {
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/codev_core_test(?:_[a-z0-9_]+)?$/);
  const env = { ...process.env, PGHOST: "127.0.0.1", PGHOSTADDR: "127.0.0.1", PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: "codev_core_test_professional_reports", PGCONNECT_TIMEOUT: "5" };
  delete env.PGSERVICE; delete env.PGSERVICEFILE;
  const bin = process.env.CODEV_CORE_TEST_PSQL ?? "psql";
  const sql = (source, target = env) => { const r = executeLocalSql(bin, target, source); assert.equal(r.status, 0, r.stderr); return r; };
  const query = source => { const r = spawnSync(bin, ["-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", source], { env, encoding: "utf8", timeout: 15000 }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  sql("drop database if exists codev_core_test_professional_reports;create database codev_core_test_professional_reports;", { ...env, PGDATABASE: "postgres" });
  const target = "20261110000000_professional_client_reports.sql";
  const previous = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter(f => f.endsWith(".sql") && f < target).sort();
  sql(`do $$ begin perform pg_advisory_xact_lock(761616);
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    ${read("supabase/local/remote-schema.sql")}${previous.map(f => read(`supabase/migrations/${f}`)).join("\n")}${read("e2e/harness/seed.sql")}
    insert into public.reports(client_id,kind,period_start,period_end,title,summary,status) values('11111111-1111-4111-8111-111111111111','monthly','2026-08-01','2026-08-31','Historical','Preserved','ready_for_review');`);
  const fingerprint = "select md5(coalesce(json_agg(r order by id)::text,'')) from public.reports r";
  const before = query(fingerprint);
  sql(`begin;${read(`supabase/migrations/${target}`)}\ncommit;`);
  assert.equal(query(fingerprint), before);
  assert.equal(query("select relrowsecurity from pg_class where oid='public.reports'::regclass"), "t");
  assert.equal(query("select not has_function_privilege('anon','public.codev_professional_reporting_ready()','EXECUTE') and not has_function_privilege('authenticated','public.codev_professional_reporting_ready()','EXECUTE') and has_function_privilege('service_role','public.codev_professional_reporting_ready()','EXECUTE')"), "t");
  assert.equal(query("set role service_role;select public.codev_professional_reporting_ready()"), "t");
  const clientId = "11111111-1111-4111-8111-111111111111";
  const invalidId = "22222222-2222-4222-8222-222222222222";
  const baseScope = { requestId: invalidId, clientId, family: "global", sources: ["website"], start: "2026-09-01", end: "2026-09-12" };
  const invalidScopes = [
    { sources: ["website", "website"] }, { sources: [] }, { sources: ["unknown"] },
    { sources: "website" }, { sources: ["website", null] },
    { family: "ads", sources: ["website"] }, { family: "seo", sources: ["google_ads"] },
    { family: "website", sources: ["website", "activity"] }, { family: "activity", sources: ["website"] },
    { clientId: "99999999-9999-4999-8999-999999999999" },
    { requestId: "99999999-9999-4999-8999-999999999999" },
    { start: "2026-09-02" }, { end: "2026-09-13" },
  ].map(patch => ({ scope: { ...baseScope, ...patch }, start: baseScope.start, end: baseScope.end }));
  invalidScopes.push({ scope: { ...baseScope, start: "2024-01-01", end: "2025-01-01" }, start: "2024-01-01", end: "2025-01-01" });
  const beforeInvalid = query(fingerprint);
  sql(`do $$ begin ${invalidScopes.map(({ scope, start, end }) => `begin
    insert into public.reports(id,client_id,kind,period_start,period_end,scope)
      values('${invalidId}','${clientId}','custom','${start}','${end}','${JSON.stringify(scope)}');
    raise exception 'Invalid custom scope accepted';exception when check_violation then null;end;`).join("\n")} end $$;`);
  assert.equal(query(fingerprint), beforeInvalid, "invalid custom scopes do not alter any report data");
  // Inclusive bounds: one day and a leap year's 366 days are both accepted.
  sql(`insert into public.reports(id,client_id,kind,period_start,period_end,scope) values
    ('22222222-2222-4222-8222-222222222221','${clientId}','custom','2024-01-01','2024-12-31',
      '${JSON.stringify({ ...baseScope, requestId: "22222222-2222-4222-8222-222222222221", start: "2024-01-01", end: "2024-12-31" })}'),
    ('22222222-2222-4222-8222-222222222223','${clientId}','custom','2026-09-01','2026-09-01',
      '${JSON.stringify({ ...baseScope, requestId: "22222222-2222-4222-8222-222222222223", family: "website", end: "2026-09-01" })}');`);
  const id = "33333333-3333-4333-8333-333333333333";
  const scope = JSON.stringify({ requestId: id, clientId: "11111111-1111-4111-8111-111111111111", family: "global", sources: ["activity", "search_console"], start: "2026-09-01", end: "2026-09-12" });
  const insert = `insert into public.reports(id,client_id,kind,period_start,period_end,status,title,summary,client_content,scope) values('${id}','11111111-1111-4111-8111-111111111111','custom','2026-09-01','2026-09-12','ready_for_review','Rapport client','Synthèse','{"summary":"Synthèse","sections":[]}', '${scope}') on conflict do nothing returning id`;
  const race = () => new Promise((resolve, reject) => {
    const child = spawn(bin, ["-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", `begin;set local role service_role;${insert};select pg_sleep(0.15);commit;`], { env });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on("data", b => stdout += b); child.stderr.on("data", b => stderr += b);
    child.on("error", e => { clearTimeout(timer); reject(e); });
    child.on("close", status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  const attempts = await Promise.all(Array.from({ length: 4 }, race));
  attempts.forEach(a => assert.equal(a.status, 0, a.stderr));
  assert.equal(attempts.filter(a => a.stdout.includes(id)).length, 1);
  assert.equal(query(`select count(*) from public.report_versions where report_id='${id}'`), "1");
  sql(`do $$ begin
    begin update public.reports set scope=jsonb_set(scope,'{family}','"seo"') where id='${id}'; raise exception 'Scope must remain frozen'; exception when sqlstate '55000' then null; end;
    begin update public.reports set period_end='2026-09-13' where id='${id}'; raise exception 'Dates must remain frozen'; exception when sqlstate '55000' then null; end;
    begin insert into public.reports(client_id,kind,period_start,period_end,scope) values('11111111-1111-4111-8111-111111111111','custom','2026-09-01','2026-09-02','{}'); raise exception 'Incomplete scope accepted'; exception when check_violation then null; end;
    if public.codev_claim_report_delivery('${id}',1,gen_random_uuid(),'client@example.test','Rapport client','Synthèse','{"summary":"Synthèse","sections":[]}') then raise exception 'Unapproved document sent'; end if;
    end $$;
    update public.reports set status='approved',approved_version=1,approved_at=now(),approved_by='isolated-admin' where id='${id}';
    update public.reports set version=2,summary='Correction',client_content='{"summary":"Correction","sections":[]}' where id='${id}';
    do $$ begin
    if not exists(select 1 from public.reports where id='${id}' and status='ready_for_review' and approved_version is null and version=2) then raise exception 'Approval not invalidated'; end if;
    if (select count(*) from public.report_versions where report_id='${id}')<>2 then raise exception 'Version history missing'; end if;
    end $$;`);
});
