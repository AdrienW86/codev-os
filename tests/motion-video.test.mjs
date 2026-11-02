// Vidéos motion design TikTok : storyboard (rien d'inventé), arguments ffmpeg, rendu réel (si le binaire est
// installé), publication vidéo TikTok (FILE_UPLOAD, lecture avant écriture), service de génération et migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadTs } from "./helpers/load-ts.mjs";

const require = createRequire(import.meta.url);
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = (v) => JSON.parse(JSON.stringify(v));
const story = loadTs("lib/motion/video/storyboard.ts");
const graph = loadTs("lib/motion/video/filtergraph.ts", { "./storyboard": story });
const TEXT = "Toiture refaite à neuf à Villeurbanne 🏠 ! Nos couvreurs ont remplacé 120 m² de tuiles.\nLa charpente a été traitée contre l'humidité.\nDemandez votre diagnostic toiture. #toiture https://exemple.fr @jrenov";

test("storyboard : texte affichable sans emoji, hashtag, mention ni lien ; ponctuation française gardée", () => {
  assert.equal(story.overlayText("Bravo 🎉 l'équipe ! #renovation @client https://x.fr"), "Bravo l'équipe !");
  assert.deepEqual(json(story.sentencesOf(TEXT)), ["Toiture refaite à neuf à Villeurbanne !", "Nos couvreurs ont remplacé 120 m² de tuiles.", "La charpente a été traitée contre l'humidité.", "Demandez votre diagnostic toiture."]);
  assert.equal(story.clampWords("un deux trois quatre cinq six", 15), "un deux trois…");
});

test("storyboard : chaque texte vient de la publication ou du nom du client ; déterministe ; durée bornée", () => {
  const b = story.buildMotionStoryboard({ text: TEXT, photoCount: 3, clientName: "Jrenov", seed: "pub-1" });
  assert.deepEqual(json(b), json(story.buildMotionStoryboard({ text: TEXT, photoCount: 3, clientName: "Jrenov", seed: "pub-1" })), "même entrée, même vidéo");
  assert.deepEqual(json(b.scenes.map((s) => s.kind)), ["hook", "photo", "photo", "outro"]);
  const allowed = [...story.sentencesOf(TEXT), "Jrenov"];
  for (const s of b.scenes) for (const t of [s.headline, s.caption].filter(Boolean)) assert.ok(allowed.some((a) => a.startsWith(t.replace(/…$/, ""))), `texte inventé : ${t}`);
  assert.equal(b.scenes.at(-1).caption, "Demandez votre diagnostic toiture.", "l'appel à l'action est repris du texte, pas inventé");
  assert.equal(b.total, 3.4 + 2.9 * 2 + 3 - 3 * story.MOTION_TRANSITION_SECONDS);
  assert.ok(story.MOTION_PALETTES.includes(b.palette) || story.MOTION_PALETTES.some((p) => p.accent === b.palette.accent));
  const many = story.buildMotionStoryboard({ text: TEXT, photoCount: 12, clientName: "Jrenov", seed: "x" });
  assert.ok(many.total <= story.MOTION_MAX_SECONDS && many.scenes.filter((s) => s.photo !== null).length <= story.MOTION_MAX_PHOTOS);
  const single = story.buildMotionStoryboard({ text: TEXT, photoCount: 1, clientName: "Jrenov", seed: "x" });
  assert.ok(single.scenes.every((s) => s.photo === null || s.photo === 0), "une seule photo : jamais d'autre index");
  assert.throws(() => story.buildMotionStoryboard({ text: TEXT, photoCount: 0, clientName: "J", seed: "x" }), /motion_photos_required/);
  assert.throws(() => story.buildMotionStoryboard({ text: "🎉 #promo", photoCount: 2, clientName: "J", seed: "x" }), /motion_text_required/);
});

test("ffmpeg : arguments sans shell, transitions calées, H.264 yuv420p faststart, piste audio muette", () => {
  const b = story.buildMotionStoryboard({ text: TEXT, photoCount: 3, clientName: "Jrenov", seed: "pub-1" });
  const files = b.scenes.map((s, i) => ({ background: `/tmp/m/bg${i}.png`, photo: s.photo === null ? null : `/tmp/m/p${i}.jpg`, text: `/tmp/m/t${i}.png`, mask: s.photo === null ? null : "/tmp/m/mask.png" }));
  const args = graph.motionFfmpegArgs(b, files, "/tmp/m/out.mp4");
  assert.ok(Array.isArray(args) && args.every((a) => typeof a === "string"));
  const fc = args[args.indexOf("-filter_complex") + 1];
  assert.match(fc, /xfade=transition=[a-z]+:duration=0\.5:offset=2\.9\[x1\]/);
  assert.match(fc, /xfade=transition=[a-z]+:duration=0\.5:offset=5\.3\[x2\]/);
  assert.match(fc, /zoompan=/); assert.match(fc, /alphamerge/);
  for (const flag of ["libx264", "yuv420p", "+faststart", "aac"]) assert.ok(args.includes(flag), flag);
  assert.equal(args.at(-1), "/tmp/m/out.mp4");
  assert.ok(args.includes("anullsrc=channel_layout=stereo:sample_rate=44100"));
  assert.throws(() => graph.motionFfmpegArgs(b, files.slice(1), "/tmp/out.mp4"), /motion_files_mismatch/);
  assert.throws(() => graph.motionFfmpegArgs({ ...b, palette: { ...b.palette, accent: "red;rm" } }, files, "/tmp/out.mp4"), /motion_invalid_color/);
});

const ffmpegPath = (() => { try { return require("ffmpeg-static"); } catch { return null; } })();
test("rendu réel : MP4 9:16 lisible à partir de photos et d'un texte", { skip: !ffmpegPath || !existsSync(ffmpegPath) ? "binaire ffmpeg-static absent" : false, timeout: 240_000 }, async () => {
  const sharp = require("sharp"), fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), cp = require("node:child_process");
  const render = loadTs("lib/motion/video/render.ts", { "./filtergraph": graph, "./storyboard": story, sharp: { default: sharp }, "node:child_process": cp, "node:fs/promises": fs, "node:os": os, "node:path": path });
  const photo = (c) => sharp({ create: { width: 900, height: 700, channels: 3, background: c } }).jpeg().toBuffer();
  const out = await render.renderMotionVideo({ photos: [await photo("#c0553a"), await photo("#3a7bc0")], text: TEXT, clientName: "Jrenov", seed: "t", ffmpegPath, fontDir: new URL("../lib/motion/video/fonts", import.meta.url).pathname });
  assert.equal(Buffer.from(out.bytes.subarray(4, 8)).toString("latin1"), "ftyp");
  assert.ok(out.bytes.length > 10_000 && out.bytes.length < render.MOTION_MAX_OUTPUT_BYTES);
  assert.equal(out.width, 720); assert.equal(out.height, 1280);
  await assert.rejects(render.renderMotionVideo({ photos: [Buffer.from("not an image")], text: TEXT, clientName: "J", seed: "t", ffmpegPath, fontDir: "/nope" }), (e) => e.code === "photos");
});

// --- Publication TikTok d'une vidéo ---
const publisher = loadTs("lib/publications/delivery/tiktok-publisher.ts");
const VIDEO = new Uint8Array([0, 0, 0, 32, ...Buffer.from("ftypisom"), ...new Array(4096).fill(1)]);
const credential = { accessToken: "act.valid-token-123", refreshToken: "rft.refresh-123", expiresAt: new Date(Date.now() + 3600_000).toISOString(), scopes: ["video.publish"], provider: "tiktok", subject: "open-1" };
const vinput = (over = {}) => ({ platform: "tiktok", account: { externalAccountId: "open-1", parentExternalId: null }, text: "Toiture refaite ! Demandez votre devis. #toiture",
  media: [{ url: "https://proj.supabase.co/storage/v1/object/sign/publication-videos/c/p/a?token=t", mimeType: "video/mp4" }], idempotencyKey: "k", credential,
  tiktok: { privacyLevel: "PUBLIC_TO_EVERYONE", allowComment: true, brandOrganic: false, brandContent: false }, ...over });
const ok = (data) => ({ status: 200, body: { data, error: { code: "ok" } } });
function videoTransport({ init = ok({ publish_id: "v_pub.123", upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=1" }), upload = { status: 201 }, read = VIDEO, status = ok({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7123] }) } = {}) {
  const calls = [];
  return { calls,
    async request(r) { calls.push(r.path === "post/publish/video/init" ? { path: r.path, body: r.body } : r.path);
      if (r.path === "post/publish/creator_info/query") return ok({ privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], comment_disabled: false });
      if (r.path === "post/publish/video/init") { if (init instanceof Error) throw init; return init; }
      if (r.path === "post/publish/status/fetch") return status;
      throw Error("unexpected " + r.path); },
    async readMedia() { calls.push("read"); if (read instanceof Error) throw read; return read; },
    async uploadVideo(url, bytes, mime) { calls.push({ upload: url, size: bytes.length, mime }); if (upload instanceof Error) throw upload; return upload; } };
}
const vopts = { mediaLink: () => null, sleep: async () => {}, statusChecks: 2, videoStatusChecks: 3 };

test("TikTok vidéo : créateur → lecture du fichier → video/init FILE_UPLOAD → envoi PUT → statut publié", async () => {
  const t = videoTransport();
  const r = await publisher.createTikTokPublisher(t, vopts).publish(vinput());
  assert.deepEqual(json(r), { ok: true, remoteId: "7123", simulated: false });
  assert.deepEqual(t.calls.map((c) => typeof c === "string" ? c : c.path ?? "upload"), ["post/publish/creator_info/query", "read", "post/publish/video/init", "upload", "post/publish/status/fetch"]);
  const init = t.calls[2].body;
  assert.deepEqual(json(init.source_info), { source: "FILE_UPLOAD", video_size: VIDEO.length, chunk_size: VIDEO.length, total_chunk_count: 1 });
  assert.equal(init.post_info.title, vinput().text, "la légende complète est le titre d'une vidéo");
  assert.equal(init.post_info.disable_comment, false); assert.equal(init.post_info.disable_duet, true); assert.equal(init.post_info.disable_stitch, true);
  assert.deepEqual(json(t.calls[3]), { upload: "https://open-upload.tiktokapis.com/video/?upload_id=1", size: VIDEO.length, mime: "video/mp4" });
});

test("TikTok vidéo : aucun appel d'écriture si le fichier est illisible ; échecs d'envoi classés sans rejouer", async () => {
  let t = videoTransport({ read: Object.assign(Error("x"), { kind: "network" }) });
  assert.deepEqual(json(await publisher.createTikTokPublisher(t, vopts).publish(vinput())), { ok: false, errorClass: "provider_unavailable", errorCode: "media_unavailable", retryAfterSeconds: null });
  assert.ok(!t.calls.some((c) => c?.path === "post/publish/video/init"), "jamais d'init sans fichier");
  t = videoTransport({ read: new Uint8Array(4096) });
  assert.equal((await publisher.createTikTokPublisher(t, vopts).publish(vinput())).errorCode, "invalid_media", "pas un MP4");
  t = videoTransport({ upload: { status: 400 } });
  assert.equal((await publisher.createTikTokPublisher(t, vopts).publish(vinput())).errorCode, "upload_failed");
  assert.ok(!t.calls.includes("post/publish/status/fetch"));
  t = videoTransport({ upload: Object.assign(Error("x"), { kind: "timeout" }) });
  assert.deepEqual(json(await publisher.createTikTokPublisher(t, vopts).publish(vinput())), { ok: false, uncertain: true, errorCode: "upload_timeout" });
  t = videoTransport({ init: ok({ publish_id: "v_pub.123", upload_url: "https://evil.example.com/up" }) });
  assert.equal((await publisher.createTikTokPublisher(t, vopts).publish(vinput())).errorCode, "upload_url_invalid");
  assert.ok(!t.calls.some((c) => c?.upload), "jamais d'envoi hors de tiktokapis.com");
  t = videoTransport({ status: ok({ status: "PROCESSING_UPLOAD" }) });
  assert.deepEqual(json(await publisher.createTikTokPublisher(t, vopts).publish(vinput())), { ok: false, uncertain: true, errorCode: "post_processing" });
  assert.equal(t.calls.filter((c) => c === "post/publish/status/fetch").length, 3, "lectures du statut propres à la vidéo");
});

test("TikTok vidéo : vidéo seule, légende ≤ 2 200 caractères, transport vidéo requis", async () => {
  const p = publisher.createTikTokPublisher(videoTransport(), vopts);
  assert.equal((await p.publish(vinput({ media: [vinput().media[0], { url: "https://proj.supabase.co/x.jpg", mimeType: "image/jpeg" }] }))).errorCode, "invalid_media");
  assert.equal((await p.publish(vinput({ text: "a".repeat(2201) }))).errorCode, "text_too_long");
  const { readMedia, uploadVideo, ...photoOnly } = videoTransport(); void readMedia; void uploadVideo;
  assert.equal((await publisher.createTikTokPublisher(photoOnly, vopts).publish(vinput())).errorCode, "media_link_not_configured");
});

test("transport vidéo : lecture limitée au stockage du projet, envoi PUT avec Content-Range vers tiktokapis.com uniquement", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, method: init.method, headers: init.headers }); return new Response(init.method === "GET" ? VIDEO : null, { status: init.method === "GET" ? 200 : 201 }); };
  const transport = loadTs("lib/integrations/publications-tiktok-publish.ts", { "./publications-retry-after": { publicationRetryAfterSeconds: () => null } }, { Response, Blob });
  const t = transport.tiktokPublishTransport(fetchImpl, { mediaOrigin: "https://proj.supabase.co" });
  assert.equal((await t.readMedia("https://proj.supabase.co/storage/v1/object/sign/publication-videos/a?token=x")).length, VIDEO.length);
  await assert.rejects(t.readMedia("https://other.example.com/v.mp4"), (e) => e.kind === "invalid_media");
  assert.deepEqual(json(await t.uploadVideo("https://open-upload.tiktokapis.com/video/?upload_id=1", VIDEO, "video/mp4")), { status: 201 });
  assert.equal(seen.at(-1).method, "PUT"); assert.equal(seen.at(-1).headers["Content-Range"], `bytes 0-${VIDEO.length - 1}/${VIDEO.length}`);
  await assert.rejects(t.uploadVideo("https://open-upload.tiktokapis.com.evil.fr/v", VIDEO, "video/mp4"), (e) => e.kind === "invalid_path");
  assert.equal(transport.isTikTokUploadUrl("http://open-upload.tiktokapis.com/x"), false);
  assert.ok(transport.TIKTOK_PUBLISH_PATHS.includes("post/publish/video/init"));
});

// --- Service de génération (base simulée) ---
const PUB = "11111111-1111-4111-8111-111111111111", REV = "22222222-2222-4222-8222-222222222222", CLIENT = "33333333-3333-4333-8333-333333333333";
const IMG1 = "44444444-4444-4444-8444-444444444441", IMG2 = "44444444-4444-4444-8444-444444444442", VAR = "55555555-5555-4555-8555-555555555555", NEWREV = "66666666-6666-4666-8666-666666666666";
function fakeDb(state) {
  const log = [];
  const rows = (table) => state[table] ?? [];
  const query = (table) => { let list = rows(table); const q = {
    select: () => q, order: () => q, limit: () => q,
    eq: (k, v) => { list = list.filter((r) => r[k] === v); return q; },
    in: (k, vs) => { list = list.filter((r) => vs.includes(r[k])); return q; },
    maybeSingle: async () => ({ data: list[0] ?? null, error: null }),
    then: (res) => res({ data: list, error: null, count: list.length }) }; return q; };
  return { log, from: query,
    storage: { from: (bucket) => ({
      download: async (path) => { log.push(["download", bucket, path]); return { data: new Blob([Buffer.from("img:" + path)]), error: null }; },
      upload: async (path, bytes, o) => { log.push(["upload", bucket, path, o.contentType]); return { error: null }; },
      remove: async (paths) => { log.push(["remove", bucket, ...paths]); return { error: null }; } }) },
    rpc: async (name, args) => { log.push(["rpc", name, json(args)]); return state.rpc?.[name]?.(args) ?? { data: null, error: null }; } };
}
const baseState = (over = {}) => ({
  publications: [{ id: PUB, client_id: CLIENT, platform: "tiktok", status: "pending_review", current_revision_id: REV, archived_at: null }],
  publication_variants: [{ id: VAR, revision_id: REV, platform: "tiktok", text_content: TEXT, metadata: { cta: "Devis" } }],
  publication_variant_assets: [{ variant_id: VAR, asset_id: IMG1, sort_order: 0 }, { variant_id: VAR, asset_id: IMG2, sort_order: 1 }],
  publication_assets: [{ id: IMG1, client_id: CLIENT, storage_path: `${CLIENT}/${PUB}/${IMG1}`, mime_type: "image/jpeg" }, { id: IMG2, client_id: CLIENT, storage_path: `${CLIENT}/${PUB}/${IMG2}`, mime_type: "image/jpeg" }],
  clients: [{ id: CLIENT, name: "Jrenov" }], publication_revisions: [{ id: REV, publication_id: PUB }],
  rpc: { publication_revise_manual: () => ({ data: NEWREV, error: null }) }, ...over });
const types = loadTs("lib/publications/types.ts"), validation = loadTs("lib/publications/validation.ts", { "./types": types });
const editor = loadTs("lib/publications/editor.ts", { "./validation": validation, "./types": types });
function service(renderImpl) {
  return loadTs("lib/publications/motion-video.ts", {
    "node:path": require("node:path"), "ffmpeg-static": { default: "/bin/ffmpeg" }, "@/lib/supabase/server": { getSupabaseServerClient: () => { throw Error("db"); } },
    "@/lib/admin-policy": { isAuthorizedAdmin: () => true },
    "@/lib/motion/video/render": { MOTION_RENDER_TIMEOUT_MS: 170_000, MotionRenderError: class extends Error { constructor(code) { super(code); this.code = code; } }, renderMotionVideo: renderImpl },
    "@/lib/motion/video/storyboard": story, "./editor": editor, "./validation": validation,
    "./automation/scheduled": { delegatedActor: async () => "user_admin" } }, { process: { env: {}, cwd: () => "/app" } });
}
const fakeRender = (calls) => async (input) => { calls.push(input); return { bytes: VIDEO, storyboard: story.buildMotionStoryboard({ text: input.text, photoCount: input.photos.length, clientName: input.clientName, seed: input.seed }), durationMs: 5, width: 720, height: 1280 }; };

test("génération : photos du stockage → vidéo privée → nouvelle révision TikTok (vidéo seule, sources gardées)", async () => {
  const renders = [], db = fakeDb(baseState());
  const r = await service(fakeRender(renders)).generateTikTokMotionVideo(PUB, "user_admin", {}, { db });
  assert.equal(r.ok, true); assert.equal(r.revisionId, NEWREV);
  assert.equal(renders[0].photos.length, 2); assert.equal(renders[0].clientName, "Jrenov"); assert.equal(renders[0].ffmpegPath, "/bin/ffmpeg");
  const upload = db.log.find((l) => l[0] === "upload");
  assert.equal(upload[1], "publication-videos"); assert.equal(upload[3], "video/mp4"); assert.match(upload[2], new RegExp(`^${CLIENT}/${PUB}/[0-9a-f-]{36}$`));
  const register = db.log.find((l) => l[1] === "publication_register_image")[2];
  assert.equal(register.p_mime, "video/mp4"); assert.equal(register.p_path, upload[2]); assert.equal(register.p_revision_id, REV);
  const revise = db.log.find((l) => l[1] === "publication_revise_manual")[2];
  assert.equal(revise.p_expected_revision_id, REV);
  assert.deepEqual(revise.p_variants[0].asset_ids, [register.p_asset_id]);
  assert.equal(revise.p_variants[0].text_content, TEXT, "texte inchangé");
  assert.deepEqual(revise.p_variants[0].metadata.motion_video.source_asset_ids, [IMG1, IMG2]);
  assert.equal(revise.p_variants[0].metadata.cta, "Devis", "métadonnées existantes conservées");
  assert.ok(!db.log.some((l) => /approve|review|submit|delivery|job/.test(String(l[1]))), "jamais d'approbation ni de diffusion");
});

test("génération : refus TikTok seulement, photos requises, révision périmée nettoyée, régénération depuis les sources", async () => {
  const renders = [];
  let db = fakeDb(baseState({ publications: [{ ...baseState().publications[0], platform: "instagram" }] }));
  assert.equal((await service(fakeRender(renders)).generateTikTokMotionVideo(PUB, "user_admin", {}, { db })).code, "not_tiktok");
  db = fakeDb(baseState({ publication_variant_assets: [] }));
  assert.equal((await service(fakeRender(renders)).generateTikTokMotionVideo(PUB, "user_admin", {}, { db })).code, "photos");
  db = fakeDb(baseState({ rpc: { publication_revise_manual: () => ({ data: null, error: { code: "40001" } }) } }));
  const stale = await service(fakeRender(renders)).generateTikTokMotionVideo(PUB, "user_admin", {}, { db });
  assert.equal(stale.code, "stale"); assert.ok(db.log.some((l) => l[0] === "remove" && l[1] === "publication-videos"), "vidéo orpheline supprimée");
  const VID = "77777777-7777-4777-8777-777777777777", s = baseState();
  db = fakeDb({ ...s, publication_variant_assets: [{ variant_id: VAR, asset_id: VID, sort_order: 0 }],
    publication_variants: [{ ...s.publication_variants[0], metadata: { motion_video: { source_asset_ids: [IMG2] } } }],
    publication_assets: [...s.publication_assets, { id: VID, client_id: CLIENT, storage_path: `${CLIENT}/${PUB}/${VID}`, mime_type: "video/mp4" }] });
  assert.equal((await service(fakeRender(renders)).generateTikTokMotionVideo(PUB, "user_admin", { automatic: true }, { db })).code, "already", "l'automatique ne refait jamais une vidéo");
  const again = await service(fakeRender(renders)).generateTikTokMotionVideo(PUB, "user_admin", {}, { db });
  assert.equal(again.ok, true); assert.deepEqual(db.log.filter((l) => l[0] === "download").map((l) => l[2]), [`${CLIENT}/${PUB}/${IMG2}`], "régénération depuis les photos d'origine");
});

test("planificateur : arrêt d'urgence respecté, migration absente = désactivé, échec journalisé, échéance respectée", async () => {
  const settings = (v) => ({ publication_settings: [{ emergency_stop: v, generation_enabled: true }] });
  let db = fakeDb({ ...baseState(), ...settings(true) });
  assert.equal((await service(fakeRender([])).runMotionVideoTick(new Date(), { db })).disabled, "global");
  db = fakeDb({ ...baseState(), ...settings(false), rpc: { publication_motion_video_candidates: () => ({ data: null, error: { code: "PGRST202" } }) } });
  assert.equal((await service(fakeRender([])).runMotionVideoTick(new Date(), { db })).disabled, "not_installed");
  const cand = { publication_motion_video_candidates: () => ({ data: [{ publication_id: PUB, revision_id: REV, client_id: CLIENT }], error: null }) };
  db = fakeDb({ ...baseState(), ...settings(false), rpc: { ...cand, publication_revise_manual: () => ({ data: NEWREV, error: null }) } });
  assert.deepEqual(json(await service(fakeRender([])).runMotionVideoTick(new Date(), { db })), { rendered: 1, failed: 0, noActor: 0, candidates: 1 });
  const failing = async () => { throw Object.assign(Error("x"), { code: "engine" }); };
  db = fakeDb({ ...baseState(), ...settings(false), rpc: cand });
  const svc = service(failing);
  assert.deepEqual(json(await svc.runMotionVideoTick(new Date(), { db })), { rendered: 0, failed: 1, noActor: 0, candidates: 1 });
  assert.deepEqual(db.log.find((l) => l[1] === "publication_motion_video_failed")[2], { p_publication_id: PUB, p_revision_id: REV, p_code: "render_engine", p_actor_id: null });
  db = fakeDb({ ...baseState(), ...settings(false), rpc: cand });
  assert.equal((await svc.runMotionVideoTick(new Date(), { db, deadline: 100_000, clock: () => 50_000 })).skipped, "deadline");
});

test("migration : stockage privé, vidéo réservée à TikTok et seule, réglage client journalisé, droits service_role", () => {
  const sql = src("supabase/migrations/20261120000000_publications_motion_video.sql").replace(/--[^\n]*/g, "");
  assert.match(sql, /'publication-videos','publication-videos',false,67108864,array\['video\/mp4'\]/);
  assert.match(sql, /mime_type in \('image\/jpeg','image\/png','image\/webp','video\/mp4'\)/);
  assert.match(sql, /Video only on TikTok/); assert.match(sql, /Video must be the only media/);
  assert.match(sql, /r\.origin='generated'/, "seules les révisions de l'agent sont reprises automatiquement");
  assert.doesNotMatch(sql, /security definer|create policy|to (anon|authenticated)|publication_deliveries|publication_jobs|publication_review/i);
  for (const fn of ["publication_motion_video_save", "publication_motion_video_candidates", "publication_motion_video_failed"]) assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`));
});

test("câblage : signature par stockage dans le moteur, binaire et police tracés pour les seules routes de rendu", () => {
  assert.match(src("lib/publications/delivery/engine.ts"), /createSignedUrls\(paths,ttl\)/);
  assert.equal(editor.mediaBucket("video/mp4"), "publication-videos"); assert.equal(editor.mediaBucket("image/jpeg"), "publication-images");
  const config = src("next.config.ts");
  assert.match(config, /serverExternalPackages: \["ffmpeg-static"\]/); assert.match(config, /fonts\/\*\.ttf/);
  assert.ok(existsSync(new URL("../lib/motion/video/fonts/Montserrat_800ExtraBold.ttf", import.meta.url)) && existsSync(new URL("../lib/motion/video/fonts/OFL.txt", import.meta.url)));
  const route = src("app/api/publications/[id]/motion-video/route.ts");
  assert.match(route, /origin !== new URL\(request\.url\)\.origin[\s\S]*requireAdmin\(\)[\s\S]*generateTikTokMotionVideo/, "même origine et admin avant tout rendu");
});
