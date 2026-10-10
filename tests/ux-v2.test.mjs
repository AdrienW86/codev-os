import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, mocks = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Intl, Date,
    require: (name) => {
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const labels = load("lib/presentation/labels.ts");
const home = load("lib/dashboard/home.ts");
const work = load("lib/work/items.ts", { "@/lib/presentation/labels": labels });

test("presentation labels never expose raw database statuses", () => {
  for (const status of ["pending", "accepted", "rejected", "archived"]) assert.doesNotMatch(labels.recommendationStatusLabel(status).label, /_|^[a-z]+$/);
  for (const status of ["draft", "pending_approval", "approved", "executing", "executed", "failed", "cancelled"]) assert.doesNotMatch(labels.actionStatusLabel(status).label, /_/);
  assert.equal(labels.actionStatusLabel("pending_approval").label, "À valider");
  assert.equal(labels.runStatusLabel("running").label, "En cours");
  assert.equal(labels.actionStatusLabel("whatever").label, "Statut inconnu");
  assert.equal(labels.actionTypeLabel("internal.test"), "Vérification interne");
  assert.equal(labels.countLabel(1, "tâche prioritaire", "tâches prioritaires"), "1 tâche prioritaire");
  assert.equal(labels.countLabel(3, "tâche prioritaire", "tâches prioritaires"), "3 tâches prioritaires");
  assert.equal(labels.countLabel(0, "action à valider", "actions à valider"), "0 action à valider");
});

test("todayInParis uses the agency time zone", () => {
  assert.equal(home.todayInParis(new Date("2026-10-09T22:30:00Z")), "2026-10-10");
  assert.equal(home.todayInParis(new Date("2026-10-09T10:00:00Z")), "2026-10-09");
});

test("planTasks splits open dated tasks into overdue, today and the next 7 days", () => {
  const task = (id, due_date, extra = {}) => ({ id, title: id, status: "À faire", priority: "Moyenne", due_date, client_id: "c", ...extra });
  const plan = home.planTasks([
    task("late", "2026-10-01"), task("today", "2026-10-09"), task("soon-high", "2026-10-12", { priority: "Haute" }), task("soon", "2026-10-12"),
    task("edge", "2026-10-16"), task("far", "2026-10-17"), task("done", "2026-10-09", { status: "Terminé" }),
    task("undated", null, { priority: "Haute" }),
  ], "2026-10-09");
  assert.deepEqual(plain(plan.overdue.map((t) => t.id)), ["late"]);
  assert.deepEqual(plain(plan.today.map((t) => t.id)), ["today"]);
  assert.deepEqual(plain(plan.week.map((t) => t.id)), ["soon-high", "soon", "edge"]);
  assert.deepEqual(plain(plan.undatedPriority.map((t) => t.id)), ["undated"]);
});

test("watchClients ranks deterministically, ignores closed work and caps the list", () => {
  const clients = ["A", "B", "C", "D", "E", "F", "Calme"].map((name) => ({ id: name, name }));
  const watched = home.watchClients({
    clients,
    projects: [{ client_id: "A", status: "En cours" }, { client_id: "A", status: "Terminé" }, { client_id: "C", status: "En cours" }, { client_id: "D", status: "En cours" }, { client_id: "E", status: "En cours" }, { client_id: "F", status: "En cours" }],
    tasks: [{ id: "1", title: "t", status: "À faire", priority: "Haute", due_date: null, client_id: "A" }, { id: "2", title: "t", status: "Terminé", priority: "Haute", due_date: null, client_id: "Calme" }],
    recommendations: [{ client_id: "B", status: "pending" }, { client_id: "Calme", status: "accepted" }],
    actions: [{ client_id: "B", status: "pending_approval", requires_approval: true }],
  });
  assert.equal(watched.length, 5);
  assert.deepEqual(plain(watched.map((row) => row.id)), ["B", "A", "C", "D", "E"]);
  assert.ok(!watched.some((row) => row.id === "Calme"));
  assert.equal(home.describeClientWatch(watched[1]), "1 projet actif · 1 tâche");
  assert.equal(home.describeClientWatch(watched[0]), "1 recommandation · 1 action à valider");
});

test("buildWorkItems maps every source to a business section and an existing route", () => {
  const items = work.buildWorkItems({
    tasks: [
      { id: "t1", client_id: "c", project_id: "p", title: "Écrire", status: "À faire", priority: "Haute", due_date: "2026-10-10", updated_at: "2026-10-01", client: { name: "Jrenov" }, project: { name: "SEO" } },
      { id: "t2", client_id: "c", project_id: null, title: "Attente", status: "En attente", priority: "Basse", due_date: null, updated_at: "2026-10-01", client: null, project: null },
    ],
    recommendations: [{ id: "r1", client_id: "c", project_id: null, title: "Revoir", status: "pending", severity: "high", updated_at: "2026-10-02" }],
    actions: [
      { id: "a1", client_id: "c", project_id: null, action_type: "internal.test", status: "pending_approval", requires_approval: true, updated_at: "2026-10-03" },
      { id: "a2", client_id: "c", project_id: null, action_type: "internal.test", status: "executed", requires_approval: true, updated_at: "2026-10-04" },
      { id: "a3", client_id: "c", project_id: null, action_type: "internal.test", status: "failed", requires_approval: true, updated_at: "2026-10-04" },
    ],
  });
  const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
  assert.equal(byKey["task:t1"].section, "todo");
  assert.equal(byKey["task:t1"].href, "/tasks/t1/edit");
  assert.deepEqual(plain(byKey["task:t1"].project), { id: "p", name: "SEO" });
  assert.equal(byKey["task:t2"].section, "waiting");
  assert.equal(byKey["recommendation:r1"].section, "review");
  assert.equal(byKey["recommendation:r1"].href, "/recommendations/r1");
  assert.equal(byKey["action:a1"].section, "review");
  assert.equal(byKey["action:a1"].href, "/actions?status=pending_approval");
  assert.equal(byKey["action:a2"].section, "done");
  assert.equal(byKey["action:a3"].section, "follow");
  for (const item of items) assert.doesNotMatch(item.status.label, /_/);
  const groups = work.groupWorkItems(items);
  assert.deepEqual(plain(Object.keys(groups)), ["todo", "follow", "review", "waiting", "done"]);
  assert.equal(work.isWorkSectionId("review"), true);
  assert.equal(work.isWorkSectionId("pending_approval"), false);
});

test("V2 navigation lists the daily-use entries and keeps legacy routes reachable", () => {
  const navigation = read("components/layout/navigation.tsx");
  const hrefs = [...navigation.matchAll(/href: "([^"]+)", label: "([^"]+)"/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(hrefs, [["/dashboard", "Accueil"], ["/clients", "Clients"], ["/advertising", "Campagnes publicitaires"], ["/agenda", "Agenda"], ["/work", "Travail"], ["/publications", "Publications"], ["/reports", "Rapports"], ["/agents", "Agents"], ["/settings", "Paramètres"]]);
  for (const route of ["projects", "tasks", "recommendations", "actions", "dashboard", "clients", "publications", "agents", "settings", "work", "agenda", "reports"]) {
    assert.ok(existsSync(new URL(`../app/(cockpit)/${route}/page.tsx`, import.meta.url)), `${route} page exists`);
  }
  assert.doesNotMatch(navigation, /Prototype|Version 0\.2/);
  assert.doesNotMatch(read("components/layout/header.tsx"), /Cockpit interne|Espace CODE-V|autres domaines démo/);
});

test("new pages stay behind the admin guard; the assistant box only talks to its same-origin API", () => {
  for (const route of ["work", "agenda", "reports", "dashboard"]) assert.match(read(`app/(cockpit)/${route}/page.tsx`), /await requireAdmin\(\);/);
  const box = read("components/dashboard/assistant-command-box.tsx");
  // Aucun fournisseur ni clé côté navigateur : uniquement /api/assistant (session admin, même origine).
  assert.doesNotMatch(box, /openai|anthropic|api_key|NEXT_PUBLIC|@\/app\//i);
  const voice = read("components/assistant/use-voice.ts");
  assert.doesNotMatch(voice, /openai|api_key|NEXT_PUBLIC/i);
  for (const source of [box, voice]) assert.doesNotMatch(source, /\bfetch\s*\(/, "network only through lib/assistant/client-api");
  const clientApi = read("lib/assistant/client-api.ts");
  assert.deepEqual([...clientApi.matchAll(/fetch\("([^"]+)"/g)].map((match) => match[1]), ["/api/assistant", "/api/assistant/transcribe"]);
  assert.doesNotMatch(clientApi, /https?:\/\/|process\.env/);
  for (const route of ["app/api/assistant/route.ts", "app/api/assistant/transcribe/route.ts"]) {
    const source = read(route);
    assert.match(source, /await requireAdmin\(\);/, route);
    assert.match(source, /checkSameOrigin\(/, route);
  }
});
