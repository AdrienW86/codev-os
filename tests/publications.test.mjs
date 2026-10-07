import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function load(path, mocks = {}, logs = []) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, URLSearchParams, process: { env: { SUPABASE_SECRET_KEY: "sb_secret_fixture", SUPABASE_DB_URL: "postgres://user:fixture-password@host/db" } }, console: { error: (...args) => logs.push(args) }, require: (name) => {
    if (name === "server-only") return {};
    if (name === "react/jsx-runtime") return jsx;
    if (name === "next/link") return {default:({href,children,...props})=>jsx.jsx("a",{href,...props,children})};
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected import ${name}`);
  } });
  return exports;
}
const types = load("lib/publications/types.ts");
const validation = load("lib/publications/validation.ts", { "./types": types });
const transitions = load("lib/publications/transitions.ts", { "./types": types });
const mediaRule = load("lib/publications/media-rule.ts", { "./editor": { platformLabels: { facebook: "Facebook", instagram: "Instagram", google_business_profile: "Google Business Profile" } } });
const readError = load("lib/supabase/read-error.ts");
const id = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const variantId = "33333333-3333-4333-8333-333333333333";
const input = { client_id: id, editorial_week: "2026-10-05", slot: 1, subject: " Sujet ", variants: [{ platform: "facebook", text_content: " Texte ", asset_ids: [] }] };
const settings = { id: transitions.PUBLICATION_SETTINGS_ID, ...transitions.SAFE_PUBLICATION_FLAGS, created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z" };

test("project publication creation and target changes use transactional audited server RPCs",async()=>{
 const c=setup();assert.equal((await c.repository.createManualPublication({...input,project_id:variantId})).ok,true);
 assert.equal(c.calls.find(call=>call[0]==="rpc")[1],"publication_create_project_manual");
 assert.equal(c.calls.find(call=>call[0]==="rpc")[2].p_actor_id,"user_admin");
 assert.equal((await c.repository.setPublicationProject(id,revisionId,variantId)).ok,true);
 assert.equal(c.calls.filter(call=>call[0]==="rpc").at(-1)[2].p_expected_revision_id,revisionId);
 const denied=setup({deny:true});await assert.rejects(()=>denied.repository.setPublicationProject(id,revisionId,variantId),/denied/);
 assert.equal((await c.repository.createManualPublication({...input,project_id:"bad"})).ok,false);
 assert.equal((await c.repository.setPublicationProject(id,revisionId,"bad")).ok,false);
 const error=setup({error:{message:"secret failure"}});assert.equal((await error.repository.setPublicationProject(id,revisionId,variantId)).ok,false);
});

function setup({ deny = false, rows = [], configuration = settings, error = null, pages, rpcData = id } = {}) {
  const calls = [], logs = [];
  const guard = async () => { calls.push("auth"); if (deny) throw new Error("denied"); return { userId: "user_admin" }; };
  let pageIndex = 0;
  const query = {
    select: (columns) => { calls.push(["select", columns]); return query; },
    eq: (...args) => { calls.push(["eq", ...args]); return query; }, order: () => query,
    range: (...args) => { calls.push(["range", ...args]); return query; },
    single: async () => ({ data: configuration, error }),
    then: (resolve) => resolve({ data: pages ? pages[pageIndex++] : rows, error }),
  };
  const repository = load("lib/publications/data.ts", {
    "@/lib/require-admin": { requireAdmin: guard }, "./transitions": transitions, "./validation": validation, "./media-rule": mediaRule,
    "@/lib/supabase/read-error": readError,
    "@/lib/supabase/server": { getSupabaseServerClient: () => ({
      from: (table) => { calls.push(["from", table]); return query; },
      rpc: async (name, args) => { calls.push(["rpc", name, args]); return { data: rpcData, error }; },
    }) },
  }, logs);
  return { repository, calls, logs, guard };
}

test("fresh and missing settings fail closed for every operation", () => {
  for (const value of [null, settings]) {
    const state = transitions.publicationSafetyState(value);
    assert.equal(state.stopped, true);
    assert.equal(state.generationAllowed, false);
    assert.equal(state.automationAllowed, false);
    assert.equal(state.publishingAllowed, false);
    assert.equal(transitions.canPublishForAccount(value, null, null), false);
  }
  assert.equal(Object.isFrozen(transitions.SAFE_PUBLICATION_FLAGS), true);
});

test("publishing authorization requires global, client, account and matching client", () => {
  const global = { ...settings, emergency_stop: false, publishing_enabled: true };
  const client = { client_id: id, publishing_enabled: true };
  const account = { client_id: id, enabled: true, status: "connected", external_account_id: "page", credential_reference: "ref:test" };
  assert.equal(transitions.canPublishForAccount(global, client, account), true);
  for (const patch of [{ enabled: false }, { status: "error" }, { client_id: revisionId }, { credential_reference: null }]) {
    assert.equal(transitions.canPublishForAccount(global, client, { ...account, ...patch }), false);
  }
  assert.equal(transitions.canPublishForAccount({ ...global, emergency_stop: true }, client, account), false);
});

test("closed editorial transitions and every new revision require review", () => {
  assert.equal(transitions.canTransitionPublication("draft", "pending_review"), true);
  assert.equal(transitions.canTransitionPublication("pending_review", "approved"), true);
  assert.equal(transitions.canTransitionPublication("pending_review", "rejected"), true);
  for (const [from, to] of [["draft", "approved"], ["rejected", "approved"], ["approved", "pending_review"], ["invalid", "approved"], ["draft", "invalid"]]) {
    assert.equal(transitions.canTransitionPublication(from, to), false);
  }
  assert.equal(transitions.statusAfterRevision(), "pending_review");
  assert.equal(transitions.approvalMatchesRevision(id, revisionId), false);
  assert.equal(transitions.approvalMatchesRevision(id, null), false);
  assert.equal(transitions.approvalMatchesRevision(id, id), true);
});

test("manual input validates Monday, slots, UUIDs, unique platforms and strict snapshots", () => {
  const valid = validation.validateManualPublication(input);
  assert.equal(valid.subject, "Sujet");
  assert.equal(valid.variants[0].text_content, "Texte");
  for (const patch of [{ client_id: "bad" }, { editorial_week: "2026-10-06" }, { editorial_week: "2026-02-30" },
    { slot: 3 }, { slot: "1" }, { subject: " " }, { subject: "a".repeat(301) }, { variants: [] },
    { variants: [...input.variants, ...input.variants] }, { actor_id: "user_attacker" },
    { variants: [{ platform: "facebook", text_content: "text", token: "secret" }] },
    { variants: [{ platform: "instagram", text_content: "text", asset_ids: [id, id] }] },
    { variants: [{ platform: "unknown", text_content: "text" }] }]) {
    assert.equal(validation.validateManualPublication({ ...input, ...patch }), null);
  }
});

test("review requires exact revision, variant and rejection reason", () => {
  const review = { publication_id: id, revision_id: revisionId, variant_id: variantId, decision: "rejected", reason: "Changer l’image" };
  assert.equal(validation.validateReview(review).decision, "rejected");
  for (const patch of [{ revision_id: null }, { variant_id: null }, { reason: null }, { reason: " " }, { decision: "published" }, { actor_id: "user_attacker" }]) {
    assert.equal(validation.validateReview({ ...review, ...patch }), null);
  }
  assert.equal(validation.validateRevision({ publication_id: id, expected_revision_id: revisionId, variants: input.variants }).publication_id, id);
  assert.equal(validation.validateRevision({ publication_id: id, variants: input.variants }), null);
});

test("weekly settings require two distinct valid local slots", () => {
  assert.equal(validation.validateTimezone("Europe/Paris"), true);
  assert.equal(validation.validateTimezone("Not/AZone"), false);
  assert.equal(validation.validateWeeklySlots([{ day: 2, time: "10:00" }, { day: 5, time: "10:00" }]), true);
  for (const slots of [[], [{ day: 2, time: "10:00" }], [{ day: 2, time: "10:00" }, { day: 2, time: "10:00" }],
    [{ day: 0, time: "10:00" }, { day: 5, time: "25:00" }]]) assert.equal(validation.validateWeeklySlots(slots), false);
});

test("all repository reads and mutations stop before storage for a non-admin", async () => {
  const { repository, calls } = setup({ deny: true });
  for (const operation of [() => repository.getPublicationSettings(), () => repository.getPublicationSettingsState(),
    () => repository.listPublications(), () => repository.createManualPublication(input),
    () => repository.reviseManualPublication({}), () => repository.reviewPublication({})]) {
    await assert.rejects(operation, /denied/);
  }
  assert.equal(calls.every((call) => call === "auth"), true);
});

test("empty list is real, filters are validated and pagination is complete", async () => {
  assert.equal((await setup().repository.listPublications()).length, 0);
  const paginated = setup({ pages: [Array.from({ length: 100 }, () => ({ id })), [{ id: revisionId }]] });
  assert.equal((await paginated.repository.listPublications(id)).length, 101);
  assert.equal(paginated.calls.some((call) => call[0] === "range" && call[1] === 100), true);
  assert.equal(paginated.calls.some((call) => call[0] === "eq" && call[1] === "client_id" && call[2] === id), true);
  const invalid = setup();
  await assert.rejects(() => invalid.repository.listPublications("bad"), /invalides/);
  assert.deepEqual(invalid.calls, ["auth"]);
});

test("settings absence and storage errors never masquerade as successful empty data", async () => {
  const missing = setup({ configuration: null });
  await assert.rejects(missing.repository.getPublicationSettings, /migrations/);
  assert.equal(await missing.repository.getPublicationSettingsState(), null);
  const broken = setup({ error: { message: "private secret SQL" } });
  await assert.rejects(broken.repository.listPublications, /Impossible de charger/);
  assert.equal(JSON.stringify(broken.logs).includes("private secret"), false);
});

test("list errors preserve Supabase diagnostics on the server without leaking credentials", async () => {
  const error = { code: "42703", message: "column publications.target_date does not exist", details: null, hint: "Check the selected columns" };
  const broken = setup({ error });
  await assert.rejects(broken.repository.listPublications, /Impossible de charger/);
  assert.deepEqual(JSON.parse(JSON.stringify(broken.logs[0][1])), error);
  const diagnostic = readError.safeSupabaseReadError({
    code: "PGRST200", message: "sb_secret_fixture sb_secret_other Bearer opaque-token",
    details: "postgres://user:fixture-password@host/db token=private-value", hint: "hint\nsecond line",
    headers: { Authorization: "never-log-me" }, stack: "never-log-stack",
  });
  const logged = JSON.stringify(diagnostic);
  assert.doesNotMatch(logged, /sb_secret_|fixture-password|opaque-token|private-value|never-log/);
  assert.match(logged, /REDACTED/);
  assert.equal(diagnostic.hint, "hint second line");
  assert.deepEqual(Object.keys(diagnostic), ["code", "message", "details", "hint"]);
  assert.equal(readError.safeSupabaseReadError({ code: "", message: "TypeError: fetch failed", details: "network unavailable", hint: "" }).message, "TypeError: fetch failed");
});

test("create, revise and review use one transactional RPC with the session actor", async () => {
  const create = setup();
  assert.equal((await create.repository.createManualPublication(input)).ok, true);
  const call = create.calls.find((entry) => entry[0] === "rpc");
  assert.equal(call[1], "publication_create_manual");
  assert.equal(call[2].p_actor_id, "user_admin");
  assert.equal(call[2].p_subject, "Sujet");
  const revise = setup();
  assert.equal((await revise.repository.reviseManualPublication({ publication_id: id, expected_revision_id: revisionId, variants: input.variants })).ok, true);
  assert.equal(revise.calls.find((entry) => entry[0] === "rpc")[1], "publication_revise_manual");
  const review = setup({ rpcData: "rejected" });
  assert.equal((await review.repository.reviewPublication({ publication_id: id, revision_id: revisionId, variant_id: variantId, decision: "rejected", reason: "Réécrire" })).data, "rejected");
  assert.equal(review.calls.find((entry) => entry[0] === "rpc")[1], "publication_review");
  assert.equal(create.calls.filter((entry) => entry[0] === "from").length, 0);
});

test("invalid mutations avoid storage; RPC failures return sanitized errors", async () => {
  const invalid = setup();
  assert.equal((await invalid.repository.createManualPublication({})).ok, false);
  assert.equal((await invalid.repository.reviseManualPublication({})).ok, false);
  assert.equal((await invalid.repository.reviewPublication({})).ok, false);
  assert.equal(invalid.calls.every((entry) => entry === "auth"), true);
  const failed = setup({ error: { message: "sensitive token" } });
  const result = await failed.repository.createManualPublication(input);
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify([result, failed.logs]).includes("sensitive token"), false);
});

const primitives = load("components/ui/primitives.tsx");
const settingsPanel = load("components/publications/settings-panel.tsx", { "@/components/ui/primitives": primitives });
const date = load("lib/format-date.ts");
const boardQuery = load("lib/publications/board-query.ts", { "./types": types });
const boardComponent = load("components/publications/publications-board.tsx", { "@/components/ui/primitives": primitives, "@/components/projects/debug-details": load("components/projects/debug-details.tsx"),
  "@/lib/publications/editor": { platformLabels: {} }, "@/lib/format-date": date, "@/lib/publications/types": types, "@/lib/publications/board-query": boardQuery,
  "./board-filter-bar": { BoardFilterBar: () => null }, "./board-visibility-form": { BoardVisibilityForm: () => null } });

// The board loader is backed by the same stored rows: no demo fallback, and it reads only after the admin guard.
function boardFrom(context){return {listPublicationBoardRows:async()=>{const rows=await context.repository.listPublications();
 const mapped=rows.map(p=>({id:p.id,clientId:p.client_id,clientName:p.client?.name??"Client",projectId:null,projectName:null,date:p.editorial_week,dateIsWeek:true,status:p.status==="pending_review"?"draft":"to_prepare",rawStatus:p.status,subject:p.subject,preview:"",platforms:[],origin:"manual",edited:false,updatedAt:p.editorial_week,revisionId:null,revisionNumber:null,creationOrigin:"manual",hasMedia:false,missingMedia:[],hidden:false,deliveries:{published:0,total:0},image:null,debug:null}));
 return {rows:mapped,total:mapped.length,page:1,pageCount:1,counts:{all:mapped.length,to_prepare:0,draft:mapped.length,ready:0,rejected:0,published:0}};}};}
test("publications page renders true empty state, flags and kill switch", async () => {
  const context = setup();
  const page = load("app/(cockpit)/publications/page.tsx", {
    "@/lib/clients/data":{listClients:async()=>[]},"@/lib/publications/board":boardFrom(context),"@/lib/publications/board-query":boardQuery,"@/components/publications/publications-board":boardComponent,"@/lib/publications/drawer":{loadPublicationDetail:async()=>{throw new Error("drawer must not load without publication");}},"@/components/publications/publication-drawer":{PublicationDrawer:()=>null},"@/lib/publications/project-channels":{publicationProjectOptions:async()=>[]},"@/lib/publications/editor":{platformLabels:{},allowedPlatforms:()=>[]},"@/lib/publications/types":types,
    "@/lib/projects/data":{listProjects:async()=>[]},
    "@/lib/require-admin": { requireAdmin: context.guard }, "@/lib/publications/data": context.repository,
    "@/components/ui/primitives": primitives, "@/components/publications/settings-panel": settingsPanel,
    "@/lib/format-date": date,
  });
  const html = renderToStaticMarkup(await page.default({searchParams:Promise.resolve({})}));
  assert.match(html, /Aucune publication pour ces critères/);
  assert.match(html, /Arrêt général/);
  assert.match(html, /Actif/);
  assert.match(html, /Désactivée/);
  assert.match(html, /Nouvelle publication/);
  assert.doesNotMatch(html, /name="emergency_stop"|name="publishing_enabled"/);
  assert.equal(context.calls[0], "auth");
});

test("page refuses non-admin and renders existing publications without demo fallback", async () => {
  for (const deny of [false, true]) {
    const context = setup({ deny, rows: [{ id, subject: "Contenu réel", editorial_week: "2026-10-05", slot: 1, client_id: id, client: { name: "Client réel" }, status: "pending_review" }] });
    const page = load("app/(cockpit)/publications/page.tsx", {
      "@/lib/clients/data":{listClients:async()=>[]},"@/lib/publications/board":boardFrom(context),"@/lib/publications/board-query":boardQuery,"@/components/publications/publications-board":boardComponent,"@/lib/publications/drawer":{loadPublicationDetail:async()=>{throw new Error("drawer must not load without publication");}},"@/components/publications/publication-drawer":{PublicationDrawer:()=>null},"@/lib/publications/project-channels":{publicationProjectOptions:async()=>[]},"@/lib/publications/editor":{platformLabels:{},allowedPlatforms:()=>[]},"@/lib/publications/types":types,
      "@/lib/projects/data":{listProjects:async()=>[]},
      "@/lib/require-admin": { requireAdmin: context.guard }, "@/lib/publications/data": context.repository,
      "@/components/ui/primitives": primitives, "@/components/publications/settings-panel": settingsPanel, "@/lib/format-date": date,
    });
    if (deny) await assert.rejects(()=>page.default({searchParams:Promise.resolve({})}), /denied/);
    else { const html = renderToStaticMarkup(await page.default({searchParams:Promise.resolve({})})); assert.match(html, /Contenu réel/); assert.match(html, /Client réel/); assert.match(html, /Brouillon/); assert.match(html,new RegExp(`/publications/${id}`)); assert.equal(context.calls[0], "auth"); }
  }
});

test("Settings reads publication flags without mutation controls or external calls", async () => {
  const context = setup();
  const page = load("app/(cockpit)/settings/page.tsx", {
    "@/lib/require-admin": { requireAdmin: context.guard }, "@/lib/publications/data": context.repository,
    "@/components/ui/primitives": primitives, "@/components/publications/settings-panel": settingsPanel,
  });
  const html = renderToStaticMarkup(await page.default());
  assert.match(html, /Publications/); assert.match(html, /Automatisation/); assert.match(html, /consultation/);
  assert.doesNotMatch(html, /<form|<button/);
  const missingHtml = renderToStaticMarkup(jsx.jsx(settingsPanel.PublicationSettingsPanel, { settings: null }));
  assert.match(missingHtml, /Réglages indisponibles/);
});

test("Settings denies non-admin before reading and error UI does not expose raw failures", async () => {
  const context = setup({ deny: true });
  const page = load("app/(cockpit)/settings/page.tsx", {
    "@/lib/require-admin": { requireAdmin: context.guard }, "@/lib/publications/data": context.repository,
    "@/components/ui/primitives": primitives, "@/components/publications/settings-panel": settingsPanel,
  });
  await assert.rejects(page.default, /denied/);
  assert.deepEqual(context.calls, ["auth"]);
  const errorPage = load("app/(cockpit)/publications/error.tsx");
  const html = renderToStaticMarkup(jsx.jsx(errorPage.default, { error: new Error("private secret SQL"), reset: () => {} }));
  assert.match(html, /Publications indisponibles/);
  assert.doesNotMatch(html, /private secret SQL|Aucune publication pour le moment/);
});

test("Lot 1 has no external transport, credential access, worker or publisher", () => {
  for (const directory of ["lib/publications", "components/publications", "app/(cockpit)/publications"]) {
    for (const file of readdirSync(new URL(`../${directory}/`, import.meta.url),{recursive:true}).filter(file=>/\.(ts|tsx)$/.test(file))) {
      const source = readFileSync(new URL(`../${directory}/${file}`, import.meta.url), "utf8");
      // Lot 4 transports live exclusively in server-only integration modules.
      assert.doesNotMatch(source, /\bfetch\s*\(|\bhttps?:\/\/|process\.env|@google|nodemailer|airtable|make\.com/i, file);
      if(/@\/lib\/integrations/.test(source))assert.match(source,/import ['"]server-only['"]/);
    }
  }
});
