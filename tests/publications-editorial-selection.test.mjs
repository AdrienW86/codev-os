// Socle Publications, lots 4-5 : sélection conjointe sujet + photo, anti-répétition et règles natives des plateformes.
import test from "node:test";
import assert from "node:assert/strict";
import { load, src, json, uid } from "./helpers/ts-load.mjs";

const pool = load("lib/publications/agent-v2/library-pool.ts");
const sel = load("lib/publications/agent-v2/selection.ts");
const prompt = load("lib/publications/agent-v2/prompt.ts");
const P = uid("3", 1), C = uid("1", 1), A = n => uid("a", n), PUB = n => uid("4", n);
const now = new Date("2026-10-12T08:00:00Z");
const row = (n, extra = {}) => ({ id: A(n), library_status: "validated", media_kind: "image", mime_type: "image/jpeg", size: 200000, width: 1600, height: 1200, purged_at: null, imported_at: `2026-10-0${Math.min(n, 9)}T08:00:00Z`, claimed_agent_v2_run_id: null, ...extra });
const assessment = (n, extra = {}) => ({ asset_id: A(n), verdict: "relevant", confidential: false, sensitive: [], manual_verdict: null, description: `Photo ${n} de toiture.`, topics: ["toiture"], quality: "good", quality_issues: [], business_relevance: 0.8, publishability: 0.8, ...extra });
const noReuse = { allowed: false, afterDays: 180 };

test("photothèque pool: only publishable, well-formed, unreserved photos, never one of the last publications", () => {
  const rows = [row(1), row(2, { library_status: "quarantined" }), row(3, { library_status: "rejected" }), row(4), row(5), row(6), row(7, { width: 400, height: 300 }),
    row(8, { width: 4000, height: 1000 }), row(9, { claimed_agent_v2_run_id: uid("8", 1) }), row(10, { media_kind: "video", mime_type: "video/mp4" }), row(11), row(12), row(13, { library_status: "received" }), row(14, { library_status: "received" }), row(15, { purged_at: "2026-10-01T00:00:00Z" })];
  const assessed = [assessment(4, { confidential: true, verdict: "to_review", manual_verdict: "relevant" }), assessment(5, { quality: "poor" }), assessment(6, { quality_issues: ["screenshot"] }),
    assessment(12, { manual_verdict: "off_topic" }), assessment(13), assessment(14, { sensitive: ["face"] })];
  const uses = [{ asset_id: A(11), publication_id: PUB(9), used_at: "2026-09-01T00:00:00Z" }];
  const ids = pool.libraryCandidates(rows, assessed, uses, noReuse, new Set(), now).map(c => c.id);
  assert.deepEqual(json(ids.sort()), [A(1), A(13)].sort());
  // Réemploi autorisé et délai écoulé : la photo revient, après les photos jamais utilisées.
  const reuse = pool.libraryCandidates(rows, assessed, uses, { allowed: true, afterDays: 30 }, new Set(), now).map(c => c.id);
  assert.equal(reuse.at(-1), A(11));
  assert.equal(pool.libraryCandidates(rows, assessed, uses, { allowed: true, afterDays: 60 }, new Set(), now).some(c => c.id === A(11)), false, "délai non écoulé");
  // Une photo d'une des 3 dernières publications n'est jamais reproposée, même si le réemploi est permis.
  assert.equal(pool.libraryCandidates(rows, assessed, uses, { allowed: true, afterDays: 30 }, new Set([PUB(9)]), now).some(c => c.id === A(11)), false);
});

test("photothèque pool: model sees descriptions and topics only, ordered by score, capped", () => {
  const rows = Array.from({ length: 40 }, (_, i) => row(i + 1, { library_status: "received" }));
  const assessed = rows.map((r, i) => assessment(i + 1, { business_relevance: i === 5 ? 1 : 0.7, publishability: i === 5 ? 1 : 0.7 }));
  const out = pool.libraryCandidates(rows, assessed, [], noReuse, new Set(), now);
  assert.equal(out.length, pool.MAX_LIBRARY_CANDIDATES);
  assert.equal(out[0].id, A(6), "best score first");
  assert.deepEqual(json(Object.keys(out[0]).sort()), ["categories", "description", "id", "source", "used"]);
  const manual = pool.libraryCandidates([row(1)], [], [], noReuse, new Set(), now)[0];
  assert.deepEqual(json(manual), { id: A(1), source: "library", used: false, description: null, categories: [pool.LIBRARY_FALLBACK_CATEGORY] });
  assert.equal(pool.fitsPlatforms({ width: null, height: null }), true);
  assert.equal(pool.fitsPlatforms({ width: 1080, height: 599 }), false);
});

const occ = (n, platform) => ({ occurrenceId: uid("5", n), projectId: P, clientId: C, platform, date: "2026-10-13", time: "12:00", timezone: "Europe/Paris", scheduledFor: `2026-10-13T1${n}:00:00Z` });
const batch = [occ(1, "facebook"), occ(2, "instagram"), occ(3, "google_business_profile")];
const previous = [{ subject: "Démoussage de toiture", texts: [{ platform: "facebook", text: "Le démoussage protège vos tuiles des infiltrations et prolonge la durée de vie de votre toiture." }], media: "Toiture couverte de mousse." }];
const input = (extra = {}) => ({ client: { name: "Toitures Dupont", activity: "Couverture", zone: null }, project: { name: "Réseaux" }, services: ["Couverture"], rules: "", channelRules: [], occurrences: batch,
  media: [{ id: A(1), categories: ["toiture"], description: "Toiture en ardoise.", used: false, source: "library" }], previousSubjects: ["Démoussage de toiture"], previousPublications: previous, priorityTopics: ["Zinguerie"], ...extra });
const output = (extra = {}) => ({ idea: { subject: "Zinguerie et gouttières", angle: "Des gouttières en bon état évitent les débordements." }, publications: [
  { occurrenceId: uid("5", 1), platform: "facebook", text: "Des gouttières bien posées évacuent l’eau loin des murs.", cta: null, mediaId: A(1) },
  { occurrenceId: uid("5", 2), platform: "instagram", text: "Zinguerie soignée, façade protégée. #zinguerie #toiture", cta: null, mediaId: A(1) },
  { occurrenceId: uid("5", 3), platform: "google_business_profile", text: "Couverture : pose et entretien de zinguerie.", cta: null, mediaId: A(1) }], ...extra });
const withText = (i, text) => output({ publications: output().publications.map((p, j) => j === i ? { ...p, text } : p) });

test("validation refuses a subject, wording or opening already used by the last publications", () => {
  assert.equal(sel.validateGeneratorOutput(input(), output()).ok, true);
  assert.deepEqual(json(sel.validateGeneratorOutput(input(), output({ idea: { subject: "Démoussage de TOITURE !", angle: "A" } }))), { ok: false, reason: "repetition" }, "same subject, case and punctuation aside");
  assert.deepEqual(json(sel.validateGeneratorOutput(input(), withText(0, "Le démoussage protège vos tuiles des infiltrations et prolonge la durée de vie de la toiture."))), { ok: false, reason: "repetition" }, "near-identical wording");
  assert.deepEqual(json(sel.validateGeneratorOutput(input(), withText(0, "Le démoussage protège vos tuiles des infiltrations : ici une autre histoire, pas la même."))), { ok: false, reason: "repetition" }, "same opening");
  assert.ok(sel.textSimilarity("Toiture refaite à neuf", "toiture REFAITE a neuf !") > 0.99);
  assert.ok(sel.textSimilarity("Gouttières posées", "Ardoises remplacées") === 0);
  // Les sujets prioritaires du profil sont des faits utilisables ; les textes passés n'en sont pas.
  assert.match(sel.factsOf(input()), /Zinguerie/);
  assert.doesNotMatch(sel.factsOf(input()), /infiltrations/);
});

test("validation enforces native platform rules: no hashtag on Google, bounded hashtags and length", () => {
  assert.deepEqual(json(sel.validateGeneratorOutput(input(), withText(2, "Couverture : entretien de zinguerie #toiture"))), { ok: false, reason: "platform_rules" });
  assert.deepEqual(json(sel.validateGeneratorOutput(input(), withText(1, "Zinguerie " + Array.from({ length: 9 }, (_, i) => `#tag${i}`).join(" ")))), { ok: false, reason: "platform_rules" });
  assert.deepEqual(json(sel.validateGeneratorOutput(input(), withText(0, "Gouttières #un #deux #trois #quatre"))), { ok: false, reason: "platform_rules" });
  assert.deepEqual(json(sel.validateGeneratorOutput(input(), withText(2, "Zinguerie. ".repeat(160)))), { ok: false, reason: "platform_rules" });
  assert.equal(sel.platformRuleViolation("google_business_profile", "Prix & qualité, C# et #1 ? non"), "hashtags", "a real hashtag is counted");
  assert.equal(sel.platformRuleViolation("google_business_profile", "Toiture & zinguerie"), null);
});

test("prompt: joint subject + photo choice, last publications quoted as data, no caption or file data", () => {
  const text = prompt.AGENT_V2_INSTRUCTIONS;
  assert.match(text, /previous_publications/);
  assert.match(text, /Choisis le sujet ET la photo ensemble/);
  assert.match(text, /Photo manquante/);
  const payload = prompt.buildGeneratorPayload(input());
  assert.deepEqual(json(payload.previous_publications), json(previous));
  assert.deepEqual(json(payload.priority_topics), ["Zinguerie"]);
  assert.deepEqual(json(payload.media), [{ id: A(1), categories: ["toiture"], description: "Toiture en ardoise." }], "source stays server-side");
  assert.deepEqual(json(prompt.generatorSchema(input()).properties.media_id.enum), [A(1), null]);
});

function contextWith(tables, { fail = [] } = {}) {
  const log = [];
  const db = { from(table) { log.push(table); const filters = []; const rows = () => fail.includes(table) ? { data: null, error: { message: "down" } } : { data: json((tables[table] ?? []).filter(r => filters.every(f => f(r)))), error: null };
    const q = { select: () => q, order: () => q, limit: () => q, eq(k, v) { filters.push(r => r[k] === v); return q; }, in(k, vs) { filters.push(r => vs.includes(r[k])); return q; },
      maybeSingle: async () => { const r = rows(); return { data: r.data?.[0] ?? null, error: r.error }; }, then(ok, ko) { return Promise.resolve(rows()).then(ok, ko); } }; return q; } };
  return { log, m: load("lib/publications/agent-v2/context.ts", { "@/lib/require-admin": { requireAdmin: async () => {} }, "@/lib/supabase/server": { getSupabaseServerClient: () => db } }) };
}
const tables = () => ({
  projects: [{ id: P, client_id: C, name: "Réseaux" }], clients: [{ id: C, name: "Toitures Dupont", activity: "Couverture", geographic_area: null }],
  publication_agent_projects: [{ project_id: P, client_id: C, enabled: true, rights_confirmed: true, verified_services: ["Couverture"], editorial_rules: "Ton sobre", drive_folder_id: "folder00000001" }],
  publication_project_channels: [{ project_id: P, client_id: C, platform: "facebook", enabled: true, editorial_rules: null }],
  publication_client_settings: [{ client_id: C, editorial_brief: "", media_reuse_allowed: false, media_reuse_after_days: 180 }],
  client_media_profiles: [{ client_id: C, services: ["Zinguerie", "Couverture"], priority_topics: ["Gouttières"], communication_guidelines: "Vouvoiement" }],
  publications: [
    { id: PUB(1), project_id: P, client_id: C, subject: "Démoussage", current_revision_id: uid("6", 1) }, { id: PUB(2), project_id: P, client_id: C, subject: "Démoussage", current_revision_id: uid("6", 2) },
    { id: PUB(3), project_id: P, client_id: C, subject: "Isolation", current_revision_id: uid("6", 3) }, { id: PUB(4), project_id: P, client_id: C, subject: "Charpente", current_revision_id: uid("6", 4) },
    { id: PUB(5), project_id: P, client_id: C, subject: "Ancien", current_revision_id: uid("6", 5) }],
  publication_variants: [{ client_id: C, publication_id: PUB(1), revision_id: uid("6", 1), platform: "facebook", text_content: "Texte démoussage" }, { client_id: C, publication_id: PUB(5), revision_id: uid("6", 5), platform: "facebook", text_content: "Texte ancien" }],
  publication_drive_media: [], publication_media_uses: [],
  whatsapp_assets: [row(1, { client_id: C, drive_file_id: "drive_file_secret_1", caption: "Facture de M. Durand" }), row(2, { client_id: C })],
  whatsapp_asset_assessments: [assessment(1, { client_id: C }), assessment(2, { client_id: C })],
  whatsapp_asset_uses: [{ client_id: C, asset_id: A(2), publication_id: PUB(3), used_at: "2026-10-01T00:00:00Z" }],
});

test("context: last 3 ideas with texts and photo, merged profile, photothèque pool; never a caption or Drive id; fail closed", async () => {
  const c = contextWith(tables());
  const { input: i } = await c.m.buildAgentV2Context(P, batch);
  assert.equal(new Set(c.log).size, c.log.length, "every table read once");
  assert.deepEqual(json(i.previousPublications.map(p => p.subject)), ["Démoussage", "Isolation", "Charpente"]);
  assert.deepEqual(json(i.previousPublications[0].texts), [{ platform: "facebook", text: "Texte démoussage" }]);
  assert.equal(i.previousPublications[1].media, "Photo 2 de toiture.", "photo of a recent publication described, never named");
  assert.deepEqual(json(i.services), ["Couverture", "Zinguerie"]);
  assert.deepEqual(json(i.priorityTopics), ["Gouttières"]);
  assert.match(i.rules, /Vouvoiement/);
  assert.deepEqual(json(i.media.map(m => [m.id, m.source])), [[A(1), "library"]], "photo used by a recent publication excluded");
  const all = JSON.stringify(i);
  for (const secret of ["drive_file_secret_1", "Facture de M. Durand", "folder00000001"]) assert.ok(!all.includes(secret), secret);
  for (const table of ["whatsapp_assets", "whatsapp_asset_assessments", "whatsapp_asset_uses", "client_media_profiles", "publication_variants"])
    await assert.rejects(() => contextWith(tables(), { fail: [table] }).m.buildAgentV2Context(P, batch), e => e.code === "context_unavailable", table);
});

test("media source: a photothèque photo is read with the access of its origin and its MD5; catalogue unchanged", async () => {
  const reads = [], drive = [];
  const m = load("lib/publications/media/source.ts", { "@/lib/integrations/publications-drive": { driveReadProvider: () => ({ download: async (f, d) => { drive.push([f, d]); return new Uint8Array([9]); } }) }, "@/lib/whatsapp/originals": { assetOriginal: async a => { reads.push(a); return new Uint8Array([1]); } } });
  const source = m.driveMediaSource();
  const ref = { id: A(1), driveFileId: "file_wa_000001", driveFolderId: "folder_wa_0001", mimeType: "image/jpeg", fileSize: 1, source: "library", origin: "whatsapp", md5: "a".repeat(32) };
  assert.deepEqual([...(await source.fetchMedia(ref)).bytes], [1]);
  assert.deepEqual(json(reads), [{ origin: "whatsapp", drive_file_id: "file_wa_000001", drive_folder_id: "folder_wa_0001", md5: "a".repeat(32), media_kind: "image" }]);
  assert.equal(drive.length, 0, "the Publications Drive access never reads WhatsApp imports");
  await assert.rejects(() => source.fetchMedia({ ...ref, md5: undefined }), /incomplete/);
  await source.fetchMedia({ id: A(2), driveFileId: "catalogfile0001", driveFolderId: "folder00000001", mimeType: "image/jpeg", fileSize: 1 });
  assert.deepEqual(drive, [["catalogfile0001", "folder00000001"]]);
});

test("missing photo: drafts are kept, the admin is notified once per client and day, towards the photothèque", () => {
  const service = src("lib/publications/agent-v2/service.ts");
  assert.match(service, /event_key:`media-missing:\$\{clientId\}:\$\{now\.toISOString\(\)\.slice\(0,10\)\}`,category:'media_missing',href:`\/clients\/\$\{clientId\}\?tab=media`/);
  assert.match(service, /ignoreDuplicates:true/);
  const schema = load("lib/notifications/schema.ts");
  assert.ok(schema.categories.includes("media_missing"));
  assert.equal(schema.safeNotificationHref(`/clients/${C}?tab=media`), `/clients/${C}?tab=media`);
  const sql = src("supabase/migrations/20261029000000_publications_editorial_selection.sql");
  assert.match(sql, /'media_received','media_missing'\)\)/);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ""), /publication_submit|publication_review_manual|status='approved'|publication_deliveries|security definer/i, "never submits, approves or delivers");
});
