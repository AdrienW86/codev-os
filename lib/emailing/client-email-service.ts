import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { ProviderError } from "@/lib/providers/errors";
import { ensureResendDomain, getResendDomain, verifyResendDomain } from "@/lib/providers/resend-domains";
import { normalizeEmail } from "./policy";
import { senderFromRow, senderSchema, suggestSendingDomain, type SenderSettings } from "./sender";

// Emailing, étape 2 : expéditeur et domaine d'envoi par client (migration 20261213000000_client_email_settings.sql)
// et gestion des contacts (liste, désabonnement manuel, effacement). Client non typé, comme le reste du socle emailing.
const db = () => getSupabaseServerClient() as unknown as SupabaseClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Outcome = { ok: boolean; message: string };
type Admin = Actor & { kind: "admin" };
const SENDER_COLUMNS = "sending_domain,from_name,from_local_part,reply_to,provider_domain_id,domain_status,dns_records,domain_checked_at";

export async function readClientSender(clientId: string): Promise<SenderSettings | null> {
  if (!UUID.test(clientId)) return null;
  const { data, error } = await db().from("client_email_settings").select(SENDER_COLUMNS).eq("client_id", clientId).maybeSingle();
  if (error) throw new Error("client_email_settings_unavailable");
  return senderFromRow(data as Record<string, unknown> | null);
}

export type SenderView = { ready: boolean; settings: SenderSettings | null; suggestedDomain: string | null };
export async function getSenderView(clientId: string): Promise<SenderView> {
  const website = (await db().from("clients").select("website").eq("id", clientId).maybeSingle()).data as { website?: string | null } | null;
  const suggestedDomain = suggestSendingDomain(website?.website);
  try { return { ready: true, settings: await readClientSender(clientId), suggestedDomain }; }
  catch { return { ready: false, settings: null, suggestedDomain }; }
}

function providerMessage(error: unknown): string {
  if (!(error instanceof ProviderError)) return "Resend indisponible : réessayez plus tard.";
  if (error.kind === "not_configured") return "Clé Resend absente (RESEND_ADMIN_API_KEY ou RESEND_API_KEY).";
  if (error.kind === "unauthorized" || error.status === 403) return "La clé Resend ne permet pas de gérer les domaines : créez une clé « Full access » dans RESEND_ADMIN_API_KEY.";
  if (error.kind === "rejected") return "Resend refuse ce domaine (déjà utilisé par un autre compte ou nom invalide).";
  if (error.kind === "rate_limited") return "Quota Resend atteint : réessayez dans une minute.";
  return "Resend indisponible : réessayez plus tard.";
}

/** Enregistre l'expéditeur. Changer de domaine remet la vérification à zéro (nouveau domaine à vérifier). */
export async function saveClientSender(actor: Admin, clientId: string, input: Record<string, string>): Promise<Outcome> {
  if (!UUID.test(clientId)) return { ok: false, message: "Client invalide." };
  const parsed = senderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Expéditeur invalide." };
  const current = await readClientSender(clientId).catch(() => undefined);
  if (current === undefined) return { ok: false, message: "Migration 20261213000000_client_email_settings à appliquer." };
  const domainChanged = current?.sending_domain !== parsed.data.sending_domain;
  const row = {
    client_id: clientId, ...parsed.data, updated_at: new Date().toISOString(),
    ...(domainChanged ? { provider_domain_id: null, domain_status: "not_started", dns_records: [], domain_checked_at: null } : {}),
  };
  const { error } = await db().from("client_email_settings").upsert(row, { onConflict: "client_id" });
  if (error) return { ok: false, message: error.code === "23505" ? "Ce domaine d'envoi est déjà utilisé par un autre client." : "Enregistrement impossible." };
  await writeAudit(actor, { action: "email_sender.saved", resource_type: "client", resource_id: clientId, metadata: { sending_domain: parsed.data.sending_domain, domain_changed: domainChanged } });
  return { ok: true, message: domainChanged ? "Expéditeur enregistré. Lancez la vérification du domaine pour obtenir les enregistrements DNS." : "Expéditeur enregistré." };
}

/** Crée le domaine chez Resend si besoin, demande la vérification et enregistre statut et enregistrements DNS. */
export async function checkClientDomain(actor: Admin, clientId: string): Promise<Outcome> {
  const settings = await readClientSender(clientId).catch(() => null);
  if (!settings?.sending_domain) return { ok: false, message: "Enregistrez d'abord le domaine d'envoi." };
  let domain;
  try {
    domain = settings.provider_domain_id ? await getResendDomain(settings.provider_domain_id) : await ensureResendDomain(settings.sending_domain);
    if (domain.name !== settings.sending_domain) domain = await ensureResendDomain(settings.sending_domain);
    if (domain.status !== "verified") { await verifyResendDomain(domain.id); domain = await getResendDomain(domain.id); }
  } catch (error) { return { ok: false, message: providerMessage(error) }; }
  const { error } = await db().from("client_email_settings").update({
    provider_domain_id: domain.id, domain_status: domain.status, dns_records: domain.records, domain_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("client_id", clientId).eq("sending_domain", settings.sending_domain);
  if (error) return { ok: false, message: "Enregistrement du statut impossible." };
  await writeAudit(actor, { action: "email_sender.domain_checked", resource_type: "client", resource_id: clientId, metadata: { sending_domain: domain.name, status: domain.status } });
  return domain.status === "verified"
    ? { ok: true, message: `Domaine ${domain.name} vérifié : les newsletters de ce client partiront à son nom.` }
    : { ok: true, message: `Domaine ${domain.name} : ${domain.records.length} enregistrement(s) DNS à créer chez l'hébergeur du client, puis relancez la vérification (la propagation DNS peut prendre jusqu'à 48 h).` };
}

// ---------------------------------------------------------------------------------------------------------------
export type ContactRow = {
  id: string; email_normalized: string; first_name: string | null; last_name: string | null; status: string;
  consent_basis: string; consent_source: string; consent_at: string; unsubscribed_at: string | null; created_at: string;
};
export const CONTACTS_PAGE = 50;
export type ContactFilter = { q?: string; status?: string; page?: number };

export async function listClientContacts(clientId: string, filter: ContactFilter): Promise<{ rows: ContactRow[]; total: number; page: number } | null> {
  if (!UUID.test(clientId)) return null;
  const page = Math.max(1, Math.min(1000, Math.floor(filter.page ?? 1)));
  let query = db().from("email_contacts").select("id,email_normalized,first_name,last_name,status,consent_basis,consent_source,consent_at,unsubscribed_at,created_at", { count: "exact" })
    .eq("client_id", clientId).order("created_at", { ascending: false }).range((page - 1) * CONTACTS_PAGE, page * CONTACTS_PAGE - 1);
  if (filter.status && ["pending", "subscribed", "unsubscribed", "bounced", "complained"].includes(filter.status)) query = query.eq("status", filter.status);
  const q = (filter.q ?? "").trim().toLowerCase().replace(/[%_,()\\]/g, "").slice(0, 100);
  if (q) query = query.ilike("email_normalized", `%${q}%`);
  const { data, error, count } = await query;
  if (error) return null;
  return { rows: (data ?? []) as ContactRow[], total: count ?? 0, page };
}

async function contact(clientId: string, id: string): Promise<{ id: string; email_normalized: string; status: string } | null> {
  if (!UUID.test(clientId) || !UUID.test(id)) return null;
  const { data } = await db().from("email_contacts").select("id,email_normalized,status").eq("client_id", clientId).eq("id", id).maybeSingle();
  return data as { id: string; email_normalized: string; status: string } | null;
}

/** Désabonnement à la demande du contact (téléphone, e-mail…) : exclusion pour ce client, statut mis à jour. */
export async function unsubscribeContactManually(actor: Admin, clientId: string, id: string): Promise<Outcome> {
  const row = await contact(clientId, id);
  const email = normalizeEmail(row?.email_normalized);
  if (!row || !email) return { ok: false, message: "Contact introuvable." };
  const { error } = await db().from("email_suppressions").insert({ scope: "client", client_id: clientId, email_normalized: email, reason: "manual", source: "admin" });
  if (error && error.code !== "23505") return { ok: false, message: "Désabonnement impossible." };
  const now = new Date().toISOString();
  const { error: update } = await db().from("email_contacts").update({ status: "unsubscribed", unsubscribed_at: now, updated_at: now }).eq("id", id).in("status", ["pending", "subscribed"]);
  if (update) return { ok: false, message: "Désabonnement impossible." };
  await writeAudit(actor, { action: "email_contact.unsubscribed", resource_type: "client", resource_id: clientId, metadata: { contact_id: id } });
  return { ok: true, message: `${email} est désabonné de ce client.` };
}

/** Droit à l'effacement : la fiche du contact est supprimée. L'exclusion éventuelle est conservée (elle empêche de
 *  réimporter une adresse qui s'est opposée aux envois) ; l'adresse n'est pas journalisée. */
export async function eraseContact(actor: Admin, clientId: string, id: string): Promise<Outcome> {
  const row = await contact(clientId, id);
  if (!row) return { ok: false, message: "Contact introuvable." };
  const { error } = await db().from("email_contacts").delete().eq("id", id).eq("client_id", clientId);
  if (error) return { ok: false, message: "Suppression impossible." };
  await writeAudit(actor, { action: "email_contact.erased", resource_type: "client", resource_id: clientId, metadata: { contact_id: id } });
  return { ok: true, message: "Contact supprimé (droit à l'effacement)." };
}
