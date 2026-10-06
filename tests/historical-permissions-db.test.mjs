import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {test} from "node:test";
import {executeLocalSql} from "./helpers/local-postgres.mjs";
import {catalogChecks} from "./helpers/remote-schema-catalog.mjs";

const databaseUrl=process.env.HISTORICAL_PERMISSIONS_TEST_DATABASE_URL;
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
test("Historical hardening SQL: faithful schema, five migrations, defaults and retained history (two rebuilds)",{
 skip:!databaseUrl?"No dedicated loopback PostgreSQL configured for historical hardening.":false,
},()=>{
 const url=new URL(databaseUrl);
 assert.ok(["postgres:","postgresql:"].includes(url.protocol));
 assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));
 assert.match(url.pathname,/^\/historical_permissions_test(?:_[a-z0-9_]+)?$/);
 assert.equal(url.search,"");assert.equal(url.hash,"");
 const loopback=url.hostname==="[::1]"?"::1":"127.0.0.1";
 const env={...process.env,PGHOST:loopback,PGHOSTADDR:loopback,PGPORT:url.port||"5432",PGDATABASE:url.pathname.slice(1),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGOPTIONS:"",PGCONNECT_TIMEOUT:"5"};
 delete env.PGSERVICE;delete env.PGSERVICEFILE;
 const files=readdirSync(new URL("../supabase/migrations/",import.meta.url)).filter(f=>/^2026100500000[0-4]_.*\.sql$/.test(f)).sort();
 assert.equal(files.length,5);
 const beforeHardening=read("supabase/tests/remote-replay-after-migrations.sql");
 const preservationMarker="-- Historical ACLs deliberately left as observed, without hardening them.";
 const projectMarker="-- Project fixtures are introduced only after migration from zero projects.";
 assert.ok(beforeHardening.includes(preservationMarker));assert.ok(beforeHardening.includes(projectMarker));
 const preservation=beforeHardening.slice(0,beforeHardening.indexOf(preservationMarker));
 const projects=beforeHardening.slice(beforeHardening.indexOf(projectMarker));
 const bootstrap=`begin;
 do $$ begin
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')) or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') or exists(select 1 from pg_namespace where nspname in ('publications_private','agent_scope_private','hardening_future_private')) then raise exception 'Hardening requires an empty local DB'; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
 end $$;`;
 const apply=file=>read(`supabase/migrations/${file}`)+`\n\\echo MIGRATION_APPLIED=${file}\n`;
 const sql=bootstrap+read("supabase/local/remote-schema.sql")
  // This managed role is a superuser remotely. postgres is not its member.
  +"alter role supabase_admin superuser;\n"
  +read("supabase/tests/remote-replay-helpers.sql")
  +catalogChecks(JSON.parse(read("supabase/local/remote-schema-snapshot.json")))
  +read("supabase/tests/remote-replay-fixtures.sql")
  +"set local role postgres;\n"+files.slice(0,4).map(apply).join("\n")+"reset role;\n"
  +`create temporary table hardening_fk_snapshot as select c.oid,c.conname,pg_get_constraintdef(c.oid) as definition,c.convalidated from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='f';
    create temporary table hardening_function_snapshot as select p.oid,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','agent_scope_private','publications_private') and p.prokind='f';
    create temporary table managed_default_snapshot as select d.oid,d.defaclacl as acl from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where pg_get_userbyid(d.defaclrole)='supabase_admin' and n.nspname='public';
    set local role postgres;\n`
  +apply(files[4])+"reset role;\n"+preservation
  +read("supabase/tests/historical-permissions.sql")
  +read("supabase/tests/historical-default-privileges.sql")
  +projects+read("supabase/tests/publications.sql")
  +"\ndrop function pg_temp.assert_true(boolean,text); drop function pg_temp.expect_failure(text,text);\n"
  +read("supabase/tests/agent-scope.sql")
  +read("supabase/tests/historical-permissions-after-rpcs.sql")
  +`select 'SQL_CHECKS='||((select passed from pg_temp.remote_replay)+(select sum(passed) from pg_temp.sql_validation_counts));
    rollback;
    do $$ begin
     if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')) or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') or exists(select 1 from pg_namespace where nspname in ('publications_private','agent_scope_private','hardening_future_private')) or exists(select 1 from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public' or d.defaclnamespace=0) then raise exception 'Hardening rebuild failed to restore empty catalog'; end if;
    end $$;`;
 let previousCount;
 for(let rebuild=1;rebuild<=2;rebuild++){
  const result=executeLocalSql(process.env.HISTORICAL_PERMISSIONS_TEST_PSQL??"psql",env,sql);
  if(result.stderr)console.log(result.stderr);
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
  const count=result.stdout.match(/SQL_CHECKS=(\d+)/)?.[1];assert.ok(count);
  const applied=result.stdout.match(/MIGRATION_APPLIED=[^\r\n]+/g);assert.equal(applied?.length,5);
  assert.match(result.stderr,/Default privileges for managed creator supabase_admin remain unchanged/);
  if(previousCount)assert.equal(count,previousCount,"Both hardening rebuilds must have identical check counts");
  previousCount=count;
  console.log(applied.join("\n"));console.log(`SQL_CHECKS=${count}; five-migration hardening rebuild ${rebuild}/2 passed; database returned to empty catalogs.`);
 }
});
