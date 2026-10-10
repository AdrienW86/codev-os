#!/usr/bin/env node
// Parcours E2E réels (Playwright, 1440 / 820 / 375) contre une base Postgres LOCALE jetable.
//   - base : codev_e2e sur loopback uniquement (refus de toute autre cible) ;
//   - PostgREST local + passerelle imitant /rest/v1 de Supabase ;
//   - copie temporaire de l'application où Clerk est remplacé par un stub (resolveAlias) :
//     le code de production n'est jamais modifié.
// Prérequis : psql, un binaire PostgREST (POSTGREST_BIN), Playwright + Chromium.
//   E2E_DATABASE_URL=postgres://postgres@127.0.0.1:54329/codev_e2e POSTGREST_BIN=/chemin/postgrest node scripts/e2e.mjs
import { spawn, spawnSync } from "node:child_process";
import { cpSync, createWriteStream, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startGateway } from "../e2e/harness/gateway.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "e2e/output");
const databaseUrl = new URL(process.env.E2E_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/codev_e2e");
if (!["127.0.0.1", "localhost"].includes(databaseUrl.hostname) || !/^\/codev_e2e$/.test(databaseUrl.pathname)) throw new Error("E2E : base locale codev_e2e sur loopback uniquement.");
const postgrest = process.env.POSTGREST_BIN ?? "postgrest";
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3200), GATEWAY_PORT = 54330, PGRST_PORT = 54331;
const API_KEY = "sb_secret_e2e_local_only_not_a_real_key", JWT_SECRET = "e2e-local-jwt-secret-0123456789abcdef", CRON_SECRET = "e2e-cron-secret-0123456789abcdef";

const pgEnv = (database) => ({ ...process.env, PGHOST: "127.0.0.1", PGPORT: databaseUrl.port || "5432", PGUSER: decodeURIComponent(databaseUrl.username || "postgres"), PGPASSWORD: decodeURIComponent(databaseUrl.password), PGDATABASE: database });
function psql(database, sql) {
  const result = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1"], { env: pgEnv(database), input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`psql: ${result.stderr.slice(0, 2000)}`);
}

export function rebuildDatabase() {
  psql("postgres", "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'codev_e2e'; drop database if exists codev_e2e; create database codev_e2e;");
  const read = (path) => readFileSync(join(root, path), "utf8");
  const migrations = readdirSync(join(root, "supabase/migrations")).filter((file) => file.endsWith(".sql")).sort();
  psql("codev_e2e", `do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create schema if not exists storage;
    create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    ${read("supabase/local/remote-schema.sql")}\n${migrations.map((file) => read(`supabase/migrations/${file}`)).join("\n")}\n${read("e2e/harness/seed.sql")}`);
}

function startPostgrest() {
  const child = spawn(postgrest, [], { env: { ...process.env, PGRST_DB_URI: `postgres://${databaseUrl.username || "postgres"}@127.0.0.1:${databaseUrl.port || 5432}/codev_e2e`, PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_JWT_SECRET: JWT_SECRET, PGRST_SERVER_PORT: String(PGRST_PORT), PGRST_SERVER_HOST: "127.0.0.1", PGRST_LOG_LEVEL: "error" }, stdio: ["ignore", "inherit", "inherit"] });
  return child;
}

async function waitFor(url, timeoutMs, accept = (status) => status < 500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(url, { headers: { apikey: API_KEY } }); if (accept(response.status)) return; } catch { /* pas encore prêt */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Délai dépassé : ${url}`);
}

function prepareApp() {
  const app = join(output, "app");
  rmSync(app, { recursive: true, force: true });
  mkdirSync(app, { recursive: true });
  for (const entry of readdirSync(root)) {
    if (["node_modules", ".next", ".git", "e2e"].includes(entry)) continue;
    cpSync(join(root, entry), join(app, entry), { recursive: true });
  }
  cpSync(join(root, "e2e/harness"), join(app, "e2e/harness"), { recursive: true });
  // Liens physiques : même arborescence de modules sans copie ni lien symbolique hors racine.
  const link = spawnSync("cp", ["-al", join(root, "node_modules"), join(app, "node_modules")]);
  if (link.status !== 0) throw new Error("node_modules: copie par liens impossible");
  writeFileSync(join(app, "next.config.ts"), `import type { NextConfig } from "next";
// Copie E2E : Clerk remplacé par des stubs. Ce fichier n'existe que dans e2e/output/app.
const nextConfig: NextConfig = { turbopack: { resolveAlias: { "@clerk/nextjs/server": "./e2e/harness/stubs/clerk-server.ts", "@clerk/nextjs": "./e2e/harness/stubs/clerk.tsx" } } };
export default nextConfig;
`);
  return app;
}

async function main() {
  rmSync(join(output, "shots"), { recursive: true, force: true });
  mkdirSync(join(output, "shots"), { recursive: true });
  const app = prepareApp();
  const env = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`, SUPABASE_SECRET_KEY: API_KEY, AUTHORIZED_ADMIN_USER_ID: "user_e2e_admin", E2E_USER_ID: "user_e2e_admin", CRON_SECRET, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_e2e" };
  for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "RESEND_API_KEY", "EMAIL_SENDING_ENABLED", "GOOGLE_ADS_DEVELOPER_TOKEN", "VERCEL_TOKEN", "GITHUB_TOKEN"]) delete env[name];
  const gateway = await startGateway({ port: GATEWAY_PORT, upstreamPort: PGRST_PORT, apiKey: API_KEY, jwtSecret: JWT_SECRET });
  let rest = null;
  const resetData = async () => {
    if (rest) { rest.kill("SIGTERM"); await new Promise((done) => rest.once("exit", done)); }
    rebuildDatabase();
    rest = startPostgrest();
    await waitFor(`http://127.0.0.1:${GATEWAY_PORT}/rest/v1/clients?select=id&limit=1`, 30_000, (status) => status === 200);
  };
  await resetData();
  // Un serveur déjà présent sur le port fausserait tout le rapport : on refuse de continuer.
  if (await fetch(`http://127.0.0.1:${APP_PORT}/`).then(() => true, () => false)) throw new Error(`Port ${APP_PORT} déjà utilisé : arrêtez le serveur existant.`);
  // Build de production (pas de HMR) : comportement identique au déploiement.
  const build = spawnSync(join(app, "node_modules/.bin/next"), ["build"], { cwd: app, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (build.status !== 0) throw new Error(`next build : ${(build.stdout + build.stderr).slice(-3000)}`);
  // Groupe de processus dédié : l'arrêt emporte aussi next-server (pas de serveur orphelin sur le port).
  // Google Ads : identifiants factices et réponses simulées (e2e/harness/google-ads-fake.mjs), dans ce seul processus.
  const serverEnv = { ...env, GOOGLE_ADS_CLIENT_ID: "e2e-client", GOOGLE_ADS_CLIENT_SECRET: "e2e-client-secret", GOOGLE_ADS_REFRESH_TOKEN: "e2e-refresh", NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import ${join(app, "e2e/harness/google-ads-fake.mjs")}`.trim() };
  const next = spawn(join(app, "node_modules/.bin/next"), ["start", "-p", String(APP_PORT)], { cwd: app, env: serverEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const stopNext = () => { try { process.kill(-next.pid, "SIGTERM"); } catch { /* déjà arrêté */ } };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stopNext(); rest?.kill("SIGTERM"); process.exit(130); });
  const log = createWriteStream(join(output, "next.log"));
  next.stdout.pipe(log);
  next.stderr.pipe(log);
  try {
    await waitFor(`http://127.0.0.1:${APP_PORT}/sign-in`, 120_000);
    if (process.env.E2E_SERVE) { console.log(`E2E : application servie sur http://127.0.0.1:${APP_PORT} (Ctrl+C pour arrêter).`); await new Promise(() => {}); }
    const { runJourneys } = await import("../e2e/journeys.mjs");
    const report = await runJourneys({ base: `http://127.0.0.1:${APP_PORT}`, shots: join(output, "shots"), resetData, cronSecret: CRON_SECRET, apiKey: API_KEY });
    writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`\nParcours : ${report.passed} réussi(s), ${report.failed.length} échec(s).`);
    for (const failure of report.failed) console.log(`  ✗ ${failure}`);
    process.exitCode = report.failed.length ? 1 : 0;
  } finally {
    stopNext();
    rest?.kill("SIGTERM");
    gateway.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
