import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const m = loadTs("lib/leads/model.ts");
const json = (value) => JSON.parse(JSON.stringify(value));
const CLIENT = "11111111-2222-4333-8444-555555555555";
const services = ["Réfection de toiture", "Démoussage de toiture", "Pose de gouttières", "Recherche de fuite"];
const context = { clientName: "Toitures Martin", facts: "Toitures Martin\nCouvreur à Narbonne\nDevis gratuit\nRéfection de toiture", exclusions: ["moins cher"], callbackPromise: "sous 24 h ouvrées", phone: "04 68 00 00 00", signature: "Jean Martin, Toitures Martin" };

test("formulaire : champs courants reconnus, coordonnées normalisées, piège à robots, contact obligatoire", () => {
  const ok = m.readSubmission({ prenom: "Marie", lastname: "Durand", email: " Marie.Durand@Exemple.FR ", telephone: "+33 6 12 34 56 78", code_postal: "11 100", message: "Fuite sous la toiture depuis l’orage, besoin d’une intervention." });
  assert.equal(ok.ok, true);
  assert.deepEqual(json(ok.value), { name: "Marie Durand", email: "marie.durand@exemple.fr", phone: "06 12 34 56 78", postcode: "11100", city: null, subject: null, message: "Fuite sous la toiture depuis l’orage, besoin d’une intervention.", pageUrl: null });
  assert.equal(m.readSubmission({ email: "a@b.fr", message: "Bonjour, un devis ?", website: "http://spam" }).reason, "honeypot");
  assert.equal(m.readSubmission({ name: "X", message: "Bonjour, un devis svp" }).ok, false, "sans e-mail ni téléphone : impossible de répondre");
  assert.equal(m.readSubmission({ email: "a@b.fr", message: "" }).ok, false);
  assert.equal(m.readSubmission(null).ok, false);
  assert.equal(m.normalizePhone("0612"), null);
  assert.equal(m.normalizePhone("06.12.34.56.78"), "06 12 34 56 78");
  assert.equal(m.normalizeOrigin("https://www.client.fr/"), "https://www.client.fr");
  assert.equal(m.normalizeOrigin("http://www.client.fr"), null, "https seulement");
  assert.equal(m.normalizeOrigin("https://www.client.fr/contact"), null, "sans chemin");
});

test("empreintes : doublon exact reconnu, adresse IP jamais conservée", () => {
  const a = m.leadFingerprint(CLIENT, { email: "a@b.fr", phone: null, message: "Toiture  à refaire" });
  assert.equal(a, m.leadFingerprint(CLIENT, { email: "a@b.fr", phone: null, message: "toiture à refaire " }));
  assert.notEqual(a, m.leadFingerprint(CLIENT, { email: "c@b.fr", phone: null, message: "toiture à refaire" }));
  const ip = m.ipFingerprint("203.0.113.9, 10.0.0.1", "secret");
  assert.match(ip, /^[a-f0-9]{40}$/);
  assert.equal(ip, m.ipFingerprint("203.0.113.9", "secret"));
  assert.ok(!ip.includes("203"));
  assert.equal(m.ipFingerprint(null, "s"), null);
});

test("indésirables évidents : liens multiples, vocabulaire de spam, écriture non latine", () => {
  assert.equal(m.obviousSpam({ message: "We offer SEO services and backlinks for your site", subject: null, name: null }), true);
  assert.equal(m.obviousSpam({ message: "see http://a.io http://b.io http://c.io", subject: null, name: null }), true);
  assert.equal(m.obviousSpam({ message: "Здравствуйте, предлагаем услуги продвижения сайта", subject: null, name: null }), true);
  assert.equal(m.obviousSpam({ message: "Bonjour, ma gouttière fuit, pouvez-vous passer ?", subject: null, name: "Paul" }), false);
});

test("qualification par règles : prestation confirmée, urgence, informations manquantes, jamais de prestation inventée", () => {
  const urgent = m.ruleQualification({ name: "Paul", email: "p@x.fr", phone: "06 12 34 56 78", postcode: "11100", city: null, subject: null, message: "Fuite importante sur la toiture après la tempête, c’est urgent.", pageUrl: null }, services);
  assert.equal(urgent.urgency, "urgent");
  assert.equal(urgent.score, "hot");
  assert.ok(services.includes(urgent.service));
  assert.ok(!urgent.missing.includes("location") && !urgent.missing.includes("phone"));
  const vague = m.ruleQualification({ name: null, email: "p@x.fr", phone: null, postcode: null, city: null, subject: null, message: "Je voudrais installer une piscine.", pageUrl: null }, services);
  assert.equal(vague.service, null, "aucune prestation du client ne correspond");
  assert.ok(vague.missing.includes("location") && vague.missing.includes("phone") && vague.missing.includes("timeframe"));
  assert.ok(vague.questions.length >= 1 && vague.questions.length <= 3);
  assert.equal(m.ruleQualification({ name: null, email: "p@x.fr", phone: null, postcode: null, city: null, subject: null, message: "Simple renseignement, pas urgent, pour l’an prochain.", pageUrl: null }, services).urgency, "flexible");
});

const submission = { name: "Marie Durand", email: "marie@exemple.fr", phone: null, postcode: "11100", city: "Narbonne", subject: "Toiture", message: "Bonjour, ma toiture de 80 m2 est à refaire avant l’hiver. Maison de 1975.", pageUrl: null };

test("qualification de l'IA recalée : prestation hors liste refusée, citations introuvables retirées, sortie invalide rejetée", () => {
  const checked = m.checkQualification({ spam: false, service: "réfection de toiture", urgency: "soon", score: "warm", summary: "Toiture de 80 m2 à refaire avant l’hiver.", timeframe: "avant l’hiver", budget: "10 000 €", property: "Maison de 1975", location: "Narbonne", missing: ["photos"], questions: ["Pouvez-vous envoyer une photo ?"], evidence: ["toiture de 80 m2 est à refaire", "budget de 10 000 €"], reply_subject: "x", reply_body: "y" }, { submission, services });
  assert.equal(checked.service, "Réfection de toiture", "recopiée depuis la liste");
  assert.equal(checked.budget, null, "budget absent de la demande : retiré");
  assert.equal(checked.timeframe, "avant l’hiver");
  assert.deepEqual(json(checked.evidence), ["toiture de 80 m2 est à refaire"]);
  assert.equal(m.checkQualification({ spam: false, service: "Piscine", urgency: "soon", score: "warm", summary: "x", missing: [], questions: [], evidence: [] }, { submission, services }).service, null);
  assert.equal(m.checkQualification({ spam: "non", urgency: "soon", score: "warm", summary: "x" }, { submission, services }), null);
  assert.equal(m.checkQualification({ spam: false, urgency: "demain", score: "warm", summary: "x" }, { submission, services }), null);
});

const goodBody = "Bonjour Marie Durand,\n\nMerci pour votre demande concernant la réfection de votre toiture de 80 m2 à Narbonne. Nous vous recontactons sous 24 h ouvrées. Pour préparer le devis gratuit, pourriez-vous nous préciser le type de couverture actuelle et nous envoyer une ou deux photos de la toiture ?\n\nBien à vous,\nJean Martin, Toitures Martin\nTél. 04 68 00 00 00";

test("réponse proposée : acceptée seulement si chaque chiffre, promesse et lien vient des faits, des réglages ou de la demande", () => {
  const ok = m.checkReply("Votre projet de toiture", goodBody, { context, submission });
  assert.equal(ok.ok, true, ok.reason);
  const refuse = (body, pattern) => { const r = m.checkReply("Objet", body, { context, submission }); assert.equal(r.ok, false, body); assert.match(r.reason, pattern); };
  refuse(goodBody.replace("sous 24 h ouvrées", "sous 48 h"), /chiffre|promesse/);
  refuse(goodBody.replace("le devis gratuit", "le devis, avec garantie 10 ans,"), /chiffre|promesse/);
  refuse(goodBody.replace("Bien à vous", "Nous intervenons en 3 jours. Bien à vous"), /chiffre|promesse/);
  refuse(goodBody.replace("Bien à vous", "Tarif à partir de 50 €. Bien à vous"), /chiffre|montant/);
  refuse(goodBody.replace("Bien à vous", "Voir https://autre-site.fr. Bien à vous"), /lien/);
  refuse(goodBody.replace("Bien à vous", "N’hésitez pas à nous appeler. Bien à vous"), /formule/);
  refuse(goodBody.replace("Bien à vous", "Nous sommes moins cher. Bien à vous"), /exclue|promesse/);
  refuse("Bonjour, merci.", /longueur/);
  const noFact = { ...context, facts: "Toitures Martin\nCouvreur" };
  assert.equal(m.checkReply("Objet", goodBody, { context: noFact, submission }).ok, false, "devis gratuit absent des faits : refusé");
});

test("réponse type et relances : aucune promesse sans réglage, questions utiles, mention de transparence", () => {
  const q = m.ruleQualification(submission, services);
  const reply = m.templateReply(submission, q, context);
  assert.match(reply.body, /^Bonjour Marie Durand,/);
  assert.match(reply.body, /Nous vous recontactons sous 24 h ouvrées\./);
  assert.match(reply.body, /Jean Martin, Toitures Martin\nTél\. 04 68 00 00 00$/);
  const bare = m.templateReply({ ...submission, name: "Marie" }, { ...q, questions: [] }, { ...context, callbackPromise: null, phone: null, signature: null });
  assert.match(bare.body, /^Bonjour,/);
  assert.doesNotMatch(bare.body, /recontactons|\d/, "aucun délai promis, aucun chiffre");
  assert.match(bare.body, /Toitures Martin$/);
  const f1 = m.followupReply(1, { name: "Marie Durand", service: "Réfection de toiture", receivedAt: "2026-11-27T09:00:00Z", questions: ["la commune du chantier"] }, context);
  assert.match(f1.body, /27 novembre/);
  assert.match(f1.body, /il nous manque encore la commune du chantier/);
  const f2 = m.followupReply(2, { name: null, service: null, receivedAt: "2026-11-27T09:00:00Z", questions: [] }, context);
  assert.match(f2.subject, /^Dernière relance/);
  assert.match(f2.body, /clôturons votre demande/);
  assert.match(m.transparencyFooter("Toitures Martin", "2026-11-27T09:00:00Z"), /STOP/);
});

test("alerte à l'artisan : urgence en tête, coordonnées et message, sans invention", () => {
  const q = { ...m.ruleQualification(submission, services), urgency: "urgent" };
  const note = m.notifyText({ name: "Marie Durand", email: "marie@exemple.fr", phone: null, location: "11100 Narbonne", message: submission.message, source: "form" }, q, "https://os.example.fr/leads?client=x");
  assert.match(note.subject, /^URGENT – Nouvelle demande/);
  assert.match(note.text, /Téléphone : non précisé/);
  assert.match(note.text, /Suivi : https:\/\/os\.example\.fr/);
});

test("calendrier : relances en jours ouvrés à 10 h (Paris), fenêtre lundi-samedi 9 h-19 h", () => {
  // Vendredi 27 novembre 2026, 15 h Paris → 2 jours ouvrés = mardi 1er décembre, 10 h Paris (9 h UTC, heure d'hiver).
  assert.equal(m.followupDueAt(new Date("2026-11-27T14:00:00Z"), 2).toISOString(), "2026-12-01T09:00:00.000Z");
  // Heure d'été : lundi 6 juillet 2026 → mercredi 8 juillet 10 h Paris = 8 h UTC.
  assert.equal(m.followupDueAt(new Date("2026-07-06T10:00:00Z"), 2).toISOString(), "2026-07-08T08:00:00.000Z");
  assert.equal(m.nextFollowup(new Date("2026-11-27T14:00:00Z"), 0, 2).toISOString(), "2026-12-01T09:00:00.000Z");
  assert.equal(m.nextFollowup(new Date("2026-12-01T09:00:00Z"), 1, 2).toISOString(), "2026-12-04T09:00:00.000Z", "deuxième relance : 3 jours ouvrés");
  assert.equal(m.nextFollowup(new Date(), 1, 1), null, "une seule relance réglée");
  assert.equal(m.nextFollowup(new Date(), 0, 0), null, "aucune relance");
  assert.equal(m.followupWindowOpen(new Date("2026-11-29T10:00:00Z")), false, "dimanche");
  assert.equal(m.followupWindowOpen(new Date("2026-11-28T09:00:00Z")), true, "samedi 10 h");
  assert.equal(m.followupWindowOpen(new Date("2026-11-27T19:30:00Z")), false, "vendredi 20 h 30");
});

test("adresse de réception : devis-<clé> sur le domaine entrant, coordonnées lues dans un e-mail transféré", () => {
  const key = "0123456789abcdef0123456789abcdef";
  assert.equal(m.inboundAddress(key, "Leads.Code-V.fr"), "devis-0123456789abcdef@leads.code-v.fr");
  assert.equal(m.inboundAddress(key, ""), null);
  assert.equal(m.inboundAddress("court", "leads.code-v.fr"), null);
  assert.equal(m.inboundKeyPrefix("devis-0123456789abcdef@leads.code-v.fr", "leads.code-v.fr"), "0123456789abcdef");
  assert.equal(m.inboundKeyPrefix("devis-0123456789abcdef@autre.fr", "leads.code-v.fr"), null);
  assert.equal(m.inboundKeyPrefix("contact@leads.code-v.fr", "leads.code-v.fr"), null);
  const contact = m.contactFromForwarded("---------- Message transféré ----------\nDe : artisan@client.fr\nNom : Paul Bernard\nE-mail : paul.bernard@gmail.com\nTél : 06 11 22 33 44\nBonjour, je souhaite un devis.", ["artisan@client.fr"]);
  assert.deepEqual(json(contact), { email: "paul.bernard@gmail.com", phone: "06 11 22 33 44", name: "Paul Bernard" });
});

test("réglages : e-mails, téléphone, origines https et nombre de relances contrôlés", () => {
  const ok = m.settingsSchema.safeParse({ enabled: true, auto_reply: false, followups: 2, notify_email: "Artisan@Client.fr", reply_to: "", callback_promise: "sous 24 h ouvrées", phone: "0468000000", signature: "", allowed_origins: "https://www.client.fr\nhttps://client.fr" });
  assert.equal(ok.success, true);
  assert.equal(ok.data.notify_email, "artisan@client.fr");
  assert.equal(ok.data.reply_to, null);
  assert.equal(ok.data.phone, "04 68 00 00 00");
  assert.deepEqual(json(ok.data.allowed_origins), ["https://www.client.fr", "https://client.fr"]);
  assert.equal(m.settingsSchema.safeParse({ ...ok.data, allowed_origins: "http://client.fr", notify_email: "", reply_to: "", phone: "", signature: "", callback_promise: "" }).success, false);
  assert.equal(m.settingsSchema.safeParse({ enabled: true, auto_reply: true, followups: 3, notify_email: "", reply_to: "", callback_promise: "", phone: "", signature: "", allowed_origins: "" }).success, false);
  assert.equal(m.settingsFromRow({ client_id: CLIENT, form_key: "k", followups: 9 }).followups, 2);
  assert.equal(m.settingsFromRow(null), null);
  assert.match(m.formSnippet("https://os.example.fr/api/public/leads/x?key=y"), /name="website"[\s\S]*fetch\(f\.action/);
});

test("câblage : charte, étape du planificateur, route publique exemptée et protégée, webhook, migration sans accès public", () => {
  const charter = loadTs("lib/harness/charter.ts");
  const leads = charter.getCharter("leads");
  assert.equal(leads.team, "commercial");
  assert.ok(leads.never.some((rule) => /prix/.test(rule)));
  assert.ok(leads.triggers.some((t) => t.kind === "step" && t.step === "leads"));
  const service = readFileSync("lib/leads/service.ts", "utf8");
  assert.match(service, /withCharter\("leads", LEAD_INSTRUCTIONS\)/, "chaque appel IA passe par le cadre de mission");
  assert.match(service, /withAiScope\(\{ agent: "leads", clientId: lead\.client_id \}/, "appel IA mesuré dans le budget du client");
  assert.match(service, /isBlockedBy\(/, "liste d'exclusion vérifiée avant tout envoi");
  assert.match(service, /idempotencyKey: key/);
  const proxy = readFileSync("proxy.ts", "utf8");
  assert.match(proxy, /\^\\\/api\\\/public\\\/leads\\\/\[0-9a-f-\]\{36\}\$/);
  assert.match(proxy, /\["POST", "OPTIONS"\]\.includes\(request\.method\)/);
  const route = readFileSync("app/api/public/leads/[clientId]/route.ts", "utf8");
  assert.match(route, /boundedBytes\(request, 32 \* 1024\)/);
  assert.doesNotMatch(route, /export (async )?function GET/, "aucune lecture publique");
  const webhook = readFileSync("app/api/webhooks/resend/route.ts", "utf8");
  assert.ok(webhook.indexOf("validResendSignature") < webhook.indexOf("handleLeadInbound(inbound)"), "signature vérifiée avant toute lecture");
  const migration = readFileSync("supabase/migrations/20261229000000_leads_agent.sql", "utf8");
  assert.match(migration, /revoke all on public\.lead_settings, public\.leads, public\.lead_messages from anon, authenticated/);
  for (const table of ["lead_settings", "leads", "lead_messages"]) assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
});
