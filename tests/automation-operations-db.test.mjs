// PostgreSQL natif jetable : transactions et concurrence réelles, aucun appel fournisseur.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { executeLocalSql } from "./helpers/local-postgres.mjs";

const databaseUrl = process.env.CODEV_CORE_TEST_DATABASE_URL;
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("native PostgreSQL: atomic automation enqueue, rollback, four workers, scoped claims and restricted grants", { skip: databaseUrl ? false : "Dedicated disposable loopback PostgreSQL absent" }, async () => {
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/codev_core_test(?:_[a-z0-9_]+)?$/);
  const env = { ...process.env, PGHOST: "127.0.0.1", PGHOSTADDR: "127.0.0.1", PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: "codev_core_test_automation_operations", PGCONNECT_TIMEOUT: "5" };
  delete env.PGSERVICE; delete env.PGSERVICEFILE;
  const command = process.env.CODEV_CORE_TEST_PSQL ?? "psql";
  const sql = source => { const r = executeLocalSql(command, env, source); assert.equal(r.status, 0, r.stderr); return r; };
  const created = executeLocalSql(command, { ...env, PGDATABASE: "postgres" }, "drop database if exists codev_core_test_automation_operations;create database codev_core_test_automation_operations;");
  assert.equal(created.status, 0, created.stderr);
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort();
  sql(`do $$ begin perform pg_advisory_xact_lock(761616);
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    ${read("supabase/local/remote-schema.sql")}
    ${migrations.map(file => read(`supabase/migrations/${file}`)).join("\n")}
    ${read("e2e/harness/seed.sql")}
    insert into public.automations(id,name,agent_id,run_type,frequency,schedule,next_run_at) select '33333333-3333-4333-8333-333333333333','Atomic test',id,'report.generate','weekly','{"time":"18:00","weekdays":[5]}',now()-interval '1 hour' from public.agents where agent_type='report' limit 1;`);
  // Inject a real SQL failure during enqueue: the schedule must remain due with no job.
  sql(`create function public.test_reject_enqueue() returns trigger language plpgsql as $$ begin raise exception 'injected enqueue failure'; end $$;
    create trigger test_reject_enqueue before insert on public.jobs for each row execute function public.test_reject_enqueue();
    do $$ declare before_due timestamptz; begin select next_run_at into before_due from public.automations where name='Atomic test';
      begin perform public.codev_enqueue_automation(id,next_run_at,now()+interval '7 days',now()) from public.automations where name='Atomic test'; raise exception 'missing expected failure';
      exception when raise_exception then if sqlerrm<>'injected enqueue failure' then raise; end if; end;
      if not exists(select 1 from public.automations where name='Atomic test' and next_run_at=before_due) or exists(select 1 from public.jobs) then raise exception 'lost occurrence'; end if;
    end $$;drop trigger test_reject_enqueue on public.jobs;drop function public.test_reject_enqueue();`);
  const race = source => new Promise((resolve, reject) => {
    const child = spawn(command, ["-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", `begin;${source};select pg_sleep(0.15);commit;`], { env, windowsHide: true });
    let stdout = "", stderr = ""; const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on("data", data => stdout += data); child.stderr.on("data", data => stderr += data);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", status => { clearTimeout(timer); resolve({ status, stdout: stdout.trim(), stderr }); });
  });
  const due = sql("select next_run_at from public.automations where name='Atomic test';").stdout.split("\n").map(s => s.trim()).find(s => /^20\d\d-/.test(s));
  assert.ok(due);
  const ticks = await Promise.all(Array.from({ length: 4 }, () => race(`select public.codev_enqueue_automation('33333333-3333-4333-8333-333333333333','${due}',now()+interval '7 days',now())`)));
  ticks.forEach(row => assert.equal(row.status, 0, row.stderr));
  assert.equal(ticks.filter(row => row.stdout).length, 1, "one winning tick");
  sql("do $$ begin if (select count(*) from public.jobs)<>1 then raise exception 'duplicate enqueue';end if;end $$;");
  const claims = await Promise.all(Array.from({ length: 4 }, (_, index) => race(`select id from public.codev_claim_job((select id from public.jobs limit 1),'manual-${index}',300)`)));
  claims.forEach(row => assert.equal(row.status, 0, row.stderr));
  assert.equal(claims.filter(row => row.stdout).length, 1, "one worker owns target");
  sql(`insert into public.jobs(id,run_type,idempotency_key,trigger) values('44444444-4444-4444-8444-444444444444','ads.report.send','unrelated-send','schedule');
    select * from public.codev_claim_job('55555555-5555-4555-8555-555555555555','manual',300);
    do $$ begin if not exists(select 1 from public.jobs where idempotency_key='unrelated-send' and status='queued' and attempts=0) then raise exception 'unrelated job touched';end if;end $$;
    do $$ declare f text; begin foreach f in array array['public.codev_enqueue_automation(uuid,timestamptz,timestamptz,timestamptz)','public.codev_claim_job(uuid,text,integer)'] loop
      if has_function_privilege('anon',f,'execute') or has_function_privilege('authenticated',f,'execute') or not has_function_privilege('service_role',f,'execute') then raise exception 'unsafe grant';end if;end loop;end $$;`);
  sql(`insert into public.automations(id,name,agent_id,run_type,frequency,schedule,next_run_at)
      select '66666666-6666-4666-8666-666666666666','Legacy key',id,'report.generate','once','{}',now()-interval '1 hour' from public.agents where agent_type='report' limit 1;
    insert into public.jobs(automation_id,run_type,scheduled_for,idempotency_key,trigger)
      select id,run_type,next_run_at,'auto:'||id||':'||next_run_at::text,'schedule' from public.automations where name='Legacy key';
    select public.codev_enqueue_automation(id,next_run_at,null,now()) from public.automations where name='Legacy key';
    do $$ begin if (select count(*) from public.jobs where automation_id='66666666-6666-4666-8666-666666666666')<>1 or not exists(select 1 from public.automations where name='Legacy key' and status='completed' and next_run_at is null) then raise exception 'legacy key duplicated';end if;end $$;
    update public.automations set status='paused',next_run_at=now()-interval '1 hour' where name='Atomic test';
    do $$ begin if public.codev_enqueue_automation('33333333-3333-4333-8333-333333333333',(select next_run_at from public.automations where name='Atomic test'),now()+interval '7 days',now()) is not null then raise exception 'paused automation enqueued';end if;end $$;
    begin;set local role authenticated;
    do $$ begin begin perform public.codev_claim_job('44444444-4444-4444-8444-444444444444','forbidden',300);raise exception 'grant allowed';exception when insufficient_privilege then null;end;end $$;
    rollback;`);
});
