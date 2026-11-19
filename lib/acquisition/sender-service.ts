import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { ProviderError } from "@/lib/providers/errors";
import { ensureResendDomain, getResendDomain, verifyResendDomain } from "@/lib/providers/resend-domains";
import { checkProspectingDomain, PROSPECTING_SENDER_COLUMNS, prospectingSenderFromRow, prospectingSenderSchema, protectedDomains, type ProspectingSender } from "./prospecting-sender";

// Expéditeur de prospection d'un espace Acquisition (migration 20261218000000_acquisition_prospecting_sender.sql) :
// un seul expéditeur Resend par espace, sur un domaine dédié vérifié (SPF, DKIM) ; DMARC conseillé à l'écran.
const db = () => getSupabaseServerClient() as unknown as SupabaseClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Outcome = { ok: boolean; message: string };
type Admin = Actor & { kind: "admin" };

/** Domaines à protéger pour un espace : EMAIL_FROM, site du client et domaine de ses newsletters. */
export async function workspaceProtectedDomains(workspaceId: string): Promise<string[]> {
  const { data: workspace } = await db().from("acquisition_workspaces").select("client_id").eq("id", workspaceId).maybeSingle();
  const clientId = (workspace as { client_id?: string | null } | null)?.client_id ?? null;
  const extra: (string | null)[] = [];
  if (clientId) {
    const [{ data: client }, settings] = await Promise.all([
      db().from("clients").select("website").eq("id", clientId).maybeSingle(),
      db().from("client_email_settings").select("sending_domain").eq("client_id", clientId).maybeSingle(),
    ]);
    extra.push((client as { website?: string | null } | null)?.website ?? null);
    if (!settings.error) extra.push((settings.data as { sending_domain?: string | null } | null)?.sending_domain ?? null);
  }
  return protectedDomains(process.env, extra);
}

/** Expéditeur Resend de l'espace ; undefined si la migration n'est pas appliquée. */
export async function readProspectingSender(workspaceId: string): Promise<ProspectingSender | null | undefined> {
  if (!UUID.test(workspaceId)) return null;
  const { data, error } = await db().from("acquisition_senders").select(PROSPECTING_SENDER_COLUMNS).eq("workspace_id", workspaceId).eq("provider", "resend").maybeSingle();
  if (error) return undefined;
  return prospectingSenderFromRow(data as Record<string, unknown> | null);
}

/** Tous les expéditeurs de prospection (écran Acquisition) ; null si la migration n'est pas appliquée. */
export async function listProspectingSenders(): Promise<ProspectingSender[] | null> {
  const { data, error } = await db().from("acquisition_senders").select(PROSPECTING_SENDER_COLUMNS).eq("provider", "resend").limit(100);
  if (error) return null;
  return ((data ?? []) as Record<string, unknown>[]).map(prospectingSenderFromRow).filter((value): value is ProspectingSender => value !== null);
}

function providerMessage(error: unknown): string {
  if (!(error instanceof ProviderError)) return "Resend indisponible : réessayez plus tard.";
  if (error.kind === "not_configured") return "Clé Resend absente (RESEND_ADMIN_API_KEY ou RESEND_API_KEY).";
  if (error.kind === "unauthorized" || error.status === 403) return "La clé Resend ne permet pas de gérer les domaines : créez une clé « Full access » dans RESEND_ADMIN_API_KEY.";
  if (error.kind === "rejected") return "Resend refuse ce domaine (déjà utilisé par un autre compte ou nom invalide).";
  if (error.kind === "rate_limited") return "Quota Resend atteint : réessayez dans une minute.";
  return "Resend indisponible : réessayez plus tard.";
}

/** Enregistre l'expéditeur. Domaine protégé refusé ; changer de domaine remet la vérification (et le préchauffage) à zéro. */
export async function saveProspectingSender(actor: Admin, workspaceId: string, input: Record<string, string>): Promise<Outcome> {
  if (!UUID.test(workspaceId)) return { ok: false, message: "Espace invalide." };
  const parsed = prospectingSenderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Expéditeur invalide." };
  const check = checkProspectingDomain(parsed.data.sending_domain, await workspaceProtectedDomains(workspaceId));
  if (!check.ok) return { ok: false, message: check.reason };
  const current = await readProspectingSender(workspaceId);
  if (current === undefined) return { ok: false, message: "Migration 20261218000000_acquisition_prospecting_sender à appliquer." };
  const { from_local_part, ...fields } = parsed.data;
  const domainChanged = current?.sending_domain !== parsed.data.sending_domain;
  const row = {
    ...fields, address: `${from_local_part}@${parsed.data.sending_domain}`, updated_at: new Date().toISOString(),
    ...(domainChanged ? { provider_domain_id: null, domain_status: "not_started", dns_records: [], domain_checked_at: null, warmup_started_at: null, status: "verification_pending" } : {}),
  };
  const { error } = current
    ? await db().from("acquisition_senders").update(row).eq("id", current.id).eq("workspace_id", workspaceId)
    : await db().from("acquisition_senders").insert({ ...row, workspace_id: workspaceId, provider: "resend", daily_limit: 0 });
  if (error) return { ok: false, message: error.code === "23505" ? "Ce domaine d'envoi est déjà utilisé par un autre espace." : "Enregistrement impossible." };
  await writeAudit(actor, { action: "acquisition_sender.saved", resource_type: "acquisition_workspace", resource_id: workspaceId, metadata: { sending_domain: parsed.data.sending_domain, domain_changed: domainChanged, kind: check.kind } });
  const base = domainChanged ? "Expéditeur enregistré. Lancez la vérification du domaine pour obtenir les enregistrements DNS." : "Expéditeur enregistré.";
  return { ok: true, message: check.kind === "subdomain" ? `${base} ${check.warning}` : base };
}

/** Crée le domaine chez Resend si besoin, demande la vérification et enregistre statut et enregistrements DNS. */
export async function checkProspectingSenderDomain(actor: Admin, workspaceId: string): Promise<Outcome> {
  const sender = await readProspectingSender(workspaceId).catch(() => null);
  if (!sender?.sending_domain) return { ok: false, message: "Enregistrez d'abord l'expéditeur et son domaine." };
  const check = checkProspectingDomain(sender.sending_domain, await workspaceProtectedDomains(workspaceId));
  if (!check.ok) return { ok: false, message: check.reason };
  let domain;
  try {
    domain = sender.provider_domain_id ? await getResendDomain(sender.provider_domain_id) : await ensureResendDomain(sender.sending_domain);
    if (domain.name !== sender.sending_domain) domain = await ensureResendDomain(sender.sending_domain);
    if (domain.status !== "verified") { await verifyResendDomain(domain.id); domain = await getResendDomain(domain.id); }
  } catch (error) { return { ok: false, message: providerMessage(error) }; }
  const now = new Date().toISOString();
  const { error } = await db().from("acquisition_senders").update({
    provider_domain_id: domain.id, domain_status: domain.status, dns_records: domain.records, domain_checked_at: now, updated_at: now,
    status: domain.status === "verified" ? "ready" : "verification_pending",
  }).eq("id", sender.id).eq("sending_domain", sender.sending_domain);
  if (error) return { ok: false, message: "Enregistrement du statut impossible." };
  await writeAudit(actor, { action: "acquisition_sender.domain_checked", resource_type: "acquisition_workspace", resource_id: workspaceId, metadata: { sending_domain: domain.name, status: domain.status } });
  return domain.status === "verified"
    ? { ok: true, message: `Domaine ${domain.name} vérifié : la prospection de cet espace pourra partir de ${sender.address}.` }
    : { ok: true, message: `Domaine ${domain.name} : ${domain.records.length} enregistrement(s) DNS à créer chez le registrar, plus l'enregistrement DMARC conseillé, puis relancez la vérification (jusqu'à 48 h de propagation).` };
}
