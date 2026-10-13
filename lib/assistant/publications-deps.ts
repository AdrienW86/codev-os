import "server-only";
// Liaison réelle des outils Publications de l'assistant : UNIQUEMENT des fonctions serveur existantes, chacune
// protégée par requireAdmin comme dans l'interface. Aucune fonction de publication, d'approbation, de soumission
// ni de diffusion n'est importée ici (tests/assistant-publications.test.mjs le vérifie).
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { todayInParis } from "@/lib/dashboard/home";
import { resolveClient } from "@/lib/assistant/clients";
import { getOpenOccurrencesForAgent } from "@/lib/publications/agent-v2/open-occurrences";
import { prepareNextPublications } from "@/lib/publications/agent-v2/service";
import { listPublications } from "@/lib/publications/data";
import { getSupervision, reschedulePublication, type SupervisedPublication } from "@/lib/publications/supervision";
import { listClientsLackingPhotos } from "@/lib/publications/editorial-health";
import { createPublicationsTools, type PhotoShortage, type PublicationsDeps } from "@/lib/assistant/publications-tool";
import type { PhotoDecisionRow } from "@/lib/assistant/publications-model";

const db = () => getSupabaseServerClient();

/**
 * Clients à court de photos utilisables : modèle de lecture de la santé de la photothèque (#42), mêmes règles que la
 * sélection de l'agent (documents exclus, doublons exacts fusionnés), avec les prestations sans photo.
 */
export async function clientsLackingPhotos(): Promise<PhotoShortage[]> {
  await requireAdmin();
  const rows = await listClientsLackingPhotos();
  return rows.map((row) => ({ clientId: row.clientId, clientName: row.clientName, available: row.usable, capped: false, servicesLacking: row.servicesLacking }));
}

/**
 * Décisions sur les photos d'un client (statut de photothèque, décision humaine, classement IA), sans légende, nom de
 * fichier ni identifiant Drive. PROVISOIRE — à remplacer par le modèle de lecture « usage / exclusion des photos »
 * de #43 dès sa fusion : seul le corps change, la forme PhotoDecisionRow[] reste celle de l'outil.
 */
export async function photoDecisions(clientId: string): Promise<PhotoDecisionRow[]> {
  await requireAdmin();
  const assets = await db().from("whatsapp_assets").select("id,library_status,media_kind,status_changed_at,status_changed_by,received_at,imported_at,purged_at,width,height")
    .eq("client_id", clientId).eq("media_kind", "image").order("status_changed_at", { ascending: false }).limit(200);
  if (assets.error) throw new Error("photos read");
  const rows = assets.data ?? [];
  const assessments = rows.length ? await db().from("whatsapp_asset_assessments").select("asset_id,verdict,confidential,sensitive,description,quality,quality_issues,manual_verdict,reviewed_at")
    .eq("client_id", clientId).in("asset_id", rows.map((row) => row.id)) : { data: [], error: null };
  if (assessments.error) throw new Error("assessments read");
  const byAsset = new Map((assessments.data ?? []).map((item) => [item.asset_id, item]));
  return rows.map((row) => {
    const a = byAsset.get(row.id);
    return {
      id: row.id, libraryStatus: row.library_status, mediaKind: row.media_kind, statusChangedAt: row.status_changed_at, statusChangedByHuman: /^user_/.test(row.status_changed_by ?? ""),
      receivedAt: row.received_at ?? row.imported_at, purged: Boolean(row.purged_at), width: row.width, height: row.height,
      assessment: a ? { verdict: a.verdict, confidential: a.confidential, sensitive: a.sensitive ?? [], description: a.description, quality: a.quality, qualityIssues: a.quality_issues ?? [], manualVerdict: a.manual_verdict, reviewedAt: a.reviewed_at } : null,
    };
  });
}

const supervisedList = (data: { scheduled: SupervisedPublication[]; errors: SupervisedPublication[]; published: SupervisedPublication[] }) =>
  [...new Map([...data.scheduled, ...data.errors, ...data.published].map((item) => [item.id, item])).values()];

export const productionPublicationsDeps: PublicationsDeps = {
  requireAdmin,
  today: () => todayInParis(),
  resolveClient,
  async agentProjects(clientId) {
    await requireAdmin();
    const agents = await db().from("publication_agent_projects").select("project_id").eq("client_id", clientId).eq("enabled", true).eq("rights_confirmed", true).limit(20);
    if (agents.error) throw new Error("agent projects read");
    const ids = (agents.data ?? []).map((row) => row.project_id as string);
    if (!ids.length) return [];
    const projects = await db().from("projects").select("id,name").in("id", ids).order("name");
    if (projects.error) throw new Error("projects read");
    return (projects.data ?? []).map((row) => ({ id: row.id, name: row.name ?? "Projet" }));
  },
  async openSlots(projectId, horizonDays) {
    return (await getOpenOccurrencesForAgent(projectId, horizonDays, new Date()))
      .map((slot) => ({ occurrenceId: slot.occurrenceId, platform: slot.platform, date: slot.date, time: slot.time, scheduledFor: slot.scheduledFor }));
  },
  async prepareRun(projectId, excludeOccurrenceIds) {
    // Même service que le bouton « Préparer les prochaines publications » ; l'appel IA réel est autorisé par la
    // confirmation explicite de la proposition (équivalent de la case « J’autorise l’appel IA »).
    const result = await prepareNextPublications(projectId, { allowRealAI: true, excludeOccurrenceIds });
    return { ok: result.ok, message: result.message, publications: result.publications };
  },
  async pendingReview(clientId) {
    return (await listPublications(clientId)).filter((item) => item.status === "pending_review" && !item.archived_at)
      .map((item) => ({ id: item.id, clientId: item.client_id, clientName: item.client?.name ?? "Client", projectName: item.project?.name ?? null, platform: item.platform ?? null, subject: item.subject, updatedAt: item.updated_at }));
  },
  async reschedulable() {
    const data = await getSupervision(new Date());
    const names = new Map(data.clients.map((client) => [client.id, client.name]));
    return supervisedList(data).map((item) => ({ id: item.id, clientId: item.clientId, clientName: names.get(item.clientId) ?? "Client", platform: item.platform, subject: item.subject, status: item.status, revisionId: item.revisionId, scheduledFor: item.scheduledFor, targets: item.targets }));
  },
  reschedule: (publicationId, revisionId, occurrenceId) => reschedulePublication(publicationId, revisionId, occurrenceId),
  async reconnectAccounts() {
    const data = await getSupervision(new Date());
    return data.clients.flatMap((client) => client.accounts.filter((account) => account.state === "reconnect")
      .map((account) => ({ clientId: client.id, clientName: client.name, platform: account.platform, name: account.name, reason: account.reason })));
  },
  photoDecisions,
  clientsLackingPhotos,
  revalidate(paths) { for (const path of paths) revalidatePath(path); },
};

export const publicationsTools = createPublicationsTools(productionPublicationsDeps);
