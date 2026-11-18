import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const charter = loadTs("lib/harness/charter.ts");
const catalog = loadTs("lib/launch/catalog.ts");
const heartbeat = readFileSync("lib/scheduler/heartbeat.ts", "utf8");
const steps = JSON.parse(heartbeat.match(/export const schedulerSteps = (\[[^\]]+\])/)[1]);

test("chaque étape du planificateur et chaque exécution d’agent se lance à la main (sauf la diffusion, à son créneau)", () => {
  const coveredSteps = new Set(catalog.launchTasks.map((t) => t.covers.step).filter(Boolean));
  const coveredRuns = new Set(catalog.launchTasks.map((t) => t.covers.runType).filter(Boolean));
  for (const step of steps) if (!catalog.NOT_LAUNCHABLE_STEPS.includes(step)) assert.ok(coveredSteps.has(step), `étape ${step} sans lancement manuel`);
  for (const c of charter.harnessCharters) for (const trigger of c.triggers) {
    if (trigger.kind === "step" && !catalog.NOT_LAUNCHABLE_STEPS.includes(trigger.step)) assert.ok(coveredSteps.has(trigger.step), `${c.id} : ${trigger.step}`);
    if (trigger.kind === "run") assert.ok(coveredRuns.has(trigger.runType), `${c.id} : ${trigger.runType}`);
  }
  for (const step of ["publication_delivery_send", "publication_delivery_prepare", "publication_auto_approval"]) assert.ok(!coveredSteps.has(step), `${step} ne se force jamais`);
});

test("catalogue : identifiants uniques, agents connus, appel payant signalé", () => {
  const ids = catalog.launchTasks.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  const agents = new Set(charter.harnessCharters.map((c) => c.id));
  for (const t of catalog.launchTasks) assert.ok(agents.has(t.agent), t.id);
  assert.equal(catalog.launchTask("local-geogrid").paid, true);
  assert.equal(catalog.launchTask("nope"), null);
});

test("service : verrou de 2 minutes, chaque cas du catalogue sans écran est traité, aucune diffusion forcée", () => {
  const service = readFileSync("lib/launch/service.ts", "utf8");
  assert.match(service, /LOCK_MS = 2 \* 60_000/);
  assert.match(service, /"launch\.started"/);
  for (const t of catalog.launchTasks.filter((x) => !x.href)) assert.match(service, new RegExp(`case "${t.id}"`), t.id);
  assert.doesNotMatch(service, /processScheduledDuePublications|prepareApprovedDeliveries|runAutoApproval|publishNow/);
  // Les relevés forcés pour un client contournent l'échéance, jamais la garde « agent actif ».
  for (const file of ["lib/performance/weekly.ts", "lib/site-health/service.ts", "lib/local-seo/service.ts", "lib/local-competition/service.ts", "lib/local-geogrid/service.ts"]) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /options\.clientId/, file);
    assert.match(src, /agent\.status ?!== ?['"]Actif['"]/, file);
  }
});
