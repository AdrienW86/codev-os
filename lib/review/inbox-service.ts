import "server-only";
// Lecture de la boîte « À valider » (lecture seule) et archivage des rapports remplacés (seule écriture, interne).
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { archiveReport } from "@/lib/reports/service";
import type { Actor } from "@/lib/core/actor";
import type { MutationState } from "@/lib/core/mutation";
import { buildInbox, previousMonthStart, supersededReports, type Inbox } from "./inbox";
import { clientAiBudget } from "@/lib/ai/metered";

const LIMIT = 1000;

export async function loadInbox(now = new Date()): Promise<Inbox> {
  const db = getSupabaseServerClient();
  const rows = async <T,>(query: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> => {
    try { const r = await query; return r.error || !r.data ? null : r.data; } catch { return null; }
  };
  const [clients, reports, recommendations, actions, ads, publications, settings, prospection, seo, seoAgent, photos, alerts] = await Promise.all([
    rows(db.from("clients").select("id,name").limit(LIMIT)),
    rows(db.from("reports").select("id,client_id,kind,period_start").eq("status", "ready_for_review").limit(LIMIT)),
    rows(db.from("recommendations").select("id,client_id,title,created_at").eq("status", "pending").limit(LIMIT)),
    rows(db.from("actions").select("id,client_id,action_type,created_at,requires_approval").eq("status", "pending_approval").limit(LIMIT)),
    rows(db.from("ads_change_approvals").select("id,client_id,created_at,operation_kind").eq("status", "pending").gt("expires_at", now.toISOString()).limit(LIMIT)),
    rows(db.from("publications").select("id,client_id,created_at").eq("status", "pending_review").is("archived_at", null).limit(LIMIT)),
    rows(db.from("publication_client_settings").select("client_id,auto_approve_enabled").limit(LIMIT)),
    rows(db.from("acquisition_messages").select("id,subject,created_at").eq("state", "draft").limit(LIMIT)),
    rows(db.from("seo_keyword_opportunities").select("id,client_id,keyword,created_at").eq("status", "to_review").limit(LIMIT)),
    rows(db.from("agents").select("id").eq("agent_type", "seo").limit(1)),
    rows(db.from("whatsapp_assets").select("client_id").in("library_status", ["quarantined", "received"]).is("purged_at", null).limit(LIMIT)),
    rows(db.from("incidents").select("id,client_id,title,detected_at").eq("source", "system").neq("status", "resolved").like("fingerprint", "harness:%").limit(LIMIT)),
  ]);
  // Agent Photo : table de la migration 20261214000000 ; absente → pas de section (agent non installé).
  const generated = await db.from("publication_generated_images").select("id,client_id,created_at").eq("status", "pending_review").limit(LIMIT).then(
    (r) => r.error ? (/42P01|PGRST205/.test(String((r.error as { code?: string }).code)) || /could not find the table|does not exist/i.test(r.error.message ?? "") ? undefined : null) : r.data ?? [],
    () => null);
  // Agent Bilan client : bilans du mois écoulé (rapports mensuels à envoyer). Lecture impossible → section illisible.
  const bilans = await db.from("reports").select("id,client_id,period_start").eq("kind", "monthly").in("status", ["ready_for_review", "approved"])
    .gte("period_start", previousMonthStart(now)).contains("client_content", { documents: [{ key: "bilan" }] }).limit(LIMIT)
    .then((r) => r.error ? null : r.data ?? [], () => null);
  // Newsletters (migration e-mailing) : table absente → pas de section.
  const missing = (error: { code?: string; message?: string }) => /42P01|PGRST205/.test(String(error.code)) || /could not find the table|does not exist/i.test(error.message ?? "");
  const newsletters = await db.from("email_newsletters").select("id,client_id,subject,created_at").eq("status", "draft").limit(LIMIT).then(
    (r) => r.error ? (missing(r.error) ? undefined : null) : r.data ?? [], () => null);
  // Agent Leads (migration 20261229000000) : table absente → pas de section.
  const leads = await db.from("lead_messages" as never).select("id,client_id,subject,created_at").eq("state", "draft").eq("direction", "out").limit(LIMIT).then(
    (r) => r.error ? (missing(r.error) ? undefined : null) : (r.data ?? []) as unknown[], () => null);
  // Plafonds IA atteints : un relevé par client ; suivi non installé (null partout) → pas de section.
  const budgets = await Promise.all(((clients ?? []) as { id: string }[]).map((c) => clientAiBudget(c.id, now).then((b) => b ? { client_id: c.id, b } : undefined, () => null)));
  const aiBudget = budgets.some((b) => b === null) ? null : budgets.every((b) => b === undefined) && budgets.length ? undefined
    : (budgets.filter(Boolean) as { client_id: string; b: { allowed: boolean; spent: number; cap: number } }[]).filter((x) => !x.b.allowed).map((x) => ({ client_id: x.client_id, spentEur: x.b.spent, capEur: x.b.cap }));
  type Ads = { id: string; client_id: string | null; created_at: string; operation_kind: string | null };
  const flagged = (settings as { client_id: string; auto_approve_enabled: boolean }[] | null);
  return buildInbox({
    clients: (clients ?? []) as { id: string; name: string | null }[],
    reports: reports as never, bilans, recommendations: recommendations as never, actions: actions as never,
    ads: ads ? (ads as Ads[]).map((a) => ({ id: a.id, client_id: a.client_id, created_at: a.created_at, summary: a.operation_kind ? `Modification à approuver (${a.operation_kind})` : null })) : null,
    publications: publications as never,
    generatedImages: generated as { id: string; client_id: string; created_at: string }[] | null | undefined,
    autoApproveClients: flagged ? new Set(flagged.filter((s) => s.auto_approve_enabled).map((s) => s.client_id)) : null,
    prospection: prospection as never, seo: seo as never,
    leads: leads as { id: string; client_id: string; subject: string | null; created_at: string }[] | null | undefined,
    newsletters: newsletters as { id: string; client_id: string; subject: string | null; created_at: string }[] | null | undefined, aiBudget,
    seoAgentId: (seoAgent as { id: string }[] | null)?.[0]?.id ?? null,
    photos: photos as never, alerts: alerts as never,
  });
}

/** Archive les rapports à relire remplacés par un rapport plus récent du même client et du même type. Aucun envoi. */
export async function archiveSupersededReports(actor: Actor & { kind: "admin" }): Promise<MutationState> {
  const { data, error } = await getSupabaseServerClient().from("reports").select("id,client_id,kind,period_start").eq("status", "ready_for_review").limit(LIMIT);
  if (error || !data) return { ok: false, message: "Rapports illisibles : rien n’a été archivé." };
  const ids = supersededReports(data as { id: string; client_id: string | null; kind: string; period_start: string }[]);
  if (!ids.length) return { ok: true, message: "Aucun rapport remplacé à archiver." };
  let archived = 0;
  for (const id of ids) if ((await archiveReport(actor, id)).ok) archived++;
  return { ok: archived === ids.length, message: `${archived} rapport(s) remplacé(s) archivé(s)${archived < ids.length ? `, ${ids.length - archived} non archivé(s)` : ""}. Le plus récent de chaque client reste à relire.` };
}
