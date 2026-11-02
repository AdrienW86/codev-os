import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const json = (v) => JSON.parse(JSON.stringify(v));
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const providers = loadTs("lib/publications/connections/providers.ts");
const snapchat = loadTs("lib/publications/connections/snapchat.ts", { "./providers": providers });
const publisher = loadTs("lib/publications/delivery/snapchat-publisher.ts");
const integration = loadTs("lib/integrations/publications-snapchat-publish.ts", { "./publications-retry-after": { publicationRetryAfterSeconds: () => null } }, { FormData, Blob, Response });
const model = loadTs("lib/publications/connections/model.ts", { "../editor": { platformLabels: { snapchat: "Snapchat" } } });
const config = loadTs("lib/integrations/publications-oauth/config.ts");
const PROFILE = "pp-123_abc";
const ADD = `/us/v1/public_profiles/${PROFILE}/media/m-1/multipart-upload`;

const credential = (over = {}) => ({ accessToken: "snap.valid-token-123", refreshToken: "snap.refresh-123", expiresAt: new Date(Date.now() + 3600_000).toISOString(), scopes: ["snapchat-profile-api"], provider: "snapchat", subject: "me-1", ...over });
const photo = { url: "https://proj.supabase.co/storage/v1/object/sign/publication-images/a.jpg?token=a", mimeType: "image/jpeg" };
const video = { url: "https://proj.supabase.co/storage/v1/object/sign/publication-videos/a.mp4?token=a", mimeType: "video/mp4" };
const input = (over = {}) => ({ platform: "snapchat", account: { externalAccountId: PROFILE, parentExternalId: null }, text: "Toiture refaite à neuf à Narbonne ! #toiture", media: [photo], idempotencyKey: "job-1", credential: credential(), ...over });
function fakeTransport(script = {}, bytes = new Uint8Array([1, 2, 3, 4, 5])) {
  const calls = [];
  const answer = (key, r) => { const next = script[key]; const value = typeof next === "function" ? next(r) : next; if (value instanceof Error) throw value; return value ?? { status: 200, body: {} }; };
  return { calls, async readMedia(url) { calls.push("read"); if (script.read instanceof Error) throw script.read; assert.match(url, /^https:\/\/proj\.supabase\.co\//); return bytes; },
    async request(r) { calls.push(r.action); return answer(r.action, r); },
    async uploadPart(path, token, part) { calls.push(`part${part.partNumber}`); return answer("part", { path, token, part }); },
    async finalizeUpload(path) { calls.push("finalize"); return answer("finalize", { path }); } };
}
const mediaCreated = { status: 200, body: { request_status: "SUCCESS", media_id: "m-1", add_path: ADD, finalize_path: ADD } };

test("Snapchat : identifiants exigés, scope vérifié, profils publics normalisés", () => {
  const c = snapchat.snapchatCredentialOf({ access_token: "snap.abcdefgh", expires_in: 3600, refresh_token: "snap.rfabcdef", scope: "snapchat-profile-api", token_type: "Bearer" }, null);
  assert.equal(c.provider, "snapchat"); assert.equal(c.refreshToken, "snap.rfabcdef");
  assert.throws(() => snapchat.snapchatCredentialOf({ access_token: "snap.abcdefgh", expires_in: 3600, scope: "snapchat-marketing-api" }, null), (e) => e.kind === "permission");
  assert.throws(() => snapchat.snapchatCredentialOf({ error: "invalid_grant" }, null), (e) => e.kind === "revoked");
  const profiles = snapchat.snapchatProfilesOf({ request_status: "SUCCESS", public_profiles: [{ sub_request_status: "SUCCESS", public_profile: { id: PROFILE, display_name: "JRenov", snap_user_name: "jrenov" } }, { public_profile: { id: "https://x", display_name: "URL" } }] });
  assert.deepEqual(json(profiles), [{ id: PROFILE, displayName: "JRenov", username: "jrenov" }]);
  assert.deepEqual(json(model.normalizeSnapchatAccounts(profiles)), [{ provider: "snapchat", platform: "snapchat", externalAccountId: PROFILE, displayName: "@jrenov", parentExternalId: null, metadata: {} }]);
  assert.equal(model.providerOfPlatform("snapchat"), "snapchat");
  assert.deepEqual(json(model.PROVIDER_PLATFORMS.snapchat), ["snapchat"]);
});

test("Snapchat : connexion, rafraîchissement et découverte des profils par le transport OAuth (lecture seule)", async () => {
  const calls = [];
  const transport = { async request(r) { calls.push(`${r.operation}:${r.path}`);
    if (r.operation === "token") return { status: 200, body: { access_token: "snap.newtoken1", expires_in: 3600, refresh_token: "snap.refresh-2", scope: "snapchat-profile-api", token_type: "Bearer" } };
    if (r.path === "me") return { status: 200, body: { request_status: "SUCCESS", me: { id: "me-1", organization_id: "11111111-1111-4111-8111-111111111111" } } };
    return { status: 200, body: { public_profiles: [{ public_profile: { id: PROFILE, display_name: "JRenov" } }] } }; } };
  const p = snapchat.createSnapchatConnectionProvider(transport);
  const c = await p.exchangeCode("code-12345678", "https://os.code-v.fr/api/publications/oauth/snapchat/callback");
  assert.equal(c.subject, "me-1");
  assert.deepEqual(json(await p.listPublicProfiles(c)), [{ id: PROFILE, displayName: "JRenov", username: null }]);
  assert.deepEqual(calls, ["token:token", "read:me", "read:me", "read:organizations/11111111-1111-4111-8111-111111111111/public_profiles"]);
  const expired = snapchat.createSnapchatConnectionProvider({ async request() { return { status: 401, body: { error: "invalid_token" } }; } });
  assert.deepEqual(json(await expired.validateConnection(credential())), { status: "expired", externalIdentity: null });
});

test("Snapchat : configuration serveur (noms seulement, jamais de valeur) et URL de redirection officielle", () => {
  const env = { PUBLICATIONS_OAUTH_BASE_URL: "https://os.code-v.fr", SNAPCHAT_CLIENT_ID: "abcd-1234-efgh", SNAPCHAT_CLIENT_SECRET: "s".repeat(32) };
  assert.deepEqual(json(config.snapchatOAuthConfig(env)), { clientId: "abcd-1234-efgh", clientSecret: "s".repeat(32), redirectUri: "https://os.code-v.fr/api/publications/oauth/snapchat/callback" });
  assert.equal(config.snapchatOAuthConfig({ ...env, SNAPCHAT_CLIENT_SECRET: "court" }), null);
  assert.deepEqual(json(config.missingOAuthConfiguration("snapchat", {})), ["PUBLICATIONS_OAUTH_BASE_URL", "PUBLICATION_CREDENTIALS_KEY", "PUBLICATION_CREDENTIALS_KEY_ID", "SNAPCHAT_CLIENT_ID", "SNAPCHAT_CLIENT_SECRET"]);
});

test("Snapchat : une photo devient une Story ; fichier chiffré AES-256-CBC, envoi puis finalisation avant toute publication", async () => {
  const plain = new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 251));
  let key, iv, uploaded;
  const t = fakeTransport({
    media: (r) => { assert.equal(r.profileId, PROFILE); assert.equal(r.body.type, "IMAGE"); key = r.body.key; iv = r.body.iv; assert.match(r.body.name, /^codev-job-1\.jpg$/); return mediaCreated; },
    part: ({ path, part }) => { assert.equal(path, ADD); uploaded = part.bytes; return { status: 200, body: { request_status: "SUCCESS" } }; },
    stories: (r) => { assert.deepEqual(json(r.body), { media_id: "m-1" }, "une Story ne porte que le média"); return { status: 200, body: { request_status: "SUCCESS", stories: [{ story: { id: "story-42" } }] } }; },
  }, plain);
  const r = await publisher.createSnapchatPublisher(t).publish(input());
  assert.deepEqual(json(r), { ok: true, remoteId: "story-42", simulated: false });
  assert.deepEqual(t.calls, ["read", "media", "part1", "finalize", "stories"]);
  assert.equal(Buffer.from(key, "base64").length, 32); assert.equal(Buffer.from(iv, "base64").length, 16);
  const d = createDecipheriv("aes-256-cbc", Buffer.from(key, "base64"), Buffer.from(iv, "base64"));
  assert.deepEqual(new Uint8Array(Buffer.concat([d.update(uploaded), d.final()])), plain, "Snap reçoit exactement le fichier, chiffré");
});

test("Snapchat : une vidéo (Studio vidéo) devient un Spotlight avec la description validée (160 caractères)", async () => {
  const text = "Une toiture neuve en 30 secondes ".repeat(10);
  const t = fakeTransport({ media: (r) => { assert.equal(r.body.type, "VIDEO"); return { status: 200, body: { media: [{ media: { id: "m-1", add_path: ADD, finalize_path: ADD } }] } }; },
    spotlights: (r) => { assert.equal(r.body.media_id, "m-1"); assert.equal(r.body.locale, "fr_FR"); assert.equal([...r.body.description].length, 160); assert.ok(r.body.description.endsWith("…")); return { status: 200, body: { spotlight: { id: "spot-7" } } }; } });
  const r = await publisher.createSnapchatPublisher(t, { encrypt: (b) => ({ bytes: b, key: "k", iv: "i" }) }).publish(input({ media: [video], text }));
  assert.deepEqual(json(r), { ok: true, remoteId: "spot-7", simulated: false });
  assert.deepEqual(t.calls, ["read", "media", "part1", "finalize", "spotlights"]);
  const big = fakeTransport({ media: mediaCreated, spotlights: { status: 200, body: { id: "spot-8" } } }, new Uint8Array(33 * 1024 * 1024));
  await publisher.createSnapchatPublisher(big, { encrypt: (b) => ({ bytes: b, key: "k", iv: "i" }) }).publish(input({ media: [video] }));
  assert.deepEqual(big.calls, ["read", "media", "part1", "part2", "finalize", "spotlights"], "plus de 32 Mo : deux morceaux");
});

test("Snapchat : refus avant toute écriture visible, incertitude après l'envoi, jamais de nouvelle tentative", async () => {
  const p = (t, o) => publisher.createSnapchatPublisher(t, o);
  assert.equal((await p(fakeTransport()).publish(input({ media: [] }))).errorCode, "media_required");
  assert.equal((await p(fakeTransport()).publish(input({ media: [photo, photo] }))).errorCode, "too_many_media");
  assert.equal((await p(fakeTransport()).publish(input({ media: [{ ...photo, mimeType: "image/png" }] }))).errorCode, "invalid_media");
  assert.equal((await p(fakeTransport()).publish(input({ account: { externalAccountId: "bad/id", parentExternalId: null } }))).errorCode, "profile_unavailable");
  assert.equal((await p(fakeTransport()).publish(input({ credential: credential({ provider: "tiktok" }) }))).errorCode, "credential_invalid");
  assert.equal((await p(fakeTransport()).publish(input({ credential: credential({ expiresAt: new Date(Date.now() - 1000).toISOString(), refreshToken: null }) }))).errorCode, "token_expired");
  const denied = fakeTransport({ media: { status: 403, body: {} } });
  assert.deepEqual(json(await p(denied).publish(input())), { ok: false, errorClass: "auth", errorCode: "permission_missing", retryAfterSeconds: null });
  assert.deepEqual(denied.calls, ["read", "media"], "rien n'est publié");
  const uploadDown = fakeTransport({ media: mediaCreated, part: Object.assign(new Error("t"), { kind: "timeout" }) });
  assert.equal((await p(uploadDown).publish(input())).errorClass, "provider_unavailable", "un envoi de média interrompu est sans effet public");
  const badPath = fakeTransport({ media: { status: 200, body: { media_id: "m-1" } } });
  assert.equal((await p(badPath).publish(input())).errorCode, "media_container_invalid");
  const lost = fakeTransport({ media: mediaCreated, stories: Object.assign(new Error("t"), { kind: "timeout" }) });
  assert.deepEqual(json(await p(lost).publish(input())), { ok: false, uncertain: true, errorCode: "timeout_after_dispatch" });
  const server = fakeTransport({ media: mediaCreated, stories: { status: 502, body: null } });
  assert.equal((await p(server).publish(input())).uncertain, true);
  const noId = fakeTransport({ media: mediaCreated, stories: { status: 200, body: { request_status: "SUCCESS" } } });
  assert.equal((await p(noId).publish(input())).errorCode, "remote_id_missing");
  assert.equal((await p(fakeTransport()).publish(input({ media: [video], text: "  " }))).errorCode, "empty_post");
});

test("Snapchat : jeton expiré rafraîchi en mémoire avant toute écriture", async () => {
  let refreshed = 0;
  const t = fakeTransport({ media: (r) => { assert.equal(r.token, "snap.fresh-token"); return mediaCreated; }, stories: { status: 200, body: { id: "story-1" } } });
  const r = await publisher.createSnapchatPublisher(t, { refresh: async (c) => { refreshed++; return { ...c, accessToken: "snap.fresh-token" }; } })
    .publish(input({ credential: credential({ expiresAt: new Date(Date.now() - 1000).toISOString() }) }));
  assert.equal(refreshed, 1); assert.equal(r.ok, true);
});

test("Snapchat : transport limité à l'API Snap, chemins d'envoi vérifiés, aucune redirection", async () => {
  assert.equal(integration.isSnapchatUploadPath(ADD, PROFILE), true);
  assert.equal(integration.isSnapchatUploadPath(`/v1/public_profiles/${PROFILE}/media/m-1/multipart-upload`, PROFILE), true);
  for (const bad of ["https://evil.example/x", `/us/v1/public_profiles/other/media/m-1/multipart-upload`, `/us/v1/public_profiles/${PROFILE}/media/../x/multipart-upload`, `/us/v1/public_profiles/${PROFILE}/stories`])
    assert.equal(integration.isSnapchatUploadPath(bad, PROFILE), false, bad);
  const requests = [];
  const fetchImpl = async (url, init) => { requests.push([url, init.method, init.redirect, init.headers?.Authorization]); return new Response(JSON.stringify({ request_status: "SUCCESS", media_id: "m" }), { status: 200, headers: { "content-type": "application/json" } }); };
  const t = integration.snapchatPublishTransport(fetchImpl, { mediaOrigin: "https://proj.supabase.co" });
  await t.request({ profileId: PROFILE, action: "media", body: { type: "IMAGE" }, token: "snap.tok" });
  await t.uploadPart(ADD, "snap.tok", { bytes: new Uint8Array([1]), partNumber: 1, fileName: "codev-1.jpg" });
  await t.finalizeUpload(ADD, "snap.tok");
  assert.deepEqual(requests.map((r) => r.slice(0, 3)), [[`https://businessapi.snapchat.com/v1/public_profiles/${PROFILE}/media`, "POST", "error"], [`https://businessapi.snapchat.com${ADD}`, "POST", "error"], [`https://businessapi.snapchat.com${ADD}`, "POST", "error"]]);
  assert.ok(requests.every((r) => r[3] === "Bearer snap.tok"));
  await assert.rejects(t.request({ profileId: "../x", action: "media", body: {}, token: "snap.tok" }), (e) => e.kind === "invalid_path");
  await assert.rejects(t.request({ profileId: PROFILE, action: "delete", body: {}, token: "snap.tok" }), (e) => e.kind === "invalid_path");
  await assert.rejects(t.readMedia("https://evil.example/a.jpg"), (e) => e.kind === "invalid_media");
});

test("Snapchat : cinquième réseau partout (migration, Studio vidéo, aperçu, documentation)", () => {
  const sql = src("supabase/migrations/20261121000000_publications_snapchat.sql");
  for (const fn of ["publication_channel_assign_account", "publication_channel_save", "publication_client_project_ensure", "publication_job_claim_scheduled", "publication_oauth_record", "publication_connections_list", "publication_delivery_reconcile", "guard_variant_video"]) assert.match(sql, new RegExp(fn));
  assert.match(sql, /Snapchat takes one media/); assert.match(sql, /not in\('tiktok','snapchat'\)/);
  assert.doesNotMatch(sql, /drop table|delete from|truncate/i);
  const studio = src("lib/studio/videos.ts");
  assert.match(studio, /snapchat:\{label:'Snapchat',maxText:160\}/); assert.doesNotMatch(studio, /publication_approve|publication_submit/);
  assert.match(src("components/publications/supervision-preview.tsx"), /data-preview="snapchat"/);
  const doc = src("docs/publications-snapchat.md");
  for (const name of ["SNAPCHAT_CLIENT_ID", "SNAPCHAT_CLIENT_SECRET", "snapchat-profile-api", "/api/publications/oauth/snapchat/callback"]) assert.match(doc, new RegExp(name.replace(/[/-]/g, "\\$&")));
  assert.doesNotMatch(src("lib/publications/delivery/snapchat-publisher.ts"), /console\./, "rien n'est journalisé");
});
