import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const providers = loadTs("lib/publications/connections/providers.ts");
const tiktok = loadTs("lib/publications/connections/tiktok.ts", { "./providers": providers });
const publisher = loadTs("lib/publications/delivery/tiktok-publisher.ts");
const model = loadTs("lib/publications/connections/model.ts", { "../editor": { platformLabels: { tiktok: "TikTok" } } });
const KEY = Buffer.alloc(32, 7).toString("base64");
const env = { PUBLICATION_CREDENTIALS_KEY: KEY, NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co" };
const link = loadTs("lib/integrations/publications-media-link.ts");

const credential = (over = {}) => ({ accessToken: "act.valid-token-123", refreshToken: "rft.refresh-123", expiresAt: new Date(Date.now() + 3600_000).toISOString(), scopes: ["user.info.basic", "video.publish"], provider: "tiktok", subject: "open-1", ...over });
const input = (over = {}) => ({ platform: "tiktok", account: { externalAccountId: "open-1", parentExternalId: null }, text: "Toiture refaite à neuf ! Demandez votre devis. #toiture",
  media: [{ url: "https://proj.supabase.co/storage/v1/object/sign/x.jpg?token=a", mimeType: "image/jpeg" }], idempotencyKey: "k", credential: credential(), ...over });
function fakeTransport(script) {
  const calls = [];
  return { calls, async request(r) { calls.push(r.path); const next = script[r.path]; const value = typeof next === "function" ? next(r) : next; if (value instanceof Error) throw value; return value; } };
}
const ok = (data) => ({ status: 200, body: { data, error: { code: "ok" } } });
const opts = (over = {}) => ({ mediaLink: (u) => "https://os.code-v.fr/api/publications/media/" + encodeURIComponent(u.slice(-5)) + ".jpg", sleep: async () => {}, statusChecks: 3, ...over });

test("TikTok : identifiants exigés, scopes vérifiés, compte normalisé", () => {
  const c = tiktok.tiktokCredentialOf({ access_token: "act.abcdefgh", expires_in: 86400, open_id: "open-1", refresh_token: "rft.abcdefgh", scope: "user.info.basic,video.publish", token_type: "Bearer" }, null);
  assert.equal(c.provider, "tiktok"); assert.equal(c.subject, "open-1"); assert.equal(c.refreshToken, "rft.abcdefgh");
  assert.throws(() => tiktok.tiktokCredentialOf({ access_token: "act.abcdefgh", expires_in: 86400, open_id: "open-1", scope: "user.info.basic" }, null), (e) => e.kind === "permission");
  assert.throws(() => tiktok.tiktokCredentialOf({ error: "invalid_grant" }, null), (e) => e.kind === "revoked");
  assert.deepEqual(JSON.parse(JSON.stringify(model.normalizeTikTokAccounts({ openId: "open-1", displayName: "Jrenov", username: null }))),
    [{ provider: "tiktok", platform: "tiktok", externalAccountId: "open-1", displayName: "Jrenov", parentExternalId: null, metadata: {} }]);
  assert.equal(model.providerOfPlatform("tiktok"), "tiktok");
});

test("TikTok : post photo public, statut suivi jusqu'à la publication", async () => {
  const t = fakeTransport({ "post/publish/creator_info/query": ok({ privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] }),
    "post/publish/content/init": (r) => { assert.equal(r.body.post_info.privacy_level, "PUBLIC_TO_EVERYONE"); assert.equal(r.body.media_type, "PHOTO"); assert.match(r.body.source_info.photo_images[0], /^https:\/\/os\.code-v\.fr\//); assert.ok(r.body.post_info.title.length <= 90); return ok({ publish_id: "p_pub_url~v2.123" }); },
    "post/publish/status/fetch": ok({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7123456789] }) });
  const r = await publisher.createTikTokPublisher(t, opts()).publish(input());
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { ok: true, remoteId: "7123456789", simulated: false });
});

test("TikTok : application non auditée, domaine non vérifié, absence d'image et traitement long", async () => {
  const privateOnly = fakeTransport({ "post/publish/creator_info/query": ok({ privacy_level_options: ["SELF_ONLY"] }) });
  assert.equal((await publisher.createTikTokPublisher(privateOnly, opts()).publish(input())).errorCode, "app_not_audited");
  assert.deepEqual(privateOnly.calls, ["post/publish/creator_info/query"], "rien n'est publié");
  const unverified = fakeTransport({ "post/publish/creator_info/query": ok({ privacy_level_options: ["PUBLIC_TO_EVERYONE"] }), "post/publish/content/init": { status: 403, body: { error: { code: "url_ownership_unverified" } } } });
  assert.equal((await publisher.createTikTokPublisher(unverified, opts()).publish(input())).errorCode, "media_domain_unverified");
  assert.equal((await publisher.createTikTokPublisher(fakeTransport({}), opts()).publish(input({ media: [] }))).errorCode, "media_required");
  assert.equal((await publisher.createTikTokPublisher(fakeTransport({}), opts({ mediaLink: () => null })).publish(input())).errorCode, "media_link_not_configured");
  const slow = fakeTransport({ "post/publish/creator_info/query": ok({ privacy_level_options: ["PUBLIC_TO_EVERYONE"] }), "post/publish/content/init": ok({ publish_id: "p_pub_url~v2.9" }), "post/publish/status/fetch": ok({ status: "PROCESSING_DOWNLOAD" }) });
  const r = await publisher.createTikTokPublisher(slow, opts()).publish(input());
  assert.equal(r.uncertain, true, "jamais renvoyé automatiquement");
  const lost = fakeTransport({ "post/publish/creator_info/query": ok({ privacy_level_options: ["PUBLIC_TO_EVERYONE"] }), "post/publish/content/init": Object.assign(new Error("t"), { kind: "timeout" }) });
  assert.equal((await publisher.createTikTokPublisher(lost, opts()).publish(input())).uncertain, true);
});

test("TikTok : jeton expiré rafraîchi en mémoire avant toute écriture", async () => {
  let refreshed = 0;
  const t = fakeTransport({ "post/publish/creator_info/query": (r) => { assert.equal(r.token, "act.fresh-token"); return ok({ privacy_level_options: ["PUBLIC_TO_EVERYONE"] }); },
    "post/publish/content/init": ok({ publish_id: "p1~x" }), "post/publish/status/fetch": ok({ status: "PUBLISH_COMPLETE" }) });
  const r = await publisher.createTikTokPublisher(t, opts({ refresh: async (c) => { refreshed++; return { ...c, accessToken: "act.fresh-token" }; } })).publish(input({ credential: credential({ expiresAt: new Date(Date.now() - 1000).toISOString() }) }));
  assert.equal(refreshed, 1); assert.equal(r.ok, true); assert.equal(r.remoteId, "p1~x");
});

test("Lien public signé : seulement le stockage du projet, signature et échéance vérifiées", () => {
  const signed = "https://proj.supabase.co/storage/v1/object/sign/publication-images/a.jpg?token=abc";
  const url = link.publicMediaLink(signed, "https://os.code-v.fr", 600, env);
  assert.match(url, /^https:\/\/os\.code-v\.fr\/api\/publications\/media\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}\.jpg$/);
  const token = url.split("/media/")[1];
  assert.equal(link.resolveMediaLink(token, env), signed);
  assert.equal(link.resolveMediaLink(token.replace(/\.(.)/, ".X"), env), null, "signature altérée");
  assert.equal(link.resolveMediaLink(token, env, Date.now() + 3600_000), null, "échéance dépassée");
  assert.equal(link.publicMediaLink("https://evil.example/a.jpg", "https://os.code-v.fr", 600, env), null, "autre hôte refusé");
  assert.equal(link.publicMediaLink(signed, "https://os.code-v.fr", 600, {}), null, "sans clé : aucun lien");
});
