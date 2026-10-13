// Photothèque, outils (migration 20261103000000) : les quatre arrivées de photos (webhook WhatsApp Business, export
// WhatsApp, photos déjà présentes dans le dossier Drive, photos ajoutées plus tard dans Drive) aboutissent une seule fois
// dans la photothèque du bon client ; numéro inconnu jamais attribué ; filtres, « Pourquoi écartée ? », reclassement,
// légende, historique d'utilisation et réemploi. Fournisseurs simulés uniquement (aucun réseau). Clients fictifs.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { load, src, json, uid, form } from "./helpers/ts-load.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
import { buildZip } from "./helpers/zip.mjs";

const require = createRequire(import.meta.url);
const COUV = uid("c", 1), JRENOV = uid("c", 2), ADMIN = "user_admin";
const WA_FOLDER = "folder_wa_couverture", AGENT_FOLDER = "folder_agent_couverture";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const md5 = bytes => createHash("md5").update(bytes).digest("hex");
const photo = name => Buffer.from(`JPEG-${name}-`.repeat(40));
const PHOTOS = { roof: photo("toiture-catalane"), gutter: photo("gouttiere-zinc"), ridge: photo("faitage"), invoice: photo("devis") };

// --- Banc commun : une base simulée partagée par les trois services (WhatsApp, synchro Drive, export). ---------------
function bench({ senders = [{ sender: "33611111111", client_id: COUV, drive_folder_id: WA_FOLDER, enabled: true, rights_confirmed: true, updated_at: "2026-10-01" }], driveFiles = {}, assets = [] } = {}) {
  const fake = createFakeSupabase({
    whatsapp_senders: senders, whatsapp_inbox: [], whatsapp_assets: assets, whatsapp_export_imports: [], whatsapp_export_items: [],
    publication_agent_projects: [{ project_id: uid("p", 1), client_id: COUV, drive_folder_id: AGENT_FOLDER, rights_confirmed: true }],
    client_media_drive_files: [], client_media_drive_sync: [],
  }, {
    unique: { whatsapp_assets: [["client_id", "drive_folder_id", "sha256"], ["drive_file_id"]], client_media_drive_files: [["client_id", "drive_file_id"]] },
    rpc: {
      // Même règle que la RPC SQL : expéditeur associé actif avec droits, ou ligne affectée explicitement. Jamais un inconnu.
      whatsapp_claim: (args, tables) => {
        const job = tables.whatsapp_inbox.find(i => i.status === "pending" && i.sender && ((i.assigned_by && i.client_id) || tables.whatsapp_senders.some(s => s.sender === i.sender && s.enabled && s.rights_confirmed)));
        if (!job) return [];
        const s = tables.whatsapp_senders.find(x => x.sender === job.sender);
        Object.assign(job, { status: "processing", client_id: job.client_id ?? s.client_id, drive_folder_id: job.drive_folder_id ?? s.drive_folder_id, lease: args.p_lease, attempts: (job.attempts ?? 0) + 1 });
        return [{ ...job }];
      },
    },
  });
  const db = { ...fake.client, storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) } };
  const log = { waUploads: [], driveDownloads: [], audits: [], exportUploads: [] };
  let ids = 0, leases = 0;
  const payload = load("lib/whatsapp/payload.ts");
  const media = new Map();
  const service = load("lib/whatsapp/service.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => db },
    "@/lib/core/audit": { writeAudit: async (_a, entry) => { log.audits.push(entry); } },
    "./providers": {
      newLease: () => `lease-${++leases}`, importDriveToken: async () => "dummy-import-token", generateDriveId: async () => `drive_wa_${String(++ids).padStart(6, "0")}`, thumbnail: async () => null,
      downloadWhatsApp: async mediaId => { const bytes = media.get(mediaId); return { bytes, mime: "image/jpeg", sha256: sha(bytes), md5: md5(bytes), kind: "image", width: 1600, height: 1200 }; },
      uploadDrive: async (_t, id, folder) => { log.waUploads.push([id, folder]); return "created"; },
      ImportFailure: class extends Error { constructor(code) { super(code); this.code = code; } },
    },
  }, { process: { env: { WHATSAPP_INGESTION_ENABLED: "true" } } });
  const provider = {
    list: async folder => Object.entries(driveFiles[folder] ?? {}).map(([id, f]) => ({ drive_file_id: id, mime_type: "image/jpeg", modified_at: f.modified })).sort((a, b) => b.modified_at.localeCompare(a.modified_at)),
    download: async (id, folder) => { log.driveDownloads.push(id); const f = driveFiles[folder]?.[id]; if (!f || f.broken) throw Error("Drive read failed"); return f.bytes; },
  };
  const intelligence = load("lib/media-intelligence/service.ts", {
    "node:crypto": require("node:crypto"), sharp: () => ({ metadata: async () => ({ width: 1600, height: 1200 }) }),
    "@/lib/supabase/server": { getSupabaseServerClient: () => db },
    "@/lib/integrations/publications-openai": {}, "@/lib/integrations/publications-drive": { driveReadProvider: () => provider }, "@/lib/publications/media/transform": {},
    "@/lib/whatsapp/originals": {}, "@/lib/whatsapp/providers": {},
    "@/lib/whatsapp/service": { storeThumbnail: async () => {}, THUMBNAIL_BUCKET: "whatsapp-thumbnails" },
  });
  // Webhook Meta (charge utile réelle) → file durable → traitement.
  const receive = async (from, messageId, name) => {
    media.set(`media-${messageId}`, PHOTOS[name]);
    const items = payload.incomingMedia({ object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone" }, messages: [{ from, id: messageId, timestamp: "1791626400", type: "image", image: { id: `media-${messageId}`, mime_type: "image/jpeg" } }] } }] }] }, "waba", "phone");
    await service.enqueueMedia(items);
    // Valeurs par défaut de la table (statut « pending », aucune tentative).
    for (const row of fake.tables.whatsapp_inbox) { row.status ??= "pending"; row.attempts ??= 0; }
    return service.processOneMedia({ kind: "system", worker: "test" });
  };
  const exportImport = async files => {
    const archive = buildZip([{ name: "Discussion WhatsApp avec Couverture.txt", data: files.map((f, i) => `12/0${i + 1}/2024 14:32 - Client: ${f.name} (fichier joint)`).join("\n") }, ...files.map(f => ({ name: f.name, data: PHOTOS[f.photo] }))]);
    let n = 0;
    const deps = {
      reader: async () => load("lib/whatsapp/zip.ts").bufferReader(archive), signedUpload: async () => "https://project.supabase.co/upload", purge: async () => {}, storePreview: async () => true,
      signedPreviews: async paths => new Map(paths.map(p => [p, `https://signed/${p}`])), inspect: async bytes => Buffer.from(bytes).toString().startsWith("JPEG") ? { mime: "image/jpeg", width: 1600, height: 1200 } : null,
      thumbnail: async () => new Uint8Array([1]), driveToken: async () => "dummy-import-token", generateDriveId: async () => `drive_ex_${String(++n).padStart(6, "0")}`,
      uploadDrive: async (_t, id, folder) => { log.exportUploads.push([id, folder]); return "created"; }, storeThumbnail: async () => {}, audit: async () => {}, now: () => new Date("2026-10-12T08:00:00Z"),
      listObjects: async () => [], removeObjects: async () => {},
    };
    const mod = load("lib/whatsapp/export-import.ts", {
      "@/lib/supabase/server": { getSupabaseServerClient: () => db }, "@/lib/core/audit": { writeAudit: async () => {} }, sharp: () => ({}),
      "./export-storage": { archiveReader: async () => { throw Error("unused"); }, ExportStorageFailure: class extends Error {}, listExportObjects: async () => [], removeExportObjects: async () => {}, MAX_ARCHIVE_BYTES: 500 * 1024 * 1024, purgeExportFiles: async () => {}, signedArchiveUpload: async () => "", signedPreviews: async () => new Map(), storePreview: async () => true },
      "./providers": { generateDriveId: async () => "", ImportFailure: class extends Error {}, importDriveToken: async () => "", maxImageBytes: 8 * 1024 * 1024, thumbnail: async () => null, uploadDrive: async () => "created" },
      "./service": { storeThumbnail: async () => {} },
    });
    const started = await mod.startExportImport(ADMIN, COUV, archive.length, true, deps);
    assert.equal(started.ok, true);
    assert.equal((await mod.analyzeExportArchive(ADMIN, COUV, started.importId, deps)).ok, true);
    let r; do { r = await mod.analyzeExportBatch(COUV, started.importId, deps); } while (r.ok && r.remaining);
    do { r = await mod.importExportBatch(ADMIN, COUV, started.importId, deps); } while (r.ok && r.remaining);
    return fake.tables.whatsapp_export_items.filter(i => i.import_id === started.importId);
  };
  const library = (client = COUV) => fake.tables.whatsapp_assets.filter(a => a.client_id === client);
  const countOf = (name, client = COUV) => library(client).filter(a => a.sha256 === sha(PHOTOS[name])).length;
  return { fake, service, intelligence, provider, receive, exportImport, library, countOf, log, driveFiles };
}

test("WhatsApp Business webhook: an authorised photo lands once in the right client's library; the same photo again is a duplicate", async () => {
  const b = bench();
  assert.equal(await b.receive("33611111111", "wamid.1", "roof"), "imported");
  assert.equal(b.countOf("roof"), 1);
  const asset = b.library()[0];
  assert.equal(asset.client_id, COUV); assert.equal(asset.drive_folder_id, WA_FOLDER); assert.ok(asset.imported_at); assert.equal(asset.origin ?? "whatsapp", "whatsapp");
  assert.deepEqual(b.log.waUploads, [[asset.drive_file_id, WA_FOLDER]]);
  // Même photo renvoyée (autre message) : une seule entrée, la file pointe vers la photo existante.
  const again = await b.receive("33611111111", "wamid.2", "roof");
  assert.ok(["duplicate", "imported"].includes(again));
  assert.equal(b.countOf("roof"), 1, "exactly once");
  assert.equal(b.fake.tables.whatsapp_inbox.find(i => i.message_id === "wamid.2").asset_id, asset.id);
  // Rejeu du même message Meta : ignoré par la file (clé waba + message).
  assert.equal(await b.receive("33611111111", "wamid.1", "roof"), "idle");
  assert.equal(b.fake.tables.whatsapp_inbox.length, 2);
});

test("a photo sent by an unknown number is never attributed automatically; it is imported only after an explicit assignment", async () => {
  const b = bench();
  assert.equal(await b.receive("33799999999", "wamid.unknown", "gutter"), "idle");
  assert.equal(b.library().length + b.library(JRENOV).length, 0, "nothing imported for anyone");
  const pending = b.fake.tables.whatsapp_inbox.find(i => i.message_id === "wamid.unknown");
  assert.equal(pending.client_id ?? null, null); assert.equal(pending.status, "pending");
  assert.equal(b.log.waUploads.length, 0, "no Drive upload");
  // Affectation explicite par un administrateur (whatsapp_assign) : client et dossier choisis.
  Object.assign(pending, { client_id: COUV, drive_folder_id: WA_FOLDER, assigned_by: ADMIN, assigned_at: "2026-10-12T09:00:00Z" });
  assert.equal(await b.service.processOneMedia({ kind: "system", worker: "test" }), "imported");
  assert.equal(b.countOf("gutter"), 1); assert.equal(b.library()[0].drive_folder_id, WA_FOLDER);
  assert.equal(b.library(JRENOV).length, 0);
});

test("photos already in the client's Drive folder are referenced once; duplicates and unreadable files are remembered, not re-downloaded", async () => {
  const b = bench({ driveFiles: { [AGENT_FOLDER]: {
    drive_old_roof_0001: { bytes: PHOTOS.roof, modified: "2025-03-01T10:00:00.000Z" },
    drive_old_ridge_001: { bytes: PHOTOS.ridge, modified: "2025-04-01T10:00:00.000Z" },
    drive_copy_roof_001: { bytes: PHOTOS.roof, modified: "2025-05-01T10:00:00.000Z" },
    drive_broken_00001: { broken: true, modified: "2025-06-01T10:00:00.000Z" },
  } } });
  const first = await b.intelligence.syncDriveLibrary(COUV, 15, { provider: b.provider, backfill: null });
  assert.deepEqual(json(first), { added: 2, skipped: 2, folders: 2, duplicates: 1, failed: 1 });
  assert.equal(b.countOf("roof"), 1, "the copy of the same photo is not a second entry");
  assert.equal(b.countOf("ridge"), 1);
  const roof = b.library().find(a => a.sha256 === sha(PHOTOS.roof));
  assert.equal(roof.origin, "drive"); assert.equal(roof.captured_at, roof.drive_file_id === "drive_old_roof_0001" ? "2025-03-01T10:00:00.000Z" : "2025-05-01T10:00:00.000Z");
  const memo = Object.fromEntries(b.fake.tables.client_media_drive_files.map(r => [r.drive_file_id, r]));
  assert.equal(Object.keys(memo).length, 2);
  assert.equal(Object.values(memo).find(r => r.outcome === "duplicate").asset_id, roof.id);
  assert.equal(memo.drive_broken_00001.outcome, "failed"); assert.equal(memo.drive_broken_00001.failures, 1);
  // Second passage : rien n'est retéléchargé (photos connues, doublon mémorisé, échec récent).
  b.log.driveDownloads.length = 0;
  assert.deepEqual(json(await b.intelligence.syncDriveLibrary(COUV, 15, { provider: b.provider, backfill: null })), { added: 0, skipped: 0, folders: 2, duplicates: 0, failed: 0 });
  assert.deepEqual(b.log.driveDownloads, []);
  // Un échec ancien est retenté (24 h), au plus 3 fois.
  memo.drive_broken_00001.updated_at = "2026-01-01T00:00:00.000Z";
  b.fake.tables.client_media_drive_files.find(r => r.drive_file_id === "drive_broken_00001").updated_at = "2026-01-01T00:00:00.000Z";
  await b.intelligence.syncDriveLibrary(COUV, 15, { provider: b.provider, backfill: null });
  assert.deepEqual(b.log.driveDownloads, ["drive_broken_00001"]);
  assert.equal(b.fake.tables.client_media_drive_files.find(r => r.drive_file_id === "drive_broken_00001").failures, 2);
});

test("photos added later to Drive, and large folders: the backfill cursor walks the folder oldest first, then starts again", async () => {
  const old = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`drive_back_${String(i).padStart(6, "0")}`, { bytes: photo(`ancienne-${i}`), modified: `2024-0${i + 1}-01T10:00:00.000Z` }]));
  const b = bench({ driveFiles: { [AGENT_FOLDER]: { ...old } } });
  const newest = { list: async () => [], download: b.provider.download };
  const asc = Object.entries(old).map(([id, f]) => ({ drive_file_id: id, mime_type: "image/jpeg", modified_at: f.modified }));
  const calls = [];
  const backfill = async (folder, after) => { if (folder === AGENT_FOLDER) calls.push(after); else return { files: [], complete: true, last: null }; const files = asc.filter(f => !after || f.modified_at > after).slice(0, 2); return { files, complete: !asc.some(f => f.modified_at > (files.at(-1)?.modified_at ?? "9")), last: files.at(-1)?.modified_at ?? null }; };
  const state = () => b.fake.tables.client_media_drive_sync.find(s => s.drive_folder_id === AGENT_FOLDER);
  assert.equal((await b.intelligence.syncDriveLibrary(COUV, 1, { provider: newest, backfill })).added, 1);
  assert.equal(state().backfill_after, "2024-01-01T10:00:00.000Z", "cursor stops at the last handled file when the limit is reached");
  assert.equal((await b.intelligence.syncDriveLibrary(COUV, 5, { provider: newest, backfill })).added, 2);
  assert.equal(state().backfill_after, "2024-03-01T10:00:00.000Z");
  assert.equal((await b.intelligence.syncDriveLibrary(COUV, 5, { provider: newest, backfill })).added, 2);
  assert.equal(state().backfill_after, null, "end of folder: the walk starts again");
  assert.ok(state().backfill_completed_at);
  assert.equal(b.library().length, 5, "every old photo referenced exactly once");
  // Photo ajoutée plus tard : la liste des plus récentes la trouve au passage suivant.
  b.driveFiles[AGENT_FOLDER].drive_new_000001 = { bytes: PHOTOS.gutter, modified: "2026-10-12T07:00:00.000Z" };
  assert.equal((await b.intelligence.syncDriveLibrary(COUV, 5, { provider: b.provider, backfill })).added, 1);
  assert.equal(b.countOf("gutter"), 1);
  assert.deepEqual(calls.slice(0, 3), [null, "2024-01-01T10:00:00.000Z", "2024-03-01T10:00:00.000Z"]);
});

test("cross-path duplicates: WhatsApp, Drive folder and export never create two entries for the same photo of a client", async () => {
  const b = bench({ driveFiles: { [AGENT_FOLDER]: { drive_roof_copy01: { bytes: PHOTOS.roof, modified: "2025-01-01T00:00:00.000Z" }, drive_ridge_00001: { bytes: PHOTOS.ridge, modified: "2025-02-01T00:00:00.000Z" } } } });
  // 1. WhatsApp : toiture importée dans le dossier WhatsApp.
  assert.equal(await b.receive("33611111111", "wamid.a", "roof"), "imported");
  // 2. Dossier Drive de l'agent : copie de la toiture (doublon mémorisé) + faîtage (nouveau).
  const synced = await b.intelligence.syncDriveLibrary(COUV, 15, { provider: b.provider, backfill: null });
  assert.equal(synced.added, 1); assert.equal(synced.duplicates, 1);
  // 3. WhatsApp : le faîtage, déjà connu par le dossier Drive (autre dossier) → doublon, aucun envoi Drive.
  const uploads = b.log.waUploads.length;
  assert.equal(await b.receive("33611111111", "wamid.b", "ridge"), "duplicate");
  assert.equal(b.log.waUploads.length, uploads, "no second Drive upload");
  const ridge = b.library().find(a => a.sha256 === sha(PHOTOS.ridge));
  assert.equal(b.fake.tables.whatsapp_inbox.find(i => i.message_id === "wamid.b").asset_id, ridge.id);
  assert.ok(b.log.audits.some(a => a.action === "whatsapp.duplicate" && a.metadata.scope === "client"));
  // 4. Export WhatsApp : toiture et faîtage déjà présents, gouttière nouvelle.
  const items = await b.exportImport([{ name: "IMG-20240101-WA0001.jpg", photo: "roof" }, { name: "IMG-20240201-WA0002.jpg", photo: "ridge" }, { name: "IMG-20240301-WA0003.jpg", photo: "gutter" }]);
  const status = Object.fromEntries(items.map(i => [i.entry_name, i.status]));
  assert.deepEqual(status, { "IMG-20240101-WA0001.jpg": "duplicate", "IMG-20240201-WA0002.jpg": "duplicate", "IMG-20240301-WA0003.jpg": "imported" });
  assert.equal(b.log.exportUploads.length, 1);
  // 5. Synchro Drive suivante : rien de neuf (doublon mémorisé), aucun téléchargement.
  b.log.driveDownloads.length = 0;
  assert.equal((await b.intelligence.syncDriveLibrary(COUV, 15, { provider: b.provider, backfill: null })).added, 0);
  assert.deepEqual(b.log.driveDownloads, []);
  for (const name of ["roof", "ridge", "gutter"]) assert.equal(b.countOf(name), 1, `${name} exactly once`);
  assert.deepEqual(b.library().map(a => a.origin ?? "whatsapp").sort(), ["drive", "whatsapp", "whatsapp_export"]);
});

test("a photo purged after a human rejection is never re-imported by WhatsApp, and the same photo stays independent between two clients", async () => {
  const purged = { id: uid("a", 9), client_id: COUV, drive_folder_id: WA_FOLDER, sha256: sha(PHOTOS.invoice), md5: md5(PHOTOS.invoice), drive_file_id: "drive_purged_0001", mime_type: "image/jpeg", size: 10, imported_at: "2026-01-01T00:00:00Z", purged_at: "2026-02-01T00:00:00Z", library_status: "rejected" };
  const b = bench({ assets: [purged], senders: [
    { sender: "33611111111", client_id: COUV, drive_folder_id: WA_FOLDER, enabled: true, rights_confirmed: true, updated_at: "1" },
    { sender: "33622222222", client_id: JRENOV, drive_folder_id: "folder_wa_jrenov01", enabled: true, rights_confirmed: true, updated_at: "1" }] });
  assert.equal(await b.receive("33611111111", "wamid.p", "invoice"), "duplicate");
  assert.equal(b.log.waUploads.length, 0); assert.equal(b.countOf("invoice"), 1);
  assert.equal(await b.receive("33622222222", "wamid.j", "invoice"), "imported", "another client keeps its own copy");
  assert.equal(b.countOf("invoice", JRENOV), 1);
});

// --- Analyse automatique : une décision humaine n'est jamais réévaluée automatiquement. ------------------------------
test("automatic classification skips photos whose status was set by a person; an explicit request may still analyse them", async () => {
  const stored = { client_id: COUV, drive_folder_id: WA_FOLDER, md5: "c".repeat(32), media_kind: "image", imported_at: "2026-10-12T08:00:00Z", purged_at: null, origin: "whatsapp", caption: null, classification_failures: 0, classification_failed_at: null };
  const fake = createFakeSupabase({
    client_media_profiles: [{ client_id: COUV, version: 2, ai_classification_enabled: true, ai_monthly_budget_eur: 1 }], clients: [{ id: COUV, name: "Couverture Catalane", activity: "Couvreur" }],
    whatsapp_asset_assessments: [],
    whatsapp_assets: [{ ...stored, id: uid("a", 1), drive_file_id: "file_auto_00001", library_status: "received", status_changed_by: null },
      { ...stored, id: uid("a", 2), drive_file_id: "file_auto_00002", library_status: "to_review", status_changed_by: "ai_classification" },
      { ...stored, id: uid("a", 3), drive_file_id: "file_human_0003", library_status: "to_review", status_changed_by: ADMIN }],
  }, { rpc: { client_media_ai_month_spend: () => 0, whatsapp_asset_assessment_record: () => "to_review", whatsapp_asset_assessment_failed: () => 1 } });
  const service = load("lib/media-intelligence/service.ts", {
    "node:crypto": require("node:crypto"), sharp: () => ({ metadata: async () => ({}) }), "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "@/lib/integrations/publications-openai": { structuredResponse: async () => { throw Error("real provider must not be called"); } }, "@/lib/integrations/publications-drive": { driveReadProvider: () => ({}) },
    "@/lib/publications/media/transform": { visionPreview: async bytes => bytes }, "@/lib/whatsapp/originals": { assetOriginal: async () => new Uint8Array([1]) },
    "@/lib/whatsapp/providers": {}, "@/lib/whatsapp/service": { storeThumbnail: async () => {}, THUMBNAIL_BUCKET: "whatsapp-thumbnails" },
  });
  const analysed = [];
  const vision = async (_i, input) => { analysed.push(input); return { value: { verdict: "off_topic", business_relevance: 0.1, publishability: 0.2, sensitive: [], confidential: false, description: "Autre.", topics: [], quality: "good", quality_issues: [] }, usage: { model: "m", input_tokens: 1, output_tokens: 1, estimated_cost_eur: 0.001 } }; };
  const auto = await service.classifyClientMedia(COUV, { limit: 8, scheduled: true }, { vision });
  assert.equal(auto.analyzed, 2, "only system-set statuses");
  assert.ok(!fake.calls.some(c => c[0] === "rpc" && c[1] === "whatsapp_asset_assessment_record" && c[2].p_asset_id === uid("a", 3)));
  const explicit = await service.classifyClientMedia(COUV, { assetIds: [uid("a", 3)], limit: 20 }, { vision });
  assert.equal(explicit.analyzed, 1);
});

// --- Filtres, « Pourquoi écartée ? », historique et réemploi (pur). -------------------------------------------------
test("library filters: unknown values are dropped, legacy status links map to views, payload and links keep only known keys", () => {
  const f = load("lib/whatsapp/library-filters.ts");
  const parsed = f.parseLibraryFilters({ status: "publishable", origin: "drive", service: " Gouttière\u0000 ", q: "x".repeat(200), used: "yes", from: "2026-10-20", to: "2026-10-01", page: "2", tab: "media" });
  assert.deepEqual(json(parsed), { status: "publishable", origin: "drive", service: "Gouttière", q: "x".repeat(120), used: "yes", from: "2026-10-01", to: "2026-10-20", page: 2 });
  assert.deepEqual(json(f.parseLibraryFilters({ status: "received", origin: "email", used: "maybe", from: "12/01/2024", page: "-1" })), { status: "to_review", origin: null, service: null, q: null, used: null, from: null, to: null, page: 0 });
  assert.deepEqual(json(f.searchPayload(parsed)), { status: "publishable", origin: "drive", service: "Gouttière", q: "x".repeat(120), used: "yes", from: "2026-10-01", to: "2026-10-20" });
  assert.equal(f.libraryHref(COUV, parsed, { page: 3 }), `/clients/${COUV}?tab=media&status=publishable&origin=drive&service=Goutti%C3%A8re&q=${"x".repeat(120)}&used=yes&from=2026-10-01&to=2026-10-20&page=3`);
  assert.equal(f.libraryHref(COUV, f.defaultFilters), `/clients/${COUV}?tab=media`);
  assert.equal(f.activeFilterCount(f.defaultFilters), 0);
});

const exclusion = load("lib/media-intelligence/exclusion.ts");
const NOW = new Date("2026-10-12T12:00:00Z");
const base = { libraryStatus: "validated", mediaKind: "image", mimeType: "image/jpeg", size: 200000, width: 1600, height: 1200, purged: false, claimed: false, statusChangedBy: ADMIN, statusChangedAt: "2026-10-01T00:00:00Z", classificationFailures: 0, classificationFailedAt: null, assessment: null, uses: [], reuse: { allowed: false, afterDays: 180 }, now: NOW };
const ai = (extra = {}) => ({ verdict: "relevant", confidential: false, sensitive: [], manual_verdict: null, quality: "good", quality_issues: [], business_relevance: 0.9, publishability: 0.8, reviewed_by: null, reviewed_at: null, ...extra });
test("« Pourquoi écartée ? » explains every exclusion and agrees with the agent's own selection rules", () => {
  const codes = input => json(exclusion.exclusionReasons({ ...base, ...input }).reasons.filter(r => r.blocking).map(r => r.code));
  assert.equal(exclusion.exclusionReasons(base).eligible, true);
  assert.deepEqual(codes({ libraryStatus: "quarantined", statusChangedBy: "ai_classification", assessment: ai({ verdict: "off_topic", business_relevance: 0.1 }) }), ["quarantined"]);
  assert.match(exclusion.exclusionReasons({ ...base, libraryStatus: "quarantined", statusChangedBy: "ai_classification" }).reasons[0].label, /analyse automatique/);
  assert.match(exclusion.exclusionReasons({ ...base, libraryStatus: "quarantined" }).reasons[0].label, /administrateur/);
  assert.deepEqual(codes({ libraryStatus: "rejected" }), ["rejected"]);
  const confidential = exclusion.exclusionReasons({ ...base, assessment: ai({ verdict: "to_review", confidential: true, sensitive: ["invoice", "address"], manual_verdict: "relevant" }) });
  assert.equal(confidential.eligible, false); assert.match(confidential.reasons[0].label, /confidentiel.*facture ou devis, adresse.*même validée/);
  assert.deepEqual(codes({ libraryStatus: "received", assessment: ai({ quality_issues: ["screenshot", "text_heavy"] }) }), ["quality"]);
  assert.match(exclusion.exclusionReasons({ ...base, assessment: ai({ quality_issues: ["screenshot"] }) }).reasons[0].label, /capture d’écran/);
  assert.deepEqual(codes({ libraryStatus: "received" }), ["not_assessed"]);
  assert.deepEqual(codes({ libraryStatus: "to_review", assessment: ai({ verdict: "to_review", sensitive: ["face"] }) }), ["ai_to_review", "face_or_minor"]);
  assert.deepEqual(codes({ mediaKind: "video", mimeType: "video/mp4" }), ["video"]);
  assert.deepEqual(codes({ width: 400, height: 300 }), ["dimensions"]);
  assert.deepEqual(codes({ claimed: true }), ["claimed"]);
  assert.deepEqual(codes({ libraryStatus: "used", uses: [{ used_at: "2026-10-01T00:00:00Z" }] }), ["reuse_disabled"]);
  const delay = exclusion.exclusionReasons({ ...base, libraryStatus: "used", uses: [{ used_at: "2026-10-01T00:00:00Z" }], reuse: { allowed: true, afterDays: 30 } });
  assert.equal(delay.reasons[0].code, "reuse_delay"); assert.match(delay.reasons[0].label, /31\/10\/2026/);
  assert.equal(exclusion.exclusionReasons({ ...base, libraryStatus: "used", uses: [{ used_at: "2026-01-01T00:00:00Z" }], reuse: { allowed: true, afterDays: 30 } }).eligible, true);
  const failed = exclusion.exclusionReasons({ ...base, libraryStatus: "received", classificationFailures: 3, classificationFailedAt: "2026-10-10T00:00:00Z" });
  assert.ok(failed.reasons.some(r => r.code === "classification_failed" && !r.blocking && /plus relancée automatiquement/.test(r.label)));
  // Même verdict que la sélection de l'agent (library-pool) sur un échantillon de cas.
  const pool = load("lib/publications/agent-v2/library-pool.ts");
  const cases = [{}, { libraryStatus: "quarantined" }, { libraryStatus: "received", assessment: ai() }, { libraryStatus: "received", assessment: ai({ sensitive: ["minor"] }) }, { assessment: ai({ confidential: true, verdict: "to_review" }) }, { assessment: ai({ manual_verdict: "off_topic" }) }, { width: 300, height: 300 }, { assessment: ai({ quality: "poor" }) }];
  for (const c of cases) {
    const m = { ...base, ...c };
    const row = { id: uid("a", 1), library_status: m.libraryStatus, media_kind: m.mediaKind, mime_type: m.mimeType, size: m.size, width: m.width, height: m.height, purged_at: null, imported_at: "2026-10-01", claimed_agent_v2_run_id: null };
    const offered = pool.libraryCandidates([row], m.assessment ? [{ asset_id: row.id, description: "", topics: [], ...m.assessment }] : [], [], m.reuse, new Set(), NOW).length === 1;
    assert.equal(exclusion.exclusionReasons(m).eligible, offered, JSON.stringify(c));
  }
});

test("usage history read model: RPC rows grouped per photo, legacy fallback before the migration, reuse state like the agent", async () => {
  const history = load("lib/whatsapp/usage-history.ts");
  const A = uid("a", 1), B = uid("a", 2), P = uid("b", 1);
  const rpcDb = { rpc: async (name, args) => { assert.equal(name, "whatsapp_asset_usage_history"); assert.equal(args.p_client_id, COUV); assert.deepEqual(json(args.p_asset_ids), [A, B]);
    return { data: [{ asset_id: A, publication_id: P, platform: "instagram", used_at: "2026-10-01T00:00:00Z", used_by: ADMIN, subject: "Chantier gouttière", publication_status: "approved", archived: false, delivery_status: "published", scheduled_for: "2026-10-02T10:00:00Z", published_at: "2026-10-02T10:00:05Z" }], error: null }; }, from: () => { throw Error("unused"); } };
  const map = await history.listAssetUsageHistory(rpcDb, COUV, [A, B, "not-a-uuid", A]);
  assert.deepEqual(json([...map.keys()]), [A, B]);
  assert.deepEqual(json(map.get(A)), [{ publicationId: P, platform: "instagram", usedAt: "2026-10-01T00:00:00Z", usedBy: ADMIN, subject: "Chantier gouttière", publicationStatus: "approved", archived: false, deliveryStatus: "published", scheduledFor: "2026-10-02T10:00:00Z", publishedAt: "2026-10-02T10:00:05Z" }]);
  assert.deepEqual(json(map.get(B)), []);
  const fake = createFakeSupabase({ whatsapp_asset_uses: [{ asset_id: A, client_id: COUV, publication_id: P, platform: "facebook", used_at: "2026-09-01T00:00:00Z", used_by: ADMIN }, { asset_id: A, client_id: JRENOV, publication_id: uid("b", 2), platform: "facebook", used_at: "2026-09-02T00:00:00Z", used_by: ADMIN }],
    publications: [{ id: P, client_id: COUV, subject: "Toiture", status: "draft", archived_at: null }] });
  const legacy = { ...fake.client, rpc: async () => ({ data: null, error: { code: "PGRST202" } }) };
  const old = await history.listAssetUsageHistory(legacy, COUV, [A]);
  assert.equal(old.get(A).length, 1, "never another client's uses"); assert.equal(old.get(A)[0].subject, "Toiture"); assert.equal(old.get(A)[0].deliveryStatus, null);
  await assert.rejects(() => history.listAssetUsageHistory({ rpc: async () => ({ data: null, error: { code: "57014" } }) }, COUV, [A]), /usage_history_unavailable/);
  assert.equal(history.reuseState([], { allowed: false, afterDays: 180 }, NOW).reason, "never_used");
  assert.equal(history.reuseState([{ usedAt: "2026-01-01T00:00:00Z" }], { allowed: false, afterDays: 30 }, NOW).reason, "reuse_disabled");
  assert.equal(history.reuseState([{ usedAt: "2026-10-01T00:00:00Z" }], { allowed: true, afterDays: 30 }, NOW).reason, "too_recent");
  assert.equal(history.reuseState([{ usedAt: "2026-01-01T00:00:00Z" }], { allowed: true, afterDays: 30 }, NOW).reason, "reusable");
});

// --- Service de la photothèque : recherche serveur, reclassement, légende. ------------------------------------------
function libraryHarness({ search, rpc = {} } = {}) {
  const A = uid("a", 1);
  const fake = createFakeSupabase({
    whatsapp_assets: [{ id: A, client_id: COUV, drive_folder_id: WA_FOLDER, drive_file_id: "drive_file_lib01", sha256: "a".repeat(64), md5: "b".repeat(32), mime_type: "image/jpeg", size: 1000, media_kind: "image", library_status: "validated", imported_at: "2026-10-01T00:00:00Z", origin: "whatsapp", thumbnail_path: null, purged_at: null, created_at: "2026-10-01T00:00:00Z", status_changed_at: "2026-10-01T00:00:00Z" }],
    whatsapp_asset_assessments: [], whatsapp_asset_decisions: [{ id: uid("d", 1), asset_id: A, client_id: COUV, kind: "reclassify", from_status: "quarantined", to_status: "validated", reason: "Chantier réel", actor_id: ADMIN, created_at: "2026-10-02T00:00:00Z" }],
  }, { rpc: { whatsapp_library_search: search ?? (() => [{ asset_id: A, total: 1 }]), whatsapp_asset_usage_history: () => [], ...rpc } });
  const db = { ...fake.client, storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) } };
  const library = load("lib/whatsapp/library.ts", {
    "node:crypto": require("node:crypto"), "@/lib/supabase/server": { getSupabaseServerClient: () => db }, "@/lib/core/audit": { writeAudit: async () => {} }, "@/lib/ai/providers": { selectAIProvider: () => null },
    "@/lib/publications/project-channels": {}, "@/lib/publications/channels": {}, "@/lib/publications/editor": { IMAGE_BUCKET: "publication-images" }, "@/lib/publications/media/transform": {}, "@/lib/publications/workspace": {},
    "./providers": {}, "./originals": { assetOriginal: async () => new Uint8Array() }, "./service": { THUMBNAIL_BUCKET: "whatsapp-thumbnails" },
  });
  return { library, fake, db, A };
}
test("library page: filters and pagination are applied by the database, with history and human decisions attached", async () => {
  const f = load("lib/whatsapp/library-filters.ts");
  const h = libraryHarness();
  const page = await h.library.searchClientLibrary(COUV, f.parseLibraryFilters({ status: "used", service: "gouttière", page: "2" }));
  const call = h.fake.calls.find(c => c[0] === "rpc" && c[1] === "whatsapp_library_search");
  assert.deepEqual(json(call[2]), { p_client_id: COUV, p_filters: { status: "used", service: "gouttière" }, p_limit: 24, p_offset: 48 });
  assert.equal(page.total, 1); assert.equal(page.searchable, true);
  assert.equal(page.items[0].id, h.A); assert.deepEqual(json(page.items[0].history), []);
  assert.equal(page.items[0].decisions[0].reason, "Chantier réel");
  // Avant la migration des outils : liste historique, filtre de statut seulement.
  const legacy = libraryHarness({ rpc: {} });
  legacy.db.rpc = (rpc => async (name, args) => name === "whatsapp_library_search" || name === "whatsapp_asset_usage_history" ? { data: null, error: { code: "PGRST202" } } : rpc(name, args))(legacy.db.rpc);
  const fallback = await legacy.library.searchClientLibrary(COUV, f.parseLibraryFilters({ status: "validated" }));
  assert.equal(fallback.searchable, false); assert.equal(fallback.items.length, 1);
  const broken = libraryHarness({ search: () => { throw Error("boom"); } });
  await assert.rejects(() => broken.library.searchClientLibrary(COUV, f.defaultFilters), /library_unavailable/);
});

test("reclassification and caption go through their audited RPCs with clear messages", async () => {
  const calls = [];
  const h = libraryHarness({ rpc: { whatsapp_asset_reclassify: args => { calls.push(args); return { asset_id: args.p_asset_id }; }, whatsapp_asset_caption_save: args => { calls.push(args); return true; } } });
  const ok = await h.library.reclassifyAsset(ADMIN, COUV, h.A, "quarantined", "Plaque lisible");
  assert.equal(ok.ok, true); assert.match(ok.message, /ne sera pas modifiée par l’analyse automatique/);
  assert.deepEqual(json(calls[0]), { p_client_id: COUV, p_asset_id: h.A, p_status: "quarantined", p_reason: "Plaque lisible", p_actor_id: ADMIN });
  const caption = await h.library.saveAssetCaption(ADMIN, COUV, h.A, "  Gouttière\u0007 zinc  ");
  assert.equal(caption.ok, true); assert.equal(calls[1].p_caption, "Gouttière zinc", "control characters removed before the RPC");
  for (const [code, pattern] of [["22023", /motif/], ["55000", /déjà dans ce statut/], ["PGRST202", /appliquez la migration/]]) {
    const failing = libraryHarness();
    failing.db.rpc = async () => ({ data: null, error: { code } });
    assert.match((await failing.library.reclassifyAsset(ADMIN, COUV, failing.A, "rejected", "Motif")).message, pattern);
  }
});

test("photothèque actions: admin first, never in simulation, reason required, statuses limited to manual ones", async () => {
  let calls = 0;
  const lib = load("lib/whatsapp/library-model.ts");
  const actions = (deny, simulate) => load("app/(cockpit)/clients/[id]/media-actions.ts", {
    "next/cache": { revalidatePath: () => {} },
    "@/lib/require-admin": { requireAdmin: async () => { if (deny) throw Error("denied"); return { userId: ADMIN }; } },
    "@/lib/simulation/server": { getActiveScenario: async () => simulate ? {} : null },
    "@/lib/publications/types": { publicationPlatforms: ["google_business_profile", "facebook", "instagram"] },
    "@/lib/whatsapp/library-model": lib,
    "@/lib/whatsapp/library": { preparePublication: async () => ({}), setLibraryStatus: async () => 1, reclassifyAsset: async () => { calls++; return { ok: true, message: "Photo reclassée." }; }, saveAssetCaption: async () => { calls++; return { ok: true, message: "Légende enregistrée." }; } },
    "@/lib/media-intelligence/service": { classifyClientMedia: async () => ({}), saveMediaProfile: async () => ({}), syncDriveLibrary: async () => ({}) },
  });
  const reclass = form({ client_id: COUV, asset_id: uid("a", 1), status: "quarantined", reason: "Visage d’un passant" });
  const caption = form({ client_id: COUV, asset_id: uid("a", 1), caption: "Gouttière" });
  await assert.rejects(() => actions(true, false).reclassifyAssetAction({}, reclass), /denied/);
  await assert.rejects(() => actions(true, false).saveAssetCaptionAction({}, caption), /denied/);
  assert.match((await actions(false, true).reclassifyAssetAction({}, reclass)).message, /simulation/i);
  assert.match((await actions(false, true).saveAssetCaptionAction({}, caption)).message, /simulation/i);
  assert.match((await actions(false, false).reclassifyAssetAction({}, form({ client_id: COUV, asset_id: uid("a", 1), status: "quarantined", reason: " " }))).message, /motif/);
  assert.match((await actions(false, false).reclassifyAssetAction({}, form({ client_id: COUV, asset_id: uid("a", 1), status: "used", reason: "Motif valable" }))).message, /statut/);
  assert.match((await actions(false, false).saveAssetCaptionAction({}, form({ client_id: COUV, asset_id: uid("a", 1), caption: "x".repeat(3001) }))).message, /3 000/);
  assert.equal(calls, 0);
  assert.equal((await actions(false, false).reclassifyAssetAction({}, reclass)).ok, true);
  assert.equal((await actions(false, false).saveAssetCaptionAction({}, caption)).ok, true);
  assert.equal(calls, 2);
});

test("wiring: server-side filtered tab, design tokens only, migration additive and server-only, deletion policy unchanged", () => {
  const page = src("app/(cockpit)/clients/[id]/page.tsx");
  assert.match(page, /<MediaTab clientId=\{client\.id\} projects=\{projects\} filters=\{parseLibraryFilters\(search\)\} \/>/);
  for (const file of ["components/clients/media-library-panel.tsx", "components/clients/media-library-form.tsx", "components/clients/media-tab.tsx"]) {
    const code = src(file);
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,6}\b|rgb\(|\b(?:text|bg|border)-(?:red|green|blue|amber|yellow|gray|slate|zinc|neutral|emerald|orange|sky|indigo)-\d{2,3}\b/, `${file}: design tokens only`);
  }
  const sql = src("supabase/migrations/20261103000000_media_library_tools.sql");
  assert.doesNotMatch(sql, /security definer/i);
  assert.doesNotMatch(sql, /\b(?:delete from|drop table|drop function|truncate)\b/i, "forward-only, nothing deleted");
  assert.doesNotMatch(sql, /create or replace function public\.(?:whatsapp_assets_review|whatsapp_asset_assessment_record|whatsapp_rejected_purge_candidates|whatsapp_asset_mark_purged)|create or replace function publications_private\./i, "existing review, purge and agent rules untouched");
  assert.equal((sql.match(/security invoker set search_path = pg_catalog/g) ?? []).length, 6);
  assert.match(sql, /grant execute on function[\s\S]*to service_role;/);
  const service = src("lib/media-intelligence/service.ts");
  assert.doesNotMatch(service.slice(service.indexOf("export async function syncDriveLibrary"), service.indexOf("export async function purgeRejectedMedia")), /trashDrive|\.delete\(/, "sync never deletes nor trashes");
  assert.doesNotMatch(src("lib/media-intelligence/drive-listing.ts"), /GOOGLE_DRIVE_IMPORT|importDriveToken/, "backfill uses the Publications read-only access only");
});
