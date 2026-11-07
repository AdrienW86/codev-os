import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const policy = loadTs("lib/emailing/policy.ts");
const env = { PUBLICATION_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64") };
const clientId = "11111111-1111-4111-8111-111111111111";
const plain = (value) => JSON.parse(JSON.stringify(value)); // objets créés dans le contexte isolé du chargeur

test("Adresses normalisées, adresses invalides refusées", () => {
  assert.equal(policy.normalizeEmail("  Jean.Dupont@Exemple.FR "), "jean.dupont@exemple.fr");
  for (const bad of ["", "x@y", "a b@c.fr", "<a@b.fr>", 42, null, "a@b.fr\r\nBcc: x@y.fr"]) assert.equal(policy.normalizeEmail(bad), null);
});

test("Jeton de désabonnement : aller-retour, portée conservée, falsification refusée", () => {
  const token = policy.unsubscribeToken("Contact@Exemple.fr", { scope: "client", clientId }, env);
  assert.deepEqual(plain(policy.readUnsubscribeToken(token, env)), { email: "contact@exemple.fr", target: { scope: "client", clientId } });
  const codev = policy.unsubscribeToken("contact@exemple.fr", { scope: "codev" }, env);
  assert.deepEqual(plain(policy.readUnsubscribeToken(codev, env).target), { scope: "codev" });
  const [payload, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ e: "autre@exemple.fr", s: "client", c: clientId })).toString("base64url");
  assert.equal(policy.readUnsubscribeToken(`${forged}.${signature}`, env), null);
  assert.equal(policy.readUnsubscribeToken(`${payload}.${signature}`, { PUBLICATION_CREDENTIALS_KEY: Buffer.alloc(32, 8).toString("base64") }), null);
  assert.equal(policy.unsubscribeToken("contact@exemple.fr", { scope: "codev" }, {}), null, "sans clé serveur, aucun jeton");
});

test("En-têtes RFC 8058 : https uniquement, URL vers la route publique", () => {
  const headers = policy.unsubscribeHeaders("contact@exemple.fr", { scope: "codev" }, "https://os.code-v.fr", env);
  assert.match(headers["List-Unsubscribe"], /^<https:\/\/os\.code-v\.fr\/api\/email\/unsubscribe\?t=[A-Za-z0-9_.-]+>$/);
  assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(policy.unsubscribeHeaders("contact@exemple.fr", { scope: "codev" }, "http://os.code-v.fr", env), null);
  assert.equal(policy.unsubscribeHeaders("contact@exemple.fr", { scope: "codev" }, null, env), null);
});

const secretKey = Buffer.alloc(24, 3);
const secret = `whsec_${secretKey.toString("base64")}`;
const svix = (body, id = "msg_1", timestamp = String(Math.floor(Date.now() / 1000))) =>
  ({ id, timestamp, signature: `v1,${createHmac("sha256", secretKey).update(`${id}.${timestamp}.${body}`).digest("base64")}` });

test("Signature Svix du webhook Resend vérifiée sur le corps brut, avec fenêtre de 5 minutes", () => {
  const body = JSON.stringify({ type: "email.delivered", data: {} });
  const bytes = new TextEncoder().encode(body);
  assert.equal(policy.validResendSignature(bytes, svix(body), secret), true);
  assert.equal(policy.validResendSignature(bytes, { ...svix(body), signature: `v1,AAAA v1,${svix(body).signature.slice(3)}` }, secret), true, "plusieurs signatures (rotation)");
  assert.equal(policy.validResendSignature(new TextEncoder().encode(body + " "), svix(body), secret), false);
  assert.equal(policy.validResendSignature(bytes, svix(body, "msg_1", String(Math.floor(Date.now() / 1000) - 600)), secret), false, "rejeu ancien");
  assert.equal(policy.validResendSignature(bytes, svix(body), undefined), false);
  assert.equal(policy.validResendSignature(bytes, { id: null, timestamp: null, signature: null }, secret), false);
});

test("Événements Resend : seuls rebond définitif et plainte excluent l'adresse", () => {
  const hard = policy.readResendEvent({ type: "email.bounced", created_at: "2026-11-07T10:00:00Z", data: { email_id: "e1", to: ["Client@Exemple.fr"], bounce: { type: "Permanent", subType: "General" } } });
  assert.equal(hard.suppress, "hard_bounce"); assert.deepEqual(plain(hard.emails), ["client@exemple.fr"]); assert.equal(hard.detail, "Permanent / General");
  assert.equal(policy.readResendEvent({ type: "email.bounced", data: { to: ["a@exemple.fr"], bounce: { type: "Transient" } } }).suppress, null);
  assert.equal(policy.readResendEvent({ type: "email.complained", data: { to: "a@exemple.fr" } }).suppress, "complaint");
  assert.equal(policy.readResendEvent({ type: "email.delivered", data: { to: ["a@exemple.fr"] } }).suppress, null);
  assert.equal(policy.readResendEvent({ type: "<script>", data: {} }), null);
  assert.equal(policy.readResendEvent(null), null);
});

test("Exclusions : globale pour tous, codev et client cloisonnés", () => {
  const target = { scope: "client", clientId };
  assert.equal(policy.isBlockedBy([{ scope: "global", client_id: null }], target), true);
  assert.equal(policy.isBlockedBy([{ scope: "global", client_id: null }], { scope: "codev" }), true);
  assert.equal(policy.isBlockedBy([{ scope: "codev", client_id: null }], target), false);
  assert.equal(policy.isBlockedBy([{ scope: "client", client_id: "22222222-2222-4222-8222-222222222222" }], target), false);
  assert.equal(policy.isBlockedBy([{ scope: "client", client_id: clientId }], target), true);
  assert.equal(policy.isBlockedBy([{ scope: "codev", client_id: null }], { scope: "codev" }), true);
});

test("Service : événement idempotent, rebond définitif → exclusion globale et contact marqué", async () => {
  const calls = [];
  const table = (name) => {
    const chain = { insert: async (row) => { calls.push([name, "insert", row]); return { error: name === "email_events" && row.provider_event_id === "dup" ? { code: "23505" } : null }; },
      update: (row) => { calls.push([name, "update", row]); return chain; }, eq: () => chain, in: () => chain, then: (resolve) => resolve({ error: null }) };
    return chain;
  };
  const service = loadTs("lib/emailing/service.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => ({ from: table }) },
    "@/lib/integrations/publications-oauth/config": { oauthBaseUrl: () => "https://os.code-v.fr" },
    "@/lib/emailing/policy": policy,
  });
  const effect = policy.readResendEvent({ type: "email.bounced", data: { email_id: "e1", to: ["a@exemple.fr"], bounce: { type: "Permanent" } } });
  assert.equal(await service.recordResendEvent("evt", effect), true);
  assert.ok(calls.some(([t, op, row]) => t === "email_suppressions" && op === "insert" && row.scope === "global" && row.reason === "hard_bounce"));
  assert.ok(calls.some(([t, op, row]) => t === "email_contacts" && op === "update" && row.status === "bounced"));
  calls.length = 0;
  assert.equal(await service.recordResendEvent("dup", effect), false);
  assert.equal(calls.filter(([t]) => t !== "email_events").length, 0, "doublon : aucune autre écriture");
});

test("Routes publiques : signature avant stockage, pas de désabonnement sur simple GET, exemptions du proxy", () => {
  const webhook = readFileSync("app/api/webhooks/resend/route.ts", "utf8");
  assert.ok(webhook.indexOf("validResendSignature") < webhook.indexOf("recordResendEvent(id"));
  const unsubscribe = readFileSync("app/api/email/unsubscribe/route.ts", "utf8");
  const get = unsubscribe.slice(unsubscribe.indexOf("export async function GET"), unsubscribe.indexOf("export async function POST"));
  assert.doesNotMatch(get, /unsubscribe\(/);
  const proxy = readFileSync("proxy.ts", "utf8");
  assert.match(proxy, /path === "\/api\/webhooks\/resend" && request\.method === "POST"/);
  assert.match(proxy, /path === "\/api\/email\/unsubscribe"/);
  const migration = readFileSync("supabase/migrations/20261129000000_emailing_foundation.sql", "utf8");
  assert.match(migration, /revoke all on public\.email_contacts, public\.email_suppressions, public\.email_events from anon, authenticated/);
});

test("sendEmail n'accepte que les en-têtes de désabonnement, sans retour à la ligne", async () => {
  const email = loadTs("lib/providers/email.ts", { "@/lib/providers/api": { providerJson: async (_p, _u, init) => { email.last = JSON.parse(init.body); return { id: "x" }; } }, "@/lib/providers/errors": loadTs("lib/providers/errors.ts") });
  const envOk = { RESEND_API_KEY: "re_x", EMAIL_FROM: "CODE-V <contact@code-v.fr>", EMAIL_SENDING_ENABLED: "true" };
  const base = { to: "a@exemple.fr", subject: "S", text: "T", idempotencyKey: "k" };
  await email.sendEmail({ ...base, headers: { "List-Unsubscribe": "<https://x.fr/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }, envOk);
  assert.equal(email.last.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  await assert.rejects(email.sendEmail({ ...base, headers: { Bcc: "x@y.fr" } }, envOk));
  await assert.rejects(email.sendEmail({ ...base, headers: { "List-Unsubscribe": "<x>\r\nBcc: y@z.fr" } }, envOk));
  await email.sendEmail(base, envOk);
  assert.equal(email.last.headers, undefined);
});
