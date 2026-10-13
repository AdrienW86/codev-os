// Publications dans l'assistant (phase 6) : intentions (texte et transcriptions vocales), propositions et
// confirmations, permissions, ambiguïtés, et absence totale d'outil de publication ou d'approbation.
// Dépendances SIMULÉES : aucune base, aucun appel IA, aucun réseau. Clients fictifs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as zod from "zod";
import { loadTs } from "./helpers/load-ts.mjs";
import { publicationsModules } from "./helpers/assistant-publications.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const TODAY = "2026-10-12"; // lundi

const periods = loadTs("lib/integrations/google-ads/periods.ts");
const text = loadTs("lib/assistant/text.ts");
const publications = publicationsModules(text);
const { model, intents: pubIntents } = publications;
const adsIntents = loadTs("lib/assistant/ads-intents.ts", { "@/lib/assistant/text": text });
const tools = loadTs("lib/assistant/tools.ts", { zod, "@/lib/integrations/google-ads/periods": periods, ...publications.mocks });
const intents = loadTs("lib/assistant/intents.ts", { "@/lib/assistant/text": text, "@/lib/assistant/ads-intents": adsIntents, ...publications.mocks });
const orchestrator = loadTs("lib/assistant/orchestrator.ts", { "@/lib/assistant/tools": tools, "@/lib/assistant/intents": intents, "@/lib/assistant/ads-intents": adsIntents, ...publications.mocks });
const views = loadTs("lib/assistant/views.ts", { zod });
const toolModule = loadTs("lib/assistant/publications-tool.ts", { ...publications.mocks });

const JRENOV = { id: "11111111-1111-4111-8111-111111111111", name: "JRenov" };
const CATALANE = { id: "22222222-2222-4222-8222-222222222222", name: "Couverture Catalane" };
const NUISIBLES = { id: "33333333-3333-4333-8333-333333333333", name: "Protection Nuisibles" };
const PROJECT = { id: "44444444-4444-4444-8444-444444444444", name: "Réseaux sociaux" };
const PUB = "55555555-5555-4555-8555-555555555555", PUB2 = "55555555-5555-4555-8555-555555555556";
const REV = "66666666-6666-4666-8666-666666666666";
const SLOT_FRIDAY = "77777777-7777-4777-8777-777777777777", SLOT_SATURDAY = "77777777-7777-4777-8777-777777777778";
const PHOTO1 = "88888888-8888-4888-8888-888888888881", PHOTO2 = "88888888-8888-4888-8888-888888888882";
const parse = (sentence, context = {}) => plain(intents.parseIntent(sentence, TODAY, context));

// --- Intentions -------------------------------------------------------------------------------

test("the seven Publications sentences are recognised, written or dictated (no punctuation, no accents)", () => {
  const cases = [
    [["Prépare les publications de JRenov pour la semaine prochaine.", "prepare les publications de jrenov pour la semaine prochaine", "Prépare les publications de la semaine prochaine pour JRenov"],
      "publications_prepare", (client) => ({ client, period: "next_week" })],
    [["Prépare deux publications pour Couverture Catalane.", "prepare deux publications pour couverture catalane", "Génère 2 posts pour Couverture Catalane"],
      "publications_prepare", (client) => ({ client, count: 2 })],
    [["Montre-moi les publications à valider.", "montre moi les publications a valider", "Quelles publications sont en attente de validation ?"],
      "publications_review_list", () => ({})],
    [["Pourquoi cette photo de Protection Nuisibles a été rejetée ?", "pourquoi cette photo de protection nuisibles a ete rejetee", "Explique pourquoi la photo de Protection Nuisibles a été écartée"],
      "publications_photo_explain", (client) => ({ client })],
    [["Affiche les comptes Instagram qui doivent être reconnectés.", "affiche les comptes instagram qui doivent etre reconnectes", "Quels comptes Instagram sont déconnectés"],
      "publications_reconnect_list", () => ({ platform: "instagram" })],
    [["Quels clients manquent de photos ?", "quels clients manquent de photos", "Quels clients n’ont pas assez de photos"],
      "publications_photo_shortage", () => ({})],
  ];
  for (const [sentences, tool, input] of cases) for (const sentence of sentences) {
    const intent = parse(sentence);
    assert.equal(intent.tool, tool, sentence);
    const client = intent.input.client;
    assert.deepEqual(intent.input, input(client), sentence);
    if (client) assert.match(client, /^(JRenov|jrenov|Couverture Catalane|couverture catalane|Protection Nuisibles|protection nuisibles)$/, sentence);
  }
  // Reprogrammation : contexte de la publication ouverte, sinon question ; vendredi 18 h = 2026-10-16 18:00.
  for (const sentence of ["Reprogramme cette publication à vendredi 18 h.", "reprogramme cette publication a vendredi 18h", "Décale cette publication à vendredi 18 heures"]) {
    assert.deepEqual(parse(sentence, { publicationId: PUB }), { tool: "publications_reschedule", input: { date: "2026-10-16", time: "18:00", publication_id: PUB } }, sentence);
    assert.ok(parse(sentence).clarify, `${sentence} sans contexte → question`);
  }
  assert.deepEqual(parse("Reprogramme la publication de JRenov au 2026-10-17 à 10h"), { tool: "publications_reschedule", input: { date: "2026-10-17", time: "10:00", client: "JRenov" } });
  assert.deepEqual(parse("reprogramme la 2 a samedi 9h", { view: "publications_list", items: [PUB, PUB2] }), { tool: "publications_reschedule", input: { date: "2026-10-17", time: "09:00", publication_id: PUB2 } });
  assert.deepEqual(parse("affiche les comptes facebook de JRenov a reconnecter"), { tool: "publications_reconnect_list", input: { platform: "facebook", client: "JRenov" } });
  assert.deepEqual(parse("Montre-moi les publications à valider de JRenov"), { tool: "publications_review_list", input: { client: "JRenov" } });
});

test("ambiguous or incomplete requests get a question, never a guessed action", () => {
  assert.match(parse("Prépare les publications de JRenov").clarify, /Combien de publications/);
  assert.match(parse("Prépare deux publications").clarify, /Pour quel client/);
  assert.match(parse("Prépare dix publications pour JRenov").clarify, /de 1 à 4/);
  assert.match(parse("Prépare les publications de JRenov pour le mois prochain").clarify, /semaine prochaine ou un nombre/);
  assert.match(parse("Reprogramme cette publication à vendredi", { publicationId: PUB }).clarify, /horaire/);
  assert.match(parse("Reprogramme cette publication à 18h", { publicationId: PUB }).clarify, /jour/);
  assert.match(parse("Reprogramme cette publication à vendredi 25h", { publicationId: PUB }).clarify, /pas valide/);
  assert.match(parse("reprogramme la 5 a vendredi 18h", { view: "publications_list", items: [PUB] }).clarify, /dernière liste/);
  assert.match(parse("Pourquoi cette photo a été rejetée ?").clarify, /quel client/);
  // Suite d'une liste numérotée de photos.
  assert.deepEqual(parse("la photo 2", { view: "publication_photos", clientId: NUISIBLES.id, clientName: NUISIBLES.name, items: [PHOTO1, PHOTO2] }), { tool: "publications_photo_explain", input: { photo_id: PHOTO2, client: NUISIBLES.name } });
  // Les phrases existantes ne sont pas captées.
  assert.equal(parse("Montre-moi les actions à valider").tool, "list_pending_actions");
  assert.equal(parse("Crée une tâche Préparer les publications pour JRenov demain").tool, "create_task");
  assert.equal(parse("Prépare le rapport hebdo de Jrenov.").tool, "generate_report");
  assert.equal(parse("Décale la réunion à vendredi 18h"), null, "« décale » sans publication n'est pas une reprogrammation");
});

test("publish / approve requests are refused before any tool, typed or dictated", async () => {
  for (const sentence of ["Publie la publication de JRenov", "publie maintenant sur instagram", "Approuve les publications de Couverture Catalane", "valide la publication de jrenov", "Mets en ligne le post de JRenov"])
    assert.equal(pubIntents.isPublishRequest(sentence), true, sentence);
  for (const sentence of ["Montre-moi les publications à valider.", "Prépare deux publications pour Couverture Catalane.", "Crée une tâche publier le post de JRenov demain", "Pourquoi cette photo de Protection Nuisibles a été rejetée ?"])
    assert.equal(pubIntents.isPublishRequest(sentence), false, sentence);
  const calls = [];
  const provider = { id: "openai", model: "m", complete: async () => { throw new Error("must not be called"); } };
  for (const via of ["text", "voice"]) {
    const reply = await orchestrator.respond([{ role: "user", content: "publie la publication de jrenov" }], { provider, via, today: TODAY, execute: async (...args) => { calls.push(args); return { ok: true, text: "x" }; } });
    assert.match(reply.reply, /ne publie ni n’approuve/);
    assert.equal(reply.proposal, undefined);
  }
  assert.equal(calls.length, 0);
});

test("the registry has no publish / approve / submit tool; Publications writes are drafts or reschedule only", () => {
  const names = Object.keys(tools.toolDefinitions);
  assert.equal(names.filter((name) => /publish|approv|submit|deliver|valid/.test(name)).length, 0, names.join(","));
  const pubWrites = names.filter((name) => name.startsWith("publications_") && tools.toolDefinitions[name].kind === "write").sort();
  assert.deepEqual(pubWrites, ["publications_prepare", "publications_reschedule"]);
  for (const name of ["publications_review_list", "publications_photo_explain", "publications_reconnect_list", "publications_photo_shortage"]) assert.equal(tools.toolDefinitions[name].kind, "read");
  assert.equal(tools.parseToolInput("publications_prepare", { client: "JRenov" }).ok, false, "period ou count obligatoire");
  assert.equal(tools.parseToolInput("publications_prepare", { client: "JRenov", period: "next_week", count: 2 }).ok, false, "pas les deux");
  assert.equal(tools.parseToolInput("publications_prepare", { client: "JRenov", count: 9 }).ok, false, "borné à 4");
  assert.equal(tools.parseToolInput("publications_reschedule", { date: "2026-10-16", time: "18:00" }).ok, false, "publication ou client");
  assert.equal(tools.parseToolInput("publications_reschedule", { client: "JRenov", date: "2026-10-16", time: "18:00", publish: true }).ok, false, "clés inconnues refusées");
  assert.match(tools.describeProposal("publications_prepare", { client: "JRenov", period: "next_week", start: "2026-10-19", end: "2026-10-25", slots: 3, project: "Réseaux sociaux" }), /Brouillons uniquement.*rien n’est soumis, approuvé, programmé ni publié.*appel IA réel/);
  assert.match(tools.describeProposal("publications_reschedule", { publication_id: PUB, date: "2026-10-16", time: "18:00", subject: "Toiture refaite" }), /approbation est remise à zéro/);

  // Aucune fonction de publication, d'approbation, de soumission ni de diffusion n'est importée ou appelée.
  for (const path of ["lib/assistant/publications-deps.ts", "lib/assistant/publications-tool.ts", "lib/assistant/publications-model.ts", "lib/assistant/publications-intents.ts"]) {
    const source = read(path);
    assert.doesNotMatch(source, /reviewPublication|review-actions|delivery-actions|\/delivery\/|publication_review\b|publication_deliver|submitPublication|approvePublication|publishPublication|process\.env|fetch\(/, path);
  }
  const deps = read("lib/assistant/publications-deps.ts");
  assert.match(deps, /prepareNextPublications\(projectId, \{ allowRealAI: true, excludeOccurrenceIds \}\)/);
  assert.match(deps, /reschedulePublication\(publicationId, revisionId, occurrenceId\)/);
  assert.match(deps, /listClientsLackingPhotos\(\)/); // modèle de lecture #42, mêmes règles que la sélection de l'agent
  assert.match(deps, /PROVISOIRE — à remplacer par le modèle de lecture « usage \/ exclusion des photos »/);
});

// --- Orchestrateur : propositions et confirmations -------------------------------------------------

function orchestratorDeps(overrides = {}) {
  const calls = [];
  return { calls, deps: { provider: null, today: TODAY, execute: async (name, input) => { calls.push([name, plain(input)]); return { ok: true, text: `résultat ${name}` }; },
    prepare: async (name, input) => ({ ok: true, input: { ...input, client: name === "publications_prepare" ? "JRenov" : input.client } }), ...overrides } };
}

test("mutations are only PROPOSED; execution needs the separate explicit confirmation (text and voice)", async () => {
  for (const [sentence, tool] of [["Prépare les publications de JRenov pour la semaine prochaine.", "publications_prepare"], ["Prépare deux publications pour Couverture Catalane.", "publications_prepare"]]) {
    const { calls, deps } = orchestratorDeps();
    const reply = await orchestrator.respond([{ role: "user", content: sentence }], deps);
    assert.equal(reply.proposal.tool, tool);
    assert.equal(calls.length, 0, "rien n'est exécuté avant la confirmation");
    const bare = await orchestrator.respond([{ role: "user", content: "oui" }], deps);
    assert.equal(bare.keepProposal, true);
    assert.equal(calls.length, 0, "« oui » ne confirme jamais");
    const confirmed = await orchestrator.confirmProposal(reply.proposal.tool, reply.proposal.input, deps);
    assert.equal(confirmed.reply, `résultat ${tool}`);
    assert.deepEqual(calls.map(([name]) => name), [tool]);
  }
  const voice = orchestratorDeps({ via: "voice" });
  const dictated = await orchestrator.respond([{ role: "user", content: "reprogramme cette publication a vendredi 18h" }], { ...voice.deps, context: { publicationId: PUB } });
  assert.equal(dictated.proposal.tool, "publications_reschedule");
  assert.equal(dictated.proposal.heard, "reprogramme cette publication a vendredi 18h");
  assert.equal(voice.calls.length, 0);
  // Lecture : exécutée directement.
  const readDeps = orchestratorDeps();
  await orchestrator.respond([{ role: "user", content: "montre moi les publications a valider" }], readDeps.deps);
  assert.deepEqual(readDeps.calls, [["publications_review_list", {}]]);
});

test("AI mode: a model call to publications_prepare is only a proposal; the prompt forbids publishing", async () => {
  const provider = { id: "anthropic", model: "m", complete: async () => ({ text: "", toolCalls: [{ id: "1", name: "publications_prepare", arguments: { client: "JRenov", count: 2 } }] }) };
  const { calls, deps } = orchestratorDeps({ provider });
  const reply = await orchestrator.respond([{ role: "user", content: "fais deux posts jrenov" }], deps);
  assert.equal(reply.proposal.tool, "publications_prepare");
  assert.equal(calls.length, 0);
  const prompt = orchestrator.systemPrompt(TODAY, { view: "publications_list", items: [PUB], publicationId: PUB });
  assert.match(prompt, /ne publies, n’approuves ni ne soumets JAMAIS/);
  assert.match(prompt, new RegExp(`1=${PUB}`));
});

test("a question from the preparation step carries the numbered list and context, without a proposal", async () => {
  const view = { type: "table", title: "Publications de JRenov", columns: ["N°"], rows: [], empty: "" };
  const { calls, deps } = orchestratorDeps({ prepare: async () => ({ ok: false, question: "Laquelle ?", view, context: { view: "publications_list", items: [PUB, PUB2] } }) });
  const reply = await orchestrator.respond([{ role: "user", content: "Reprogramme la publication de JRenov à vendredi 18h" }], deps);
  assert.equal(reply.proposal, undefined);
  assert.equal(reply.reply, "Laquelle ?");
  assert.deepEqual(plain(reply.context), { view: "publications_list", items: [PUB, PUB2] });
  assert.equal(calls.length, 0);
  assert.deepEqual(plain(views.parseContext({ view: "publications_list", items: [PUB], publicationId: PUB, assetId: PHOTO1 })), { view: "publications_list", items: [PUB], publicationId: PUB, assetId: PHOTO1 });
  assert.deepEqual(plain(views.parseContext({ publicationId: "pas-un-uuid" })), {}, "contexte invalide ignoré");
});

// --- Outils (dépendances simulées) ---------------------------------------------------------------

const slot = (id, date, time, scheduledFor) => ({ occurrenceId: id, platform: "instagram", date, time, scheduledFor });
function fakeDeps(overrides = {}) {
  const calls = [];
  const log = (name, value) => { calls.push(name); return value; };
  const clients = [JRENOV, CATALANE, NUISIBLES, { id: "99999999-9999-4999-8999-999999999999", name: "JRenov Toiture" }];
  const deps = {
    requireAdmin: async () => log("requireAdmin", { userId: "user_admin" }),
    today: () => TODAY,
    resolveClient: async (name) => { log("resolveClient");
      const exact = clients.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (exact) return { ok: true, ...exact };
      const many = clients.filter((c) => c.name.toLowerCase().includes(name.toLowerCase()));
      if (many.length === 1) return { ok: true, ...many[0] };
      return { ok: false, message: many.length ? `Plusieurs clients correspondent à « ${name} » : ${many.map((c) => c.name).join(", ")}. Précisez lequel.` : `Aucun client ne correspond à « ${name} ».` }; },
    agentProjects: async () => log("agentProjects", [PROJECT]),
    openSlots: async () => log("openSlots", [
      slot("a0000000-0000-4000-8000-000000000001", "2026-10-14", "10:00", "2026-10-14T08:00:00Z"),
      slot("a0000000-0000-4000-8000-000000000002", "2026-10-20", "10:00", "2026-10-20T08:00:00Z"),
      slot("a0000000-0000-4000-8000-000000000003", "2026-10-23", "18:00", "2026-10-23T16:00:00Z"),
      slot("a0000000-0000-4000-8000-000000000004", "2026-10-28", "10:00", "2026-10-28T09:00:00Z")]),
    prepareRun: async (projectId, exclude) => { calls.push(["prepareRun", projectId, [...exclude]]); return { ok: true, message: "ok", publications: [{ id: PUB, platform: "instagram", label: "Instagram" }] }; },
    pendingReview: async () => log("pendingReview", [{ id: PUB, clientId: JRENOV.id, clientName: "JRenov", projectName: PROJECT.name, platform: "instagram", subject: "Chantier salle de bain", updatedAt: "2026-10-11T10:00:00Z" }]),
    reschedulable: async () => log("reschedulable", [{ id: PUB, clientId: JRENOV.id, clientName: "JRenov", platform: "instagram", subject: "Chantier salle de bain", status: "approved", revisionId: REV, scheduledFor: "2026-10-14T08:00:00Z",
      targets: [{ id: SLOT_FRIDAY, scheduledFor: "2026-10-16T16:00:00Z" }, { id: SLOT_SATURDAY, scheduledFor: "2026-10-17T07:00:00Z" }] }]),
    reschedule: async (...args) => { calls.push(["reschedule", ...args]); return { ok: true, message: "Publication reprogrammée : nouvelle validation nécessaire avant diffusion.", publicationId: PUB2 }; },
    reconnectAccounts: async () => log("reconnectAccounts", [
      { clientId: JRENOV.id, clientName: "JRenov", platform: "instagram", name: "@jrenov", reason: "Connexion expirée" },
      { clientId: CATALANE.id, clientName: "Couverture Catalane", platform: "facebook", name: "Couverture Catalane", reason: "Accès révoqué" }]),
    photoDecisions: async () => log("photoDecisions", [
      { id: PHOTO1, libraryStatus: "rejected", mediaKind: "image", statusChangedAt: "2026-10-10T09:00:00Z", statusChangedByHuman: true, receivedAt: "2026-10-01T09:00:00Z", purged: false, width: 1200, height: 900,
        assessment: { verdict: "to_review", confidential: false, sensitive: ["face"], description: "Technicien devant une maison", quality: "good", qualityIssues: [], manualVerdict: null, reviewedAt: null } },
      { id: PHOTO2, libraryStatus: "validated", mediaKind: "image", statusChangedAt: "2026-10-09T09:00:00Z", statusChangedByHuman: true, receivedAt: "2026-10-02T09:00:00Z", purged: false, width: 1200, height: 900,
        assessment: { verdict: "relevant", confidential: false, sensitive: [], description: "Piège posé", quality: "good", qualityIssues: [], manualVerdict: null, reviewedAt: null } }]),
    clientsLackingPhotos: async () => log("clientsLackingPhotos", [{ clientId: CATALANE.id, clientName: "Couverture Catalane", available: 2, capped: false }]),
    revalidate: (paths) => calls.push(["revalidate", paths.length]),
    ...overrides,
  };
  return { calls, deps, tools: toolModule.createPublicationsTools(deps) };
}

test("non-admin: every Publications tool stops at requireAdmin, before any read or write", async () => {
  const denied = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  for (const [name, input, phase] of [
    ["publications_review_list", {}, "execute"], ["publications_photo_explain", { client: "Protection Nuisibles" }, "execute"], ["publications_reconnect_list", {}, "execute"],
    ["publications_photo_shortage", {}, "execute"], ["publications_prepare", { client: "JRenov", count: 2 }, "execute"], ["publications_prepare", { client: "JRenov", count: 2 }, "prepare"],
    ["publications_reschedule", { publication_id: PUB, date: "2026-10-16", time: "18:00" }, "prepare"], ["publications_reschedule", { publication_id: PUB, date: "2026-10-16", time: "18:00", revision_id: REV, occurrence_id: SLOT_FRIDAY }, "execute"]]) {
    const { calls, tools: t } = fakeDeps({ requireAdmin: async () => { throw denied; } });
    await assert.rejects(t[phase](name, input), denied, `${phase} ${name}`);
    assert.deepEqual(calls, [], `${phase} ${name}: aucune lecture ni écriture`);
  }
  // La route garde requireAdmin en tout premier, avant toute lecture du corps.
  const route = read("app/api/assistant/route.ts");
  assert.ok(route.indexOf("await requireAdmin()") < route.indexOf("readJsonBody(request"));
});

test("prepare: client and project resolved or asked; bounded runs; drafts only; next week excludes other slots", async () => {
  const { tools: t } = fakeDeps();
  assert.match((await t.prepare("publications_prepare", { client: "Inconnu", count: 1 })).question, /Aucun client ne correspond/);
  assert.match((await t.prepare("publications_prepare", { client: "jren", count: 1 })).question, /Plusieurs clients correspondent/);
  const twoProjects = fakeDeps({ agentProjects: async () => [PROJECT, { id: "44444444-4444-4444-8444-444444444445", name: "Fiche Google" }] });
  assert.match((await twoProjects.tools.prepare("publications_prepare", { client: "JRenov", count: 1 })).question, /plusieurs projets.*Lequel/);
  const none = fakeDeps({ agentProjects: async () => [] });
  assert.match((await none.tools.prepare("publications_prepare", { client: "JRenov", count: 1 })).question, /n’est activé sur aucun projet/);

  const week = await t.prepare("publications_prepare", { client: "jrenov", period: "next_week" });
  assert.deepEqual(plain(week), { ok: true, input: { client: "JRenov", project: PROJECT.name, period: "next_week", start: "2026-10-19", end: "2026-10-25", slots: 2 } });
  assert.equal(tools.parseToolInput("publications_prepare", week.input).ok, true, "la proposition repasse la validation stricte à la confirmation");

  // Semaine prochaine : seules les occurrences du 19 au 25 sont candidates, au plus 4 préparations.
  const run = fakeDeps();
  const outcome = await run.tools.execute("publications_prepare", week.input);
  const runs = run.calls.filter((call) => call[0] === "prepareRun");
  assert.equal(runs.length, 4);
  assert.deepEqual(runs[0][2], ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000004"]);
  assert.match(outcome.text, /Brouillons uniquement : rien n’est soumis, approuvé ni publié/);

  // « deux publications » : arrêt dès 2 brouillons (1 par préparation → 2 préparations ; 2 par préparation → 1).
  const count = fakeDeps();
  await count.tools.execute("publications_prepare", { client: "Couverture Catalane", count: 2 });
  assert.equal(count.calls.filter((call) => call[0] === "prepareRun").length, 2);
  const pair = fakeDeps({ prepareRun: async () => ({ ok: true, message: "ok", publications: [{ id: PUB, platform: "facebook", label: "Facebook" }, { id: PUB2, platform: "instagram", label: "Instagram" }] }) });
  const paired = await pair.tools.execute("publications_prepare", { client: "Couverture Catalane", count: 2 });
  assert.match(paired.text, /2 brouillons préparés pour Couverture Catalane \(Facebook, Instagram\)/);
  // Échec de l'agent (budget, agent désactivé…) : relayé, rien d'autre.
  const failing = fakeDeps({ prepareRun: async () => ({ ok: false, message: "Budget mensuel de l’agent atteint.", publications: [] }) });
  const failed = await failing.tools.execute("publications_prepare", { client: "JRenov", count: 3 });
  assert.equal(failed.ok, false);
  assert.equal(failed.text, "Budget mensuel de l’agent atteint.");
  assert.equal(failing.calls.filter((call) => call[0] === "revalidate").length, 0);
  // Aucun créneau libre la semaine prochaine → question, pas de proposition.
  const empty = fakeDeps({ openSlots: async () => [slot("a0000000-0000-4000-8000-000000000001", "2026-10-14", "10:00", "2026-10-14T08:00:00Z")] });
  assert.match((await empty.tools.prepare("publications_prepare", { client: "JRenov", period: "next_week" })).question, /Aucun créneau libre la semaine prochaine/);
});

test("reschedule: exact Paris slot, approval reset stated, revision re-checked at confirmation; ambiguity → numbered list", async () => {
  const { tools: t, calls } = fakeDeps();
  const prepared = await t.prepare("publications_reschedule", { publication_id: PUB, date: "2026-10-16", time: "18:00" });
  assert.deepEqual(plain(prepared.input), { publication_id: PUB, date: "2026-10-16", time: "18:00", revision_id: REV, occurrence_id: SLOT_FRIDAY, subject: "Chantier salle de bain", platform: "instagram", client_name: "JRenov", from: "2026-10-14T08:00:00Z" });
  assert.equal(tools.parseToolInput("publications_reschedule", prepared.input).ok, true);
  assert.match(tools.describeProposal("publications_reschedule", prepared.input), /« Chantier salle de bain » \(Instagram, JRenov\) du mercredi 14 octobre à 10:00 au vendredi 16 octobre à 18:00.*approbation est remise à zéro/);
  assert.equal(calls.filter((call) => call[0] === "reschedule").length, 0, "préparer n'écrit rien");
  const done = await t.execute("publications_reschedule", prepared.input);
  assert.deepEqual(calls.find((call) => call[0] === "reschedule"), ["reschedule", PUB, REV, SLOT_FRIDAY]);
  assert.match(done.text, /nouvelle validation/);

  assert.match((await t.prepare("publications_reschedule", { publication_id: PUB, date: "2026-10-16", time: "19:00" })).question, /Aucun créneau libre le vendredi 16 octobre à 19:00.*samedi 17 octobre à 09:00/);
  assert.match((await t.prepare("publications_reschedule", { publication_id: PUB2, date: "2026-10-16", time: "18:00" })).question, /ne peut pas être reprogrammée/);
  assert.match((await t.prepare("publications_reschedule", { publication_id: PUB, date: "2026-10-01", time: "18:00" })).question, /est passé/);
  // Révision changée entre la proposition et la confirmation : rien n'est écrit.
  const stale = fakeDeps();
  const refused = await stale.tools.execute("publications_reschedule", { ...prepared.input, revision_id: "66666666-6666-4666-8666-666666666667" });
  assert.equal(refused.ok, false);
  assert.equal(stale.calls.filter((call) => call[0] === "reschedule").length, 0);
  // Client avec plusieurs publications reprogrammables : liste numérotée et question.
  const two = fakeDeps({ reschedulable: async () => ["a", "b"].map((suffix, index) => ({ id: index ? PUB2 : PUB, clientId: JRENOV.id, clientName: "JRenov", platform: "instagram", subject: `Sujet ${suffix}`, status: "approved", revisionId: REV, scheduledFor: "2026-10-14T08:00:00Z", targets: [{ id: SLOT_FRIDAY, scheduledFor: "2026-10-16T16:00:00Z" }] })) });
  const ask = await two.tools.prepare("publications_reschedule", { client: "JRenov", date: "2026-10-16", time: "18:00" });
  assert.equal(ask.ok, false);
  assert.match(ask.question, /2 publications reprogrammables. Laquelle/);
  assert.deepEqual(plain(ask.context.items), [PUB, PUB2]);
});

test("read tools: review list with supervision deep link, reconnect links, photo shortage, photo explanation (ask when several)", async () => {
  const { tools: t, calls } = fakeDeps();
  const review = await t.execute("publications_review_list", {});
  assert.equal(review.view.link.href, "/publications/supervision?view=review");
  assert.deepEqual(plain(review.context), { view: "publications_list", items: [PUB], publicationId: PUB });
  assert.match(review.text, /1 publication à valider/);
  const scoped = await t.execute("publications_review_list", { client: "JRenov" });
  assert.equal(scoped.view.link.href, `/publications/supervision?view=review&client=${JRENOV.id}`);

  const insta = await t.execute("publications_reconnect_list", { platform: "instagram" });
  assert.deepEqual(insta.view.rows.map((row) => row.href), [`/clients/${JRENOV.id}?tab=publications`]);
  assert.match(insta.text, /@jrenov \(Instagram, connexion expirée\)/);
  const shortage = await t.execute("publications_photo_shortage", {});
  assert.match(shortage.text, /Couverture Catalane \(2 disponibles\)/);
  assert.equal(shortage.view.rows[0].href, `/clients/${CATALANE.id}?tab=media`);

  // Une seule photo écartée : explication directe (décision humaine + classement IA).
  const single = await t.execute("publications_photo_explain", { client: "Protection Nuisibles" });
  assert.match(single.text, /Rejetée par un administrateur le 2026-10-10 \(décision humaine\)/);
  assert.match(single.text, /Classée « à examiner » par l’IA/);
  assert.equal(single.context.assetId, PHOTO1);
  // Plusieurs photos écartées : on demande laquelle, liste numérotée ; puis « la photo 2 ».
  const several = fakeDeps({ photoDecisions: async () => [
    { id: PHOTO1, libraryStatus: "rejected", mediaKind: "image", statusChangedAt: "2026-10-10T09:00:00Z", statusChangedByHuman: true, receivedAt: null, purged: false, width: 1200, height: 900, assessment: null },
    { id: PHOTO2, libraryStatus: "quarantined", mediaKind: "image", statusChangedAt: "2026-10-09T09:00:00Z", statusChangedByHuman: false, receivedAt: null, purged: false, width: 1200, height: 900,
      assessment: { verdict: "off_topic", confidential: true, sensitive: ["invoice"], description: "Facture de M. X, 12 rue Y", quality: "good", qualityIssues: [], manualVerdict: null, reviewedAt: null } }] });
  const ask = await several.tools.execute("publications_photo_explain", { client: "Protection Nuisibles" });
  assert.match(ask.text, /2 photos de Protection Nuisibles sont écartées. Laquelle/);
  assert.deepEqual(plain(ask.context), { clientId: NUISIBLES.id, clientName: NUISIBLES.name, view: "publication_photos", items: [PHOTO1, PHOTO2] });
  assert.doesNotMatch(JSON.stringify(ask), /Facture de M\. X|12 rue Y/, "description confidentielle masquée");
  const second = await several.tools.execute("publications_photo_explain", { client: NUISIBLES.name, photo_id: PHOTO2 }, ask.context);
  assert.match(second.text, /Mise en quarantaine le 2026-10-09 par le classement automatique/);
  assert.match(second.text, /Contenu confidentiel détecté par le classement IA \(facture ou devis\)/);
  assert.deepEqual(plain(second.context.items), [PHOTO1, PHOTO2], "la liste reste disponible pour « et la 1 ? »");
  // Client ambigu → message, aucune lecture de photo.
  const ambiguous = fakeDeps();
  assert.match((await ambiguous.tools.execute("publications_photo_explain", { client: "jren" })).text, /Plusieurs clients/);
  assert.equal(ambiguous.calls.includes("photoDecisions"), false);
  assert.equal(calls.filter((call) => Array.isArray(call) && call[0] === "prepareRun").length, 0, "aucune lecture ne prépare");
});

test("pure rules: next week, Paris slots, exclusion reasons", () => {
  assert.deepEqual(plain(model.nextWeekRange("2026-10-12")), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(plain(model.nextWeekRange("2026-10-18")), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(plain(model.parisParts("2026-10-16T16:00:00Z")), { date: "2026-10-16", time: "18:00" });
  assert.deepEqual(plain(model.parisParts("2026-10-30T17:00:00Z")), { date: "2026-10-30", time: "18:00" }, "heure d'hiver");
  assert.deepEqual(plain(model.photoExclusionReasons({ id: PHOTO1, libraryStatus: "validated", mediaKind: "image", statusChangedAt: null, statusChangedByHuman: true, receivedAt: null, purged: false, width: 1200, height: 900,
    assessment: { verdict: "relevant", confidential: false, sensitive: [], description: "ok", quality: "good", qualityIssues: [], manualVerdict: null, reviewedAt: null } })), []);
  const poor = model.photoExclusionReasons({ id: PHOTO1, libraryStatus: "received", mediaKind: "image", statusChangedAt: null, statusChangedByHuman: false, receivedAt: null, purged: false, width: 400, height: 300,
    assessment: { verdict: "relevant", confidential: false, sensitive: [], description: "ok", quality: "poor", qualityIssues: ["blurry"], manualVerdict: null, reviewedAt: null } });
  assert.match(poor.join(" "), /Qualité insuffisante : floue.*Format inadapté \(400×300 px/);
  assert.match(model.photoExclusionReasons({ id: PHOTO1, libraryStatus: "received", mediaKind: "image", statusChangedAt: "2026-10-01", statusChangedByHuman: false, receivedAt: null, purged: false, width: null, height: null,
    assessment: { verdict: "relevant", confidential: false, sensitive: [], description: "ok", quality: "good", qualityIssues: [], manualVerdict: "off_topic", reviewedAt: "2026-10-05T10:00:00Z" } }).join(" "), /Jugée hors sujet par un administrateur le 2026-10-05/);
  assert.equal(model.supervisionReviewHref(JRENOV.id), `/publications/supervision?view=review&client=${JRENOV.id}`);
});
