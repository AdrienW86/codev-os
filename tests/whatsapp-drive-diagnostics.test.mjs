import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { loadTs } from "./helpers/load-ts.mjs";
const require = createRequire(import.meta.url);
const payload = loadTs("lib/whatsapp/payload.ts");
const errors = loadTs("lib/whatsapp/drive-errors.ts");
const SECRET = "dummy-secret-value-123";
const credentials = { GOOGLE_DRIVE_IMPORT_CLIENT_ID: "123-abc.apps.googleusercontent.com", GOOGLE_DRIVE_IMPORT_CLIENT_SECRET: SECRET, GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN: "1//dummy-refresh-token" };
const providers = (env, fetchImpl = async () => { throw Error("unexpected network"); }) => loadTs("lib/whatsapp/providers.ts", { "./payload": payload, "./drive-errors": errors, sharp: { default: require("sharp") } }, { fetch: fetchImpl, Response, Blob, process: { env } });
const token = (scope = "https://www.googleapis.com/auth/drive.file") => Response.json({ access_token: "ya29.dummy-access-token", token_type: "Bearer", expires_in: 3599, scope });
const failure = async promise => { try { await promise; } catch (error) { return error; } assert.fail("expected a failure"); };

test("OAuth errors map to closed codes from Google's error field only", () => {
  assert.equal(errors.oauthErrorCode(400, { error: "invalid_grant", error_description: `Token has been expired or revoked ${SECRET}` }), "oauth_invalid_grant");
  assert.equal(errors.oauthErrorCode(401, { error: "invalid_client" }), "oauth_invalid_client");
  assert.equal(errors.oauthErrorCode(400, { error: "unauthorized_client" }), "oauth_unauthorized_client");
  assert.equal(errors.oauthErrorCode(401, null), "oauth_invalid_client");
  assert.equal(errors.oauthErrorCode(400, { error: "something_new" }), "oauth_rejected");
  assert.equal(errors.oauthErrorCode(400, { error: "__proto__" }), "oauth_rejected");
  assert.equal(errors.oauthErrorCode(503, { error: "invalid_grant" }), "provider_unavailable");
});
test("Drive API errors map known reasons, including a disabled API", () => {
  const drive = (status, reason, where = "errors") => errors.driveErrorCode(status, { error: { code: status, message: `details ${SECRET}`, [where]: [{ reason }] } });
  assert.equal(drive(403, "accessNotConfigured"), "drive_api_disabled");
  assert.equal(drive(403, "SERVICE_DISABLED", "details"), "drive_api_disabled");
  assert.equal(drive(403, "insufficientPermissions"), "drive_permission");
  assert.equal(drive(403, "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "details"), "drive_scope_missing");
  assert.equal(drive(403, "userRateLimitExceeded"), "drive_rate_limited");
  assert.equal(drive(403, "storageQuotaExceeded"), "drive_storage_quota");
  assert.equal(errors.driveErrorCode(404, null), "drive_not_found");
  assert.equal(errors.driveErrorCode(429, null), "drive_rate_limited");
  assert.equal(errors.driveErrorCode(502, null), "provider_unavailable");
  assert.equal(errors.driveErrorCode(400, { error: "bad" }), "drive_rejected");
});
test("every code has its own message; variable names may appear, values never", () => {
  const messages = errors.driveErrorCodes.map(code => errors.driveErrorMessage(code));
  assert.equal(new Set(messages).size, messages.length);
  assert.match(errors.driveErrorMessage("config_missing", "GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN"), /Variable GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN absente.*redéployez/);
  assert.equal(errors.driveErrorMessage("not-a-code"), errors.driveErrorMessage("unexpected"));
});

test("missing, blank or malformed credentials are reported by variable name before any network call", async () => {
  let calls = 0;
  const count = async () => { calls++; return token(); };
  for (const [name, value, code] of [["GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN", undefined, "config_missing"], ["GOOGLE_DRIVE_IMPORT_CLIENT_SECRET", "   ", "config_missing"], ["GOOGLE_DRIVE_IMPORT_CLIENT_ID", "not-a-google-client", "config_invalid"], ["GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN", "has space inside token", "config_invalid"]]) {
    const error = await failure(providers({ ...credentials, [name]: value }, count).importDriveToken());
    assert.equal(error.code, code); assert.equal(error.context.variable, name);
  }
  assert.equal(calls, 0);
});
test("surrounding whitespace or newline pasted in Vercel is tolerated", async () => {
  let body;
  const p = providers({ ...credentials, GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN: ` ${credentials.GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN}\n` }, async (_url, init) => { body = String(init.body); return token(); });
  assert.equal(await p.importDriveToken(), "ya29.dummy-access-token");
  assert.match(body, /refresh_token=1%2F%2Fdummy-refresh-token&/);
});
test("token exchange failures keep only the code and HTTP status", async () => {
  for (const [status, body, code] of [[400, { error: "invalid_grant", error_description: SECRET }, "oauth_invalid_grant"], [401, { error: "invalid_client" }, "oauth_invalid_client"], [500, "<html>", "provider_unavailable"]]) {
    const error = await failure(providers(credentials, async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })).importDriveToken());
    assert.equal(error.code, code); assert.equal(error.context.stage, "oauth"); assert.equal(error.context.status, status);
    assert.equal(JSON.stringify({ message: error.message, context: error.context }).includes(SECRET), false);
  }
  assert.equal((await failure(providers(credentials, async () => { throw Error(SECRET); }).importDriveToken())).code, "provider_unavailable");
  assert.equal((await failure(providers(credentials, async () => Response.json({ token_type: "Bearer" })).importDriveToken())).code, "provider_response");
});
test("scope problems are distinguished: missing drive.file or broader Drive access", async () => {
  assert.equal((await failure(providers(credentials, async () => token("openid email")).importDriveToken())).code, "drive_scope_missing");
  assert.equal((await failure(providers(credentials, async () => token("https://www.googleapis.com/auth/drive.readonly")).importDriveToken())).code, "drive_scope_too_broad");
  assert.equal((await failure(providers(credentials, async () => token("https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive")).importDriveToken())).code, "drive_scope_too_broad");
  assert.equal(await providers(credentials, async () => token("openid https://www.googleapis.com/auth/drive.file")).importDriveToken(), "ya29.dummy-access-token");
});
test("folder creation reports a disabled Drive API, a refused creation and an unconfirmed id", async () => {
  const drive = second => providers(credentials, async url => String(url).includes("generateIds") ? Response.json({ ids: ["generated_folder_id_1"] }) : second());
  assert.equal((await failure(providers(credentials, async () => Response.json({ error: { code: 403, errors: [{ reason: "accessNotConfigured" }] } }, { status: 403 })).createImportFolder("dummy-token", "Client"))).code, "drive_api_disabled");
  assert.equal((await failure(drive(() => Response.json({ error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } }, { status: 403 })).createImportFolder("dummy-token", "Client"))).code, "drive_permission");
  assert.equal((await failure(drive(() => Response.json({ id: "another_folder_id_2" })).createImportFolder("dummy-token", "Client"))).code, "drive_folder_create");
  assert.equal(await drive(() => Response.json({ id: "generated_folder_id_1" })).createImportFolder("dummy-token", "Client"), "generated_folder_id_1");
});

function folderAction({ audit = async () => {}, token: tokenImpl, create = async () => "generated_folder_id_1", client = { id: "00000000-0000-4000-8000-000000000001", name: "Client" } } = {}) {
  const p = providers(credentials);
  const logs = [], calls = { drive: 0 };
  const quiet = { ...console, error: (...args) => logs.push(args.join(" ")) };
  const actions = loadTs("app/(cockpit)/settings/whatsapp/actions.ts", {
    "next/cache": { revalidatePath: () => {} },
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: "user_admin" }) },
    "@/lib/simulation/server": { getActiveScenario: async () => null },
    "@/lib/supabase/server": { getSupabaseServerClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: client, error: null }) }) }) }) }) },
    "@/lib/core/audit": { writeAudit: audit },
    "@/lib/whatsapp/payload": payload,
    "@/lib/whatsapp/providers": { ImportFailure: p.ImportFailure, importDriveToken: async () => { calls.drive++; return tokenImpl ? tokenImpl(p.ImportFailure) : "dummy-token"; }, createImportFolder: async () => { calls.drive++; return create(p.ImportFailure); }, checkFolder: async () => {} },
    "@/lib/whatsapp/drive-errors": loadTs("lib/whatsapp/drive-errors.ts", {}, { console: quiet }),
    "@/lib/whatsapp/service": {},
  }, { console: quiet });
  const form = new FormData(); form.set("client_id", "00000000-0000-4000-8000-000000000001");
  return { run: () => actions.createFolder({}, form), logs, calls };
}
test("createFolder shows a distinct message per cause and logs a structured, secret-free line", async () => {
  const cases = [
    [Failure => { throw new Failure("config_missing", { stage: "config", variable: "GOOGLE_DRIVE_IMPORT_CLIENT_SECRET" }); }, "config_missing", /GOOGLE_DRIVE_IMPORT_CLIENT_SECRET absente/],
    [Failure => { throw new Failure("oauth_invalid_grant", { stage: "oauth", status: 400 }); }, "oauth_invalid_grant", /invalid_grant/],
    [Failure => { throw new Failure("oauth_invalid_client", { stage: "oauth", status: 401 }); }, "oauth_invalid_client", /invalid_client/],
    [Failure => { throw new Failure("drive_scope_missing", { stage: "oauth" }); }, "drive_scope_missing", /drive\.file/],
    [() => { throw Error(`boom ${SECRET}`); }, "unexpected", /journaux Vercel/],
  ];
  for (const [tokenImpl, code, message] of cases) {
    const h = folderAction({ token: tokenImpl });
    const state = await h.run();
    assert.equal(state.code, code); assert.match(state.message, message); assert.equal(state.ok, undefined);
    assert.equal(h.logs.length, 1);
    const line = JSON.parse(h.logs[0].replace("[whatsapp-drive] ", ""));
    assert.equal(line.action, "whatsapp.folder.create"); assert.equal(line.code, code);
    assert.equal(h.logs[0].includes(SECRET) || state.message.includes(SECRET), false);
  }
  const api = folderAction({ create: Failure => { throw new Failure("drive_api_disabled", { stage: "drive", status: 403 }); } });
  assert.match((await api.run()).message, /Google Drive API/);
  assert.match(api.logs[0], /"status":403/);
});
test("audit failure stops before any Drive call; a missing client is reported plainly", async () => {
  const audit = folderAction({ audit: async () => { throw Error("audit down"); } });
  assert.equal((await audit.run()).code, "audit_unavailable"); assert.equal(audit.calls.drive, 0);
  const missing = folderAction({ client: null });
  assert.equal((await missing.run()).code, "client_not_found"); assert.equal(missing.calls.drive, 0);
  const ok = folderAction();
  const state = await ok.run();
  assert.equal(state.ok, true); assert.match(state.message, /generated_folder_id_1/); assert.equal(ok.logs.length, 0);
});
