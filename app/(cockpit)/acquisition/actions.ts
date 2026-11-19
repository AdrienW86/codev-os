"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACQUISITION_CATEGORIES } from "@/lib/acquisition/model";
import { PRESCRIBER_SEGMENTS, type PrescriberSegmentId } from "@/lib/acquisition/prescribers";
import { cancelDiscoveryRun, enrichWithPlaces, queueZoneScan, runPrescriberDiscovery, ZONE_MAX_OPTIONS } from "@/lib/acquisition/discovery";
import { ENRICHMENT_SOURCES, type EnrichmentSource } from "@/lib/acquisition/background";
import { parseNafList } from "@/lib/acquisition/naf";
import { resolveZoneScope } from "@/lib/acquisition/zone-scan";
import { handoffToEmailProspecting } from "@/lib/acquisition/handoff";
import { HANDOFF_MAX } from "@/lib/acquisition/outreach";
import { requireAdminWriter } from "@/lib/core/guards";
import { checkProspectingSenderDomain, saveProspectingSender } from "@/lib/acquisition/sender-service";
import { APPROVE_MAX, approveMessages, cancelMessage, saveSendingSettings, updateDraft } from "@/lib/acquisition/send-service";

const sourcesFrom = (data: FormData) => data.getAll("sources").filter((v): v is EnrichmentSource => typeof v === "string" && (ENRICHMENT_SOURCES as string[]).includes(v));

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories = new Set<string>(ACQUISITION_CATEGORIES.map(c => c.id));
const text = (data: FormData, name: string, max: number) => {
  const v = data.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};
function httpUrl(value: string): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password || u.hostname === "localhost" || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch { return null; }
}
function deny(reason: string): never { redirect(`/acquisition?notice=${encodeURIComponent(reason)}`); }
function db(): SupabaseClient { return getSupabaseServerClient() as unknown as SupabaseClient; }

export async function createInternalAcquisitionWorkspace(data: FormData) {
  await requireAdmin();
  if (text(data, "confirmation", 30) !== "CODE-V") deny("validation");
  const client = db();
  const { data: existing, error: readError } = await client.from("acquisition_workspaces").select("id").eq("is_internal",true).limit(1);
  if (readError) deny("storage");
  if (existing?.length) deny("already_exists");
  const { error } = await client.from("acquisition_workspaces").insert({
    label:"CODE-V",is_internal:true,emergency_stop:true,discovery_enabled:false,sending_enabled:false,daily_send_limit:0,timezone:"Europe/Paris",
  });
  if (error) deny("storage");
  revalidatePath("/acquisition");
  redirect("/acquisition?notice=workspace_created");
}

export async function createAcquisitionProspect(data: FormData) {
  await requireAdmin();
  const workspaceId = text(data,"workspace_id",36);
  const name = text(data,"company_name",180);
  const category = text(data,"category",48);
  const source = httpUrl(text(data,"source_url",2048));
  const websiteRaw = text(data,"website",2048);
  const website = websiteRaw ? httpUrl(websiteRaw) : null;
  const explanation = text(data,"explanation",2000);
  if (!uuid.test(workspaceId) || name.length < 2 || !categories.has(category) || !source || (websiteRaw && !website) || explanation.length < 15) deny("invalid_prospect");
  const client = db();
  const { data: workspace, error: accessError } = await client.from("acquisition_workspaces").select("id").eq("id",workspaceId).maybeSingle();
  if (accessError || !workspace) deny("workspace_missing");
  // Manual discovery; nothing is automatically qualified or approved.
  const { error } = await client.from("acquisition_prospects").insert({
    workspace_id:workspaceId,company_name:name,category,website,
    domain_normalized: website ? new URL(website).hostname.toLowerCase().replace(/^www\./,"") : null,
    source_url:source,source_checked_at:new Date().toISOString(),explanation,stage:"discovered",
  });
  if (error) deny("storage");
  revalidatePath("/acquisition");
  redirect("/acquisition?notice=prospect_created");
}

export async function createAcquisitionTemplate(data: FormData) {
  await requireAdmin();
  const workspaceId=text(data,"workspace_id",36);
  const category=text(data,"category",48);
  const name=text(data,"name",100);
  const subject=text(data,"subject",240);
  const body=text(data,"body",8000);
  if (!uuid.test(workspaceId) || !categories.has(category) || name.length<2 || subject.length<3 || body.length<20) deny("invalid_template");
  // Templates remain disabled and can never directly trigger a send.
  const {error}=await db().from("acquisition_templates").insert({
    workspace_id:workspaceId,category,name,subject_template:subject,body_template:body,enabled:false,
  });
  if(error) deny("storage");
  revalidatePath("/acquisition");
  redirect("/acquisition?notice=template_created");
}

/** Espace Acquisition dédié à un client : verrouillé (arrêt d'urgence, aucun envoi). */
export async function createClientAcquisitionWorkspace(data: FormData) {
  await requireAdmin();
  const clientId = text(data,"client_id",36);
  if (!uuid.test(clientId)) deny("validation");
  const client = db();
  const { data: row, error: readError } = await client.from("clients").select("id,name,company_name").eq("id",clientId).maybeSingle();
  if (readError || !row) deny("client_missing");
  const { data: existing } = await client.from("acquisition_workspaces").select("id").eq("client_id",clientId).limit(1);
  if (existing?.length) deny("already_exists");
  const { error } = await client.from("acquisition_workspaces").insert({
    client_id:clientId,label:(row.company_name || row.name).slice(0,120),is_internal:false,
    emergency_stop:true,discovery_enabled:false,sending_enabled:false,daily_send_limit:0,timezone:"Europe/Paris",
  });
  if (error) deny("storage");
  revalidatePath("/acquisition");
  redirect("/acquisition?notice=workspace_created");
}

const RADII = new Set([5,10,20,30,50]);

/** Agent Prospection : recherche des prescripteurs du client dans le registre Sirene. Aucun contact. */
export async function discoverPrescribersAction(data: FormData) {
  await requireAdmin();
  const workspaceId = text(data,"workspace_id",36);
  const radius = Number(text(data,"radius_km",3));
  const perSegment = Number(text(data,"max_per_segment",3));
  if (!uuid.test(workspaceId) || !RADII.has(radius) || !Number.isInteger(perSegment) || perSegment<5 || perSegment>50) deny("invalid_discovery");
  const segments = data.getAll("segments").filter((v): v is string => typeof v === "string" && v in PRESCRIBER_SEGMENTS) as PrescriberSegmentId[];
  const outcome = await runPrescriberDiscovery({
    workspaceId, activity:text(data,"activity",120), place:text(data,"place",120),
    radiusKm:radius, maxPerSegment:perSegment, segments, sources: sourcesFrom(data),
  });
  revalidatePath("/acquisition");
  if (!outcome.ok) deny(`discovery_${outcome.reason}`);
  redirect(`/acquisition?notice=discovery_done&found=${outcome.found}&inserted=${outcome.inserted}`);
}

export async function enrichProspectsAction(data: FormData) {
  await requireAdmin();
  const workspaceId = text(data,"workspace_id",36);
  if (!uuid.test(workspaceId)) deny("validation");
  const outcome = await enrichWithPlaces(workspaceId);
  revalidatePath("/acquisition");
  if (!outcome.ok) deny(`enrich_${outcome.reason}`);
  redirect(`/acquisition?notice=enrich_done&found=${outcome.enriched}&inserted=${outcome.checked}`);
}

/** Balayage complet de la zone en tâche de fond (planificateur). Aucun contact pris. */
export async function queueZoneScanAction(data: FormData) {
  await requireAdmin();
  const workspaceId = text(data,"workspace_id",36);
  const radius = Number(text(data,"radius_km",3));
  const max = Number(text(data,"max_companies",7));
  if (!uuid.test(workspaceId) || !RADII.has(radius) || !(ZONE_MAX_OPTIONS as readonly number[]).includes(max)) deny("invalid_discovery");
  const outcome = await queueZoneScan({
    workspaceId, place: text(data,"place",120), radiusKm: radius, maxCompanies: max,
    excludeNonOperating: data.get("include_non_operating") !== "on",
    excludeSoleProprietors: data.get("exclude_sole_proprietors") === "on",
    sources: sourcesFrom(data),
    scope: resolveZoneScope({ sections: data.getAll("zone_sections"), segments: data.getAll("zone_segments"), nafCodes: parseNafList(text(data, "zone_naf", 400)) }),
  });
  revalidatePath("/acquisition");
  if (!outcome.ok) deny(`discovery_${outcome.reason}`);
  redirect("/acquisition?notice=zone_queued");
}

export async function cancelDiscoveryRunAction(data: FormData) {
  await requireAdmin();
  const runId = text(data,"run_id",36);
  if (!uuid.test(runId)) deny("validation");
  const ok = await cancelDiscoveryRun(runId);
  revalidatePath("/acquisition");
  redirect(`/acquisition?notice=${ok ? "run_cancelled" : "storage"}`);
}

/** Transmet la liste filtrée à la prospection e-mail : brouillons à relire, aucun envoi. */
export async function handoffToEmailAction(data: FormData) {
  await requireAdmin();
  const workspaceId = text(data,"workspace_id",36);
  const category = text(data,"category",48);
  const segment = text(data,"segment",48);
  const templateId = text(data,"template_id",36);
  const minScore = Number(text(data,"min_score",3) || "0");
  const limit = Number(text(data,"limit",3) || String(HANDOFF_MAX));
  if (!uuid.test(workspaceId) || (category && !categories.has(category)) || (segment && !(segment in PRESCRIBER_SEGMENTS)) ||
    (templateId && !uuid.test(templateId)) || !Number.isInteger(minScore) || minScore<0 || minScore>100 ||
    !Number.isInteger(limit) || limit<1 || limit>HANDOFF_MAX) deny("invalid_handoff");
  const outcome = await handoffToEmailProspecting({
    workspaceId, filter: { category: category || undefined, segment: segment || undefined, minScore: minScore || undefined },
    templateId: templateId || undefined, limit, personalize: data.get("personalize") === "on",
  });
  revalidatePath("/acquisition");
  if (!outcome.ok) deny(`handoff_${outcome.reason}`);
  const skipped = outcome.skipped.suppressed + outcome.skipped.already_drafted + outcome.skipped.duplicate_email + outcome.skipped.undeliverable;
  redirect(`/acquisition?notice=handoff_done&found=${outcome.created}&inserted=${skipped}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Expéditeur de prospection (domaine dédié, vérifié chez Resend). Aucun envoi.
async function senderOutcome(workspaceId: string, run: (actor: Awaited<ReturnType<typeof requireAdminWriter>>) => Promise<{ ok: boolean; message: string }>): Promise<never> {
  if (!uuid.test(workspaceId)) deny("validation");
  let result: { ok: boolean; message: string };
  try { result = await run(await requireAdminWriter()); }
  catch { result = { ok: false, message: "Action impossible (droits, mode simulation ou service indisponible)." }; }
  revalidatePath("/acquisition");
  redirect(`/acquisition?${new URLSearchParams({ workspace: workspaceId, tab: "senders", msg: result.message.slice(0, 300), ok: result.ok ? "1" : "0" })}`);
}

export async function saveProspectingSenderAction(data: FormData) {
  const workspaceId = text(data, "workspace_id", 36);
  const input = Object.fromEntries(["sending_domain", "from_name", "from_local_part", "reply_to", "legal_name", "legal_address", "privacy_url"].map((name) => [name, text(data, name, 300)]));
  await senderOutcome(workspaceId, (actor) => saveProspectingSender(actor, workspaceId, input));
}

export async function checkProspectingSenderAction(data: FormData) {
  const workspaceId = text(data, "workspace_id", 36);
  await senderOutcome(workspaceId, (actor) => checkProspectingSenderDomain(actor, workspaceId));
}

// ---------------------------------------------------------------------------------------------------------------
// E-mails de prospection : correction, approbation (confirmation cruciale), annulation, réglages d'envoi.
async function emailsOutcome(workspaceId: string, run: (actor: Awaited<ReturnType<typeof requireAdminWriter>>) => Promise<{ ok: boolean; message: string }>): Promise<never> {
  if (!uuid.test(workspaceId)) deny("validation");
  let result: { ok: boolean; message: string };
  try { result = await run(await requireAdminWriter()); }
  catch { result = { ok: false, message: "Action impossible (droits, mode simulation ou service indisponible)." }; }
  revalidatePath("/acquisition");
  redirect(`/acquisition?${new URLSearchParams({ workspace: workspaceId, tab: "emails", msg: result.message.slice(0, 300), ok: result.ok ? "1" : "0" })}`);
}

export async function updateDraftAction(data: FormData) {
  const workspaceId = text(data, "workspace_id", 36), id = text(data, "id", 36);
  await emailsOutcome(workspaceId, (actor) => updateDraft(actor, workspaceId, id, { subject: text(data, "subject", 240), body: text(data, "body", 8000) }));
}

/** Confirmation cruciale : case cochée et nombre d'e-mails retapé. */
export async function approveMessagesAction(data: FormData) {
  const workspaceId = text(data, "workspace_id", 36);
  const ids = data.getAll("ids").filter((v): v is string => typeof v === "string" && uuid.test(v)).slice(0, APPROVE_MAX);
  if (data.get("confirm") !== "on" || text(data, "confirm_count", 4) !== String(ids.length))
    await emailsOutcome(workspaceId, async () => ({ ok: false, message: "Confirmation requise : cochez la case et indiquez le nombre exact d'e-mails sélectionnés." }));
  await emailsOutcome(workspaceId, (actor) => approveMessages(actor, workspaceId, ids, { followUp: data.get("follow_up") === "on" }));
}

export async function cancelMessageAction(data: FormData) {
  const workspaceId = text(data, "workspace_id", 36), id = text(data, "id", 36);
  await emailsOutcome(workspaceId, (actor) => cancelMessage(actor, workspaceId, id));
}

/** Activer les envois (confirmation cruciale) ou les arrêter (immédiat). */
export async function saveSendingSettingsAction(data: FormData) {
  const workspaceId = text(data, "workspace_id", 36);
  const enabled = text(data, "mode", 10) === "enable";
  if (enabled && data.get("confirm") !== "on")
    await emailsOutcome(workspaceId, async () => ({ ok: false, message: "Cochez la confirmation pour activer les envois." }));
  await emailsOutcome(workspaceId, (actor) => saveSendingSettings(actor, workspaceId, { enabled, dailyLimit: Number(text(data, "daily_limit", 3) || "0") }));
}
