// Prospection e-mail sécurisée : expéditeur sur domaine dédié, puis (PR suivantes) vérification des adresses,
// envoi planifié et progressif, désinscription et réponses, rédaction par entreprise, relance et statistiques.
import test from "node:test";
import assert from "node:assert/strict";
import { load, src, json } from "./helpers/ts-load.mjs";

const sender = load("lib/acquisition/prospecting-sender.ts");

test("domaine enregistrable et domaines protégés (EMAIL_FROM, site du client, newsletters)", () => {
  assert.equal(sender.registrableDomain("news.exemple.fr"), "exemple.fr");
  assert.equal(sender.registrableDomain("a.b.exemple.co.uk"), "exemple.co.uk");
  assert.equal(sender.registrableDomain("pas un domaine"), null);
  assert.equal(sender.domainOfAddress("CODE-V <rapports@Code-V.fr>"), "code-v.fr");
  assert.deepEqual(json(sender.protectedDomains({ EMAIL_FROM: "CODE-V <rapports@code-v.fr>" }, ["https://www.toitures-martin.fr/", "news.toitures-martin.fr", null])),
    ["code-v.fr", "toitures-martin.fr", "news.toitures-martin.fr"]);
});

test("la prospection ne part jamais d'un domaine protégé ; sous-domaine accepté avec avertissement", () => {
  const protectedList = ["code-v.fr", "news.toitures-martin.fr"];
  assert.equal(sender.checkProspectingDomain("code-v.fr", protectedList).ok, false);
  assert.equal(sender.checkProspectingDomain("news.toitures-martin.fr", protectedList).ok, false);
  assert.equal(sender.checkProspectingDomain("pro.news.toitures-martin.fr", protectedList).ok, false, "sous-domaine du domaine de newsletters");
  assert.equal(sender.checkProspectingDomain("toitures-martin.fr", protectedList).ok, false, "domaine principal du client");
  const sub = sender.checkProspectingDomain("contact.code-v.fr", protectedList);
  assert.equal(sub.ok, true); assert.equal(sub.kind, "subdomain"); assert.match(sub.warning, /domaine séparé/);
  assert.deepEqual(json(sender.checkProspectingDomain("code-v-pro.fr", protectedList)), { ok: true, kind: "separate" });
  assert.equal(sender.checkProspectingDomain("pas un domaine", protectedList).ok, false);
});

test("formulaire : mention légale obligatoire, lien https, adresse avant @ valide", () => {
  const base = { sending_domain: "Code-V-Pro.fr", from_name: "CODE-V", from_local_part: "Contact", reply_to: "", legal_name: "CODE-V SAS", legal_address: "1 rue X, 67000 Strasbourg", privacy_url: "" };
  const ok = sender.prospectingSenderSchema.safeParse(base);
  assert.equal(ok.success, true); assert.equal(ok.data.sending_domain, "code-v-pro.fr"); assert.equal(ok.data.from_local_part, "contact"); assert.equal(ok.data.reply_to, null);
  for (const bad of [{ legal_name: "" }, { legal_address: "" }, { privacy_url: "http://x.fr" }, { from_local_part: "a b" }, { from_name: "A<b>" }, { reply_to: "pas-une-adresse" }])
    assert.equal(sender.prospectingSenderSchema.safeParse({ ...base, ...bad }).success, false, JSON.stringify(bad));
});

test("expéditeur utilisable seulement vérifié, prêt, complet et toujours hors domaine protégé", () => {
  const row = { id: "s1", workspace_id: "w1", provider: "resend", address: "contact@code-v-pro.fr", status: "ready", daily_limit: 0, sending_domain: "code-v-pro.fr", from_name: "Adrien de CODE-V",
    reply_to: "adrien@code-v-pro.fr", legal_name: "CODE-V SAS", legal_address: "1 rue X, 67000 Strasbourg", privacy_url: null, provider_domain_id: "d1", domain_status: "verified", dns_records: [], domain_checked_at: null, warmup_started_at: null };
  const parsed = sender.prospectingSenderFromRow(row);
  assert.deepEqual(json(sender.resolveProspectingSender(parsed, ["code-v.fr"])), { from: "Adrien de CODE-V <contact@code-v-pro.fr>", replyTo: "adrien@code-v-pro.fr", domain: "code-v-pro.fr", legalName: "CODE-V SAS", legalAddress: "1 rue X, 67000 Strasbourg", privacyUrl: null });
  assert.equal(sender.prospectingSenderFromRow({ ...row, provider: "smtp" }), null);
  for (const change of [{ status: "verification_pending" }, { domain_status: "pending" }, { legal_name: null }, { legal_address: "" }, { address: "contact@code-v.fr" }])
    assert.equal(sender.resolveProspectingSender(sender.prospectingSenderFromRow({ ...row, ...change }), ["code-v.fr"]), null, JSON.stringify(change));
  assert.equal(sender.resolveProspectingSender(parsed, ["code-v-pro.fr"]), null, "domaine devenu protégé : refus");
  assert.deepEqual(json(sender.dmarcRecord("code-v-pro.fr")), { name: "_dmarc.code-v-pro.fr", value: "v=DMARC1; p=none; adkim=s; aspf=s;" });
});

test("migration expéditeur : additive, un expéditeur Resend par espace, domaine unique", () => {
  const sql = src("supabase/migrations/20261218000000_acquisition_prospecting_sender.sql");
  assert.match(sql, /'resend'/);
  assert.match(sql, /acquisition_senders_one_resend_per_workspace[\s\S]*where provider = 'resend'/);
  assert.match(sql, /acquisition_senders_sending_domain_unique/);
  assert.doesNotMatch(sql, /\b(drop table|delete from|truncate)\b/i);
});

test("actions Acquisition : un identifiant UUID standard est accepté (8-4-4-4-12)", () => {
  const actions = src("app/(cockpit)/acquisition/actions.ts");
  const pattern = /const uuid = \/(.+)\/i;/.exec(actions)?.[1];
  assert.ok(pattern);
  assert.equal(new RegExp(pattern, "i").test("123e4567-e89b-42d3-a456-426614174000"), true);
});

// ---------------------------------------------------------------------------------------------------------------
// PR 2 : vérification des adresses avant envoi.
const check = load("lib/emailing/address-check.ts");

test("adresse : syntaxe, domaine jetable et faute de frappe détectés sans réseau", () => {
  assert.deepEqual(json(check.precheckAddress("pas une adresse")), { status: "invalid_syntax", detail: null });
  assert.equal(check.precheckAddress("contact..x@exemple.fr").status, "invalid_syntax");
  assert.equal(check.precheckAddress("contact@-exemple.fr").status, "invalid_syntax");
  assert.deepEqual(json(check.precheckAddress("contact@yopmail.com")), { status: "disposable", detail: "yopmail.com" });
  assert.deepEqual(json(check.precheckAddress("Contact@Gmial.com")), { status: "typo", detail: "contact@gmail.com ?" });
  assert.equal(check.precheckAddress("contact@exemple.fr"), null);
});

test("adresse : MX réel exigé, MX nul refusé, panne DNS jamais considérée valide", async () => {
  const dns = { "exemple.fr": [{ exchange: "mx.exemple.fr", priority: 10 }], "nul.fr": [{ exchange: ".", priority: 0 }], "vide.fr": [] };
  const lookup = async (domain) => {
    if (domain === "absent.fr") throw Object.assign(new Error("x"), { code: "ENOTFOUND" });
    if (domain === "panne.fr") throw Object.assign(new Error("x"), { code: "ETIMEOUT" });
    return dns[domain];
  };
  assert.equal((await check.checkAddress("contact@exemple.fr", lookup)).status, "valid");
  for (const domain of ["nul.fr", "vide.fr", "absent.fr"]) assert.equal((await check.checkAddress(`contact@${domain}`, lookup)).status, "no_mx", domain);
  assert.equal((await check.checkAddress("contact@panne.fr", lookup)).status, "unknown");
  let calls = 0;
  const counted = async (domain) => { calls++; return lookup(domain); };
  const results = await check.checkAddresses(["contact@exemple.fr", "info@exemple.fr", "contact@exemple.fr", "contact@yopmail.com"], counted);
  assert.equal(results.size, 3); assert.equal(calls, 1, "une seule résolution par domaine");
  assert.equal(results.get("contact@yopmail.com").status, "disposable");
});

test("adresse : fraîcheur de 30 jours, non distribuable mémorisé hors panne", () => {
  const now = new Date("2026-11-19T10:00:00Z");
  assert.equal(check.addressCheckFresh("valid", "2026-11-01T10:00:00Z", now), true);
  assert.equal(check.addressCheckFresh("valid", "2026-10-01T10:00:00Z", now), false);
  assert.equal(check.addressCheckFresh("no_mx", "2026-11-18T10:00:00Z", now), false);
  assert.equal(check.addressCheckFresh("valid", null, now), false);
  assert.equal(check.recentlyUndeliverable("no_mx", "2026-11-18T10:00:00Z", now), true);
  assert.equal(check.recentlyUndeliverable("unknown", "2026-11-18T10:00:00Z", now), false);
  assert.equal(check.recentlyUndeliverable("disposable", "2026-09-01T10:00:00Z", now), false);
  assert.equal(check.recentlyUndeliverable("valid", "2026-11-18T10:00:00Z", now), false);
});

test("transmission : seules les adresses vérifiées deviennent des brouillons", () => {
  const handoff = src("lib/acquisition/handoff.ts");
  assert.match(handoff, /checkAddressesWithDns\(selected\.map/);
  assert.match(handoff, /deliverable\.map\(\(p\) => \{/);
  assert.match(src("supabase/migrations/20261219000000_acquisition_email_checks.sql"), /email_check_status[\s\S]*'valid','invalid_syntax','disposable','typo','no_mx','unknown'/);
});
