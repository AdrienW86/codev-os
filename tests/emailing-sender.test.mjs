// Emailing, étape 2 : expéditeur et domaine d'envoi par client (Resend), liste des contacts.
import test from "node:test";
import assert from "node:assert/strict";
import { load, src, json } from "./helpers/ts-load.mjs";

const sender = load("lib/emailing/sender.ts");

test("domaine : normalisé, sous-domaine news. proposé depuis le site du client", () => {
  assert.equal(sender.normalizeDomain(" HTTPS://News.Exemple.FR/path?x "), "news.exemple.fr");
  for (const bad of ["", "exemple", "a b.fr", "-x.fr", 42, "x".repeat(260) + ".fr"]) assert.equal(sender.normalizeDomain(bad), null, String(bad));
  assert.equal(sender.suggestSendingDomain("https://www.toitures-martin.fr/"), "news.toitures-martin.fr");
  assert.equal(sender.suggestSendingDomain(null), null);
});

test("enregistrements DNS : types connus seulement, valeurs bornées, statut normalisé", () => {
  const records = sender.readDnsRecords([
    { record: "SPF", type: "MX", name: "send.news", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10, status: "pending" },
    { record: "DKIM", type: "TXT", name: "resend._domainkey.news", value: "p=MIGf", status: "verified" },
    { record: "X", type: "A", name: "a", value: "1.2.3.4" },
    { record: "SPF", type: "TXT", name: "send.news", value: "v=spf1\r\ninclude:x" },
    { record: "<b>", type: "TXT", name: "n", value: "v", status: "bogus" },
  ]);
  assert.deepEqual(json(records), [
    { record: "SPF", type: "MX", name: "send.news", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10, status: "pending" },
    { record: "DKIM", type: "TXT", name: "resend._domainkey.news", value: "p=MIGf", priority: null, status: "verified" },
    { record: "TXT", type: "TXT", name: "n", value: "v", priority: null, status: "not_started" },
  ], "libellé suspect remplacé par le type, statut inconnu ramené à « non vérifié »");
  assert.deepEqual(json(sender.readDnsRecords("nope")), []);
});

test("expéditeur du client : utilisé seulement quand le domaine est vérifié", () => {
  const settings = sender.senderFromRow({ sending_domain: "news.exemple.fr", from_name: "Toitures Martin", from_local_part: "newsletter", reply_to: "Contact@Exemple.fr", domain_status: "verified", dns_records: [] });
  assert.deepEqual(json(sender.clientSender(settings)), { from: "Toitures Martin <newsletter@news.exemple.fr>", replyTo: "contact@exemple.fr" });
  assert.equal(sender.clientSender({ ...settings, domain_status: "pending" }), null);
  assert.equal(sender.clientSender({ ...settings, from_name: null }), null);
  assert.equal(sender.clientSender(null), null);
  assert.equal(sender.clientSender({ ...settings, from_name: 'Evil" <x@y.fr>' }).from, "Evil x@y.fr <newsletter@news.exemple.fr>", "chevrons et guillemets retirés du nom");
});

test("formulaire expéditeur validé (domaine, nom sans chevrons, partie locale, réponse facultative)", () => {
  const ok = sender.senderSchema.safeParse({ sending_domain: "News.Exemple.fr", from_name: "Toitures Martin", from_local_part: "Newsletter", reply_to: "" });
  assert.equal(ok.success, true);
  assert.deepEqual(json(ok.data), { sending_domain: "news.exemple.fr", from_name: "Toitures Martin", from_local_part: "newsletter", reply_to: null });
  for (const bad of [{ from_name: "A <b@c.fr>" }, { sending_domain: "pas un domaine" }, { from_local_part: "a b" }, { reply_to: "x@" }])
    assert.equal(sender.senderSchema.safeParse({ sending_domain: "news.exemple.fr", from_name: "A", from_local_part: "news", reply_to: "", ...bad }).success, false, JSON.stringify(bad));
});

test("Resend domaines : création en région UE, domaine existant réutilisé, clé d'administration prioritaire", async () => {
  const errors = load("lib/providers/errors.ts");
  const calls = [];
  const domain = { id: "d_1", name: "news.exemple.fr", status: "not_started", records: [{ record: "DKIM", type: "TXT", name: "resend._domainkey.news", value: "p=MIG" }] };
  const providerJson = async (_p, url, init) => { calls.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body && JSON.parse(init.body) });
    if (url.endsWith("/domains") && init.method === "GET") return { data: calls.length > 2 ? [{ id: "d_1", name: "news.exemple.fr" }] : [] };
    return domain; };
  const resend = load("lib/providers/resend-domains.ts", { "@/lib/providers/api": { providerJson }, "@/lib/providers/errors": errors });
  const env = { RESEND_API_KEY: "re_sendonly123", RESEND_ADMIN_API_KEY: "re_fullaccess123" };
  const created = await resend.ensureResendDomain("News.Exemple.fr", env);
  assert.equal(created.id, "d_1"); assert.equal(created.records.length, 1);
  assert.deepEqual(calls[1].body, { name: "news.exemple.fr", region: "eu-west-1" });
  assert.equal(calls[1].auth, "Bearer re_fullaccess123");
  calls.length = 2;
  await resend.ensureResendDomain("news.exemple.fr", env);
  assert.ok(!calls.slice(2).some((c) => c.method === "POST"), "domaine existant : pas de nouvelle création");
  await assert.rejects(resend.ensureResendDomain("news.exemple.fr", {}), (e) => e.kind === "not_configured");
  await assert.rejects(resend.getResendDomain("../x", env), (e) => e.kind === "malformed");
});

test("sendEmail : expéditeur du client accepté seulement sous la forme « Nom <adresse> », reply_to validé", async () => {
  let last;
  const email = load("lib/providers/email.ts", { "@/lib/providers/api": { providerJson: async (_p, _u, init) => { last = JSON.parse(init.body); return { id: "x" }; } }, "@/lib/providers/errors": load("lib/providers/errors.ts") });
  const env = { RESEND_API_KEY: "re_x", EMAIL_FROM: "CODE-V <contact@code-v.fr>", EMAIL_SENDING_ENABLED: "true" };
  const base = { to: "a@exemple.fr", subject: "S", text: "T", idempotencyKey: "k" };
  await email.sendEmail({ ...base, from: "Toitures Martin <newsletter@news.exemple.fr>", replyTo: "contact@exemple.fr" }, env);
  assert.equal(last.from, "Toitures Martin <newsletter@news.exemple.fr>"); assert.equal(last.reply_to, "contact@exemple.fr");
  await email.sendEmail(base, env);
  assert.equal(last.from, "CODE-V <contact@code-v.fr>"); assert.equal(last.reply_to, undefined);
  for (const from of ["newsletter@news.exemple.fr", "A <x@y.fr>\r\nBcc: z@z.fr", 'A" <x@y.fr>', "A <pas-une-adresse>"])
    await assert.rejects(email.sendEmail({ ...base, from }, env), JSON.stringify(from));
  await assert.rejects(email.sendEmail({ ...base, replyTo: "x@" }, env));
});

test("newsletter : envoi au nom du client si domaine vérifié, sinon adresse commune ; contacts gérés depuis la page", () => {
  const service = src("lib/emailing/newsletter-service.ts");
  assert.match(service, /clientSender\(/);
  assert.match(service, /\.\.\.\(sender \? \{ from: sender\.from, replyTo: sender\.replyTo \} : \{\}\)/);
  const admin = src("lib/emailing/client-email-service.ts");
  assert.match(admin, /scope: "client", client_id: clientId, email_normalized: email, reason: "manual"/, "désabonnement manuel = exclusion pour ce client");
  assert.doesNotMatch(admin.slice(admin.indexOf("export async function eraseContact")), /email_suppressions/, "l'effacement conserve l'exclusion");
  const actions = src("app/(cockpit)/emailing/actions.ts");
  assert.match(actions, /requireAdminWriter/);
  assert.match(actions, /confirm"\) !== "on"\) done\(clientId, \{ ok: false, message: "Cochez la case pour confirmer la suppression/);
  const migration = src("supabase/migrations/20261213000000_client_email_settings.sql");
  assert.match(migration, /revoke all on public\.client_email_settings from anon, authenticated/);
});
