import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { providerJson } from "@/lib/providers/api";
import { classifyReply, replyExcerpt, type InboundEmail, type ReplyKind } from "./replies";

// Prospection e-mail, PR 4 : traitement des réponses reçues (webhook Resend « email.received »).
// La réponse est rattachée au dernier message de prospection envoyé à cette adresse (120 jours) ; sinon ignorée.
const db = () => getSupabaseServerClient() as unknown as SupabaseClient;
const SYSTEM: Actor = { kind: "system", worker: "acquisition-replies" };

/** Texte et en-têtes d'un e-mail reçu (API Resend). null si la clé ne le permet pas : l'objet seul sert alors. */
async function receivedContent(emailId: string | null): Promise<{ text: string | null; autoSubmitted: string | null } | null> {
  const key = process.env.RESEND_ADMIN_API_KEY || process.env.RESEND_API_KEY;
  if (!emailId || !key) return null;
  try {
    const data = await providerJson<{ text?: unknown; headers?: unknown }>("resend", `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { method: "GET", headers: { Authorization: `Bearer ${key}` } });
    const headers = data.headers && typeof data.headers === "object" ? data.headers as Record<string, unknown> : {};
    const auto = Object.entries(headers).find(([name]) => name.toLowerCase() === "auto-submitted")?.[1];
    return { text: typeof data.text === "string" ? data.text.slice(0, 50_000) : null, autoSubmitted: typeof auto === "string" ? auto.slice(0, 60) : null };
  } catch { return null; }
}

export type ReplyOutcome = { matched: false } | { matched: true; kind: ReplyKind };

export async function handleProspectingReply(inbound: InboundEmail, now = new Date()): Promise<ReplyOutcome> {
  if (!inbound.from) return { matched: false };
  const since = new Date(now.getTime() - 120 * 86_400_000).toISOString();
  const { data, error } = await db().from("acquisition_messages").select("id,workspace_id,prospect_id,replied_at")
    .eq("recipient_email", inbound.from).eq("state", "sent").gte("sent_at", since).order("sent_at", { ascending: false }).limit(1);
  if (error) throw new Error("acquisition_messages_unavailable");
  const message = (data ?? [])[0] as { id: string; workspace_id: string; prospect_id: string; replied_at: string | null } | undefined;
  if (!message) return { matched: false };
  const content = await receivedContent(inbound.emailId);
  const kind = classifyReply({ subject: inbound.subject, text: content?.text ?? null, autoSubmitted: content?.autoSubmitted ?? null });
  const at = now.toISOString();
  if (kind === "auto_reply") {
    await writeAudit(SYSTEM, { action: "acquisition_reply.auto", resource_type: "acquisition_workspace", resource_id: message.workspace_id, metadata: { message_id: message.id } });
    return { matched: true, kind };
  }
  await db().from("acquisition_messages").update({ replied_at: at, reply_kind: kind, reply_excerpt: replyExcerpt(content?.text ?? null) ?? (inbound.subject.slice(0, 300) || null), updated_at: at }).eq("id", message.id);
  // Plus aucun envoi vers cette entreprise : brouillons et messages en file (relance comprise) annulés.
  await db().from("acquisition_messages").update({ state: "cancelled", cancelled_reason: kind === "stop" ? "stop" : "replied", updated_at: at })
    .eq("workspace_id", message.workspace_id).eq("prospect_id", message.prospect_id).in("state", ["draft", "approved"]);
  await db().from("acquisition_prospects").update({ stage: kind === "stop" ? "excluded" : "responded", updated_at: at }).eq("id", message.prospect_id).eq("workspace_id", message.workspace_id);
  if (kind === "stop") {
    // Opposition définitive : exclusion de l'espace et de l'expéditeur (CODE-V ou client), jamais levée automatiquement.
    const { data: workspace } = await db().from("acquisition_workspaces").select("client_id").eq("id", message.workspace_id).maybeSingle();
    const clientId = (workspace as { client_id?: string | null } | null)?.client_id ?? null;
    const local = await db().from("acquisition_suppressions").insert({ workspace_id: message.workspace_id, email_normalized: inbound.from, reason: "reply_stop" });
    const common = await db().from("email_suppressions").insert({ scope: clientId ? "client" : "codev", client_id: clientId, email_normalized: inbound.from, reason: "unsubscribe", source: "reply_stop" });
    for (const result of [local, common]) if (result.error && result.error.code !== "23505") throw new Error("acquisition_suppression_failed");
  }
  await writeAudit(SYSTEM, { action: kind === "stop" ? "acquisition_reply.stop" : "acquisition_reply.received", resource_type: "acquisition_workspace", resource_id: message.workspace_id, metadata: { message_id: message.id } });
  return { matched: true, kind };
}
