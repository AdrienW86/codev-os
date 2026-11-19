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

// ---------------------------------------------------------------------------------------------------------------
// PR 3 : approbation, planification et envoi progressif.
const plan = load("lib/acquisition/send-plan.ts");
const mail = load("lib/acquisition/outreach-mail.ts");

test("préchauffage et plafond du jour : 10, 20, 35 puis 50 au plus, jamais au-delà du réglage", () => {
  const now = new Date("2026-11-19T10:00:00Z");
  const ago = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();
  assert.equal(plan.warmupCap(null, now), 10);
  assert.deepEqual([0, 6, 7, 13, 14, 20, 21, 90].map((d) => plan.warmupCap(ago(d), now)), [10, 10, 20, 20, 35, 35, 50, 50]);
  assert.equal(plan.dailyCap(200, ago(90), now), 50);
  assert.equal(plan.dailyCap(15, ago(90), now), 15);
  assert.equal(plan.dailyCap(40, null, now), 10);
  assert.equal(plan.dailyCap(0, ago(90), now), 0);
  assert.equal(plan.dailyCap(Number.NaN, ago(90), now), 0);
});

test("créneaux : jours ouvrés 9 h – 11 h 30 et 14 h – 16 h 30 heure de Paris, hors fériés", () => {
  // Jeudi 19/11/2026 : 10 h Paris = 9 h UTC (heure d'hiver).
  assert.equal(plan.inSendWindow(new Date("2026-11-19T09:00:00Z")), true);
  assert.equal(plan.inSendWindow(new Date("2026-11-19T07:59:00Z")), false, "8 h 59 Paris");
  assert.equal(plan.inSendWindow(new Date("2026-11-19T10:30:00Z")), false, "11 h 30 Paris");
  assert.equal(plan.inSendWindow(new Date("2026-11-19T13:15:00Z")), true, "14 h 15 Paris");
  assert.equal(plan.inSendWindow(new Date("2026-11-21T09:00:00Z")), false, "samedi");
  assert.equal(plan.inSendWindow(new Date("2026-11-11T09:00:00Z")), false, "11 novembre");
  assert.equal(plan.isFrenchHoliday(2026, 4, 6), true, "lundi de Pâques 2026");
  assert.equal(plan.isFrenchHoliday(2026, 5, 14), true, "Ascension 2026");
  assert.equal(plan.isFrenchHoliday(2026, 5, 25), true, "lundi de Pentecôte 2026");
  assert.equal(plan.isFrenchHoliday(2026, 5, 26), false);
  // Heure d'été : 9 h 30 Paris = 7 h 30 UTC.
  assert.equal(plan.inSendWindow(new Date("2026-06-17T07:30:00Z")), true);
});

test("répartition : quelques messages par passage, jamais en rafale", () => {
  assert.equal(plan.ticksLeftToday(new Date("2026-11-19T08:00:00Z")), 20, "9 h : 10 + 10 passages");
  assert.equal(plan.ticksLeftToday(new Date("2026-11-19T15:00:00Z")), 2, "16 h : 2 passages");
  assert.equal(plan.ticksLeftToday(new Date("2026-11-19T12:00:00Z")), 0, "hors créneau");
  assert.equal(plan.tickBudget(10, 20), 1);
  assert.equal(plan.tickBudget(50, 20), 3);
  assert.equal(plan.tickBudget(50, 2), 3, "plafond de 3 par passage");
  assert.equal(plan.tickBudget(0, 10), 0);
  assert.equal(plan.tickBudget(5, 0), 0);
  assert.equal(plan.localDayStartIso(new Date("2026-11-19T09:00:00Z")), "2026-11-18T23:00:00.000Z");
  assert.equal(plan.localDayStartIso(new Date("2026-06-17T07:30:00Z")), "2026-06-16T22:00:00.000Z");
});

test("réputation : arrêt automatique sur plainte ou rebonds", () => {
  assert.deepEqual(json(plan.reputationVerdict({ sent: 100, hardBounces: 3, complaints: 0 })), { stop: false });
  assert.equal(plan.reputationVerdict({ sent: 100, hardBounces: 4, complaints: 0 }).reason, "bounce_rate");
  assert.equal(plan.reputationVerdict({ sent: 5, hardBounces: 0, complaints: 1 }).reason, "complaint");
  assert.equal(plan.reputationVerdict({ sent: 10, hardBounces: 3, complaints: 0 }).reason, "bounce_rate");
  assert.equal(plan.reputationVerdict({ sent: 10, hardBounces: 2, complaints: 0 }).stop, false);
});

test("jours ouvrés : relance à J+5 ouvrés, week-end et fériés sautés", () => {
  assert.equal(plan.addBusinessDays(new Date("2026-11-19T09:00:00Z"), 5).toISOString(), "2026-11-26T09:00:00.000Z");
  assert.equal(plan.addBusinessDays(new Date("2026-11-09T09:00:00Z"), 2).toISOString(), "2026-11-12T09:00:00.000Z", "11 novembre sauté");
});

test("message envoyé : mention complète (identité, origine, finalité, désinscription, confidentialité)", () => {
  const outreach = load("lib/acquisition/outreach.ts");
  const env = { PUBLICATION_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64") };
  const link = mail.unsubscribeLink("contact@archi.fr", { scope: "codev" }, "https://os.code-v.fr", env);
  assert.match(link, /^https:\/\/os\.code-v\.fr\/api\/email\/unsubscribe\?t=/);
  assert.equal(mail.unsubscribeLink("contact@archi.fr", { scope: "codev" }, "http://x.fr", env), null);
  assert.equal(mail.unsubscribeLink("contact@archi.fr", { scope: "codev" }, "https://os.code-v.fr", {}), null);
  const sender = { legalName: "CODE-V SAS", legalAddress: "1 rue X, 67000 Strasbourg", privacyUrl: "https://code-v.fr/confidentialite" };
  const text = mail.composeProspectingText(`Bonjour,\n\nMessage.\n\n${outreach.OPT_OUT_FOOTER}`, sender, link, "https://www.archi.fr/mentions-legales");
  assert.ok(!text.includes(outreach.OPT_OUT_FOOTER), "courte mention du brouillon remplacée");
  for (const part of ["CODE-V SAS · 1 rue X, 67000 Strasbourg", "provient de archi.fr", "intérêt légitime", link, "« STOP »", "https://code-v.fr/confidentialite"]) assert.ok(text.includes(part), part);
  assert.equal(mail.sourceLabel("https://www.openstreetmap.org/node/1"), "OpenStreetMap (données publiques)");
  assert.equal(mail.sourceLabel(null), "le site de votre entreprise");
});

test("envoi : verrous rejoués avant chaque message, confirmation cruciale pour approuver et activer", () => {
  const service = src("lib/acquisition/send-service.ts");
  for (const needle of ["emailSendingStatus().enabled", "inSendWindow(now", "resolveProspectingSender(", "reputationVerdict(", "dailyCap(", "evaluateAcquisitionDispatch(", "blocked.has(email)", "addressCheckFresh(", "unsubscribeHeaders(", ".eq(\"state\", \"approved\").select(\"id\")", "idempotencyKey"])
    assert.ok(service.includes(needle), needle);
  const actions = src("app/(cockpit)/acquisition/actions.ts");
  assert.match(actions, /data\.get\("confirm"\) !== "on" \|\| text\(data, "confirm_count", 4\) !== String\(ids\.length\)/);
  assert.match(actions, /enabled && data\.get\("confirm"\) !== "on"/);
  assert.match(src("lib/scheduler/heartbeat.ts"), /"acquisition_send"/);
  const sql = src("supabase/migrations/20261220000000_acquisition_sending.sql");
  assert.match(sql, /acquisition_messages_idempotency/); assert.match(sql, /acquisition_messages_one_followup/);
  assert.doesNotMatch(sql, /\b(drop table|delete from|truncate)\b/i);
});

// ---------------------------------------------------------------------------------------------------------------
// PR 4 : réponses reçues (STOP, réponse, absence).
const replies = load("lib/acquisition/replies.ts");

test("réception : événement email.received lu, autres types ignorés", () => {
  const inbound = replies.readInboundEmail({ type: "email.received", data: { email_id: "abc_123", from: "Cabinet Archi <Contact@Archi.fr>", to: ["contact@code-v-pro.fr"], subject: "RE:\nCODE-V" } });
  assert.deepEqual(json(inbound), { emailId: "abc_123", from: "contact@archi.fr", to: ["contact@code-v-pro.fr"], subject: "RE: CODE-V" });
  assert.equal(replies.readInboundEmail({ type: "email.delivered", data: {} }), null);
  assert.equal(replies.readInboundEmail({ type: "email.received", data: { email_id: "../x", from: "x" } }).emailId, null);
});

test("réponse : texte nouveau sans citation, STOP prioritaire, absence consignée", () => {
  assert.equal(replies.newReplyText("Merci, appelez-moi.\n\nLe jeu. 19 nov. 2026, CODE-V a écrit :\n> Bonjour"), "Merci, appelez-moi.");
  const c = (subject, text, autoSubmitted = null) => replies.classifyReply({ subject, text, autoSubmitted });
  assert.equal(c("Re: Atelier et CODE-V", "STOP"), "stop");
  assert.equal(c("Re: Atelier et CODE-V", "Merci de ne plus nous contacter."), "stop");
  assert.equal(c("Re: Atelier et CODE-V", "Nous ne sommes pas intéressés."), "stop");
  assert.equal(c("Re: Atelier et CODE-V", "Désinscrivez-moi svp"), "stop");
  assert.equal(c("STOP", null), "stop", "objet seul (corps illisible)");
  assert.equal(c("Re: Atelier et CODE-V", "Volontiers, mardi 10 h ?\n> Si vous ne souhaitez plus être contacté, répondez STOP"), "reply", "STOP cité ignoré");
  assert.equal(c("Réponse automatique : absent", "Je suis absent jusqu'au 25."), "auto_reply");
  assert.equal(c("Re: Atelier", "Bonjour", "auto-replied"), "auto_reply");
  assert.equal(c("Re: Atelier", "Stoppez tout"), "reply", "mot proche, pas une demande d'arrêt explicite");
  assert.equal(replies.replyExcerpt("Merci\n\n\n\nÀ bientôt\n> cité"), "Merci\n\nÀ bientôt");
});

test("webhook : réponse traitée avant l'enregistrement (rejouable), STOP exclut définitivement", () => {
  const route = src("app/api/webhooks/resend/route.ts");
  assert.ok(route.indexOf("handleProspectingReply(inbound)") < route.indexOf("recordResendEvent(id!, effect)"));
  const service = src("lib/acquisition/reply-service.ts");
  assert.match(service, /in\("state", \["draft", "approved"\]\)/);
  assert.match(service, /email_suppressions"\)\.insert\(\{ scope: clientId \? "client" : "codev"/);
  assert.match(service, /acquisition_suppressions"\)\.insert/);
});

// ---------------------------------------------------------------------------------------------------------------
// PR 5 : rédaction personnalisée par entreprise, à partir des seuls faits vérifiés.
const writer = load("lib/acquisition/writer.ts");
const outreachMod = load("lib/acquisition/outreach.ts");

test("faits de la page publique : titre, description, titre principal, avec la page source", () => {
  const html = `<html><head><title>Atelier Archi &amp; Co | Architectes à Strasbourg</title><meta name="description" content="Rénovation et extension de maisons alsaciennes depuis 2009."></head><body><h1>Architecture <em>durable</em> en Alsace</h1></body></html>`;
  const facts = writer.extractPageFacts(html, "https://atelier-archi.fr/", "2026-11-19T10:00:00Z");
  assert.deepEqual(json(facts.map((f) => [f.id, f.statement])), [
    ["site_title", "Atelier Archi & Co | Architectes à Strasbourg"], ["site_description", "Rénovation et extension de maisons alsaciennes depuis 2009."], ["site_heading", "Architecture durable en Alsace"]]);
  assert.ok(facts.every((f) => f.sourceUrl === "https://atelier-archi.fr/"));
  assert.deepEqual(json(writer.extractPageFacts("<title>Accueil</title>", "https://x.fr/", "2026-11-19T10:00:00Z")), [], "texte trop court");
});

test("sortie du Rédacteur : faits cités, nombres connus, sans lien, personnalisée, sinon repli sur le modèle", () => {
  const ctx = { sender: { name: "Toitures Martin", activity: "Couverture", zone: "Strasbourg" }, recipient: { company: "Atelier Archi", city: "Strasbourg", segment: "Architectes" },
    benefit: "Sur vos projets, disposer d'une entreprise identifiée pour ce lot vous évite de relancer plusieurs consultations.",
    facts: [{ id: "site_description", label: "Présentation", statement: "Rénovation et extension de maisons alsaciennes depuis 2009.", sourceUrl: "https://atelier-archi.fr/", verifiedAt: "2026-11-19T10:00:00Z" }] };
  const body = "Bonjour,\n\nJ'ai vu qu'Atelier Archi accompagne la rénovation et l'extension de maisons alsaciennes depuis 2009. Toitures Martin intervient en couverture autour de Strasbourg, souvent sur ce type de chantier.\n\nSur vos projets, disposer d'une entreprise identifiée pour ce lot vous évite de relancer plusieurs consultations, et nous orientons volontiers nos clients vers des architectes.\n\nAuriez-vous 10 minutes la semaine prochaine pour en parler ?\n\nBien cordialement,\nToitures Martin";
  const good = { refused: false, refusal_reason: "", subject: "Atelier Archi et la couverture", body, fact_ids_used: ["site_description"] };
  const ok = writer.validateWriterOutput(good, ctx);
  assert.equal(ok.ok, true, JSON.stringify(ok)); assert.ok(ok.body.endsWith(outreachMod.OPT_OUT_FOOTER)); assert.equal(ok.facts.length, 1);
  const bad = (change) => writer.validateWriterOutput({ ...good, ...change }, ctx);
  assert.equal(bad({ refused: true }).reason, "refused");
  assert.equal(bad({ fact_ids_used: [] }).reason, "facts");
  assert.equal(bad({ fact_ids_used: ["site_description", "invente"] }).reason, "facts");
  assert.equal(bad({ body: body.replace("depuis 2009", "depuis 2009 et livrons en 48 h") }).reason, "invented_number");
  assert.equal(bad({ body: body.replace("Bonjour,", "Bonjour, voir www.toitures.fr.") }).reason, "links");
  assert.equal(bad({ body: body.replaceAll("Atelier Archi", "votre cabinet"), subject: "La couverture à Strasbourg" }).reason, "not_personal");
  assert.equal(bad({ body: "Bonjour, court." }).reason, "length");
  assert.equal(bad({ body: body.replace("Auriez-vous", "Offre gratuite et urgente : auriez-vous") }).reason, "quality");
});

test("Rédacteur : cadre de mission, contrôle avant remplacement, brouillon en cours non approuvable", () => {
  const service = src("lib/acquisition/writer-service.ts");
  assert.match(service, /withCharter\("prospection-writer"/);
  assert.match(service, /validateWriterOutput\(/);
  assert.match(service, /robotsAllows\(/);
  assert.match(service, /\.eq\("state", "draft"\)\.eq\("draft_source", "ai_pending"\)/);
  assert.match(src("lib/acquisition/send-service.ts"), /neq\("draft_source", "ai_pending"\)/);
});
