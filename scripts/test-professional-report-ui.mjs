// Real Chromium/Next, simulated session and storage; no production DB or provider calls.
import { cpSync, mkdirSync, writeFileSync, symlinkSync, rmSync, createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, ".."), out = join(root, "e2e/output/professional-reports"), app = join(out, "app");
rmSync(out, { recursive: true, force: true }); mkdirSync(app, { recursive: true });
for (const item of ["app", "components", "lib", "public", "e2e/harness/stubs", "tests/helpers", "package.json", "tsconfig.json", "postcss.config.mjs"]) cpSync(join(root, item), join(app, item), { recursive: true });
symlinkSync(join(root, "node_modules"), join(app, "node_modules"), "dir");
writeFileSync(join(app, "next.config.ts"), `import path from "node:path";export default {webpack(config:any){config.resolve.alias={...config.resolve.alias,"@clerk/nextjs/server":path.resolve(process.cwd(),"e2e/harness/stubs/clerk-server.ts"),"@clerk/nextjs":path.resolve(process.cwd(),"e2e/harness/stubs/clerk.tsx")};return config;}};`);
writeFileSync(join(app, "lib/supabase/server.ts"), `import "server-only";import {uiStore} from "../../e2e/harness/professional-store.mjs";export function getSupabaseServerClient(){return uiStore().client;}`);
writeFileSync(join(app, "e2e/harness/professional-store.mjs"), `
import {createFakeSupabase} from '../../tests/helpers/fake-supabase.mjs';
const client={id:'11111111-1111-4111-8111-111111111111',name:'Protection Nuisibles — fixture',email:'fixture@example.invalid',created_at:'2026-01-01T00:00:00Z'};
export function reset(ready=true){
 const db=createFakeSupabase({clients:[client],reports:[],report_versions:[],report_deliveries:[],tasks:[{id:'22222222-2222-4222-8222-222222222222',client_id:client.id,title:'Page contact améliorée',status:'Terminé',priority:'Moyenne',due_date:null,completed_at:'2026-09-10T10:00:00Z',created_at:'2026-09-05T10:00:00Z'}]}, {unique:{reports:[['id']]},rpc:{codev_professional_reporting_ready:()=>ready,codev_unread_notifications:()=>0}});
 const original=db.client.from;
 db.client.from=table=>{
  for(const r of db.tables.reports){
   r.client=client;r.delivery??={};r.approved_version??=null;
   if(!db.tables.report_versions.some(v=>v.report_id===r.id&&v.version===r.version))db.tables.report_versions.push({report_id:r.id,version:r.version,summary:r.summary,created_at:new Date().toISOString()});
  }
  return original(table);
 };
 globalThis.__professionalFixture=db;return db;
}
export function uiStore(){return globalThis.__professionalFixture??reset();}
export function seedAutomations(){
 const db=uiStore(),now=Date.now(),past=new Date(now-60000).toISOString(),future=new Date(now+86400000).toISOString();
 const states=[['44444444-4444-4444-8444-444444444444','Rapports à valider','succeeded'],['55555555-5555-4555-8555-555555555555','Jamais lancée',null],['66666666-6666-4666-8666-666666666666','Analyse échouée','failed']];
 db.tables.automations=[];db.tables.jobs=[];
 for(const [id,name,status] of states){
  const jobs=status?[{id:id.replace(/^./,'7'),automation_id:id,run_type:'report.generate',client_id:client.id,status,attempts:1,max_attempts:3,scheduled_for:past,started_at:past,finished_at:past,created_at:past,lease_expires_at:null,agent_run_id:null,result:status==='succeeded'?{report_ids:[db.tables.reports[0].id]}:{}}]:[];
  db.tables.jobs.push(...jobs);db.tables.automations.push({id,name,client_id:client.id,client,agent:{name:'Agent Rapport'},agent_id:null,run_type:'report.generate',frequency:'daily',schedule:{time:'09:00'},timezone:'Europe/Paris',status:'active',next_run_at:future,last_run_at:status?past:null,consecutive_failures:status==='failed'?1:0,created_at:past,jobs,config:{kind:'monthly'}});
 }
}
`);
mkdirSync(join(app, "app/api/qa"), { recursive: true });
writeFileSync(join(app, "app/api/qa/route.ts"), `import {reset,uiStore,seedAutomations} from "../../../e2e/harness/professional-store.mjs";export async function GET(request:Request){const p=new URL(request.url).searchParams;if(p.has('automations'))seedAutomations();else if(!p.has('inspect'))reset(p.get('ready')!=='0');return Response.json({reports:uiStore().tables.reports.map((r:any)=>({id:r.id,version:r.version,status:r.status,scope:r.scope})),jobCount:uiStore().tables.jobs?.length??0});}`);
const env = { ...process.env };
for (const key of Object.keys(env)) if (/TOKEN|SECRET|API_KEY|VAPID|PASSWORD|EMAIL_|PUSH_|CLERK|SUPABASE|AI_PROVIDER|STT_PROVIDER/.test(key)) delete env[key];
Object.assign(env, { NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", AUTHORIZED_ADMIN_USER_ID: "user_e2e_admin", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_e2e", EMAIL_SENDING_ENABLED: "false", PUSH_SENDING_ENABLED: "false" });
const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "-H", "127.0.0.1", "-p", "3341"], { cwd: app, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
const log = createWriteStream(join(out, "next.log")); server.stdout.pipe(log); server.stderr.pipe(log);
const base = "http://127.0.0.1:3341";
let browser, activePage;
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null) throw Error("Test server stopped; see next.log");
    try { if ((await fetch(base + "/api/qa", { signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(ready, "Isolated Next server ready");
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM });
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 375, height: 812 }]]) {
    await fetch(base + "/api/qa");
    const context = await browser.newContext({ viewport, locale: "fr-FR", acceptDownloads: true });
    const page = await context.newPage(), errors = []; page.setDefaultTimeout(35000);
    activePage = page;
    page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
    await page.goto(base + "/reports");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Préparer l’aperçu", exact: true }) });
    await form.locator('select[name="client_id"]').selectOption("11111111-1111-4111-8111-111111111111");
    await form.locator('select[name="family"]').selectOption("activity");
    await page.screenshot({ path: join(out, name + "-generation.png"), fullPage: true });
    await form.getByLabel("Du (inclus)").fill("2026-09-01"); await form.getByLabel("Au (inclus)").fill("2026-09-15");
    const confirmation = form.getByLabel("Je confirme la préparation", { exact: false });
    await confirmation.check(); await form.getByLabel("Au (inclus)").fill("2026-09-16"); assert.equal(await confirmation.isChecked(), false);
    await form.getByLabel("Au (inclus)").fill("2026-09-15"); await confirmation.check();
    await form.getByRole("button", { name: "Préparer l’aperçu", exact: true }).click();
    await form.getByRole("link", { name: "Ouvrir le rapport et son PDF" }).click();
    await page.getByText("Page contact améliorée", { exact: true }).waitFor();
    const reportUrl = page.url();
    const prepared = await (await fetch(base + "/api/qa?inspect=1")).json();
    assert.equal(prepared.reports.length, 1); assert.equal(prepared.reports[0].status, "ready_for_review");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Télécharger le PDF" }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.pdf$/); await download.saveAs(join(out, name + "-report.pdf"));
    const bytes = await (await fetch(base + "/api/reports/" + prepared.reports[0].id + "/pdf")).arrayBuffer();
    assert.equal(Buffer.from(bytes).subarray(0, 8).toString("ascii"), "%PDF-1.4");
    assert.equal(await page.getByRole("button", { name: "Envoyer le PDF par e-mail", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Approuver la version 1", exact: true }).click();
    await page.getByText("Rapport approuvé. Il peut maintenant être envoyé.").waitFor();
    await page.reload();
    await page.getByLabel("Synthèse", { exact: false }).fill("Synthèse corrigée pour ce document de démonstration.");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.getByText(/Synthèse enregistrée/).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Approuver la version 2", exact: true }).waitFor();
    const edited = await (await fetch(base + "/api/qa?inspect=1")).json();
    assert.equal(edited.reports[0].version, 2); assert.equal(edited.reports[0].status, "ready_for_review");
    await page.getByRole("button", { name: "Actualiser le document", exact: true }).click();
    await page.getByText(/Version 3 préparée/).waitFor();
    await page.goto(reportUrl); await page.screenshot({ path: join(out, name + "-review.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await fetch(base + "/api/qa?automations=1"); await page.goto(base + "/settings?tab=automations");
    await page.getByText("Validation nécessaire", { exact: true }).waitFor();
    await page.getByText("Jamais exécutée", { exact: true }).waitFor();
    await page.getByText("Échouée", { exact: true }).waitFor();
    await page.locator('a[href="/settings/automations/44444444-4444-4444-8444-444444444444"]').click();
    await page.getByRole("heading", { name: "Historique des jobs", exact: true }).waitFor();
    await page.getByRole("link", { name: /version actuelle 3/ }).waitFor();
    await page.screenshot({ path: join(out, name + "-automation-history.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal((await (await fetch(base + "/api/qa?inspect=1")).json()).jobCount, 2, "Reading supervision created no job");
    await fetch(base + "/api/qa?ready=0"); await page.goto(base + "/reports");
    await page.getByText(/Le reporting personnalisé attend la migration/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Préparer l’aperçu", exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log(name + ": prepare -> client preview -> PDF -> approve -> edit invalidates -> refresh v3; automation evidence/history read-only; absent migration blocked; no email");
    await context.close();
  }
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: join(out, "failure.png"), fullPage: true });
    writeFileSync(join(out, "failure.html"), await activePage.content());
  }
  throw error;
} finally {
  await browser?.close(); try { process.kill(-server.pid, "SIGTERM"); } catch {} log.end();
}
