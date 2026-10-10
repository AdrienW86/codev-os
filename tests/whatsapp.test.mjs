import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { loadTs } from "./helpers/load-ts.mjs";
const require = createRequire(import.meta.url);
const payload = loadTs("lib/whatsapp/payload.ts");
const fixture = () => ({ object: "whatsapp_business_account", entry: [{ id: "123", changes: [{ field: "messages", value: { metadata: { phone_number_id: "456" }, messages: [{ id: "wamid.HBgMPhoto/Example+==", from: "33612345678", timestamp: "1791626400", type: "image", image: { id: "789", mime_type: "image/jpeg" }, text: { body: "private" } }] } }] }] });
test("WhatsApp signature covers exact raw bytes, rejects missing, malformed and altered signatures", () => {
  const bytes = Buffer.from(JSON.stringify(fixture()));
  const signature = "sha256=" + createHmac("sha256", "dummy-secret").update(bytes).digest("hex");
  assert.equal(payload.validSignature(bytes, signature, "dummy-secret"), true);
  assert.equal(payload.validSignature(Buffer.concat([bytes, Buffer.from(" ")]), signature, "dummy-secret"), false);
  for (const value of [null, "sha256=no", "sha256=" + "0".repeat(64), signature]) assert.equal(payload.validSignature(bytes, value, "wrong-secret"), false);
});
test("WhatsApp isolates WABA and phone, discards conversation contents and other message types", () => {
  const value = fixture();
  value.entry[0].changes[0].value.messages.push({ type: "text", text: { body: "private" } });
  const images = payload.incomingImages(value, "123", "456");
  assert.equal(images.length, 1);
  assert.equal(images[0].media_id, "789");
  assert.equal(JSON.stringify(images).includes("private"), false);
  assert.equal(payload.incomingImages(value, "other", "456").length, 0);
  assert.equal(payload.incomingImages(value, "123", "other").length, 0);
});
test("invalid image prevents silent acknowledgement; international phones and folders are strict", () => {
  const value = fixture(); value.entry[0].changes[0].value.messages[0].from = "123";
  assert.throws(() => payload.incomingImages(value, "123", "456"));
  assert.equal(payload.folderSchema.safeParse("folder' or true").success, false);
  assert.equal(payload.phoneSchema.safeParse("33612345678").success, true);
});
test("stream limit works without content-length", async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(6)); c.close(); } });
  await assert.rejects(() => payload.boundedBytes({ body: stream }, 5), /body_too_large/);
});
function route(env, service = {}) {
  return loadTs("app/api/webhooks/whatsapp/route.ts", { "next/server": { after: () => {} }, "@/lib/whatsapp/payload": payload, "@/lib/whatsapp/service": { ingestionEnabled: () => true, enqueueImages: async () => {}, ...service } }, { Response, process: { env } });
}
const env = { WHATSAPP_APP_SECRET: "dummy-secret", WHATSAPP_VERIFY_TOKEN: "verify", WHATSAPP_PHONE_NUMBER_ID: "456", WHATSAPP_BUSINESS_ACCOUNT_ID: "123" };
test("webhook verification succeeds only with matching token and mode", async () => {
  const r = route(env);
  assert.equal(await (await r.GET(new Request("https://example.test/?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=123"))).text(), "123");
  assert.equal((await r.GET(new Request("https://example.test/?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123"))).status, 403);
});
test("webhook only acknowledges durable enqueue, returns retryable failure on unavailable DB", async () => {
  const body = JSON.stringify(fixture());
  const signature = "sha256=" + createHmac("sha256", env.WHATSAPP_APP_SECRET).update(body).digest("hex");
  const request = () => new Request("https://example.test/api/webhooks/whatsapp", { method: "POST", body, headers: { "x-hub-signature-256": signature } });
  let captured;
  assert.equal((await route(env, { enqueueImages: async images => { captured = images; } }).POST(request())).status, 200);
  assert.equal(captured.length, 1);
  assert.equal((await route(env, { enqueueImages: async () => { throw Error("database private details"); } }).POST(request())).status, 503);
  assert.equal((await route(env).POST(new Request("https://example.test", { method: "POST", body }))).status, 401);
  assert.equal((await route(env, { ingestionEnabled: () => false }).POST(request())).status, 503);
});
const makeProviders = (fetchImpl) => loadTs("lib/whatsapp/providers.ts", { "./payload": payload, sharp: { default: require("sharp") } }, { fetch: fetchImpl, Response, Blob, process: { env: { WHATSAPP_ACCESS_TOKEN: "dummy-access-token", WHATSAPP_PHONE_NUMBER_ID: "456" } } });
test("media download validates byte hash and actual image format", async () => {
  const bytes = await require("sharp")({ create: { width: 5, height: 5, channels: 3, background: "red" } }).jpeg().toBuffer();
  let calls = 0;
  const p = makeProviders(async url => {
    calls++;
    if (String(url).includes("graph.facebook.com")) return Response.json({ id: "789", url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/test", mime_type: "image/jpeg", file_size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    return new Response(bytes);
  });
  const result = await p.downloadWhatsApp("789");
  assert.equal(result.mime, "image/jpeg"); assert.equal(result.bytes.length, bytes.length); assert.equal(calls, 2);
});
test("media URLs cannot exfiltrate authorization to another host", async () => {
  let calls = 0;
  const p = makeProviders(async () => { calls++; return Response.json({ id: "789", url: "https://evil.test/image", mime_type: "image/jpeg", file_size: 1, sha256: "0".repeat(64) }); });
  await assert.rejects(() => p.downloadWhatsApp("789"), /media_host/); assert.equal(calls, 1);
});
test("existing Drive file is reused only with same parent and checksum", async () => {
  const p = makeProviders(async () => Response.json({ id: "drive_file_id_1", parents: ["folder_client_1"], md5Checksum: "a".repeat(32), trashed: false }));
  assert.equal(await p.driveFileMatches("dummy-token", "drive_file_id_1", "folder_client_1", "a".repeat(32)), true);
  await assert.rejects(() => p.driveFileMatches("dummy-token", "drive_file_id_1", "other_client_2", "a".repeat(32)), /drive_file_conflict/);
  await assert.rejects(() => p.driveFileMatches("dummy-token", "drive_file_id_1", "folder_client_1", "b".repeat(32)), /drive_file_conflict/);
});
test("replay after upload timeout reuses reserved Drive ID without another upload", async () => {
  let calls = 0;
  const p = makeProviders(async () => { calls++; return Response.json({ id: "drive_file_id_1", parents: ["folder_client_1"], md5Checksum: "a".repeat(32), trashed: false }); });
  assert.equal(await p.uploadDrive("dummy-token", "drive_file_id_1", "folder_client_1", { bytes: new Uint8Array(1), mime: "image/jpeg", sha256: "b".repeat(64), md5: "a".repeat(32) }), "existing");
  assert.equal(calls, 1);
});
test("resumable Drive upload validates Location before sending credentials", async () => {
  let calls = 0;
  const p = makeProviders(async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 404 });
    if (calls === 2) return Response.json({ id: "folder_client_1", mimeType: "application/vnd.google-apps.folder", capabilities: { canAddChildren: true } });
    return new Response(null, { status: 200, headers: { location: "https://evil.test/upload/drive/" } });
  });
  await assert.rejects(() => p.uploadDrive("dummy-token", "drive_file_id_1", "folder_client_1", { bytes: new Uint8Array(1), mime: "image/jpeg", sha256: "b".repeat(64), md5: "a".repeat(32) }), /drive_upload_host/);
  assert.equal(calls, 3);
});

function workerHarness({ failUpload = false, failAuditOnce = false, denyLease = false } = {}) {
  const job = { id: "job", sender: "33612345678", media_id: "789", client_id: "client-a", drive_folder_id: "folder_client_a", attempts: 1 };
  const state = { asset: null, uploaded: false, updates: [], audits: [], proposed: 0, failAuditOnce };
  const db = {
    rpc: async () => ({ data: [{ ...job }], error: null }),
    from: table => {
      let operation, values; const filters = {};
      const query = {
        upsert: v => { operation = "upsert"; values = v; return query; },
        select: () => query,
        update: v => { operation = "update"; values = v; return query; },
        eq: (key, value) => { filters[key] = value; return query; },
        single: () => query,
        then: (resolve, reject) => Promise.resolve().then(() => {
          if (table === "whatsapp_assets") {
            if (operation === "upsert") state.asset ??= { ...values };
            if (filters.client_id) assert.equal(filters.client_id, "client-a");
            if (filters.drive_folder_id) assert.equal(filters.drive_folder_id, "folder_client_a");
            return { data: state.asset, error: null };
          }
          assert.equal(filters.lease, "lease-1");
          if (!denyLease) state.updates.push(values);
          return { data: denyLease ? [] : [{ id: job.id }], error: null };
        }).then(resolve, reject),
      };
      return query;
    },
  };
  const providers = {
    newLease: () => "lease-1",
    downloadWhatsApp: async () => ({ bytes: new Uint8Array(1), mime: "image/jpeg", sha256: "a".repeat(64), md5: "b".repeat(32) }),
    importDriveToken: async () => "dummy-token",
    generateDriveId: async () => `drive_file_${++state.proposed}`,
    uploadDrive: async (_token, id, folder) => {
      assert.equal(folder, "folder_client_a");
      assert.equal(id, state.asset.drive_file_id);
      if (failUpload) throw new providers.ImportFailure("provider_unavailable");
      const previous = state.uploaded; state.uploaded = true;
      return previous ? "existing" : "created";
    },
    ImportFailure: class extends Error { constructor(code) { super(code); this.code = code; } },
  };
  const service = loadTs("lib/whatsapp/service.ts", {
    "./providers": providers,
    "@/lib/supabase/server": { getSupabaseServerClient: () => db },
    "@/lib/core/audit": { writeAudit: async (_actor, entry) => { if (state.failAuditOnce) { state.failAuditOnce = false; throw Error("audit_down"); } state.audits.push(entry); } },
  }, { process: { env: { WHATSAPP_INGESTION_ENABLED: "true" } } });
  return { service, state, job };
}
test("worker reserves exact hash per client and folder and imports using stable ID", async () => {
  const h = workerHarness();
  assert.equal(await h.service.processOneImage({ kind: "system", worker: "test" }), "imported");
  assert.equal(h.state.asset.client_id, "client-a");
  assert.equal(h.state.updates[0].status, "imported");
  assert.equal(h.state.updates[0].drive_file_id, "drive_file_1");
  assert.equal(h.state.audits[0].action, "whatsapp.imported");
  assert.equal(await h.service.processOneImage({ kind: "system", worker: "test" }), "duplicate");
  assert.equal(h.state.asset.drive_file_id, "drive_file_1");
});
test("upload success followed by audit failure is safely reconciled on retry", async () => {
  const h = workerHarness({ failAuditOnce: true });
  assert.equal(await h.service.processOneImage({ kind: "system", worker: "test" }), "retry");
  assert.equal(h.state.updates[0].status, "pending");
  assert.equal(await h.service.processOneImage({ kind: "system", worker: "test" }), "duplicate");
  assert.equal(h.state.asset.drive_file_id, "drive_file_1");
});
test("provider outage retries with bounded attempt limit and safe code", async () => {
  const h = workerHarness({ failUpload: true });
  assert.equal(await h.service.processOneImage({ kind: "system", worker: "test" }), "retry");
  assert.equal(h.state.updates[0].error_code, "provider_unavailable");
  assert.ok(new Date(h.state.updates[0].retry_at).getTime() > Date.now());
  h.job.attempts = 5;
  await h.service.processOneImage({ kind: "system", worker: "test" });
  assert.equal(h.state.updates[1].status, "failed");
});
test("stale worker cannot complete or modify a replacement lease", async () => {
  const h = workerHarness({ denyLease: true });
  assert.equal(await h.service.processOneImage({ kind: "system", worker: "test" }), "retry");
  assert.equal(h.state.updates.length, 0);
});
test("WhatsApp actions authenticate before DB or providers; simulation never writes", async () => {
  let calls = 0;
  const load = (deny, simulate) => loadTs("app/(cockpit)/settings/whatsapp/actions.ts", {
    "next/cache": { revalidatePath: () => {} },
    "@/lib/require-admin": { requireAdmin: async () => { if (deny) throw Error("denied"); return { userId: "admin" }; } },
    "@/lib/simulation/server": { getActiveScenario: async () => simulate ? {} : null },
    "@/lib/supabase/server": { getSupabaseServerClient: () => { calls++; throw Error("unexpected DB"); } },
    "@/lib/core/audit": { writeAudit: () => { calls++; } },
    "@/lib/whatsapp/payload": payload,
    "@/lib/whatsapp/providers": {},
    "@/lib/whatsapp/service": { processOneImage: () => { calls++; } },
  });
  for (const name of ["saveSender", "retryImport", "createFolder", "runImport"]) {
    const args = name === "runImport" ? [] : [{}, new FormData()];
    await assert.rejects(() => load(true, false)[name](...args), /denied/);
    assert.match((await load(false, true)[name](...args)).message, /simulation/i);
  }
  assert.equal(calls, 0);
});
test("scheduled worker verifies CRON_SECRET before touching the queue", async () => {
  let calls = 0;
  const r = loadTs("app/api/internal/whatsapp/process/route.ts", { "@/lib/whatsapp/service": { processImageBatch: async () => { calls++; return { processed: 1, status: "idle" }; } } }, { Response, process: { env: { CRON_SECRET: "dummy-cron" } } });
  for (const authorization of [null, "Bearer wrong", "Bearer "]) {
    const response = await r.POST(new Request("https://example.test", { method: "POST", headers: authorization ? { authorization } : {} }));
    assert.equal(response.status, 401);
  }
  assert.equal(calls, 0);
  const response = await r.GET(new Request("https://example.test", { headers: { authorization: "Bearer dummy-cron" } }));
  assert.equal(response.status, 200); assert.equal(calls, 1);
});
test("Drive import refuses a read-only token and overly broad Drive scopes", async () => {
  const credentials = { GOOGLE_DRIVE_IMPORT_CLIENT_ID: "dummy-client-id", GOOGLE_DRIVE_IMPORT_CLIENT_SECRET: "dummy-client-secret", GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN: "dummy-refresh-token" };
  for (const scope of ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive"]) {
    const p = loadTs("lib/whatsapp/providers.ts", { "./payload": payload, sharp: { default: require("sharp") } }, { Response, Blob, process: { env: credentials }, fetch: async () => Response.json({ access_token: "dummy-access-token", token_type: "Bearer", scope }) });
    await assert.rejects(() => p.importDriveToken(), /drive_scope/);
  }
});
