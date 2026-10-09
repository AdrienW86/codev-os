import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {executeLocalSql} from "./helpers/local-postgres.mjs";
import {test} from "node:test";
const databaseUrl=process.env.AGENT_SCOPE_TEST_DATABASE_URL;
test("Scope SQL: rebuild all four migrations on isolated local legacy fixture twice",{skip:!databaseUrl?"No isolated local PostgreSQL configured; scope SQL integration tests not executed.":false},()=>{
 const url=new URL(databaseUrl);assert.ok(["postgres:","postgresql:"].includes(url.protocol));assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));assert.match(url.pathname,/^\/agent_scope_test(?:_[a-z0-9_]+)?$/);assert.equal(url.search,"");assert.equal(url.hash,"");
 const loopback=url.hostname==="[::1]"?"::1":"127.0.0.1";
 const env={...process.env,PGHOST:loopback,PGHOSTADDR:loopback,PGPORT:url.port||"5432",PGDATABASE:url.pathname.slice(1),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGOPTIONS:"",PGCONNECT_TIMEOUT:"5"};
 delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL("../supabase/migrations/",import.meta.url)).filter(f=>/^2026100500000[0-3]_.*\.sql$/.test(f)).sort();assert.equal(files.length,4);
 const bootstrap=readFileSync(new URL("../supabase/tests/agent-scope-bootstrap.sql",import.meta.url),"utf8");
 const marker="-- Baseline inserted here by the runner before the fictitious historical data.";
 const baseline=readFileSync(new URL("../supabase/local/baseline.sql",import.meta.url),"utf8");
 assert.ok(bootstrap.includes(marker));
 const readMigration=f=>readFileSync(new URL(`../supabase/migrations/${f}`,import.meta.url),"utf8");
 const sql=bootstrap.replace(marker,()=>baseline)+files.slice(0,2).map(readMigration).join("\n")
  +readFileSync(new URL("../supabase/tests/historical-snapshot.sql",import.meta.url),"utf8")
  +files.slice(2).map(readMigration).join("\n")
  +readFileSync(new URL("../supabase/tests/historical-preservation.sql",import.meta.url),"utf8")
  +readFileSync(new URL("../supabase/tests/publications.sql",import.meta.url),"utf8")
  +"\ndrop function pg_temp.assert_true(boolean,text); drop function pg_temp.expect_failure(text,text);\n"
  +readFileSync(new URL("../supabase/tests/agent-scope.sql",import.meta.url),"utf8")+`\nselect 'SQL_CHECKS=' || (sum(passed)+(select passed from pg_temp.historical_checks)) from pg_temp.sql_validation_counts; rollback;
  do $$ begin
   if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','p')) or exists(select 1 from pg_namespace where nspname in ('publications_private','agent_scope_private')) then raise exception 'Rebuild did not return to an empty DB'; end if;
  end $$;`;
 for(let rebuild=0;rebuild<2;rebuild++){const result=executeLocalSql(process.env.AGENT_SCOPE_TEST_PSQL??"psql",env,sql);assert.ifError(result.error);assert.equal(result.status,0,result.stderr);const count=result.stdout.match(/SQL_CHECKS=(\d+)/);assert.ok(count,"SQL checks must be counted");console.log(`${count[0]} (both suites, actual checks)`);console.log(`Four-migration rebuild ${rebuild+1}/2 passed, both SQL suites executed, DB returned to empty state.`);}
});
