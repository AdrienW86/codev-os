import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { ProviderError } from "@/lib/providers/errors";
import { emailSendingStatus, sendEmail } from "@/lib/providers/email";
import { oauthBaseUrl } from "@/lib/integrations/publications-oauth/config";
import { isBlockedBy, normalizeEmail, unsubscribeHeaders, type SuppressionScope } from "@/lib/emailing/policy";
import { addressCheckFresh } from "@/lib/emailing/address-check";
import { checkAddressesWithDns } from "@/lib/emailing/address-check-dns";
import { evaluateAcquisitionDispatch } from "./connector-gates";
import { resolveProspectingSender } from "./prospecting-sender";
import { readProspectingSender, workspaceProtectedDomains } from "./sender-service";
import { FOLLOW_UP_BUSINESS_DAYS, composeProspectingText, followUpMessage, unsubscribeLink } from "./outreach-mail";
import { auditOutreachDraft } from "./outreach";
import { NO_CONTACT_STAGES, addBusinessDays, dailyCap, inSendWindow, localDayStartIso, reputationVerdict, tickBudget, ticksLeftToday } from "./send-plan";

// Prospection e-mail, PR 3 : approbation, planification et envoi progressif (migration 20261220000000).
// Chaîne : brouillon relu → approbation humaine (confirmation cruciale) → envoi par le planificateur dans les créneaux
// de bureau, au rythme du préchauffage, avec tous les verrous rejoués juste avant chaque message.
const db = () => getSupabaseServerClient() as unknown as SupabaseClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Outcome = { ok: boolean; message: string };
type Admin = Actor & { kind: "admin" };
const SYSTEM: Actor = { kind: "system", worker: "acquisition-send" };
/** Au plus 100 messages approuvés en une fois (relecture humaine réaliste). */
export const APPROVE_MAX = 100;
const MAX_ATTEMPTS = 3;

type Workspace = { id: string; client_id: string | null; label: string; sending_enabled: boolean; emergency_stop: boolean; daily_send_limit: number; timezone: string };
const WORKSPACE_COLUMNS = "id,client_id,label,sending_enabled,emergency_stop,daily_send_limit,timezone";
const scopeOf = (workspace: { client_id: string | null }): SuppressionScope => workspace.client_id ? { scope: "client", clientId: workspace.client_id } : { scope: "codev" };

async function readWorkspace(id: string): Promise<Workspace | null> {
  if (!UUID.test(id)) return null;
  const { data } = await db().from("acquisition_workspaces").select(WORKSPACE_COLUMNS).eq("id", id).maybeSingle();
  return data as Workspace | null;
}

/** Adresses exclues pour cet espace : exclusions communes (globales ou de l'expéditeur) et exclusions de l'espace. */
async function blockedEmails(workspace: Workspace, emails: string[]): Promise<Set<string> | null> {
  const blocked = new Set<string>();
  if (!emails.length) return blocked;
  const [local, common] = await Promise.all([
    db().from("acquisition_suppressions").select("email_normalized").eq("workspace_id", workspace.id).in("email_normalized", emails),
    db().from("email_suppressions").select("email_normalized,scope,client_id").in("email_normalized", emails),
  ]);
  if (local.error || common.error) return null; // en cas de doute, rien ne part
  for (const row of (local.data ?? []) as { email_normalized: string }[]) blocked.add(row.email_normalized);
  const byEmail = new Map<string, { scope: string; client_id: string | null }[]>();
  for (const row of (common.data ?? []) as { email_normalized: string; scope: string; client_id: string | null }[]) byEmail.set(row.email_normalized, [...(byEmail.get(row.email_normalized) ?? []), row]);
  for (const [email, rows] of byEmail) if (isBlockedBy(rows, scopeOf(workspace))) blocked.add(email);
  return blocked;
}

// ---------------------------------------------------------------------------------------------------------------
// Actions de l'administrateur (écran Acquisition → E-mails).

/** Corrige un brouillon avant approbation (objet, texte). */
export async function updateDraft(actor: Admin, workspaceId: string, id: string, input: { subject: string; body: string }): Promise<Outcome> {
  if (!UUID.test(workspaceId) || !UUID.test(id)) return { ok: false, message: "Brouillon invalide." };
  const subject = input.subject.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200), body = input.body.replace(/\r\n/g, "\n").trim().slice(0, 8000);
  if (subject.length < 3 || body.length < 20) return { ok: false, message: "Objet ou texte trop court." };
  const { data, error } = await db().from("acquisition_messages").update({ subject, body_text: body }).eq("id", id).eq("workspace_id", workspaceId).eq("state", "draft").select("id");
  if (error || !data?.length) return { ok: false, message: "Seul un brouillon peut être modifié." };
  await writeAudit(actor, { action: "acquisition_message.edited", resource_type: "acquisition_workspace", resource_id: workspaceId, metadata: { message_id: id } });
  return { ok: true, message: "Brouillon enregistré." };
}

/**
 * Approuve des brouillons (confirmation cruciale côté écran). Refusés : adresse exclue, non vérifiée (revérifiée ici
 * si besoin), brouillon incomplet (variable non remplacée, mention d'opposition absente) ou fiche déjà en réponse.
 */
export async function approveMessages(actor: Admin, workspaceId: string, ids: string[], options: { followUp?: boolean } = {}): Promise<Outcome> {
  const workspace = await readWorkspace(workspaceId);
  const unique = [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, APPROVE_MAX);
  if (!workspace || !unique.length) return { ok: false, message: "Aucun brouillon sélectionné." };
  const { data, error } = await db().from("acquisition_messages").select("id,prospect_id,recipient_email,subject,body_text,state,draft_source,step").eq("workspace_id", workspace.id).in("id", unique);
  if (error) return { ok: false, message: "Migration 20261220000000_acquisition_sending à appliquer." };
  // Un brouillon en cours de rédaction personnalisée n'est pas approuvable (il va changer).
  const drafts = ((data ?? []) as { id: string; prospect_id: string; recipient_email: string; subject: string; body_text: string; state: string; draft_source: string; step: number }[]).filter((m) => m.state === "draft" && m.draft_source !== "ai_pending");
  if (!drafts.length) return { ok: false, message: "Aucun brouillon à approuver." };
  const prospects = await db().from("acquisition_prospects").select("id,stage,company_name,email_check_status,email_checked_at").eq("workspace_id", workspace.id).in("id", drafts.map((m) => m.prospect_id));
  if (prospects.error) return { ok: false, message: "Migration 20261219000000_acquisition_email_checks à appliquer (vérification des adresses)." };
  const byId = new Map(((prospects.data ?? []) as { id: string; stage: string; company_name: string; email_check_status: string | null; email_checked_at: string | null }[]).map((p) => [p.id, p]));
  const emails = drafts.map((m) => normalizeEmail(m.recipient_email)).filter((e): e is string => Boolean(e));
  const blocked = await blockedEmails(workspace, emails);
  if (!blocked) return { ok: false, message: "Liste d'exclusion illisible : rien n'est approuvé." };
  const stale = drafts.filter((m) => { const p = byId.get(m.prospect_id); return !addressCheckFresh(p?.email_check_status, p?.email_checked_at); }).map((m) => normalizeEmail(m.recipient_email)).filter((e): e is string => Boolean(e));
  const rechecked = stale.length ? await checkAddressesWithDns(stale) : new Map();
  const now = new Date().toISOString();
  for (const [email, result] of rechecked) {
    const ids = drafts.filter((m) => normalizeEmail(m.recipient_email) === email).map((m) => m.prospect_id);
    await db().from("acquisition_prospects").update({ email_check_status: result.status, email_check_detail: result.status === "valid" ? null : result.status, email_checked_at: now }).eq("workspace_id", workspace.id).in("id", ids);
  }
  const refused: Record<string, number> = { excluded: 0, address: 0, quality: 0, stage: 0 };
  const approved: string[] = [];
  for (const m of drafts) {
    const email = normalizeEmail(m.recipient_email), p = byId.get(m.prospect_id);
    if (!email || blocked.has(email)) { refused.excluded++; continue; }
    if (!p || NO_CONTACT_STAGES.has(p.stage)) { refused.stage++; continue; }
    const valid = addressCheckFresh(p.email_check_status, p.email_checked_at) || rechecked.get(email)?.status === "valid";
    if (!valid) { refused.address++; continue; }
    const issues = auditOutreachDraft({ subject: m.subject, body: m.body_text }, p.company_name).issues;
    if (issues.some((i) => i.code === "placeholder" || i.code === "opt_out" || i.code === "subject_empty")) { refused.quality++; continue; }
    approved.push(m.id);
  }
  if (approved.length) {
    const { error: updateError } = await db().from("acquisition_messages").update({ state: "approved", approved_at: now, approved_by: actor.userId.slice(0, 120), scheduled_for: now })
      .eq("workspace_id", workspace.id).eq("state", "draft").neq("draft_source", "ai_pending").in("id", approved);
    if (updateError) return { ok: false, message: "Migration 20261220000000_acquisition_sending à appliquer." };
    for (const id of approved) await db().from("acquisition_messages").update({ idempotency_key: `acq:${id}` }).eq("id", id).is("idempotency_key", null);
    await db().from("acquisition_prospects").update({ stage: "approved", updated_at: now }).eq("workspace_id", workspace.id).in("id", drafts.filter((m) => approved.includes(m.id)).map((m) => m.prospect_id));
    // Relance unique approuvée en même temps (case cochée) : programmée seulement une fois le premier message parti,
    // 5 jours ouvrés plus tard ; annulée dès une réponse, une opposition, un rebond ou une annulation du premier.
    if (options.followUp) {
      const senderName = await workspaceSenderName(workspace);
      const rows = drafts.filter((m) => approved.includes(m.id) && (m.step ?? 1) === 1).map((m) => {
        const follow = followUpMessage(m.subject, senderName);
        return { workspace_id: workspace.id, prospect_id: m.prospect_id, recipient_email: m.recipient_email, subject: follow.subject, body_text: follow.body,
          state: "approved", approved_at: now, approved_by: actor.userId.slice(0, 120), step: 2, parent_message_id: m.id, scheduled_for: null, idempotency_key: `acq:fu:${m.id}` };
      });
      if (rows.length) await db().from("acquisition_messages").insert(rows); // un brouillon n'est approuvé qu'une fois : jamais de doublon
    }
  }
  await writeAudit(actor, { action: "acquisition_message.approved", resource_type: "acquisition_workspace", resource_id: workspace.id, metadata: { approved: approved.length, refused } });
  const refusedTotal = Object.values(refused).reduce((a, b) => a + b, 0);
  return { ok: approved.length > 0, message: `${approved.length} e-mail(s) approuvé(s), envoyés progressivement dans les créneaux de bureau.${refusedTotal ? ` ${refusedTotal} refusé(s) : ${refused.excluded} exclu(s), ${refused.address} adresse(s) non vérifiée(s), ${refused.quality} brouillon(s) incomplet(s), ${refused.stage} fiche(s) déjà en réponse ou exclue(s).` : ""}` };
}

async function workspaceSenderName(workspace: Workspace): Promise<string> {
  if (!workspace.client_id) return workspace.label;
  const { data } = await db().from("clients").select("name,company_name").eq("id", workspace.client_id).maybeSingle();
  const client = data as { name?: string | null; company_name?: string | null } | null;
  return client?.company_name || client?.name || workspace.label;
}

/** Annule les relances encore en attente d'un message (premier message annulé, écarté ou sans suite). */
async function cancelFollowUps(parentId: string, reason: string) {
  await db().from("acquisition_messages").update({ state: "cancelled", cancelled_reason: reason }).eq("parent_message_id", parentId).in("state", ["draft", "approved"]);
}

/** Annule un brouillon ou un message approuvé pas encore parti. */
export async function cancelMessage(actor: Admin, workspaceId: string, id: string): Promise<Outcome> {
  if (!UUID.test(workspaceId) || !UUID.test(id)) return { ok: false, message: "Message invalide." };
  const { data, error } = await db().from("acquisition_messages").update({ state: "cancelled", cancelled_reason: "admin" }).eq("id", id).eq("workspace_id", workspaceId).in("state", ["draft", "approved"]).select("id");
  if (error || !data?.length) return { ok: false, message: "Ce message ne peut plus être annulé." };
  await cancelFollowUps(id, "admin");
  await writeAudit(actor, { action: "acquisition_message.cancelled", resource_type: "acquisition_workspace", resource_id: workspaceId, metadata: { message_id: id } });
  return { ok: true, message: "Message annulé." };
}

/**
 * Réglages d'envoi de l'espace. Activer exige un expéditeur prêt (domaine dédié vérifié) et la confirmation cruciale ;
 * lever l'arrêt d'urgence aussi. Quota borné à 50/jour (le préchauffage limite davantage les premières semaines).
 */
export async function saveSendingSettings(actor: Admin, workspaceId: string, input: { enabled: boolean; dailyLimit: number }): Promise<Outcome> {
  const workspace = await readWorkspace(workspaceId);
  if (!workspace) return { ok: false, message: "Espace invalide." };
  const dailyLimit = Number.isSafeInteger(input.dailyLimit) ? Math.max(0, Math.min(50, input.dailyLimit)) : 0;
  if (input.enabled) {
    const sender = await readProspectingSender(workspace.id);
    if (!resolveProspectingSender(sender ?? null, await workspaceProtectedDomains(workspace.id))) return { ok: false, message: "Expéditeur non prêt : configurez et vérifiez le domaine dédié (onglet Expéditeur)." };
    if (!emailSendingStatus().enabled) return { ok: false, message: "Envoi e-mail désactivé côté serveur (RESEND_API_KEY, EMAIL_FROM, EMAIL_SENDING_ENABLED=true)." };
    if (!oauthBaseUrl()) return { ok: false, message: "URL publique manquante (PUBLICATIONS_OAUTH_BASE_URL) : lien de désinscription impossible." };
    if (dailyLimit < 1) return { ok: false, message: "Choisissez un quota quotidien (10 conseillé au départ)." };
  }
  const { error } = await db().from("acquisition_workspaces").update({
    sending_enabled: input.enabled, emergency_stop: !input.enabled, daily_send_limit: dailyLimit, updated_at: new Date().toISOString(),
    ...(input.enabled ? { send_paused_reason: null, send_paused_at: null } : {}),
  }).eq("id", workspace.id);
  if (error) return { ok: false, message: "Enregistrement impossible." };
  await writeAudit(actor, { action: input.enabled ? "acquisition_sending.enabled" : "acquisition_sending.stopped", resource_type: "acquisition_workspace", resource_id: workspace.id, metadata: { daily_limit: dailyLimit } });
  return { ok: true, message: input.enabled ? `Envois activés : ${dailyLimit}/jour au plus, préchauffage du domaine compris.` : "Envois arrêtés (arrêt d'urgence actif)." };
}

// ---------------------------------------------------------------------------------------------------------------
// Planificateur (étape acquisition_send, toutes les 15 min).

/** Réputation des 7 derniers jours : envois, rebonds définitifs et plaintes reçus par le webhook Resend. null si illisible. */
async function reputation(workspaceId: string, now: Date) {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { data, error } = await db().from("acquisition_messages").select("provider_message_id").eq("workspace_id", workspaceId).eq("state", "sent").gte("sent_at", since).limit(2000);
  if (error) return null;
  const ids = ((data ?? []) as { provider_message_id: string | null }[]).map((m) => m.provider_message_id).filter((id): id is string => Boolean(id));
  let hardBounces = 0, complaints = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const events = await db().from("email_events").select("event_type,detail").in("provider_message_id", ids.slice(i, i + 200)).in("event_type", ["email.bounced", "email.complained"]);
    if (events.error) return null;
    for (const e of (events.data ?? []) as { event_type: string; detail: string | null }[]) {
      if (e.event_type === "email.complained") complaints++;
      else if ((e.detail ?? "").startsWith("Permanent")) hardBounces++;
    }
  }
  return { sent: (data ?? []).length, hardBounces, complaints };
}

type TickResult = { workspaces: number; sent: number; failed: number; skipped: number; stopped: number };

export async function runProspectingSendTick(now = new Date()): Promise<TickResult | { disabled: true }> {
  const result: TickResult = { workspaces: 0, sent: 0, failed: 0, skipped: 0, stopped: 0 };
  if (!emailSendingStatus().enabled || !oauthBaseUrl()) return { disabled: true };
  const { data, error } = await db().from("acquisition_workspaces").select(WORKSPACE_COLUMNS).eq("sending_enabled", true).eq("emergency_stop", false).limit(20);
  if (error) throw new Error("acquisition_workspaces_unavailable");
  // Envoi interrompu (passage coupé) depuis plus de 30 min : remis en file. La clé d'idempotence Resend (24 h) empêche
  // tout doublon si le message était en réalité parti.
  await db().from("acquisition_messages").update({ state: "approved", last_error: "interrupted" }).eq("state", "sending").lt("updated_at", new Date(now.getTime() - 30 * 60_000).toISOString());
  for (const workspace of (data ?? []) as Workspace[]) {
    if (!inSendWindow(now, workspace.timezone)) continue;
    result.workspaces++;
    const sender = await readProspectingSender(workspace.id);
    const resolved = resolveProspectingSender(sender ?? null, await workspaceProtectedDomains(workspace.id));
    if (!sender || !resolved) { result.skipped++; continue; }
    const health = await reputation(workspace.id, now);
    if (!health) { result.skipped++; continue; }
    const verdict = reputationVerdict(health);
    if (verdict.stop) {
      await db().from("acquisition_workspaces").update({ emergency_stop: true, send_paused_reason: verdict.detail.slice(0, 300), send_paused_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", workspace.id);
      await writeAudit(SYSTEM, { action: "acquisition_sending.auto_stopped", resource_type: "acquisition_workspace", resource_id: workspace.id, metadata: { reason: verdict.reason, detail: verdict.detail } });
      result.stopped++; continue;
    }
    const sentToday = await db().from("acquisition_messages").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("state", "sent").gte("sent_at", localDayStartIso(now, workspace.timezone));
    if (sentToday.error) { result.skipped++; continue; }
    const cap = dailyCap(workspace.daily_send_limit, sender.warmup_started_at, now);
    const budget = tickBudget(cap - (sentToday.count ?? 0), ticksLeftToday(now, workspace.timezone));
    if (budget <= 0) continue;
    const due = await db().from("acquisition_messages").select("id,prospect_id,recipient_email,subject,body_text,approved_at,idempotency_key,attempt_count")
      .eq("workspace_id", workspace.id).eq("state", "approved").lte("scheduled_for", now.toISOString()).order("scheduled_for", { ascending: true }).limit(budget);
    if (due.error) { result.skipped++; continue; }
    const messages = (due.data ?? []) as { id: string; prospect_id: string; recipient_email: string; subject: string; body_text: string; approved_at: string | null; idempotency_key: string | null; attempt_count: number | null }[];
    if (!messages.length) continue;
    const emails = messages.map((m) => normalizeEmail(m.recipient_email)).filter((e): e is string => Boolean(e));
    const blocked = await blockedEmails(workspace, emails);
    const prospects = await db().from("acquisition_prospects").select("id,stage,contact_email_source,email_check_status,email_checked_at").eq("workspace_id", workspace.id).in("id", messages.map((m) => m.prospect_id));
    if (!blocked || prospects.error) { result.skipped++; continue; }
    const byId = new Map(((prospects.data ?? []) as { id: string; stage: string; contact_email_source: string | null; email_check_status: string | null; email_checked_at: string | null }[]).map((p) => [p.id, p]));
    let sentHere = 0;
    for (const m of messages) {
      const outcome = await sendOne(workspace, sender.id, resolved, m, byId.get(m.prospect_id), blocked, (sentToday.count ?? 0) + sentHere, cap, now);
      if (outcome === "sent") { result.sent++; sentHere++; } else if (outcome === "failed") result.failed++; else result.skipped++;
    }
    if (sentHere && !sender.warmup_started_at) await db().from("acquisition_senders").update({ warmup_started_at: now.toISOString() }).eq("id", sender.id).is("warmup_started_at", null);
  }
  return result;
}

async function sendOne(
  workspace: Workspace, senderId: string, sender: NonNullable<ReturnType<typeof resolveProspectingSender>>,
  m: { id: string; prospect_id: string; recipient_email: string; subject: string; body_text: string; approved_at: string | null; idempotency_key: string | null; attempt_count: number | null },
  prospect: { stage: string; contact_email_source: string | null; email_check_status: string | null; email_checked_at: string | null } | undefined,
  blocked: Set<string>, sentToday: number, cap: number, now: Date,
): Promise<"sent" | "failed" | "skipped"> {
  const email = normalizeEmail(m.recipient_email);
  const target = scopeOf(workspace);
  const cancel = async (reason: string) => {
    await db().from("acquisition_messages").update({ state: reason === "suppressed" ? "suppressed" : "cancelled", cancelled_reason: reason }).eq("id", m.id).eq("state", "approved");
    await cancelFollowUps(m.id, reason);
    return "skipped" as const;
  };
  if (!email) return cancel("invalid_address");
  if (blocked.has(email)) return cancel("suppressed");
  if (!prospect || NO_CONTACT_STAGES.has(prospect.stage)) return cancel("prospect_stage");
  if (!addressCheckFresh(prospect.email_check_status, prospect.email_checked_at, now)) {
    const check = (await checkAddressesWithDns([email])).get(email);
    await db().from("acquisition_prospects").update({ email_check_status: check?.status ?? "unknown", email_check_detail: check?.status === "valid" ? null : check?.status ?? "unknown", email_checked_at: now.toISOString() }).eq("id", m.prospect_id);
    if (check?.status === "unknown") return "skipped"; // panne DNS : retenté au prochain passage
    if (check?.status !== "valid") return cancel("undeliverable");
  }
  const decision = evaluateAcquisitionDispatch({
    emergencyStop: workspace.emergency_stop, workspaceSendingEnabled: workspace.sending_enabled, senderReady: true, providerApproved: true,
    recipientApproved: true, humanApproved: Boolean(m.approved_at), suppressed: false, dailyLimit: cap, sentToday,
  }, { workspaceId: workspace.id, senderId, recipient: email, idempotencyKey: m.idempotency_key ?? `acq:${m.id}` });
  if (!decision.allowed) return "skipped";
  const headers = unsubscribeHeaders(email, target, oauthBaseUrl());
  const link = unsubscribeLink(email, target, oauthBaseUrl());
  if (!headers || !link) return "skipped";
  // Réservation atomique : un message n'est envoyé qu'une fois, même si deux passages se chevauchent.
  const claim = await db().from("acquisition_messages").update({ state: "sending", attempt_count: (m.attempt_count ?? 0) + 1, updated_at: now.toISOString() }).eq("id", m.id).eq("state", "approved").select("id");
  if (claim.error || !claim.data?.length) return "skipped";
  try {
    const sent = await sendEmail({ to: email, subject: m.subject, text: composeProspectingText(m.body_text, sender, link, prospect.contact_email_source), headers, idempotencyKey: m.idempotency_key ?? `acq:${m.id}`, from: sender.from, replyTo: sender.replyTo });
    await db().from("acquisition_messages").update({ state: "sent", sent_at: now.toISOString(), provider_message_id: sent.id, sender_id: senderId, last_error: null }).eq("id", m.id);
    // Relance éventuelle : programmée à J+5 ouvrés (envoyée dans les créneaux suivants, mêmes verrous).
    await db().from("acquisition_messages").update({ scheduled_for: addBusinessDays(now, FOLLOW_UP_BUSINESS_DAYS).toISOString() }).eq("parent_message_id", m.id).eq("state", "approved").is("scheduled_for", null);
    await db().from("acquisition_prospects").update({ stage: "contacted", updated_at: now.toISOString() }).eq("id", m.prospect_id).in("stage", ["approved", "draft_ready", "discovered", "verified", "qualified"]);
    return "sent";
  } catch (error) {
    const kind = error instanceof ProviderError ? error.kind : "unknown";
    const retry = (m.attempt_count ?? 0) + 1 < MAX_ATTEMPTS && ["rate_limited", "unavailable", "timeout", "unknown"].includes(kind);
    await db().from("acquisition_messages").update(retry
      ? { state: "approved", scheduled_for: new Date(now.getTime() + 30 * 60_000).toISOString(), last_error: kind }
      : { state: "failed", last_error: kind }).eq("id", m.id);
    if (!retry) await cancelFollowUps(m.id, "parent_failed");
    return "failed";
  }
}
