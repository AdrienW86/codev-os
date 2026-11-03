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

// --- Studio vidéo (base simulée) ---
const CLIENT = "33333333-3333-4333-8333-333333333333", ASSET = "44444444-4444-4444-8444-444444444441";
const types = loadTs("lib/publications/types.ts"), validation = loadTs("lib/publications/validation.ts", { "./types": types });
const editor = loadTs("lib/publications/editor.ts", { "./validation": validation, "./types": types });
const music = loadTs("lib/motion/music.ts");
const studioModel = loadTs("lib/studio/model.ts", { "@/lib/motion/video/storyboard": story, "@/lib/motion/music": music });
const formOf = (entries) => { const f = new FormData(); for (const [k, v] of entries) f.append(k, v); return f; };
const baseForm = (over = []) => formOf([["client_id", CLIENT], ["title", "Toiture octobre"], ["headline", "Toiture refaite en 3 jours"], ["captions", "Dépose des tuiles\nPose de l'écran"], ["closing", "Demandez votre devis"], ["brand", ""], ["pace", "standard"], ["library_asset", ASSET], ...over]);

test("studio : formulaire strict (client, accroche, rythme, 1 à 8 photos, une légende par ligne)", () => {
  const ok = studioModel.parseStudioForm(baseForm(), 1);
  assert.equal(ok.ok, true);
  assert.deepEqual(json(ok.draft.script), { headline: "Toiture refaite en 3 jours", captions: ["Dépose des tuiles", "Pose de l'écran"], closing: "Demandez votre devis", brand: "", pace: "standard" });
  assert.deepEqual(json(ok.draft.libraryAssetIds), [ASSET]);
  assert.match(studioModel.parseStudioForm(baseForm(), 8).message, /8 photos au plus/);
  assert.match(studioModel.parseStudioForm(formOf([["client_id", CLIENT], ["title", "T"], ["headline", "Accroche"], ["captions", ""], ["closing", ""], ["brand", ""], ["pace", "standard"]]), 0).message, /au moins une photo/);
  assert.match(studioModel.parseStudioForm((() => { const f = baseForm(); f.set("pace", "turbo"); return f; })(), 0).message, /rythme/);
  assert.match(studioModel.parseStudioForm((() => { const f = baseForm(); f.set("client_id", "x"); return f; })(), 0).message, /client/);
  assert.equal(studioModel.suggestedCaption(ok.draft.script), "Toiture refaite en 3 jours\nDépose des tuiles\nPose de l'écran\nDemandez votre devis");
});

test("studio : storyboard du script saisi (aucun texte ajouté), rythme appliqué", () => {
  const b = story.buildScriptStoryboard({ headline: "Toiture refaite 🎉", captions: ["Dépose #chantier"], closing: "Demandez votre devis", brand: "Jrenov", pace: "dynamic" }, 2, "seed");
  assert.deepEqual(json(b.scenes.map((s) => [s.kind, s.headline ?? s.caption])), [["hook", "Toiture refaite"], ["photo", "Dépose"], ["outro", "Jrenov"]]);
  assert.equal(b.scenes.at(-1).caption, "Demandez votre devis");
  assert.equal(b.scenes[0].duration, story.MOTION_PACES.dynamic.hook);
  assert.throws(() => story.buildScriptStoryboard({ headline: "🎉", captions: [], closing: null, brand: "J" }, 1, "s"), /motion_text_required/);
});

const VID_BYTES = new Uint8Array([0, 0, 0, 32, ...Buffer.from("ftypisom"), ...new Array(4096).fill(1)]);
function studioDb() {
  const log = [];
  const tables = { clients: [{ id: CLIENT, name: "Jrenov" }], studio_videos: [] };
  const query = (table) => { let list = tables[table] ?? []; const q = {
    select: () => q, order: () => q, limit: () => q, in: () => q, is: () => q, not: () => q,
    eq: (k, v) => { list = list.filter((r) => r[k] === v); return q; },
    maybeSingle: async () => ({ data: list[0] ?? null, error: null }),
    insert: async (row) => { log.push(["insert", table, json(row)]); tables[table].push(row); return { error: null }; },
    then: (res) => res({ data: list, error: null }) }; return q; };
  return { log, tables, from: query, storage: { from: (bucket) => ({
    upload: async (path, bytes, o) => { log.push(["upload", bucket, path, o.contentType]); return { error: null }; },
    remove: async (paths) => { log.push(["remove", bucket, ...paths]); return { error: null }; },
    createSignedUrls: async (paths) => ({ data: paths.map((path) => ({ path, signedUrl: "https://proj.supabase.co/sign/" + path })), error: null }) }) } };
}
function studio(audit = []) {
  return loadTs("lib/studio/videos.ts", {
    "node:crypto": require("node:crypto"), "node:path": require("node:path"), "ffmpeg-static": { default: "/bin/ffmpeg" },
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: "user_admin" }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => { throw Error("db"); } },
    "@/lib/core/audit": { writeAudit: async (actor, entry) => { audit.push(entry.action); } }, "@/lib/whatsapp/library": { readOriginal: async () => null }, "@/lib/media-intelligence/model": loadTs("lib/media-intelligence/model.ts"), "@/lib/motion/music": music,
    "@/lib/publications/project-channels": {}, "@/lib/publications/channels": {}, "@/lib/publications/workspace": {},
    "@/lib/publications/editor": editor, "@/lib/motion/video/render": { MotionRenderError: class extends Error {}, renderMotionVideo: async () => { throw Error("real render"); } },
    "./model": studioModel }, { process: { env: {}, cwd: () => "/app" }, File, FormData, Blob });
}
test("studio : rendu à partir de la photothèque, stockage privé dédié, bibliothèque par client, journal", async () => {
  const db = studioDb(), audit = [], renders = [];
  const render = async (input) => { renders.push(input); return { bytes: VID_BYTES, storyboard: story.buildScriptStoryboard(input.script, input.photos.length, input.seed), durationMs: 1, width: 720, height: 1280 }; };
  const r = await studio(audit).createStudioVideo(baseForm(), { db, render, readLibrary: async (c, a) => c === CLIENT && a === ASSET ? { bytes: new Uint8Array([1]), mime: "image/jpeg" } : null });
  assert.equal(r.ok, true, r.message);
  assert.equal(renders[0].script.brand, "Jrenov", "nom affiché par défaut : le client");
  const up = db.log.find((l) => l[0] === "upload");
  assert.deepEqual(up, ["upload", "studio-videos", `${CLIENT}/${r.id}.mp4`, "video/mp4"]);
  const row = db.log.find((l) => l[0] === "insert")[2];
  assert.equal(row.client_id, CLIENT); assert.equal(row.created_by, "user_admin"); assert.deepEqual(row.sources, { library_asset_ids: [ASSET], uploaded_photos: 0 });
  assert.deepEqual(audit, ["studio.video_created"]);
  assert.ok(!db.log.some((l) => /publication/.test(String(l[1]))), "le Studio ne touche pas aux publications");
  const listed = await studio().listStudioVideos(CLIENT, { db });
  assert.equal(listed.videos.length, 1); assert.match(listed.videos[0].url, /studio-videos|sign/);
  const refused = await studio().createStudioVideo(baseForm(), { db, render, readLibrary: async () => null });
  assert.match(refused.message, /photothèque est illisible/);
  const noEngine = await studio().createStudioVideo(baseForm(), { db, render, ffmpegPath: null, readLibrary: async () => ({ bytes: new Uint8Array([1]), mime: "image/jpeg" }) });
  assert.match(noEngine.message, /Moteur vidéo indisponible/);
});

test("migration : stockages privés, vidéo réservée à TikTok et seule, table Studio serveur uniquement", () => {
  const sql = src("supabase/migrations/20261120000000_publications_motion_video.sql").replace(/--[^\n]*/g, "");
  assert.match(sql, /'publication-videos','publication-videos',false,67108864,array\['video\/mp4'\]/);
  assert.match(sql, /'studio-videos','studio-videos',false,67108864,array\['video\/mp4'\]/);
  assert.match(sql, /mime_type in \('image\/jpeg','image\/png','image\/webp','video\/mp4'\)/);
  assert.match(sql, /Video only on TikTok/); assert.match(sql, /Video must be the only media/);
  assert.match(sql, /alter table public\.studio_videos enable row level security/);
  assert.doesNotMatch(sql, /security definer|create policy|to (anon|authenticated)|publication_deliveries|publication_jobs/i);
});

test("câblage : Studio séparé des publications, signature par stockage, binaire et police tracés pour la seule route de rendu", () => {
  assert.match(src("lib/publications/delivery/engine.ts"), /createSignedUrls\(paths,ttl\)/);
  assert.equal(editor.mediaBucket("video/mp4"), "publication-videos"); assert.equal(editor.mediaBucket("image/jpeg"), "publication-images");
  const config = src("next.config.ts");
  assert.match(config, /serverExternalPackages: \["ffmpeg-static"\]/); assert.match(config, /"\/api\/studio\/videos": motionVideoFiles/);
  assert.ok(existsSync(new URL("../lib/motion/video/fonts/Montserrat_800ExtraBold.ttf", import.meta.url)) && existsSync(new URL("../lib/motion/video/fonts/OFL.txt", import.meta.url)));
  assert.match(src("app/api/studio/videos/route.ts"), /origin !== new URL\(request\.url\)\.origin[\s\S]*requireAdmin\(\)[\s\S]*createStudioVideo/, "même origine et admin avant tout rendu");
  assert.match(src("components/layout/navigation.tsx"), /href: "\/studio", label: "Studio vidéo"/);
  assert.doesNotMatch(src("app/api/internal/scheduler/tick/route.ts"), /motion|studio/i, "aucune génération automatique dans le planificateur");
});

test("Studio: the photo picker offers exactly what the Publications agent may publish (same rule, never purged)", () => {
  const studio = src("lib/studio/videos.ts");
  assert.match(studio, /isPublicationCandidate\(\{libraryStatus:r\.library_status,mediaKind:r\.media_kind,purged:false,assessment:byAsset\.get\(r\.id\)\?\?null\}\)/);
  assert.match(studio, /\.in\('library_status',\['received','to_review','validated','used'\]\)\.is\('purged_at',null\)/);
});

test("music: embedded original tracks per pace, stable automatic pick, none on request, traced for the render function", () => {
  assert.equal(music.MOTION_TRACKS.length, 8);
  for (const t of music.MOTION_TRACKS) assert.ok(existsSync(new URL(`../lib/motion/video/music/${t.file}`, import.meta.url)), t.file);
  for (const pace of ["dynamic", "standard", "calm"]) {
    const a = music.pickTrack("auto", pace, "seed-1"), b = music.pickTrack("auto", pace, "seed-1");
    assert.equal(a.mood, pace); assert.equal(a.id, b.id, "même vidéo : même morceau");
  }
  assert.equal(music.pickTrack("none", "dynamic", "x"), null);
  assert.equal(music.pickTrack("calme", "dynamic", "x").id, "calme", "choix explicite prioritaire");
  assert.equal(music.isMusicChoice("inconnu"), false); assert.equal(music.isMusicChoice("auto"), true);
  assert.match(src("next.config.ts"), /"\.\/lib\/motion\/video\/music\/\*\.mp3"/);
  assert.match(src("lib/motion/video/music/LICENCE.txt"), /compositions originales/);
});

test("music: looped, trimmed to the video, faded in and out; silent track without music", () => {
  const board = story.buildScriptStoryboard({ headline: "Accroche", captions: [], closing: null, brand: "CODE-V", pace: "standard" }, 2, "seed");
  const files = board.scenes.map((s) => ({ background: "/t/bg.png", photo: s.photo === null ? null : "/t/p.jpg", text: null, mask: s.photo === null ? null : "/t/m.png" }));
  const withMusic = graph.motionFfmpegArgs(board, files, "/t/out.mp4", "/m/horizon.mp3");
  const i = withMusic.indexOf("/m/horizon.mp3");
  assert.equal(withMusic.slice(i - 3, i + 1).join(" "), "-stream_loop -1 -i /m/horizon.mp3");
  const fc = withMusic[withMusic.indexOf("-filter_complex") + 1];
  assert.match(fc, new RegExp(`atrim=0:${board.total}`)); assert.match(fc, /afade=t=in:st=0:d=0\.4/); assert.match(fc, /afade=t=out:st=[\d.]+:d=1\.6/);
  assert.ok(withMusic.includes("[aout]")); assert.ok(!withMusic.includes("anullsrc=channel_layout=stereo:sample_rate=44100"));
  const silent = graph.motionFfmpegArgs(board, files, "/t/out.mp4");
  assert.ok(silent.includes("anullsrc=channel_layout=stereo:sample_rate=44100")); assert.ok(!silent.includes("-stream_loop"));
  const fields = { client_id: "11111111-1111-4111-8111-111111111111", title: "T", headline: "Accroche", captions: "", closing: "", brand: "B", pace: "calm" };
  const fake = (extra) => ({ get: (k) => ({ ...fields, ...extra })[k] ?? null, getAll: () => [] });
  assert.equal(studioModel.parseStudioForm(fake({}), 1).draft.music, "auto", "sans choix : automatique");
  assert.equal(studioModel.parseStudioForm(fake({ music: "lumiere" }), 1).draft.music, "lumiere");
  const parsed = studioModel.parseStudioForm(fake({ music: "pas-un-morceau" }), 1);
  assert.equal(parsed.ok, false, "musique inconnue refusée");
});
