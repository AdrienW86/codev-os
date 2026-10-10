// Tests SIMULÉS de la transcription vocale : aucun appel réseau, fetch remplacé par un double.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const errors = loadTs("lib/providers/errors.ts");
const api = loadTs("lib/providers/api.ts", { "@/lib/providers/errors": errors });
const audio = loadTs("lib/voice/audio.ts");
const stt = loadTs("lib/voice/stt.ts", { "@/lib/providers/api": api, "@/lib/providers/errors": errors, "@/lib/voice/audio": audio }, { FormData, Blob });
const plain = (value) => JSON.parse(JSON.stringify(value));
const webmBytes = () => { const bytes = new Uint8Array(4000); bytes.set([0x1a, 0x45, 0xdf, 0xa3]); return bytes; };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

test("browser MIME types map to extensions OpenAI accepts; unsupported types are refused", () => {
  assert.deepEqual(plain(audio.audioFormatOf("audio/webm;codecs=opus")), { mime: "audio/webm", extension: "webm", container: "webm" });
  assert.equal(audio.audioFormatOf("audio/x-wav").extension, "wav", "was sent as .x-wav before the fix");
  assert.equal(audio.audioFormatOf("audio/mpeg").extension, "mp3");
  assert.equal(audio.audioFormatOf("audio/mp4").extension, "mp4");
  assert.equal(audio.audioFormatOf("audio/ogg;codecs=opus").extension, "ogg");
  assert.equal(audio.audioFormatOf("audio/aac"), null, ".aac is not accepted by OpenAI");
  assert.equal(audio.audioFormatOf("text/plain"), null);
  assert.ok(!audio.ACCEPTED_AUDIO.includes("audio/aac"));
});

test("real container is detected from the first bytes", () => {
  const sniff = (...bytes) => audio.sniffContainer(Uint8Array.from([...bytes, ...new Array(16).fill(0)]));
  assert.equal(sniff(0x1a, 0x45, 0xdf, 0xa3), "webm");
  assert.equal(sniff(0x4f, 0x67, 0x67, 0x53), "ogg");
  assert.equal(sniff(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45), "wav");
  assert.equal(sniff(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70), "mp4");
  assert.equal(sniff(0x49, 0x44, 0x33), "mp3");
  assert.equal(sniff(0x00, 0x01), null);
});

test("multipart sent to OpenAI: ASCII file name with a supported extension, model, language, JSON format", async () => {
  let captured;
  const fetchImpl = async (url, init) => { captured = { url: String(url), init }; return json(200, { text: " Bonjour " }); };
  const provider = stt.createOpenAISpeechToText("sk-test", "whisper-1", fetchImpl);
  assert.equal(await provider.transcribe(new Blob([webmBytes()], { type: "audio/webm;codecs=opus" })), "Bonjour");
  assert.equal(captured.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["Content-Type"], undefined, "fetch sets the multipart boundary itself");
  const file = captured.init.body.get("file");
  assert.equal(file.name, "dictation.webm");
  assert.match(file.name, /^[\x20-\x7e]+$/, "ASCII only (was « dictée.webm »)");
  assert.equal(file.type, "audio/webm");
  assert.equal(file.size, 4000);
  assert.equal(captured.init.body.get("model"), "whisper-1");
  assert.equal(captured.init.body.get("language"), "fr");
  assert.equal(captured.init.body.get("response_format"), "json");
  const wav = stt.createOpenAISpeechToText("sk-test", "whisper-1", async (_u, init) => { captured = init; return json(200, { text: "ok" }); });
  await wav.transcribe(new Blob([webmBytes()], { type: "audio/x-wav" }));
  assert.equal(captured.body.get("file").name, "dictation.wav");
});

test("unsupported audio type is refused before any network call; ping costs nothing", async () => {
  let calls = 0;
  const provider = stt.createOpenAISpeechToText("sk-test", "gpt-4o-mini-transcribe", async (url, init) => { calls++; return json(200, { id: "gpt-4o-mini-transcribe", url: String(url), method: init.method }); });
  await assert.rejects(() => provider.transcribe(new Blob([webmBytes()], { type: "audio/aac" })), (error) => error.code === "unsupported_audio_type");
  assert.equal(calls, 0);
  await provider.ping();
  assert.equal(calls, 1);
});

test("provider failures keep status + code and map to a useful French reason", async () => {
  const failing = (status, body) => stt.createOpenAISpeechToText("sk-test", "whisper-1", async () => json(status, body)).transcribe(new Blob([webmBytes()], { type: "audio/webm" })).then(() => null, (error) => error);
  const cases = [
    [429, { error: { code: "insufficient_quota", message: "quota sk-secret" } }, "quota", /Quota OpenAI épuisé/],
    [401, { error: { code: "invalid_api_key" } }, "unauthorized", /Clé OpenAI invalide \(invalid_api_key\)/],
    [404, { error: { code: "model_not_found" } }, "model", /« whisper-1 » introuvable/],
    [400, { error: { code: "invalid_value", message: "Invalid file format" } }, "rejected", /refusé par OpenAI \(invalid_value\)/],
    [503, {}, "unavailable", /indisponible \(HTTP 503\)/],
  ];
  for (const [status, body, reason, message] of cases) {
    const error = await failing(status, body);
    assert.equal(error.status, status);
    const mapped = stt.sttFailureReason(error, "whisper-1");
    assert.equal(mapped.reason, reason);
    assert.match(mapped.message, message);
    assert.doesNotMatch(JSON.stringify({ error, mapped }), /sk-secret|Invalid file format/, "no raw provider message");
  }
  assert.equal(stt.sttFailureReason(new errors.ProviderError("openai", "timeout"), "whisper-1").reason, "timeout");
});

function loadRoute(provider, env = {}) {
  const logs = [];
  const log = (level) => (...args) => logs.push([level, ...args.map((value) => JSON.parse(JSON.stringify(value)))]);
  const route = loadTs("app/api/assistant/transcribe/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: "user_admin" }) },
    "@/lib/simulation/server": { getActiveScenario: async () => env.simulation ?? null },
    "@/lib/core/request-guard": { checkSameOrigin: () => ({ ok: true }), createRateLimiter: () => () => true },
    "@/lib/voice/stt": { selectSpeechToText: () => provider, sttFailureReason: stt.sttFailureReason },
    "@/lib/voice/audio": audio,
  }, { console: { info: log("info"), warn: log("warn"), error: log("error") }, Blob, Response, Request });
  return { route, logs };
}
const audioRequest = (type, bytes = webmBytes()) => new Request("https://os.code-v.fr/api/assistant/transcribe", { method: "POST", headers: { "content-type": type, origin: "https://os.code-v.fr" }, body: bytes });

test("route: failure → 502 with a reason; logs carry model, MIME, container, size, status, code — never key, audio or transcript", async () => {
  const provider = { model: "whisper-1", transcribe: async () => { throw new errors.ProviderError("openai", "rate_limited", 429, "insufficient_quota"); } };
  const { route, logs } = loadRoute(provider);
  const response = await route.POST(audioRequest("audio/webm;codecs=opus"));
  assert.equal(response.status, 502);
  assert.deepEqual(plain(response.body), { error: "stt_failed", reason: "quota", message: "Quota OpenAI épuisé : vérifiez la facturation du compte OpenAI." });
  const [level, message, details] = logs.at(-1);
  assert.equal(level, "error");
  assert.equal(message, "[voice] Transcription en échec");
  assert.deepEqual({ ...details, ms: 0 }, { model: "whisper-1", mime: "audio/webm", container: "webm", size: 4000, kind: "rate_limited", status: 429, code: "insufficient_quota", type: null, scopes: null, ms: 0 });
  assert.doesNotMatch(JSON.stringify(logs), /sk-|Bearer|Authorization/i);
});

test("route: success logs no transcript; mislabelled audio is sent with its real container type", async () => {
  let receivedType;
  const provider = { model: "whisper-1", transcribe: async (blob) => { receivedType = blob.type; return "Crée une tâche secrète"; } };
  const { route, logs } = loadRoute(provider);
  const response = await route.POST(audioRequest("audio/mp4"));
  assert.equal(response.status, 200);
  assert.equal(response.body.text, "Crée une tâche secrète");
  assert.equal(receivedType, "audio/webm", "declared mp4, real webm");
  assert.equal(logs.at(-1)[1], "[voice] Transcription réussie");
  assert.doesNotMatch(JSON.stringify(logs), /tâche secrète/);
  const timeout = loadRoute({ model: "whisper-1", transcribe: async () => { throw new errors.ProviderError("openai", "timeout"); } });
  assert.equal((await timeout.route.POST(audioRequest("audio/webm"))).status, 504);
});

test("route: unsupported type, tiny audio, missing provider and simulation are refused cleanly", async () => {
  const provider = { model: "whisper-1", transcribe: async () => "x" };
  const refused = await loadRoute(provider).route.POST(audioRequest("audio/aac"));
  assert.equal(refused.status, 415);
  assert.match(refused.body.message, /audio\/aac/);
  assert.equal((await loadRoute(provider).route.POST(audioRequest("audio/webm", new Uint8Array(10)))).body.error, "no_speech");
  assert.equal((await loadRoute(null).route.POST(audioRequest("audio/webm"))).status, 503);
  assert.equal((await loadRoute(provider, { simulation: { id: "x" } }).route.POST(audioRequest("audio/webm"))).status, 409);
});

// Corps renvoyé par OpenAI pour une clé reconnue mais sans la permission d'appeler le modèle (code: null).
const missingScopeBody = { error: { message: "You have insufficient permissions for this operation. Missing scopes: api.model.audio.request. Check that you have the correct role in your organization (Reader, Writer, Owner) and project (Member, Owner), and if you're using a restricted API key, that it has the necessary scopes.", type: "invalid_request_error", param: null, code: null } };

test("401 permission refusal: missing scope and type are extracted, never the free-text message", () => {
  assert.deepEqual(plain(errors.errorDetailsFromBody(JSON.stringify(missingScopeBody))), { code: "missing_scope", type: "invalid_request_error", scopes: ["api.model.audio.request"] });
  assert.deepEqual(plain(errors.errorDetailsFromBody(JSON.stringify({ error: { message: "Incorrect API key provided: sk-abc***", type: "invalid_request_error", code: "invalid_api_key" } }))), { code: "invalid_api_key", type: "invalid_request_error", scopes: [] });
  assert.deepEqual(plain(errors.errorDetailsFromBody(JSON.stringify({ error: { message: "Missing scopes: <script>, ../etc", type: "x" } }))).scopes, [], "only dotted identifiers are kept");
});

test("transcription 401: a missing permission is NOT reported as an invalid key", async () => {
  const fail = (status, body) => stt.createOpenAISpeechToText("sk-test", "whisper-1", async () => json(status, body)).transcribe(new Blob([webmBytes()], { type: "audio/webm" })).then(() => null, (error) => error);
  const scope = await fail(401, missingScopeBody);
  assert.equal(scope.status, 401);
  assert.equal(scope.code, "missing_scope");
  assert.deepEqual(plain(scope.scopes), ["api.model.audio.request"]);
  const mapped = stt.sttFailureReason(scope, "whisper-1");
  assert.equal(mapped.reason, "permission");
  assert.match(mapped.message, /acceptée mais sans la permission.*api\.model\.audio\.request/);
  assert.doesNotMatch(mapped.message, /invalide/);
  const typeOnly = stt.sttFailureReason(await fail(401, { error: { type: "invalid_request_error", code: null, message: "nope" } }), "whisper-1");
  assert.equal(typeOnly.reason, "permission");
  assert.match(typeOnly.message, /refuse cette opération.*HTTP 401, invalid_request_error/);
  assert.match(stt.sttFailureReason(await fail(401, { error: { code: "invalid_api_key" } }), "whisper-1").message, /Clé OpenAI invalide/);
});

test("connection test and transcription send the SAME Authorization header (same variable, same construction)", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url: String(url), auth: new Headers(init.headers).get("authorization") }); return json(200, { text: "ok" }); };
  const provider = stt.createOpenAISpeechToText("sk-same-key", "whisper-1", fetchImpl);
  await provider.ping();
  await provider.transcribe(new Blob([webmBytes()], { type: "audio/webm" }));
  assert.deepEqual(seen.map((call) => call.url), ["https://api.openai.com/v1/models/whisper-1", "https://api.openai.com/v1/audio/transcriptions"]);
  assert.equal(seen[0].auth, "Bearer sk-same-key");
  assert.equal(seen[1].auth, seen[0].auth);
  assert.equal(stt.selectSpeechToText({ OPENAI_API_KEY: "  sk-same-key \n" }, fetchImpl) !== null, true, "same variable, trimmed like the assistant");
});

test("route logs the provider type and missing scope, never the key", async () => {
  const provider = { model: "whisper-1", transcribe: async () => { throw new errors.ProviderError("openai", "unauthorized", 401, "missing_scope", { type: "invalid_request_error", scopes: ["api.model.audio.request"] }); } };
  const { route, logs } = loadRoute(provider);
  const response = await route.POST(audioRequest("audio/webm"));
  assert.equal(response.status, 502);
  assert.equal(response.body.reason, "permission");
  const details = logs.at(-1)[2];
  assert.equal(details.status, 401);
  assert.equal(details.code, "missing_scope");
  assert.equal(details.type, "invalid_request_error");
  assert.equal(details.scopes, "api.model.audio.request");
  assert.doesNotMatch(JSON.stringify(logs), /sk-|Bearer|Authorization/i);
});

test("diagnostic runs the same requests as real usage: a completion and a transcription of 1 s of silence", async () => {
  assert.equal(audio.sniffContainer(audio.silentWav().slice(0, 16)), "wav");
  assert.equal(audio.silentWav().byteLength, 44 + 32_000);
  const calls = [];
  const logs = [];
  const make = (sttError) => loadTs("lib/ai/diagnostics.ts", {
    "@/lib/ai/providers": { selectAIProvider: () => ({ id: "openai", model: "gpt-4.1-mini", ping: async () => calls.push("ping"), complete: async (input) => { calls.push(`complete:${input.tools.length}`); return { text: "OK", toolCalls: [] }; } }) },
    "@/lib/assistant/orchestrator": { providerFailureReason: () => "x" },
    "@/lib/voice/stt": { selectSpeechToText: () => ({ model: "whisper-1", ping: async () => calls.push("stt-ping"), transcribe: async (blob) => { calls.push(`transcribe:${blob.type}:${blob.size}`); if (sttError) throw sttError; return ""; } }), sttFailureReason: stt.sttFailureReason },
    "@/lib/voice/audio": audio,
  }, { Blob, console: { error: (...args) => logs.push(JSON.parse(JSON.stringify(args))) } });
  const ok = await make(null).diagnoseAIProvider({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "abcdef1234" });
  assert.equal(ok.ok, true);
  assert.deepEqual(calls, ["complete:0", "transcribe:audio/wav:32044"], "no models-only ping");
  assert.match(ok.message, /requête de transcription acceptée/);
  const failed = await make(new errors.ProviderError("openai", "unauthorized", 401, "missing_scope", { type: "invalid_request_error", scopes: ["api.model.audio.request"] })).diagnoseAIProvider({});
  assert.equal(failed.ok, false);
  assert.match(failed.message, /portée manquante : api\.model\.audio\.request/);
  assert.equal(logs.at(-1)[1].scopes, "api.model.audio.request");
  assert.doesNotMatch(JSON.stringify(logs), /sk-|Bearer/);
});
