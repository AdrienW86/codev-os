import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const CLIENT = "11111111-2222-4333-8444-555555555555";
const KEY = "0123456789abcdef0123456789abcdef";
const ADMIN = { kind: "admin", userId: "user_admin" };
const goodBody = "Bonjour Marie Durand,\n\nMerci pour votre demande concernant la réfection de votre toiture à Narbonne. Nous vous recontactons sous 24 h ouvrées. Pour préparer le devis gratuit, pourriez-vous nous préciser le type de couverture actuelle et nous envoyer une ou deux photos de la toiture ?\n\nBien à vous,\nJean Martin, Toitures Martin";

function setup({ settings = {}, ai = null, sendFails = false, suppressions = [], env = {} } = {}) {
  const fake = createFakeSupabase({
    clients: [{ id: CLIENT, name: "Toitures Martin", company_name: null }],
    lead_settings: [{ client_id: CLIENT, enabled: true, form_key: KEY, allowed_origins: ["https://www.toitures-martin.fr"], auto_reply: false, followups: 2, notify_email: "artisan@toitures-martin.fr", reply_to: "contact@toitures-martin.fr", callback_promise: "sous 24 h ouvrées", phone: null, signature: "Jean Martin, Toitures Martin", ...settings }],
    leads: [], lead_messages: [], client_email_settings: [], email_suppressions: suppressions,
  }, { unique: { leads: [["client_id", "fingerprint"]] } });
  const sent = [], audits = [], aiCalls = [];
  const model = loadTs("lib/leads/model.ts");
  const policy = { normalizeEmail: (v) => (typeof v === "string" && /@/.test(v) ? v.trim().toLowerCase() : null) };
  const replies = loadTs("lib/acquisition/replies.ts", { "@/lib/emailing/policy": policy });
  const service = loadTs("lib/leads/service.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "@/lib/core/audit": { writeAudit: async (_actor, entry) => { audits.push(entry.action); } },
    "@/lib/ai/models": { agentsAiConfigured: () => Boolean(ai) },
    "@/lib/ai/metered": { withAiScope: (_scope, work) => work(), structuredResponse: async (instructions, input) => { aiCalls.push({ instructions, input: JSON.parse(input) }); return { value: ai(aiCalls.length) }; } },
    "@/lib/visual-agent/service": { clientBrandContext: async () => ({ client: { name: "Toitures Martin", activity: "Couvreur", zone: "Narbonne" }, services: ["Réfection de toiture", "Recherche de fuite"], facts: "Toitures Martin\nCouvreur à Narbonne\nDevis gratuit", exclusions: [], guidelines: "" }) },
    "@/lib/providers/email": {
      emailSendingStatus: () => ({ enabled: true }),
      sendEmail: async (message) => { if (sendFails) throw Object.assign(new Error("x"), { code: "rejected" }); sent.push(message); return { id: `re_${sent.length}` }; },
    },
    "@/lib/providers/api": { providerJson: async () => ({ text: "Oui, toujours d’actualité, voici les photos.\n\nLe 27 nov. a écrit :\n> ancien message", headers: {} }) },
    "@/lib/integrations/publications-oauth/config": { oauthBaseUrl: () => "https://os.example.fr" },
    "@/lib/emailing/policy": { isBlockedBy: (rows, target) => rows.some((r) => r.scope === "global" || (r.scope === target.scope && r.client_id === target.clientId)) },
    "@/lib/emailing/sender": { normalizeDomain: (v) => v ?? null, senderFromRow: () => null },
    "@/lib/acquisition/replies": replies,
    "./model": model,
  }, { process: { env: { EMAIL_FROM: "CODE-V <envoi@code-v.fr>", LEADS_INBOUND_DOMAIN: "leads.code-v.fr", RESEND_API_KEY: "re_test", ...env } } });
  return { fake, service, sent, audits, aiCalls };
}
const form = { name: "Marie Durand", email: "marie@exemple.fr", postcode: "11100", message: "Bonjour, ma toiture est à refaire avant l’hiver, maison à Narbonne." };

test("formulaire : clé, client actif et origine déclarée exigés ; doublon exact enregistré une fois ; robot ignoré sans trace", async () => {
  const { service, fake } = setup();
  const base = { clientId: CLIENT, key: KEY, origin: "https://www.toitures-martin.fr", ipHash: "a".repeat(40), body: form };
  assert.equal((await service.intakeFormLead({ ...base, key: "f".repeat(32) })).status, 404);
  assert.equal((await service.intakeFormLead({ ...base, origin: "https://pirate.example" })).status, 403);
  assert.equal((await service.intakeFormLead({ ...base, body: { email: "x@y.fr" } })).status, 422);
  const first = await service.intakeFormLead(base);
  assert.equal(first.ok, true); assert.equal(first.duplicate, false); assert.equal(first.allowedOrigin, "https://www.toitures-martin.fr");
  const again = await service.intakeFormLead(base);
  assert.equal(again.duplicate, true); assert.equal(again.leadId, first.leadId);
  const robot = await service.intakeFormLead({ ...base, body: { ...form, website: "http://spam.example" } });
  assert.equal(robot.ok, true);
  assert.equal(fake.tables.leads.length, 1);
  assert.equal(fake.tables.leads[0].ip_hash, "a".repeat(40));
  fake.tables.lead_settings[0].enabled = false;
  assert.equal((await service.intakeFormLead({ ...base, body: { ...form, message: "Autre demande de devis" } })).status, 404, "agent désactivé : formulaire refusé");
});

test("sans IA : qualification par règles, réponse type à valider, artisan prévenu une seule fois ; envoi validé puis relances", async () => {
  const { service, fake, sent } = setup();
  const { leadId } = await service.intakeFormLead({ clientId: CLIENT, key: KEY, origin: null, ipHash: null, body: form });
  const processed = await service.processLead(leadId);
  assert.equal(processed.ok, true, processed.message);
  const lead = fake.tables.leads[0];
  assert.equal(lead.state, "ready"); assert.equal(lead.qualified_by, "rules"); assert.equal(lead.service, "Réfection de toiture");
  const draft = fake.tables.lead_messages.find((m) => m.kind === "first_reply");
  assert.equal(draft.state, "draft"); assert.equal(draft.draft_source, "template");
  assert.match(draft.body, /Nous vous recontactons sous 24 h ouvrées/);
  assert.equal(sent.length, 1, "seule l'alerte de l'artisan part");
  assert.equal(sent[0].to, "artisan@toitures-martin.fr"); assert.equal(sent[0].replyTo, "marie@exemple.fr");
  assert.equal((await service.processLead(leadId)).ok, false, "jamais traitée deux fois");

  const result = await service.sendLeadMessage(draft.id, ADMIN, { subject: draft.subject, body: `${draft.body}\nPS : merci.` });
  assert.equal(result.ok, true, result.message);
  const reply = sent[1];
  assert.equal(reply.to, "marie@exemple.fr");
  assert.equal(reply.from, "Toitures Martin <envoi@code-v.fr>", "adresse commune au nom du client (domaine non vérifié)");
  assert.equal(reply.replyTo, "devis-0123456789abcdef@leads.code-v.fr", "les réponses reviennent à l'agent");
  assert.match(reply.text, /PS : merci\.[\s\S]*STOP/);
  assert.equal(fake.tables.lead_messages.find((m) => m.id === draft.id).draft_source, "admin");
  assert.equal(lead.state, "contacted"); assert.ok(lead.first_reply_at); assert.ok(lead.next_followup_at);
  assert.equal((await service.sendLeadMessage(draft.id, ADMIN)).ok, false, "jamais envoyé deux fois");

  // Relance due (samedi 10 h Paris, dans la fenêtre) : brouillon à valider, rien ne part sans réponse automatique.
  lead.next_followup_at = "2026-11-28T08:00:00.000Z";
  const tick = await service.runLeadsTick(new Date("2026-11-28T09:00:00Z"), { deadline: Date.now() + 60_000 });
  assert.equal(tick.followups, 1); assert.equal(tick.auto_sent, 0);
  const followup = fake.tables.lead_messages.find((m) => m.kind === "followup");
  assert.equal(followup.state, "draft"); assert.equal(followup.step, 1);
  assert.equal(lead.next_followup_at, null, "pas d'autre relance tant que celle-ci n'est pas envoyée");
  assert.equal(sent.length, 2);

  // Le prospect répond : relance annulée, demande « a répondu », réponse transmise à l'artisan.
  const inbound = await service.handleLeadInbound({ emailId: "em_1", from: "marie@exemple.fr", to: ["devis-0123456789abcdef@leads.code-v.fr"], subject: "Re: Votre demande" });
  assert.equal(inbound.handled, true);
  assert.equal(lead.state, "answered");
  assert.equal(followup.state, "cancelled");
  const forwarded = sent[2];
  assert.equal(forwarded.to, "artisan@toitures-martin.fr"); assert.equal(forwarded.replyTo, "marie@exemple.fr");
  assert.match(forwarded.text, /toujours d’actualité/); assert.doesNotMatch(forwarded.text, /ancien message/);
  assert.ok(fake.tables.lead_messages.some((m) => m.direction === "in" && m.state === "received"));
});

test("IA : réponse contrôlée gardée ; réponse qui invente un délai refusée puis remplacée par la réponse type", async () => {
  const qualification = { spam: false, service: "Réfection de toiture", urgency: "soon", score: "warm", summary: "Toiture à refaire avant l’hiver.", timeframe: "avant l’hiver", budget: null, property: null, location: "Narbonne", missing: ["photos"], questions: ["Pouvez-vous envoyer une photo de la toiture ?"], evidence: ["ma toiture est à refaire"] };
  const good = setup({ ai: () => ({ ...qualification, reply_subject: "Votre toiture", reply_body: goodBody }) });
  const { leadId } = await good.service.intakeFormLead({ clientId: CLIENT, key: KEY, origin: null, ipHash: null, body: form });
  await good.service.processLead(leadId);
  const draft = good.fake.tables.lead_messages.find((m) => m.kind === "first_reply");
  assert.equal(draft.draft_source, "ai"); assert.equal(draft.body, goodBody);
  assert.equal(good.fake.tables.leads[0].qualified_by, "ai");
  assert.match(good.aiCalls[0].instructions, /^CADRE DE MISSION — Agent Leads/);
  assert.equal(good.aiCalls[0].input.request_untrusted.message, form.message, "la demande est transmise comme donnée");

  const invents = setup({ ai: () => ({ ...qualification, reply_subject: "Votre toiture", reply_body: goodBody.replace("sous 24 h ouvrées", "en 48 h") }) });
  const second = await invents.service.intakeFormLead({ clientId: CLIENT, key: KEY, origin: null, ipHash: null, body: form });
  await invents.service.processLead(second.leadId);
  assert.equal(invents.aiCalls.length, 2, "un second essai avec le motif du refus");
  assert.match(invents.aiCalls[1].input.previous_reply_refused, /48|promesse/);
  const fallback = invents.fake.tables.lead_messages.find((m) => m.kind === "first_reply");
  assert.equal(fallback.draft_source, "template"); assert.doesNotMatch(fallback.body, /48/);
  assert.equal(invents.fake.tables.leads[0].qualified_by, "ai", "qualification de l'IA gardée, réponse de repli");

  const spam = setup({ ai: () => ({ ...qualification, spam: true, reply_subject: "x", reply_body: goodBody }) });
  const third = await spam.service.intakeFormLead({ clientId: CLIENT, key: KEY, origin: null, ipHash: null, body: form });
  await spam.service.processLead(third.leadId);
  assert.equal(spam.fake.tables.leads[0].state, "spam");
  assert.equal(spam.fake.tables.lead_messages.length, 0); assert.equal(spam.sent.length, 0, "indésirable : ni réponse ni alerte");
});

test("réponse automatique : envoyée tout de suite ; adresse exclue ou envoi refusé : rien ne part, le brouillon reste", async () => {
  const auto = setup({ settings: { auto_reply: true } });
  const { leadId } = await auto.service.intakeFormLead({ clientId: CLIENT, key: KEY, origin: null, ipHash: null, body: form });
  const r = await auto.service.processLead(leadId);
  assert.match(r.message, /envoyée automatiquement/);
  assert.equal(auto.sent.filter((m) => m.to === "marie@exemple.fr").length, 1);
  assert.equal(auto.fake.tables.leads[0].state, "contacted");

  const blocked = setup({ settings: { auto_reply: true }, suppressions: [{ scope: "client", client_id: CLIENT, email_normalized: "marie@exemple.fr" }] });
  const second = await blocked.service.intakeFormLead({ clientId: CLIENT, key: KEY, origin: null, ipHash: null, body: form });
  await blocked.service.processLead(second.leadId);
  assert.equal(blocked.sent.filter((m) => m.to === "marie@exemple.fr").length, 0);
  assert.equal(blocked.fake.tables.lead_messages.find((m) => m.kind === "first_reply").state, "cancelled");

  const failing = setup({ settings: { auto_reply: true, notify_email: null }, sendFails: true });
  const third = await failing.service.intakeFormLead({ clientId: CLIENT, key: KEY, origin: null, ipHash: null, body: form });
  const out = await failing.service.processLead(third.leadId);
  assert.match(out.message, /attend votre validation/);
  assert.equal(failing.fake.tables.lead_messages.find((m) => m.kind === "first_reply").state, "failed");
  assert.equal(failing.fake.tables.leads[0].state, "ready");

  const noReplyTo = setup({ settings: { auto_reply: true, reply_to: null }, env: { LEADS_INBOUND_DOMAIN: "" } });
  const fourth = await noReplyTo.service.intakeFormLead({ clientId: CLIENT, key: KEY, origin: null, ipHash: null, body: form });
  const refused = await noReplyTo.service.processLead(fourth.leadId);
  assert.match(refused.message, /Adresse de réponse manquante/);
});

test("statut manuel : relances et brouillons annulés ; demande transférée par l'artisan : coordonnées du demandeur reprises", async () => {
  const { service, fake } = setup();
  const { leadId } = await service.intakeFormLead({ clientId: CLIENT, key: KEY, origin: null, ipHash: null, body: form });
  await service.processLead(leadId);
  assert.equal((await service.setLeadState(ADMIN, leadId, "won")).ok, true);
  assert.equal(fake.tables.leads[0].state, "won");
  assert.equal(fake.tables.lead_messages.find((m) => m.kind === "first_reply").state, "cancelled");
  assert.equal((await service.setLeadState(ADMIN, leadId, "ready")).ok, false, "statut réservé à l'agent");

  const forwarded = setup();
  const result = await forwarded.service.handleLeadInbound({ emailId: null, from: "artisan@toitures-martin.fr", to: ["devis-0123456789abcdef@leads.code-v.fr"], subject: "TR: Demande de devis toiture" });
  assert.equal(result.handled, true);
  // Message transféré sans coordonnée du demandeur (ni e-mail ni téléphone dans le texte) : aucune demande créée, rien n'est inventé.
  assert.equal(forwarded.fake.tables.leads.length, 0);
  const other = await forwarded.service.handleLeadInbound({ emailId: null, from: "x@y.fr", to: ["contact@ailleurs.fr"], subject: "Bonjour" });
  assert.equal(other.handled, false, "adresse étrangère à l'agent : laissée à la prospection");
});
