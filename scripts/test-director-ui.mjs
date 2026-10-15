// Real Next/Chromium, simulated Clerk/storage. No real provider, microphone or database.
import { cpSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, ".."), out = join(root, "e2e/output/director"), app = join(out, "app");
rmSync(out, { recursive: true, force: true }); mkdirSync(app, { recursive: true });
for (const item of ["app", "components", "lib", "public", "e2e/harness/stubs", "tests/helpers", "package.json", "tsconfig.json", "postcss.config.mjs"]) cpSync(join(root, item), join(app, item), { recursive: true });
symlinkSync(join(root, "node_modules"), join(app, "node_modules"), "dir");
writeFileSync(join(app, "next.config.ts"), 'import path from "node:path";export default {webpack(config:any){config.resolve.alias={...config.resolve.alias,"@clerk/nextjs/server":path.resolve(process.cwd(),"e2e/harness/stubs/clerk-server.ts"),"@clerk/nextjs":path.resolve(process.cwd(),"e2e/harness/stubs/clerk.tsx")};return config;}};');
writeFileSync(join(app, "lib/supabase/server.ts"), 'import "server-only";import {store} from "../../e2e/harness/director-store.mjs";export function getSupabaseServerClient(){return store().client;}');
// Extend only the disposable helper copy with the read-only PostgREST count/abort features.
const fake = join(app, "tests/helpers/fake-supabase.mjs");
writeFileSync(fake, readFileSync(fake, "utf8").replace("range(from, to)", "abortSignal() { return api; }, range(from, to)")
  .replace("function finish(data) {", "function finish(data) { const count = data.length;")
  .replace("return { data: clone(result), error: null };", "return { data: clone(result), count, error: null };"));
writeFileSync(join(app, "e2e/harness/director-store.mjs"), [
  "import {createFakeSupabase} from '../../tests/helpers/fake-supabase.mjs';",
  "const a={id:'11111111-1111-4111-8111-111111111111',name:'Protection Nuisibles'},b={id:'22222222-2222-4222-8222-222222222222',name:'Jrenov'};",
  "export function reset(failed=false){const at=new Date().toISOString(),day=new Date(Date.now()-86400000).toISOString().slice(0,10);",
  "const db=createFakeSupabase({clients:[a,b],tasks:[],actions:[],audit_logs:[],admin_notifications:[],",
  "incidents:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',client_id:a.id,title:'Contrôler le site indisponible',severity:'critical',source:'monitoring',status:'open',updated_at:at,recommendation_id:null}],",
  "recommendations:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',client_id:b.id,title:'Examiner les zones ciblées',severity:'high',reason:'Hypothèse enregistrée, à confirmer avec les données Ads.',status:'pending',created_at:at,agent:{agent_type:'google-ads'}}],",
  "metric_snapshots:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',client_id:b.id,provider:'search-console',metric_key:'summary',period_start:'2026-09-01',period_end:day,fetched_at:at,data:{clicks:30,previous_clicks:100}}]},",
  "{failOn:(table)=>failed&&table==='metric_snapshots',rpc:{codev_unread_notifications:()=>0}});globalThis.__directorFixture=db;return db;}",
  "export function store(){return globalThis.__directorFixture??reset();}",
].join("\n"));
mkdirSync(join(app, "app/api/qa"), { recursive: true });
writeFileSync(join(app, "app/api/qa/route.ts"), 'import {reset,store} from "../../../e2e/harness/director-store.mjs";export async function GET(request:Request){const p=new URL(request.url).searchParams;if(!p.has("inspect"))reset(p.has("failed"));return Response.json({tasks:store().tables.tasks,calls:store().calls});}');
mkdirSync(join(app, "app/director-test"), { recursive: true });
writeFileSync(join(app, "app/director-test/page.tsx"), 'import {AssistantCommandBox} from "@/components/dashboard/assistant-command-box";export default function Page(){return <main className="mx-auto max-w-4xl p-3"><h1>Directeur IA — scénario isolé</h1><AssistantCommandBox suggestions={[]}/></main>;}');
const env = { ...process.env };
for (const key of Object.keys(env)) if (/TOKEN|SECRET|API_KEY|VAPID|PASSWORD|EMAIL_|PUSH_|CLERK|SUPABASE|AI_PROVIDER|STT_PROVIDER/.test(key)) delete env[key];
Object.assign(env, { NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", AUTHORIZED_ADMIN_USER_ID: "user_e2e_admin", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_e2e", EMAIL_SENDING_ENABLED: "false", PUSH_SENDING_ENABLED: "false" });
const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "-H", "127.0.0.1", "-p", "3342"], { cwd: app, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
const log = createWriteStream(join(out, "next.log")); server.stdout.pipe(log); server.stderr.pipe(log);
const base = "http://127.0.0.1:3342";
let browser;
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null) throw Error("Isolated Next server stopped; see next.log");
    try { if ((await fetch(base + "/api/qa", { signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(ready, "Isolated Next server ready");
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM });
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 375, height: 812 }]]) {
    await fetch(base + "/api/qa");
    const context = await browser.newContext({ viewport, locale: "fr-FR" }), page = await context.newPage(), errors = [], requests = [];
    page.setDefaultTimeout(35000); page.on("pageerror", e => errors.push(e.message));
    page.on("request", request => { if (request.url() === base + "/api/assistant") requests.push(request.postDataJSON()); });
    await page.goto(base + "/director-test");
    await page.getByRole("button", { name: "Analyser tous mes clients", exact: true }).evaluate(button => { button.click(); button.click(); });
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("heading", { name: "Diagnostic du Directeur IA" }).waitFor();
    await dialog.getByRole("heading", { name: "Contrôler le site indisponible" }).waitFor();
    assert.equal(requests.length, 1, "two synchronous clicks issue one request");
    await dialog.getByText(/30 contre 100.*70 %/).waitFor();
    await dialog.getByText(/Hypothèse ou justification à confirmer/).first().waitFor();
    await dialog.getByText(/État étayé/).first().waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Confirmer", exact: true }).count(), 0);
    let inspected = await (await fetch(base + "/api/qa?inspect=1")).json();
    assert.equal(inspected.tasks.length, 0);
    assert.ok(!inspected.calls.some(([, operation]) => /insert|update|delete/.test(operation)));
    const first = dialog.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Contrôler le site indisponible" }) });
    await first.getByRole("button", { name: "Proposer une tâche", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirmer", exact: true }).waitFor();
    inspected = await (await fetch(base + "/api/qa?inspect=1")).json();
    assert.equal(inspected.tasks.length, 0, "proposing a task still writes nothing");
    assert.equal(requests.at(-1).propose.tool, "create_task");
    await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
    assert.equal(await dialog.getByRole("button", { name: "Confirmer", exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    await dialog.locator(".overflow-y-auto").first().evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: join(out, name + "-diagnostic.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Fermer le panneau de résultats" }).click();
    await fetch(base + "/api/qa?failed=1");
    await page.getByRole("button", { name: "Analyser tous mes clients", exact: true }).click();
    await dialog.getByText(/Source seo indisponible/).waitFor();
    assert.equal(await dialog.getByText(/30 contre 100/).count(), 0, "failed source cannot retain old evidence");
    await page.screenshot({ path: join(out, name + "-partial.png"), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(name + ": multi-client evidence, duplicate guard, task proposal/cancel without writes, partial source and responsive panel passed");
    await context.close();
  }
} finally {
  await browser?.close(); try { process.kill(-server.pid, "SIGTERM"); } catch {} log.end();
}
