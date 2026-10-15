// Real Next/Chromium, isolated admin session and in-memory Supabase. No migration or provider calls.
// Run from scripts/: E2E_CHROMIUM=/usr/bin/chromium node scripts/test-automation-ui.mjs
// Before copying into the repository: E2E_ROOT=/workspace/codev-os node /tmp/codev-test-automation-ui.mjs
import { cpSync, mkdirSync, writeFileSync, symlinkSync, rmSync, createWriteStream, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(process.env.E2E_ROOT ?? resolve(import.meta.dirname, ".."));
const require = createRequire(join(root, "package.json"));
const { chromium } = require("playwright");
const out = join(root, "e2e/output/automations"), app = join(out, "app");
const base = "http://127.0.0.1:3343";
const ids = {
  client: "11111111-1111-4111-8111-111111111111",
  report: "33333333-3333-4333-8333-333333333333",
  review: "44444444-4444-4444-8444-444444444444",
  never: "55555555-5555-4555-8555-555555555555",
  failed: "66666666-6666-4666-8666-666666666666",
  reviewJob: "74444444-4444-4444-8444-444444444444",
  failedJob: "76666666-6666-4666-8666-666666666666",
};
const names = { review: "Rapports mensuels à valider", never: "Jamais lancée", failed: "Analyse échouée" };
const reportTitle = "Rapport mensuel — septembre 2026";
const reportSummary = "Synthèse mensuelle existante : version 2 à relire.";

// Never reuse a server from another run or send fixture reset requests to it.
try {
  await fetch(base + "/api/qa", { signal: AbortSignal.timeout(750) });
  throw new Error("Port 3343 is already occupied; stop that process before running this test.");
} catch (error) {
  if (error.message.startsWith("Port 3343")) throw error;
}
rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
for (const item of ["app", "components", "lib", "public", "e2e/harness/stubs", "tests/helpers", "package.json", "tsconfig.json", "postcss.config.mjs"]) {
  cpSync(join(root, item), join(app, item), { recursive: true });
}
symlinkSync(join(root, "node_modules"), join(app, "node_modules"), "dir");
writeFileSync(join(app, "next.config.ts"), `import path from "node:path";
export default {webpack(config:any){config.resolve.alias={...config.resolve.alias,
"@clerk/nextjs/server":path.resolve(process.cwd(),"e2e/harness/stubs/clerk-server.ts"),
"@clerk/nextjs":path.resolve(process.cwd(),"e2e/harness/stubs/clerk.tsx")};return config;}};`);
writeFileSync(join(app, "lib/supabase/server.ts"), `import "server-only";
import {uiStore} from "../../e2e/harness/automation-store.mjs";
export function getSupabaseServerClient(){return uiStore().client;}`);
writeFileSync(join(app, "e2e/harness/automation-store.mjs"), `
import {createFakeSupabase} from '../../tests/helpers/fake-supabase.mjs';
const ids=${JSON.stringify(ids)},names=${JSON.stringify(names)};
export function reset(){
 const now=Date.now(),past=new Date(now-60000).toISOString(),future=new Date(now+86400000).toISOString();
 const client={id:ids.client,name:'Protection Nuisibles — fixture',email:'fixture@example.invalid',created_at:past};
 const content={summary:${JSON.stringify(reportSummary)},highlights:[],sections:[{title:'Activité du mois',lines:['Page contact améliorée.','URL vérifiée : https://fixture.example.invalid/'+'chemin'.repeat(35)]}],empty:false};
 const report={id:ids.report,client_id:client.id,client,kind:'monthly',title:${JSON.stringify(reportTitle)},summary:content.summary,
  period_start:'2026-09-01',period_end:'2026-09-30',status:'ready_for_review',version:2,approved_version:null,
  client_content:content,internal_content:content,generated_at:past,created_at:past,updated_at:past,
  approved_at:null,approved_by:null,sent_at:null,archived_at:null,delivery:{}};
 const job=(id,automation_id,status)=>({id,automation_id,run_type:'report.generate',client_id:client.id,status,
  attempts:1,max_attempts:3,scheduled_for:past,started_at:past,finished_at:past,created_at:past,
  lease_expires_at:null,agent_run_id:null,result:status==='succeeded'?{report_ids:[report.id]}:{}});
 const jobs=[job(ids.reviewJob,ids.review,'succeeded'),job(ids.failedJob,ids.failed,'failed')];
 const automations=['review','never','failed'].map(key=>({id:ids[key],name:names[key],client_id:client.id,client,
  agent:{name:'Agent Rapport'},agent_id:null,run_type:'report.generate',frequency:'daily',schedule:{time:'09:00'},
  timezone:'Europe/Paris',status:'active',next_run_at:future,last_run_at:key==='never'?null:past,
  consecutive_failures:key==='failed'?1:0,created_at:past,config:{kind:'monthly'}}));
 const db=createFakeSupabase({clients:[client],reports:[report],report_versions:[
  {report_id:report.id,version:1,summary:'Première synthèse mensuelle.',created_at:new Date(now-120000).toISOString()},
  {report_id:report.id,version:2,summary:content.summary,created_at:past}],
  report_deliveries:[],jobs,automations},{rpc:{codev_unread_notifications:()=>0}});
 const original=db.client.from;
 db.client.from=table=>{
  // The fake client does not project relational selections: supply the latest real fixture job explicitly.
  for(const automation of db.tables.automations)automation.jobs=db.tables.jobs.filter(job=>job.automation_id===automation.id)
   .sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)).slice(0,1);
  const query=original(table),limit=query.limit,order=query.order;
  // Keep child ordering/limit from reducing or reordering the parent automation collection.
  query.limit=(count,options)=>options?.referencedTable?query:limit(count);
  query.order=(column,options)=>options?.referencedTable?query:order(column,options);
  return query;
 };
 globalThis.__automationFixture=db;return db;
}
export function uiStore(){return globalThis.__automationFixture??reset();}
export function inspect(){const db=uiStore();return {
 automations:db.tables.automations.map(({id,name})=>({id,name})),
 jobs:db.tables.jobs.map(({id,automation_id,status})=>({id,automation_id,status})),
 reports:db.tables.reports.map(({id,kind,version,status,approved_version})=>({id,kind,version,status,approved_version})),
 mutations:db.calls.filter(([table,operation])=>table!=='rpc'&&operation!=='select'),
 unexpectedRpc:db.calls.filter(([table,operation])=>table==='rpc'&&operation!=='codev_unread_notifications')
};}
`);
mkdirSync(join(app, "app/api/qa"), { recursive: true });
writeFileSync(join(app, "app/api/qa/route.ts"), `import {reset,inspect} from "../../../e2e/harness/automation-store.mjs";
export const dynamic="force-dynamic";
export async function GET(request:Request){if(new URL(request.url).searchParams.has('reset'))reset();return Response.json(inspect());}`);
// This guard only exists in the temporary app. All server HTTP/fetch destinations must be loopback.
const guard = join(app, "e2e/harness/local-network-only.cjs");
writeFileSync(guard, `const http=require('node:http'),https=require('node:https');
const allowed=new Set(['127.0.0.1','localhost','::1','[::1]']);
function check(value){const host=typeof value==='string'||value instanceof URL?new URL(value).hostname:value?.hostname??value?.host??'localhost';
 if(!allowed.has(String(host).replace(/:3343$/,'')))throw Error('External network is disabled for the automation UI test');}
for(const module of [http,https]){for(const name of ['request','get']){const original=module[name];module[name]=function(...args){check(args[0]);return original.apply(this,args);};}}
const originalFetch=globalThis.fetch;globalThis.fetch=function(input,...args){check(typeof input==='object'&&input.url?input.url:input);return originalFetch.call(this,input,...args);};
`);
// A whitelist prevents inherited provider secrets, credentials and runtime injection from reaching Next.
const env = {};
for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ"]) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, {
  NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", AUTHORIZED_ADMIN_USER_ID: "user_e2e_admin",
  E2E_USER_ID: "user_e2e_admin", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_e2e",
  EMAIL_SENDING_ENABLED: "false", PUSH_SENDING_ENABLED: "false", WHATSAPP_INGESTION_ENABLED: "false",
});
const server = spawn(process.execPath, ["--require", guard, join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "-H", "127.0.0.1", "-p", "3343"], {
  cwd: app, env, stdio: ["ignore", "pipe", "pipe"], detached: true,
});
const log = createWriteStream(join(out, "next.log"));
server.stdout.pipe(log); server.stderr.pipe(log);
let browser, activePage, serverError;
server.on("error", error => { serverError = error; });
const inspect = async () => {
  const response = await fetch(base + "/api/qa", { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, "Fixture inspection available");
  return response.json();
};
const assertViewport = async (page, label) => {
  const box = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(box.document <= box.width + 1 && box.body <= box.width + 1, label + ": no horizontal overflow " + JSON.stringify(box));
};
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw Error("Isolated Next server stopped; see " + join(out, "next.log"));
    try { if ((await fetch(base + "/api/qa", { signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(ready, "Isolated Next server ready; see " + join(out, "next.log"));
  const executablePath = process.env.E2E_CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  browser = await chromium.launch({ executablePath, args: ["--disable-background-networking", "--disable-component-update", "--no-default-browser-check"] });
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 375, height: 812 }]]) {
    assert.equal((await fetch(base + "/api/qa?reset=1")).status, 200);
    const baseline = await inspect();
    assert.equal(baseline.automations.length, 3);
    assert.equal(baseline.jobs.length, 2);
    assert.deepEqual(baseline.reports, [{ id: ids.report, kind: "monthly", version: 2, status: "ready_for_review", approved_version: null }]);
    const context = await browser.newContext({ viewport, locale: "fr-FR", serviceWorkers: "block" });
    const errors = [], externalRequests = [], mutationRequests = [];
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base) { externalRequests.push(url.origin); return route.abort(); }
      if (!["GET", "HEAD"].includes(request.method())) mutationRequests.push(request.method() + " " + url.pathname);
      return route.continue();
    });
    const page = await context.newPage();
    activePage = page; page.setDefaultTimeout(35000);
    page.on("pageerror", error => errors.push(error.message));
    // Exercise the real admin navigation, including the mobile menu.
    await page.goto(base + "/reports/" + ids.report);
    await page.getByRole("heading", { level: 1, name: "Protection Nuisibles — fixture", exact: true }).waitFor();
    if (name === "mobile") await page.locator("details > summary").click();
    const navigation = page.getByRole("navigation", { name: "Navigation principale" }).filter({ visible: true });
    await navigation.getByRole("link", { name: "Paramètres", exact: true }).click();
    await page.getByRole("heading", { name: "Paramètres", exact: true }).waitFor();
    await page.getByRole("navigation", { name: "Sections des paramètres" }).getByRole("link", { name: "Automatisations", exact: true }).click();
    await page.getByRole("heading", { name: /Supervision des automatisations/ }).waitFor();
    for (const [key, label] of [["review", "Validation nécessaire"], ["never", "Jamais exécutée"], ["failed", "Échouée"]]) {
      const row = page.locator("li").filter({ has: page.getByRole("link", { name: names[key], exact: true }) });
      assert.equal(await row.count(), 1, "Exactly one automation row: " + key);
      await row.getByText(label, { exact: true }).waitFor();
      assert.equal(await row.getByRole("link", { name: "Voir l’historique et les preuves", exact: true }).getAttribute("href"), "/settings/automations/" + ids[key]);
    }
    assert.equal(await page.getByRole("link", { name: reportTitle, exact: true }).getAttribute("href"), "/reports/" + ids.report);
    await assertViewport(page, name + " list");
    await page.screenshot({ path: join(out, name + "-automation-list.png"), fullPage: true, caret: "initial" });

    await page.getByRole("link", { name: names.never, exact: true }).click();
    await page.getByRole("heading", { name: "Historique des jobs", exact: true }).waitFor();
    await page.getByText("Jamais exécutée", { exact: true }).waitFor();
    await page.getByText("Aucun job associé enregistré.", { exact: true }).waitFor();
    assert.equal(await page.locator('li[id^="job-"]').count(), 0);
    assert.equal(await page.getByRole("button", { name: "Exécuter maintenant", exact: true }).count(), 0);
    await assertViewport(page, name + " never-run history");
    await page.getByRole("link", { name: "Toutes les automatisations", exact: true }).click();

    await page.getByRole("link", { name: names.failed, exact: true }).click();
    await page.getByRole("heading", { name: "Historique des jobs", exact: true }).waitFor();
    const failedJob = page.locator('[id="job-' + ids.failedJob + '"]');
    await failedJob.getByText("Échouée", { exact: true }).waitFor();
    await failedJob.getByText("Tentatives : 1/3", { exact: true }).waitFor();
    assert.equal(await failedJob.getByRole("link", { name: /version actuelle/ }).count(), 0);
    await assertViewport(page, name + " failed history");
    await page.screenshot({ path: join(out, name + "-automation-failed-history.png"), fullPage: true, caret: "initial" });
    await page.getByRole("link", { name: "Toutes les automatisations", exact: true }).click();

    await page.getByRole("link", { name: names.review, exact: true }).click();
    await page.getByRole("heading", { name: "Historique des jobs", exact: true }).waitFor();
    assert.equal(await page.locator('li[id^="job-"]').count(), 1);
    const reviewJob = page.locator('[id="job-' + ids.reviewJob + '"]');
    await reviewJob.getByText("Validation nécessaire", { exact: true }).waitFor();
    await reviewJob.getByText("Tentatives : 1/3", { exact: true }).waitFor();
    const proof = reviewJob.getByRole("link", { name: "Lien vers cette preuve", exact: true });
    assert.equal(await proof.getAttribute("href"), "/settings/automations/" + ids.review + "#job-" + ids.reviewJob);
    await proof.click();
    await page.waitForURL(url => url.hash === "#job-" + ids.reviewJob);
    assert.equal(new URL(page.url()).hash, "#job-" + ids.reviewJob);
    const reportLink = reviewJob.getByRole("link", { name: reportTitle + " · version actuelle 2", exact: true });
    assert.equal(await reportLink.getAttribute("href"), "/reports/" + ids.report);
    assert.equal(await page.getByRole("button", { name: "Exécuter maintenant", exact: true }).count(), 0);
    await assertViewport(page, name + " review history");
    await page.screenshot({ path: join(out, name + "-automation-review-history.png"), fullPage: true, caret: "initial" });
    await reportLink.click();
    await page.getByRole("heading", { level: 1, name: "Protection Nuisibles — fixture", exact: true }).waitFor();
    await page.getByRole("button", { name: "Approuver la version 2", exact: true }).waitFor();
    await page.getByText("À relire", { exact: true }).waitFor();
    await page.getByText(reportSummary, { exact: true }).first().waitFor();
    await assertViewport(page, name + " linked monthly report v2");
    await page.screenshot({ path: join(out, name + "-automation-linked-report-v2.png"), fullPage: true, caret: "initial" });
    await page.goBack();
    await page.getByRole("heading", { name: "Historique des jobs", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("link", { name: reportTitle + " · version actuelle 2", exact: true }).waitFor();

    const finalState = await inspect();
    assert.deepEqual(finalState.automations, baseline.automations, "Reading supervision preserves automation configuration");
    assert.deepEqual(finalState.jobs, baseline.jobs, "Reading list, history and report creates or changes no job");
    assert.deepEqual(finalState.reports, baseline.reports, "Reading keeps existing monthly report v2 awaiting review");
    assert.deepEqual(finalState.mutations, [], "No database write during read-only navigation");
    assert.deepEqual(finalState.unexpectedRpc, [], "No scheduler, generation or migration RPC");
    assert.deepEqual(mutationRequests, [], "No HTTP mutation during read-only navigation");
    assert.deepEqual(externalRequests, [], "No browser request to an external provider");
    assert.deepEqual(errors, [], "No uncaught browser error");
    console.log(name + ": admin navigation; 3 real job-derived states; never/failed/review histories; proof anchor; existing monthly v2 linked; zero writes/jobs created; no overflow or external requests");
    await context.close();
  }
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: join(out, "failure.png"), fullPage: true, caret: "initial" }).catch(() => {});
    writeFileSync(join(out, "failure.html"), await activePage.content());
  }
  throw error;
} finally {
  await browser?.close();
  try { process.kill(-server.pid, "SIGTERM"); } catch {}
  log.end();
}
