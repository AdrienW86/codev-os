import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { withCharter } from "@/lib/harness/charter";
import { agentsAiConfigured } from "@/lib/ai/models";
import { structuredResponse, withAiScope } from "@/lib/ai/metered";
import { clientBrandContext } from "@/lib/visual-agent/service";
import { emailSendingStatus, sendEmail } from "@/lib/providers/email";
import { providerJson } from "@/lib/providers/api";
import { oauthBaseUrl } from "@/lib/integrations/publications-oauth/config";
import { isBlockedBy } from "@/lib/emailing/policy";
import { normalizeDomain, senderFromRow } from "@/lib/emailing/sender";
import { classifyReply, newReplyText, type InboundEmail } from "@/lib/acquisition/replies";
import {
  CLOSE_AFTER_DAYS, LEAD_INSTRUCTIONS, LEAD_SCHEMA, MANUAL_STATES, MAX_FOLLOWUPS, RETENTION_DAYS,
  checkQualification, checkReply, contactFromForwarded, followupReply, followupWindowOpen, inboundAddress, inboundKeyPrefix, isLeadState,
  leadFingerprint, nextFollowup, normalizeLeadEmail, notifyText, readSubmission, ruleQualification, settingsFromRow, settingsSchema, templateReply, transparencyFooter,
  type LeadSettings, type LeadSource, type LeadState, type LeadSubmission, type Qualification, type ReplyContext,
} from "./model";

// Agent Leads : réception des demandes de devis (formulaire du site, e-mail transféré, saisie), qualification, première
// réponse rapide et relances. Rien ne part sans validation, sauf pour un client qui a choisi la réponse automatique.
// Tables de la migration 20261229000000_leads_agent.sql (client non typé, comme les autres modules récents).
const db = () => getSupabaseServerClient() as unknown as SupabaseClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SYSTEM: Actor = { kind: "system", worker: "leads-agent" };
const MIGRATION = "Migration 20261229000000_leads_agent à appliquer.";
const missingTable = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "42P01" || e?.code === "PGRST205" || /could not find the table|does not exist/i.test(e?.message ?? "");
};
/** Limites de débit du formulaire public (par empreinte d'adresse IP). */
const RATE = { perClientHour: 5, allClientsHour: 20 } as const;
/** Une demande reste au plus ce nombre de passages en traitement avant d'être laissée en « Reçue » (traitement manuel). */
const MAX_PROCESS_ATTEMPTS = 5;

type Outcome = { ok: boolean; message: string };
export type LeadRow = {
  id: string; client_id: string; source: LeadSource; state: LeadState; contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  postcode: string | null; city: string | null; subject: string | null; message: string; page_url: string | null; service: string | null;
  urgency: string | null; score: string | null; qualification: Partial<Qualification>; qualified_by: string | null; received_at: string; first_reply_at: string | null;
  last_contact_at: string | null; next_followup_at: string | null; followups_sent: number; answered_at: string | null; closed_reason: string | null;
  process_attempts: number; notified_at: string | null;
};
const LEAD_COLUMNS = "id,client_id,source,state,contact_name,contact_email,contact_phone,postcode,city,subject,message,page_url,service,urgency,score,qualification,qualified_by,received_at,first_reply_at,last_contact_at,next_followup_at,followups_sent,answered_at,closed_reason,process_attempts,notified_at";
export type LeadMessageRow = {
  id: string; lead_id: string; client_id: string; direction: "out" | "in"; kind: "first_reply" | "followup" | "notify" | "inbound"; step: number;
  state: "draft" | "approved" | "sending" | "sent" | "failed" | "cancelled" | "received"; recipient: string | null; subject: string; body: string;
  draft_source: string | null; error: string | null; sent_at: string | null; created_at: string;
};
const MESSAGE_COLUMNS = "id,lead_id,client_id,direction,kind,step,state,recipient,subject,body,draft_source,error,sent_at,created_at";

const submissionOf = (lead: LeadRow): LeadSubmission => ({
  name: lead.contact_name, email: lead.contact_email, phone: lead.contact_phone, postcode: lead.postcode, city: lead.city, subject: lead.subject, message: lead.message, pageUrl: lead.page_url,
});
const ipSecret = () => process.env.PUBLICATION_CREDENTIALS_KEY || process.env.CRON_SECRET || "codev-leads";
export const leadsIpSecret = ipSecret;

// --- Réglages -------------------------------------------------------------------------------------------------------

async function readSettings(clientId: string): Promise<LeadSettings | null> {
  const { data, error } = await db().from("lead_settings").select("*").eq("client_id", clientId).maybeSingle();
  if (error) throw Object.assign(new Error(missingTable(error) ? "leads_not_installed" : "lead_settings_unavailable"), { missing: missingTable(error) });
  return settingsFromRow(data as Record<string, unknown> | null);
}
const timingSafeText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const newFormKey = () => randomBytes(16).toString("hex");

export type LeadsView = {
  ready: boolean; settings: LeadSettings | null; leads: LeadRow[]; messages: LeadMessageRow[];
  endpoint: string | null; inbound: string | null; sending: { enabled: boolean; reason: string | null }; senderVerified: boolean; aiReady: boolean;
  counts: Record<LeadState, number>;
};

export async function getLeadsView(clientId: string, filter: { state?: string } = {}): Promise<LeadsView> {
  if (!UUID.test(clientId)) throw new Error("invalid client");
  const counts = { new: 0, ready: 0, contacted: 0, answered: 0, won: 0, lost: 0, closed: 0, spam: 0 } as Record<LeadState, number>;
  const sending = emailSendingStatus();
  const base = { endpoint: null, inbound: null, sending: { enabled: sending.enabled, reason: sending.enabled ? null : sending.reason }, senderVerified: false, aiReady: agentsAiConfigured(process.env), counts };
  let settings: LeadSettings | null;
  try { settings = await readSettings(clientId); }
  catch (error) { if ((error as { missing?: boolean }).missing) return { ready: false, settings: null, leads: [], messages: [], ...base }; throw error; }
  let query = db().from("leads").select(LEAD_COLUMNS).eq("client_id", clientId).order("received_at", { ascending: false }).limit(60);
  if (isLeadState(filter.state)) query = query.eq("state", filter.state);
  const [leads, all, sender] = await Promise.all([
    query,
    db().from("leads").select("state").eq("client_id", clientId).limit(5000),
    db().from("client_email_settings").select("domain_status").eq("client_id", clientId).maybeSingle(),
  ]);
  if (leads.error || all.error) throw new Error("leads_unavailable");
  for (const row of (all.data ?? []) as { state: LeadState }[]) if (isLeadState(row.state)) counts[row.state]++;
  const rows = (leads.data ?? []) as LeadRow[];
  const messages = rows.length ? await db().from("lead_messages").select(MESSAGE_COLUMNS).in("lead_id", rows.map((r) => r.id)).order("created_at").limit(500) : { data: [], error: null };
  if (messages.error) throw new Error("lead_messages_unavailable");
  const origin = oauthBaseUrl();
  return {
    ...base, ready: true, settings, leads: rows, messages: (messages.data ?? []) as LeadMessageRow[],
    endpoint: settings && origin ? `${origin}/api/public/leads/${clientId}?key=${settings.form_key}` : null,
    inbound: settings ? inboundAddress(settings.form_key, process.env.LEADS_INBOUND_DOMAIN) : null,
    senderVerified: !sender.error && (sender.data as { domain_status?: string } | null)?.domain_status === "verified",
  };
}

export async function saveLeadSettings(actor: Actor & { kind: "admin" }, clientId: string, raw: Record<string, unknown>): Promise<Outcome> {
  if (!UUID.test(clientId)) return { ok: false, message: "Client invalide." };
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Réglages invalides." };
  let current: LeadSettings | null;
  try { current = await readSettings(clientId); } catch (error) { return { ok: false, message: (error as { missing?: boolean }).missing ? MIGRATION : "Lecture des réglages impossible." }; }
  const row = { ...parsed.data, updated_at: new Date().toISOString(), updated_by: actor.userId.slice(0, 120) };
  const { error } = current
    ? await db().from("lead_settings").update(row).eq("client_id", clientId)
    : await db().from("lead_settings").insert({ ...row, client_id: clientId, form_key: newFormKey() });
  if (error) return { ok: false, message: "Enregistrement des réglages impossible." };
  await writeAudit(actor, { action: "leads.settings_saved", resource_type: "client", resource_id: clientId, metadata: { enabled: parsed.data.enabled, auto_reply: parsed.data.auto_reply, followups: parsed.data.followups, origins: parsed.data.allowed_origins.length } });
  const warning = parsed.data.auto_reply && !parsed.data.reply_to && !inboundAddress(current?.form_key ?? "0".repeat(32), process.env.LEADS_INBOUND_DOMAIN)
    ? " Attention : sans adresse de réponse, la réponse automatique ne part pas (les réponses du prospect seraient perdues)." : "";
  return { ok: true, message: `Réglages de l’Agent Leads enregistrés.${warning}` };
}

export async function rotateFormKey(actor: Actor & { kind: "admin" }, clientId: string): Promise<Outcome> {
  if (!UUID.test(clientId)) return { ok: false, message: "Client invalide." };
  const { data, error } = await db().from("lead_settings").update({ form_key: newFormKey(), updated_at: new Date().toISOString(), updated_by: actor.userId.slice(0, 120) }).eq("client_id", clientId).select("client_id");
  if (error || !data?.length) return { ok: false, message: "Enregistrez d’abord les réglages de l’Agent Leads." };
  await writeAudit(actor, { action: "leads.form_key_rotated", resource_type: "client", resource_id: clientId, metadata: {} });
  return { ok: true, message: "Nouvelle clé de formulaire créée : mettez à jour le formulaire du site (l’ancienne clé est refusée)." };
}

// --- Réception ------------------------------------------------------------------------------------------------------

export type IntakeResult = { ok: true; leadId: string; duplicate: boolean } | { ok: false; status: number; error: string };

async function insertLead(clientId: string, source: LeadSource, submission: LeadSubmission, ipHash: string | null, now: Date): Promise<IntakeResult> {
  const fingerprint = leadFingerprint(clientId, submission);
  const { data, error } = await db().from("leads").insert({
    client_id: clientId, source, state: "new", process_attempts: 0, followups_sent: 0, contact_name: submission.name, contact_email: submission.email, contact_phone: submission.phone,
    postcode: submission.postcode, city: submission.city, subject: submission.subject, message: submission.message, page_url: submission.pageUrl,
    ip_hash: ipHash, fingerprint, received_at: now.toISOString(),
  }).select("id").single();
  if (error?.code === "23505") {
    const existing = await db().from("leads").select("id").eq("client_id", clientId).eq("fingerprint", fingerprint).maybeSingle();
    const id = (existing.data as { id?: string } | null)?.id;
    return id ? { ok: true, leadId: id, duplicate: true } : { ok: false, status: 503, error: "unavailable" };
  }
  if (error || !data) return { ok: false, status: 503, error: missingTable(error) ? "not_installed" : "unavailable" };
  return { ok: true, leadId: (data as { id: string }).id, duplicate: false };
}

/** Formulaire public du site : clé du client, origine autorisée, piège à robots, limite de débit, doublon exact. */
export type FormIntake = IntakeResult & { allowedOrigin: string | null };
export async function intakeFormLead(input: { clientId: string; key: string | null; origin: string | null; ipHash: string | null; body: unknown; now?: Date }): Promise<FormIntake> {
  const now = input.now ?? new Date();
  const fail = (status: number, error: string, allowedOrigin: string | null = null): FormIntake => ({ ok: false, status, error, allowedOrigin });
  if (!UUID.test(input.clientId) || !input.key || !/^[A-Za-z0-9_-]{24,64}$/.test(input.key)) return fail(404, "not_found");
  let settings: LeadSettings | null;
  try { settings = await readSettings(input.clientId); } catch { return fail(503, "unavailable"); }
  if (!settings || !timingSafeText(settings.form_key, input.key) || !settings.enabled) return fail(404, "not_found");
  const allowedOrigin = input.origin && settings.allowed_origins.includes(input.origin.toLowerCase()) ? input.origin : null;
  // Navigateur d'une origine non déclarée : refusé (un appel serveur à serveur n'envoie pas d'Origin).
  if (input.origin && !allowedOrigin) return fail(403, "origin_not_allowed");
  const submission = readSubmission(input.body);
  // Robot pris au piège : réponse identique à un succès, rien n'est enregistré.
  if (!submission.ok) return submission.reason === "honeypot" ? { ok: true, leadId: "", duplicate: true, allowedOrigin } : fail(422, submission.message, allowedOrigin);
  if (input.ipHash) {
    const since = new Date(now.getTime() - 3_600_000).toISOString();
    const [own, all] = await Promise.all([
      db().from("leads").select("id", { count: "exact", head: true }).eq("client_id", input.clientId).eq("ip_hash", input.ipHash).gte("received_at", since),
      db().from("leads").select("id", { count: "exact", head: true }).eq("ip_hash", input.ipHash).gte("received_at", since),
    ]);
    if (own.error || all.error) return fail(503, "unavailable", allowedOrigin);
    if ((own.count ?? 0) >= RATE.perClientHour || (all.count ?? 0) >= RATE.allClientsHour) return fail(429, "too_many_requests", allowedOrigin);
  }
  const result = await insertLead(input.clientId, "form", submission.value, input.ipHash, now);
  if (result.ok && !result.duplicate) await writeAudit(SYSTEM, { action: "lead.received", resource_type: "lead", resource_id: result.leadId, metadata: { client_id: input.clientId, source: "form" } });
  return { ...result, allowedOrigin };
}

/** Saisie manuelle (appel téléphonique, message reçu ailleurs) : même traitement que le formulaire. */
export async function addManualLead(actor: Actor & { kind: "admin" }, clientId: string, raw: Record<string, unknown>): Promise<Outcome> {
  if (!UUID.test(clientId)) return { ok: false, message: "Client invalide." };
  const submission = readSubmission(raw);
  if (!submission.ok) return { ok: false, message: submission.message };
  try { await readSettings(clientId); } catch (error) { return { ok: false, message: (error as { missing?: boolean }).missing ? MIGRATION : "Lecture impossible." }; }
  const result = await insertLead(clientId, "manual", submission.value, null, new Date());
  if (!result.ok) return { ok: false, message: result.error === "not_installed" ? MIGRATION : "Enregistrement impossible." };
  if (result.duplicate) return { ok: false, message: "Cette demande est déjà enregistrée." };
  await writeAudit(actor, { action: "lead.received", resource_type: "lead", resource_id: result.leadId, metadata: { client_id: clientId, source: "manual" } });
  const processed = await processLead(result.leadId).catch(() => null);
  return { ok: true, message: processed ? `Demande enregistrée. ${processed.message}` : "Demande enregistrée ; elle sera qualifiée au prochain passage." };
}

// --- Traitement : qualification, réponse proposée, alerte à l'artisan, envoi automatique éventuel --------------------

async function replyContext(clientId: string, settings: LeadSettings | null) {
  const ctx = await clientBrandContext(clientId, "leads");
  const client = await db().from("clients").select("name,company_name").eq("id", clientId).maybeSingle();
  const row = client.data as { name?: string; company_name?: string | null } | null;
  const clientName = row?.company_name || row?.name || ctx.client.name;
  const context: ReplyContext = { clientName, facts: ctx.facts.slice(0, 6000), exclusions: ctx.exclusions, callbackPromise: settings?.callback_promise ?? null, phone: settings?.phone ?? null, signature: settings?.signature ?? null };
  return { context, services: ctx.services, activity: ctx.client.activity, zone: ctx.client.zone };
}

type Drafted = { qualification: Qualification; reply: { subject: string; body: string }; source: "ai" | "template"; by: "ai" | "rules" };

async function qualifyAndDraft(lead: LeadRow, settings: LeadSettings | null): Promise<Drafted> {
  const submission = submissionOf(lead);
  const { context, services, activity, zone } = await replyContext(lead.client_id, settings);
  const rules = ruleQualification(submission, services);
  if (!agentsAiConfigured(process.env)) return { qualification: rules, reply: templateReply(submission, rules, context), source: "template", by: "rules" };
  let feedback: string | null = null;
  let qualification: Qualification | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let value: unknown;
    try {
      ({ value } = await withAiScope({ agent: "leads", clientId: lead.client_id }, () => structuredResponse(withCharter("leads", LEAD_INSTRUCTIONS), JSON.stringify({
        company: context.clientName, activity, zone, services, facts_untrusted: context.facts,
        ...(context.exclusions.length ? { client_exclusions_never_write: context.exclusions } : {}),
        callback_promise: context.callbackPromise, phone: context.phone, signature: context.signature,
        request_untrusted: { name: submission.name, subject: submission.subject, message: submission.message, postcode: submission.postcode, city: submission.city, has_phone: Boolean(submission.phone), has_email: Boolean(submission.email) },
        ...(feedback ? { previous_reply_refused: feedback } : {}),
      }), LEAD_SCHEMA, { maxOutputTokens: 1500, timeoutMs: 45_000 })));
    } catch { break; }
    qualification = checkQualification(value, { submission, services }) ?? qualification;
    if (!qualification) break;
    const v = value as { reply_subject?: unknown; reply_body?: unknown };
    const reply = checkReply(v.reply_subject, v.reply_body, { context, submission });
    if (reply.ok) return { qualification: { ...qualification, spam: qualification.spam || rules.spam }, reply: { subject: reply.subject, body: reply.body }, source: "ai", by: "ai" };
    feedback = reply.reason;
  }
  // Qualification de l'IA gardée si elle est valable ; réponse de repli (aucune invention possible).
  const final = qualification ? { ...qualification, spam: qualification.spam || rules.spam, questions: qualification.questions.length ? qualification.questions : rules.questions } : rules;
  return { qualification: final, reply: templateReply(submission, final, context), source: "template", by: qualification ? "ai" : "rules" };
}

async function readLead(id: string): Promise<LeadRow | null> {
  if (!UUID.test(id)) return null;
  const { data } = await db().from("leads").select(LEAD_COLUMNS).eq("id", id).maybeSingle();
  return (data as LeadRow | null) ?? null;
}

export async function processLead(leadId: string, now = new Date()): Promise<Outcome> {
  const lead = await readLead(leadId);
  if (!lead || lead.state !== "new") return { ok: false, message: "Demande déjà traitée." };
  // Réservation : un seul traitement à la fois (le webhook et le planificateur peuvent se croiser).
  const { data: claimed } = await db().from("leads").update({ process_attempts: lead.process_attempts + 1, updated_at: now.toISOString() })
    .eq("id", lead.id).eq("state", "new").eq("process_attempts", lead.process_attempts).select("id");
  if (!claimed?.length) return { ok: false, message: "Traitement déjà en cours." };
  const settings = await readSettings(lead.client_id).catch(() => null);
  const drafted = await qualifyAndDraft(lead, settings);
  const q = drafted.qualification;
  const at = new Date().toISOString();
  if (q.spam) {
    await db().from("leads").update({ state: "spam", service: q.service, urgency: q.urgency, score: "cold", qualification: q, qualified_by: drafted.by, closed_reason: "spam", updated_at: at }).eq("id", lead.id).eq("state", "new");
    await writeAudit(SYSTEM, { action: "lead.spam", resource_type: "lead", resource_id: lead.id, metadata: { client_id: lead.client_id, by: drafted.by } });
    return { ok: true, message: "Classée indésirable : aucune réponse préparée." };
  }
  // Sans adresse e-mail : « Réponse à valider » sans brouillon, l'écran indique de rappeler par téléphone.
  const nextState: LeadState = "ready";
  const { error } = await db().from("leads").update({ state: nextState, service: q.service, urgency: q.urgency, score: q.score, qualification: q, qualified_by: drafted.by, updated_at: at }).eq("id", lead.id).eq("state", "new");
  if (error) throw new Error("lead_update_failed");
  if (lead.contact_email) {
    const insert = await db().from("lead_messages").insert({
      lead_id: lead.id, client_id: lead.client_id, direction: "out", kind: "first_reply", step: 0, state: "draft", recipient: lead.contact_email,
      subject: drafted.reply.subject, body: drafted.reply.body, draft_source: drafted.source,
    });
    if (insert.error && insert.error.code !== "23505") throw new Error("lead_message_insert_failed");
  }
  await writeAudit(SYSTEM, { action: "lead.qualified", resource_type: "lead", resource_id: lead.id, metadata: { client_id: lead.client_id, by: drafted.by, draft: drafted.source, score: q.score, urgency: q.urgency } });
  await notifyArtisan(lead, q, settings).catch(() => { console.error("[leads] Alerte à l'artisan non envoyée."); });
  if (!lead.contact_email) return { ok: true, message: "Qualifiée. Pas d’adresse e-mail : à rappeler par téléphone (l’artisan est prévenu s’il a donné son adresse)." };
  if (settings?.auto_reply) {
    const draft = await db().from("lead_messages").select("id").eq("lead_id", lead.id).eq("kind", "first_reply").eq("state", "draft").maybeSingle();
    const id = (draft.data as { id?: string } | null)?.id;
    if (id) {
      const sent = await sendLeadMessage(id, null);
      return { ok: true, message: sent.ok ? "Qualifiée et réponse envoyée automatiquement." : `Qualifiée ; réponse automatique non envoyée (${sent.message}) : elle attend votre validation.` };
    }
  }
  return { ok: true, message: `Qualifiée (${drafted.by === "ai" ? "IA" : "règles"}) ; réponse ${drafted.source === "ai" ? "rédigée" : "type"} prête à valider.` };
}

async function notifyArtisan(lead: LeadRow, q: Qualification, settings: LeadSettings | null) {
  if (!settings?.notify_email || lead.notified_at || !emailSendingStatus().enabled) return;
  const { data: claimed } = await db().from("leads").update({ notified_at: new Date().toISOString() }).eq("id", lead.id).is("notified_at", null).select("id");
  if (!claimed?.length) return;
  const origin = oauthBaseUrl();
  const location = [lead.postcode, lead.city].filter(Boolean).join(" ") || q.location;
  const note = notifyText({ name: lead.contact_name, email: lead.contact_email, phone: lead.contact_phone, location, message: lead.message, source: lead.source }, q, origin ? `${origin}/leads?client=${lead.client_id}` : null);
  try {
    // Réponse directe au demandeur depuis la boîte de l'artisan (« Répondre ») quand son adresse est connue.
    await sendEmail({ to: settings.notify_email, subject: note.subject, text: note.text, idempotencyKey: `lead-notify:${lead.id}`, replyTo: lead.contact_email });
    await db().from("lead_messages").insert({ lead_id: lead.id, client_id: lead.client_id, direction: "out", kind: "notify", step: 0, state: "sent", recipient: settings.notify_email, subject: note.subject, body: note.text.slice(0, 6000), draft_source: "template", sent_at: new Date().toISOString() });
  } catch {
    await db().from("leads").update({ notified_at: null }).eq("id", lead.id);
    throw new Error("notify_failed");
  }
}

// --- Envoi ----------------------------------------------------------------------------------------------------------

async function senderFor(clientId: string, clientName: string, settings: LeadSettings | null): Promise<{ from?: string; replyTo: string | null }> {
  const row = await db().from("client_email_settings").select("sending_domain,from_name,from_local_part,reply_to,domain_status").eq("client_id", clientId).maybeSingle();
  const sender = row.error ? null : senderFromRow(row.data as Record<string, unknown> | null);
  const inbound = settings ? inboundAddress(settings.form_key, process.env.LEADS_INBOUND_DOMAIN) : null;
  // Les réponses du prospect reviennent à l'agent (adresse de réception) pour arrêter les relances ; sinon chez l'artisan.
  const replyTo = inbound ?? settings?.reply_to ?? sender?.reply_to ?? null;
  const name = (sender?.from_name || clientName).replace(/[<>"\r\n\x00]/g, "").trim().slice(0, 80) || "Votre artisan";
  const domain = sender?.domain_status === "verified" ? normalizeDomain(sender.sending_domain) : null;
  if (domain) return { from: `${name} <contact@${domain}>`, replyTo };
  // Domaine du client non vérifié : adresse commune EMAIL_FROM, au nom du client.
  const shared = (process.env.EMAIL_FROM ?? "").replace(/^.*<|>.*$/g, "").trim();
  return { from: shared ? `${name} <${shared}>` : undefined, replyTo };
}

/**
 * Envoie un message approuvé (ou une réponse automatique, actor null). Réservé par mise à jour conditionnelle et clé
 * d'idempotence : un double clic ou deux passages ne l'envoient jamais deux fois. Adresse exclue : jamais d'envoi.
 */
export async function sendLeadMessage(messageId: string, actor: (Actor & { kind: "admin" }) | null, edit?: { subject: string; body: string }): Promise<Outcome> {
  if (!UUID.test(messageId)) return { ok: false, message: "Message invalide." };
  const { data } = await db().from("lead_messages").select(MESSAGE_COLUMNS).eq("id", messageId).maybeSingle();
  const message = data as LeadMessageRow | null;
  if (!message || message.direction !== "out" || !["draft", "approved", "failed"].includes(message.state) || message.kind === "notify") return { ok: false, message: "Ce message ne peut plus être envoyé." };
  const lead = await readLead(message.lead_id);
  if (!lead || !["ready", "contacted"].includes(lead.state) || !lead.contact_email) return { ok: false, message: "La demande n’attend plus de réponse (statut changé)." };
  const status = emailSendingStatus();
  if (!status.enabled) return { ok: false, message: status.reason };
  const settings = await readSettings(lead.client_id).catch(() => null);
  const client = await db().from("clients").select("name,company_name").eq("id", lead.client_id).maybeSingle();
  const clientName = (client.data as { name?: string; company_name?: string | null } | null)?.company_name || (client.data as { name?: string } | null)?.name || "Votre artisan";
  const sender = await senderFor(lead.client_id, clientName, settings);
  if (!sender.replyTo) return { ok: false, message: "Adresse de réponse manquante (réglages de l’Agent Leads) : le prospect ne pourrait pas vous répondre." };
  const subject = (edit?.subject ?? message.subject).replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const body = (edit?.body ?? message.body).replace(/\r\n/g, "\n").trim().slice(0, 5500);
  if (subject.length < 3 || body.length < 20) return { ok: false, message: "Objet ou message trop court." };
  const { data: suppressed, error: suppressionError } = await db().from("email_suppressions").select("scope,client_id").eq("email_normalized", lead.contact_email).limit(20);
  if (suppressionError && !missingTable(suppressionError)) return { ok: false, message: "Liste d’exclusion illisible : envoi refusé par prudence." };
  if (suppressed && isBlockedBy(suppressed as { scope: string; client_id: string | null }[], { scope: "client", clientId: lead.client_id })) {
    await db().from("lead_messages").update({ state: "cancelled", error: "suppressed", updated_at: new Date().toISOString() }).eq("id", message.id);
    return { ok: false, message: "Adresse exclue (désinscription ou rebond) : aucun envoi." };
  }
  const now = new Date();
  const key = `lead-msg:${message.id}`;
  const { data: claimed } = await db().from("lead_messages").update({
    state: "sending", subject, body, idempotency_key: key, updated_at: now.toISOString(),
    ...(edit && (edit.subject !== message.subject || edit.body !== message.body) ? { draft_source: "admin" } : {}),
    ...(actor ? { approved_by: actor.userId.slice(0, 120), approved_at: now.toISOString() } : { approved_by: "auto", approved_at: now.toISOString() }),
  }).eq("id", message.id).eq("state", message.state).select("id");
  if (!claimed?.length) return { ok: false, message: "Envoi déjà en cours." };
  try {
    const result = await sendEmail({ to: lead.contact_email, subject, text: `${body}\n\n${transparencyFooter(clientName, lead.received_at)}`, idempotencyKey: key, from: sender.from, replyTo: sender.replyTo });
    const sentAt = new Date();
    await db().from("lead_messages").update({ state: "sent", provider_message_id: result.id.slice(0, 120), sent_at: sentAt.toISOString(), error: null, updated_at: sentAt.toISOString() }).eq("id", message.id);
    const followups = settings?.followups ?? 0;
    const next = nextFollowup(sentAt, message.step, followups);
    await db().from("leads").update({
      state: "contacted", last_contact_at: sentAt.toISOString(), ...(message.kind === "first_reply" ? { first_reply_at: sentAt.toISOString() } : { followups_sent: Math.min(MAX_FOLLOWUPS, message.step) }),
      next_followup_at: next?.toISOString() ?? null, updated_at: sentAt.toISOString(),
    }).eq("id", lead.id).in("state", ["ready", "contacted"]);
    await writeAudit(actor ?? SYSTEM, { action: "lead.message_sent", resource_type: "lead", resource_id: lead.id, metadata: { client_id: lead.client_id, kind: message.kind, step: message.step, auto: !actor } });
    return { ok: true, message: message.kind === "first_reply" ? "Réponse envoyée au prospect." : `Relance ${message.step} envoyée.` };
  } catch (error) {
    const code = (error as { code?: string; kind?: string } | null)?.code ?? (error as { kind?: string } | null)?.kind ?? "send_failed";
    await db().from("lead_messages").update({ state: "failed", error: String(code).slice(0, 60), updated_at: new Date().toISOString() }).eq("id", message.id);
    await writeAudit(actor ?? SYSTEM, { action: "lead.message_failed", resource_type: "lead", resource_id: lead.id, metadata: { client_id: lead.client_id, kind: message.kind } });
    return { ok: false, message: "Envoi refusé par le fournisseur d’e-mails : le message reste à renvoyer." };
  }
}

export async function cancelLeadMessage(actor: Actor & { kind: "admin" }, messageId: string): Promise<Outcome> {
  if (!UUID.test(messageId)) return { ok: false, message: "Message invalide." };
  const { data, error } = await db().from("lead_messages").update({ state: "cancelled", updated_at: new Date().toISOString() }).eq("id", messageId).in("state", ["draft", "approved", "failed"]).select("lead_id,kind");
  if (error || !data?.length) return { ok: false, message: "Ce message ne peut plus être annulé." };
  const row = data[0] as { lead_id: string; kind: string };
  // Relance annulée : plus de relance automatique pour cette demande.
  if (row.kind === "followup") await db().from("leads").update({ next_followup_at: null, updated_at: new Date().toISOString() }).eq("id", row.lead_id);
  await writeAudit(actor, { action: "lead.message_cancelled", resource_type: "lead", resource_id: row.lead_id, metadata: { kind: row.kind } });
  return { ok: true, message: "Message annulé." };
}

/** Statut choisi à la main : toute réponse ou relance en attente est annulée, plus aucune relance n'est prévue. */
export async function setLeadState(actor: Actor & { kind: "admin" }, leadId: string, state: unknown): Promise<Outcome> {
  if (!UUID.test(leadId) || !isLeadState(state) || !MANUAL_STATES.includes(state)) return { ok: false, message: "Statut invalide." };
  const at = new Date().toISOString();
  const { data, error } = await db().from("leads").update({ state, next_followup_at: null, closed_reason: state === "answered" ? null : `admin:${state}`, ...(state === "answered" ? { answered_at: at } : {}), updated_at: at }).eq("id", leadId).select("client_id");
  if (error || !data?.length) return { ok: false, message: "Mise à jour impossible." };
  await db().from("lead_messages").update({ state: "cancelled", updated_at: at }).eq("lead_id", leadId).in("state", ["draft", "approved", "failed"]);
  await writeAudit(actor, { action: "lead.state_changed", resource_type: "lead", resource_id: leadId, metadata: { state, client_id: (data[0] as { client_id: string }).client_id } });
  return { ok: true, message: "Statut mis à jour." };
}

/** Relance du traitement d'une demande restée « Reçue » (IA indisponible, échec) : bouton de l'écran. */
export async function retryLead(actor: Actor & { kind: "admin" }, leadId: string): Promise<Outcome> {
  const lead = await readLead(leadId);
  if (!lead || lead.state !== "new") return { ok: false, message: "Cette demande est déjà traitée." };
  await writeAudit(actor, { action: "lead.retry", resource_type: "lead", resource_id: leadId, metadata: {} });
  return processLead(leadId).catch(() => ({ ok: false, message: "Traitement impossible pour le moment." }));
}

// --- Planificateur (étape « leads ») -------------------------------------------------------------------------------

export type LeadsTick = { processed: number; failed: number; followups: number; auto_sent: number; closed: number; purged: number; disabled?: "migration" };

export async function runLeadsTick(now = new Date(), options: { deadline?: number } = {}): Promise<LeadsTick> {
  const summary: LeadsTick = { processed: 0, failed: 0, followups: 0, auto_sent: 0, closed: 0, purged: 0 };
  const deadline = options.deadline ?? Date.now() + 50_000;
  const probe = await db().from("lead_settings").select("client_id").eq("enabled", true).limit(500);
  if (probe.error) { if (missingTable(probe.error)) return { ...summary, disabled: "migration" }; throw new Error("lead_settings_unavailable"); }
  // 1. Demandes reçues non traitées (le traitement immédiat du formulaire a échoué ou n'a pas eu le temps).
  const pending = await db().from("leads").select("id").eq("state", "new").lt("process_attempts", MAX_PROCESS_ATTEMPTS).lte("received_at", new Date(now.getTime() - 60_000).toISOString()).order("received_at").limit(5);
  if (pending.error) throw new Error("leads_unavailable");
  for (const row of (pending.data ?? []) as { id: string }[]) {
    if (deadline - Date.now() < 15_000) break;
    try { const r = await processLead(row.id, now); if (r.ok) summary.processed++; } catch { summary.failed++; }
  }
  // 2. Relances dues (lundi-samedi, 9 h-19 h) : rédigées par modèle de repli ; envoyées seules si la réponse automatique est choisie.
  if (followupWindowOpen(now)) {
    const due = await db().from("leads").select(LEAD_COLUMNS).eq("state", "contacted").lte("next_followup_at", now.toISOString()).order("next_followup_at").limit(10);
    if (due.error) throw new Error("leads_unavailable");
    for (const lead of (due.data ?? []) as LeadRow[]) {
      if (deadline - Date.now() < 8_000) break;
      try { const r = await prepareFollowup(lead, now); if (r === "drafted" || r === "sent") summary.followups++; if (r === "sent") summary.auto_sent++; } catch { summary.failed++; }
    }
  }
  // 3. Sans réponse après la dernière relance : demande close.
  const closeBefore = new Date(now.getTime() - CLOSE_AFTER_DAYS * 86_400_000).toISOString();
  const stale = await db().from("leads").update({ state: "closed", closed_reason: "no_answer", updated_at: now.toISOString() })
    .eq("state", "contacted").is("next_followup_at", null).lte("last_contact_at", closeBefore).select("id");
  if (!stale.error) {
    const ids = ((stale.data ?? []) as { id: string }[]).map((r) => r.id);
    summary.closed = ids.length;
    if (ids.length) await db().from("lead_messages").update({ state: "cancelled", updated_at: now.toISOString() }).in("lead_id", ids).in("state", ["draft", "approved", "failed"]);
  }
  // 4. Conservation : demandes sans échange depuis 3 ans supprimées (messages compris).
  const purgeBefore = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  const purged = await db().from("leads").delete().lte("updated_at", purgeBefore).not("state", "in", "(new,ready)").select("id");
  if (!purged.error) summary.purged = purged.data?.length ?? 0;
  return summary;
}

async function prepareFollowup(lead: LeadRow, now: Date): Promise<"drafted" | "sent" | "skipped"> {
  const settings = await readSettings(lead.client_id).catch(() => null);
  const step = lead.followups_sent + 1;
  if (!settings?.enabled || step > Math.min(settings.followups, MAX_FOLLOWUPS) || !lead.contact_email) {
    await db().from("leads").update({ next_followup_at: null, updated_at: now.toISOString() }).eq("id", lead.id);
    return "skipped";
  }
  const { context } = await replyContext(lead.client_id, settings);
  const text = followupReply(step, { name: lead.contact_name, service: lead.service, receivedAt: lead.received_at, questions: lead.qualification?.questions ?? [] }, context);
  // L'échéance est retirée tout de suite : une relance non validée n'en appelle pas d'autre (la suivante est prévue à l'envoi).
  const { data: claimed } = await db().from("leads").update({ next_followup_at: null, updated_at: now.toISOString() }).eq("id", lead.id).eq("next_followup_at", lead.next_followup_at!).select("id");
  if (!claimed?.length) return "skipped";
  const { data, error } = await db().from("lead_messages").insert({
    lead_id: lead.id, client_id: lead.client_id, direction: "out", kind: "followup", step, state: "draft", recipient: lead.contact_email, subject: text.subject, body: text.body, draft_source: "template",
  }).select("id").single();
  if (error) { if (error.code === "23505") return "skipped"; throw new Error("followup_insert_failed"); }
  if (!settings.auto_reply) return "drafted";
  const sent = await sendLeadMessage((data as { id: string }).id, null);
  return sent.ok ? "sent" : "drafted";
}

// --- E-mails entrants (webhook Resend « email.received ») ------------------------------------------------------------

async function receivedText(emailId: string | null): Promise<{ text: string | null; autoSubmitted: string | null }> {
  const key = process.env.RESEND_ADMIN_API_KEY || process.env.RESEND_API_KEY;
  if (!emailId || !key) return { text: null, autoSubmitted: null };
  try {
    const data = await providerJson<{ text?: unknown; headers?: unknown }>("resend", `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { method: "GET", headers: { Authorization: `Bearer ${key}` } });
    const headers = data.headers && typeof data.headers === "object" ? data.headers as Record<string, unknown> : {};
    const auto = Object.entries(headers).find(([name]) => name.toLowerCase() === "auto-submitted")?.[1];
    return { text: typeof data.text === "string" ? data.text.slice(0, 50_000) : null, autoSubmitted: typeof auto === "string" ? auto.slice(0, 60) : null };
  } catch { return { text: null, autoSubmitted: null }; }
}

/**
 * E-mail reçu sur une adresse devis-… du domaine entrant. Réponse d'un prospect connu : relances arrêtées, artisan prévenu.
 * Autre expéditeur : nouvelle demande (e-mail transféré par l'artisan ou écrit directement). false : adresse étrangère à l'agent.
 */
export type InboundOutcome = { handled: boolean; process?: string };
export async function handleLeadInbound(inbound: InboundEmail, now = new Date()): Promise<InboundOutcome> {
  const domain = process.env.LEADS_INBOUND_DOMAIN;
  const prefix = inbound.to.map((address) => inboundKeyPrefix(address, domain)).find(Boolean);
  if (!prefix || !inbound.from) return { handled: false };
  // Clé hexadécimale : les clés qui commencent par le préfixe sont exactement l'intervalle [préfixe, préfixe + "g").
  const { data, error } = await db().from("lead_settings").select("*").gte("form_key", prefix).lt("form_key", `${prefix}g`).limit(2);
  if (error) { if (missingTable(error)) return { handled: true }; throw new Error("lead_settings_unavailable"); }
  const settings = ((data ?? []) as Record<string, unknown>[]).map(settingsFromRow).filter((s): s is LeadSettings => Boolean(s));
  if (settings.length !== 1 || !settings[0].enabled) return { handled: true }; // adresse de l'agent mais inconnue ou désactivée : ignorée
  const config = settings[0];
  const content = await receivedText(inbound.emailId);
  const kind = classifyReply({ subject: inbound.subject, text: content.text, autoSubmitted: content.autoSubmitted });
  const known = await db().from("leads").select(LEAD_COLUMNS).eq("client_id", config.client_id).eq("contact_email", inbound.from).in("state", ["ready", "contacted", "answered"]).order("received_at", { ascending: false }).limit(1);
  if (known.error) throw new Error("leads_unavailable");
  const lead = ((known.data ?? []) as LeadRow[])[0];
  const at = now.toISOString();
  if (lead) {
    if (kind === "auto_reply") return { handled: true };
    const excerpt = newReplyText(content.text ?? "").slice(0, 4000) || inbound.subject || "(réponse sans texte lisible)";
    await db().from("lead_messages").insert({ lead_id: lead.id, client_id: lead.client_id, direction: "in", kind: "inbound", step: 0, state: "received", recipient: null, subject: (inbound.subject || "Réponse").slice(0, 200), body: excerpt.slice(0, 6000), created_at: at });
    await db().from("lead_messages").update({ state: "cancelled", updated_at: at }).eq("lead_id", lead.id).in("state", ["draft", "approved", "failed"]).eq("kind", "followup");
    await db().from("leads").update({ state: kind === "stop" ? "lost" : "answered", answered_at: at, next_followup_at: null, closed_reason: kind === "stop" ? "stop" : null, updated_at: at }).eq("id", lead.id);
    if (kind === "stop") {
      const r = await db().from("email_suppressions").insert({ scope: "client", client_id: lead.client_id, email_normalized: inbound.from, reason: "unsubscribe", source: "lead_reply_stop" });
      if (r.error && r.error.code !== "23505" && !missingTable(r.error)) throw new Error("lead_suppression_failed");
    } else if (config.notify_email && emailSendingStatus().enabled) {
      // La réponse du prospect est transmise à l'artisan, qui lui répond directement (« Répondre »).
      await sendEmail({ to: config.notify_email, subject: `Réponse de ${lead.contact_name ?? inbound.from} : ${inbound.subject}`.slice(0, 200), text: `${lead.contact_name ?? "Le prospect"} (${inbound.from}${lead.contact_phone ? `, ${lead.contact_phone}` : ""}) a répondu :\n\n${excerpt}`, idempotencyKey: `lead-in:${inbound.emailId ?? `${lead.id}:${at}`}`, replyTo: inbound.from })
        .catch(() => { console.error("[leads] Réponse du prospect non transmise à l'artisan."); });
    }
    await writeAudit(SYSTEM, { action: kind === "stop" ? "lead.stop" : "lead.answered", resource_type: "lead", resource_id: lead.id, metadata: { client_id: lead.client_id } });
    return { handled: true };
  }
  if (kind === "auto_reply") return { handled: true };
  // Nouvelle demande. Transférée par l'artisan : les coordonnées du demandeur sont lues dans le message transféré.
  const forwarded = config.notify_email === inbound.from || config.reply_to === inbound.from;
  const body = content.text ?? "";
  const contact = forwarded ? contactFromForwarded(body, [inbound.from, config.notify_email ?? "", config.reply_to ?? ""]) : { email: inbound.from, phone: contactFromForwarded(body, [inbound.from]).phone, name: null };
  const submission = readSubmission({ name: contact.name ?? "", email: contact.email ?? "", phone: contact.phone ?? "", subject: inbound.subject.replace(/^\s*(tr|fwd?)\s*:\s*/i, ""), message: (forwarded ? body : newReplyText(body)) || inbound.subject });
  if (!submission.ok) { await writeAudit(SYSTEM, { action: "lead.inbound_unreadable", resource_type: "client", resource_id: config.client_id, metadata: { forwarded } }); return { handled: true }; }
  const result = await insertLead(config.client_id, "email", submission.value, null, now);
  if (result.ok && !result.duplicate) {
    await writeAudit(SYSTEM, { action: "lead.received", resource_type: "lead", resource_id: result.leadId, metadata: { client_id: config.client_id, source: "email", forwarded } });
    return { handled: true, process: result.leadId };
  }
  return { handled: true };
}

export const leadsAddressOk = (value: unknown) => normalizeLeadEmail(value) !== null;
