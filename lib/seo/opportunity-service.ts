import "server-only";
// Services de l'interface « Opportunités de mots-clés » (lecture, décisions, préparation et exécution contrôlée).
// L'autorisation (session administrateur, simulation refusée) est faite au point d'entrée (Server Actions).
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { clientContextDenied, getAgentByType, prepareAction, recordRecommendation } from "@/lib/agents/outputs";
import { authorize } from "@/lib/permissions/engine";
import { isProviderConfigured } from "@/lib/system/providers";
import { createAutomation, runNow } from "@/lib/automations/service";
import { seoAutomationPresets } from "@/lib/automations/definitions";
import { ProviderError } from "@/lib/providers/errors";
import { githubWriteConfigured, openSeoPullRequest, readRepositoryFile } from "@/lib/providers/github-write";
import { githubChangeSchema, quotedValueEdit, seoBranchName, type GithubChange } from "@/lib/seo/github-change-model";
import { categoryLabels, intentLabels, pathOf, type OpportunityCategory } from "@/lib/seo/opportunities";
import { ensureRecommendation, transitionOpportunity, type StoreDeps } from "@/lib/seo/opportunity-store";
import { isOpportunityStatus } from "@/lib/seo/opportunity-status";
import type { Json } from "@/lib/supabase/database.types";
import type { OpportunityStatus, SeoAnalysisRow, SeoInterventionRow, SeoOpportunityRow } from "@/lib/supabase/seo-opportunities.types";

const db = () => getSupabaseServerClient();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Outcome = { ok: true; message: string; id?: string } | { ok: false; message: string };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function storeDeps(actor: Actor): StoreDeps {
  return {
    db: db(),
    recommend: (input) => recordRecommendation(actor, input),
    audit: (entry) => writeAudit(actor, entry),
  };
}

// ——— Lecture ———

export type SeoClient = { id: string; name: string; property: string | null; repository: string | null; assigned: boolean };

/** Clients suivis par l'Agent SEO (rattachés) ou ayant une propriété Search Console. */
export async function listSeoClients(agentId: string): Promise<SeoClient[]> {
  const [{ data: assignments, error }, { data: connections, error: connectionError }] = await Promise.all([
    db().from("agent_client_assignments").select("client_id,enabled").eq("agent_id", agentId),
    db().from("client_connections").select("client_id,provider,metadata").in("provider", ["search-console", "github"]).not("client_id", "is", null),
  ]);
  if (error || connectionError) throw new Error("seo clients read");
  const ids = [...new Set([...(assignments ?? []).map((row) => row.client_id as string), ...(connections ?? []).filter((row) => row.provider === "search-console" && typeof record(row.metadata).property === "string").map((row) => row.client_id as string)])];
  if (!ids.length) return [];
  const { data: clients, error: clientError } = await db().from("clients").select("id,name").in("id", ids).order("name");
  if (clientError) throw new Error("clients read");
  return (clients ?? []).map((client) => {
    const property = (connections ?? []).find((row) => row.client_id === client.id && row.provider === "search-console");
    const github = (connections ?? []).find((row) => row.client_id === client.id && row.provider === "github");
    return {
      id: client.id, name: client.name,
      property: typeof record(property?.metadata).property === "string" ? record(property?.metadata).property as string : null,
      repository: typeof record(github?.metadata).repository === "string" ? record(github?.metadata).repository as string : null,
      assigned: (assignments ?? []).some((row) => row.client_id === client.id && row.enabled),
    };
  });
}

export async function listOpportunities(clientId: string, filters: { category?: string; status?: string } = {}): Promise<SeoOpportunityRow[]> {
  if (!uuid.test(clientId)) return [];
  let query = db().from("seo_keyword_opportunities").select("*").eq("client_id", clientId).order("last_detected_at", { ascending: false }).limit(300);
  if (filters.category && Object.hasOwn(categoryLabels, filters.category)) query = query.eq("category", filters.category as OpportunityCategory);
  if (filters.status && isOpportunityStatus(filters.status)) query = query.eq("status", filters.status);
  const { data, error } = await query;
  if (error) throw new Error("opportunities read");
  return (data ?? []) as SeoOpportunityRow[];
}

export async function listAnalyses(clientId: string, limit = 12): Promise<SeoAnalysisRow[]> {
  if (!uuid.test(clientId)) return [];
  const { data, error } = await db().from("seo_opportunity_analyses").select("*").eq("client_id", clientId).order("started_at", { ascending: false }).limit(limit);
  if (error) throw new Error("analyses read");
  return (data ?? []) as SeoAnalysisRow[];
}

export type OpportunityDetail = {
  row: SeoOpportunityRow; clientName: string; interventions: SeoInterventionRow[];
  recommendation: { id: string; status: string; title: string } | null;
  actions: { id: string; action_type: string; status: string; result: Json | null; error_message: string | null; created_at: string }[];
};

export async function getOpportunityDetail(id: string): Promise<OpportunityDetail | null> {
  if (!uuid.test(id)) return null;
  const { data, error } = await db().from("seo_keyword_opportunities").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("opportunity read");
  if (!data) return null;
  const row = data as SeoOpportunityRow;
  const [{ data: client }, { data: interventions, error: interventionError }, recommendation, actions] = await Promise.all([
    db().from("clients").select("name").eq("id", row.client_id).maybeSingle(),
    db().from("seo_opportunity_interventions").select("*").eq("opportunity_id", row.id).order("created_at", { ascending: false }),
    row.recommendation_id ? db().from("recommendations").select("id,status,title").eq("id", row.recommendation_id).maybeSingle() : Promise.resolve({ data: null }),
    row.recommendation_id ? db().from("actions").select("id,action_type,status,result,error_message,created_at").eq("recommendation_id", row.recommendation_id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  if (interventionError) throw new Error("interventions read");
  return {
    row, clientName: client?.name ?? "Client", interventions: (interventions ?? []) as SeoInterventionRow[],
    recommendation: recommendation.data ? recommendation.data as OpportunityDetail["recommendation"] : null,
    actions: (actions.data ?? []) as OpportunityDetail["actions"],
  };
}

/** Opportunité liée à une recommandation (conversation depuis la page Recommandations). */
export async function getOpportunityByRecommendation(recommendationId: string): Promise<SeoOpportunityRow | null> {
  if (!uuid.test(recommendationId)) return null;
  const { data, error } = await db().from("seo_keyword_opportunities").select("*").eq("recommendation_id", recommendationId).maybeSingle();
  if (error) throw new Error("opportunity read");
  return (data ?? null) as SeoOpportunityRow | null;
}

export async function listSeoAutomations(clientId: string) {
  if (!uuid.test(clientId)) return [];
  const { data, error } = await db().from("automations").select("id,name,status,frequency,next_run_at,last_run_at,config").eq("run_type", "seo.analyze").eq("client_id", clientId).neq("status", "archived");
  if (error) throw new Error("automations read");
  return data ?? [];
}

// ——— Décisions ———

export async function scheduleSeoAnalyses(actor: Actor & { kind: "admin" }, clientId: string): Promise<Outcome> {
  if (!uuid.test(clientId)) return { ok: false, message: "Client invalide." };
  const existing = await listSeoAutomations(clientId);
  const depthOf = (config: unknown) => record(config).depth === "weekly" ? "weekly" : "daily";
  let created = 0, note = "";
  for (const preset of seoAutomationPresets) {
    if (existing.some((item) => depthOf(item.config) === preset.config.depth)) continue;
    const result = await createAutomation(actor, { name: preset.name, runType: "seo.analyze", clientId, frequency: preset.frequency, schedule: preset.schedule, config: preset.config });
    if (!result.ok) return result;
    created++;
    note = result.message ?? "";
  }
  if (!created) return { ok: true, message: "Les analyses quotidienne et hebdomadaire sont déjà planifiées pour ce client." };
  return { ok: true, message: `${created} analyse(s) planifiée(s) (quotidienne 07:30, hebdomadaire lundi 08:00).${note.includes("en pause") ? " L’Agent SEO est en pause : activez-le pour que les exécutions aient lieu." : ""}` };
}

export async function runOpportunityAnalysis(actor: Actor & { kind: "admin" }, clientId: string) {
  if (!uuid.test(clientId)) return { ok: false as const, message: "Client invalide." };
  return runNow(actor, { runType: "seo.analyze", clientId, payload: { depth: "weekly" }, dedupeKey: "opportunities" });
}

export async function changeOpportunityStatus(actor: Actor & { kind: "admin" }, id: string, to: string, reason: string | null): Promise<Outcome> {
  if (!uuid.test(id) || !isOpportunityStatus(to)) return { ok: false, message: "Statut invalide." };
  const agent = await getAgentByType("seo");
  const result = await transitionOpportunity({ ...storeDeps(actor), agentId: agent?.id ?? null }, { id, to, reason });
  return result.ok ? { ok: true, message: statusMessages[to] } : result;
}

const statusMessages: Record<OpportunityStatus, string> = {
  detected: "Opportunité remise à l’état détecté.", to_review: "Opportunité à examiner.", approved: "Opportunité approuvée : la recommandation liée est acceptée.",
  in_progress: "Opportunité en cours.", done: "Opportunité marquée comme réalisée.", dismissed: "Opportunité écartée ; la justification est conservée.",
};

/** Ouvre (ou crée) la recommandation existante liée à l'opportunité. */
export async function openRecommendation(actor: Actor & { kind: "admin" }, id: string): Promise<Outcome> {
  const detail = await getOpportunityDetail(id);
  if (!detail) return { ok: false, message: "Opportunité introuvable." };
  if (detail.row.recommendation_id) return { ok: true, message: "Recommandation existante.", id: detail.row.recommendation_id };
  const agent = await getAgentByType("seo");
  if (!agent) return { ok: false, message: "Agent SEO introuvable." };
  const denied = await clientContextDenied(agent, detail.row.client_id);
  if (denied || !agent.enabled || agent.status !== "Actif") return { ok: false, message: denied ?? "Activez l’Agent SEO pour créer la recommandation." };
  const recommendationId = await ensureRecommendation(storeDeps(actor), detail.row, agent.id);
  return { ok: true, message: "Recommandation créée.", id: recommendationId };
}

// ——— Préparation d'une modification GitHub (après approbation de l'opportunité) ———

export type GithubPreparation = { title?: string; description?: string; h1?: string };

export async function prepareGithubChange(actor: Actor & { kind: "admin" }, id: string, input: GithubPreparation): Promise<Outcome> {
  const detail = await getOpportunityDetail(id);
  if (!detail) return { ok: false, message: "Opportunité introuvable." };
  const { row } = detail;
  if (row.status !== "approved" && row.status !== "in_progress") return { ok: false, message: "Approuvez d’abord l’opportunité : aucune modification n’est préparée sans votre autorisation." };
  const github = record(record(row.evidence).github);
  const repository = typeof github.repository === "string" ? github.repository : null;
  const branch = typeof github.branch === "string" ? github.branch : null;
  const path = typeof github.path === "string" ? github.path : null;
  if (!repository || !branch || !path) return { ok: false, message: "Fichier source inconnu : lancez une analyse hebdomadaire avec le dépôt GitHub renseigné sur la fiche client." };
  let file: { content: string; sha: string };
  try { file = await readRepositoryFile(repository, path, branch); } catch (error) {
    return { ok: false, message: error instanceof ProviderError ? `Lecture du fichier impossible : ${error.message}` : "Lecture du fichier impossible." };
  }
  const edits = [] as GithubChange["edits"];
  const fields: [keyof GithubPreparation, string][] = [["title", "title"], ["description", "description"], ["h1", "h1"]];
  for (const [key, label] of fields) {
    const next = input[key]?.trim();
    const current = typeof github[key] === "string" ? (github[key] as string) : "";
    if (!next || next === current) continue;
    if (next.length > (key === "description" ? 300 : 120)) return { ok: false, message: `Le nouveau ${label} est trop long.` };
    const edit = current ? quotedValueEdit(file.content, current, next) : null;
    if (!edit) return { ok: false, message: `Le ${label} actuel n’est pas une valeur statique unique dans ${path} : cette modification doit être préparée à la main (action « Modification du site proposée »).` };
    edits.push(edit);
  }
  if (!edits.length) return { ok: false, message: "Aucune modification : renseignez au moins un nouveau title, une description ou un H1." };
  const agent = await getAgentByType("seo");
  if (!agent) return { ok: false, message: "Agent SEO introuvable." };
  const recommendationId = row.recommendation_id ?? await ensureRecommendation(storeDeps(actor), row, agent.id);
  const metrics = record(row.metrics);
  const parameters: GithubChange = {
    opportunity_id: row.id, repository, base_branch: branch, branch: seoBranchName(row.keyword, row.id), path, base_sha: file.sha, edits,
    pr_title: `SEO : ${categoryLabels[row.category].toLowerCase()} « ${row.keyword} »`.slice(0, 200),
    pr_body: [
      "Modification préparée par CODE-V OS (Agent SEO) après approbation explicite. À relire avant toute fusion : rien n’est déployé automatiquement.",
      "", `**Constat** : ${row.rationale}`, "", `**Recommandation** : ${row.recommended_action}`,
      "", `**Données** : Search Console ${row.period_start ?? "?"} → ${row.period_end ?? "?"}${typeof metrics.impressions === "number" ? ` — ${metrics.impressions} impressions, ${metrics.clicks} clics${typeof metrics.position === "number" ? `, position ${metrics.position.toFixed(1)}` : ""}` : ""}.`,
      `**Intention estimée** : ${intentLabels[row.intent]} (${row.intent_basis ?? "règles"}).`, "",
      `**Fichier** : \`${path}\` (${pathOf(row.target_url ?? "/")})`,
      ...edits.map((edit, index) => `- Remplacement ${index + 1} : \`${edit.find.slice(0, 200)}\` → \`${edit.replace.slice(0, 200)}\``),
      "", "Les effets seront mesurés à 7, 28 et 60 jours après le déploiement ; une évolution ne sera pas attribuée automatiquement à cette modification.",
    ].join("\n").slice(0, 6000),
  };
  if (!githubChangeSchema.safeParse(parameters).success) return { ok: false, message: "Modification invalide (fichier, branche ou texte non accepté)." };
  const result = await prepareAction(actor, { recommendationId, type: "seo.github_pull_request", parameters });
  if (!result.ok) return result;
  await writeAudit(actor, { action: "seo_opportunity.change_prepared", resource_type: "seo_opportunity", resource_id: row.id, metadata: { action_id: result.id, repository, path, edits: edits.length } });
  return { ok: true, message: result.created ? "Modification préparée : elle attend votre approbation dans Actions avant toute création de branche." : "Une modification est déjà en attente pour cette recommandation.", id: result.id };
}

// ——— Exécution contrôlée (après approbation de l'action) ———

export async function executeGithubChange(actor: Actor & { kind: "admin" }, actionId: string): Promise<Outcome> {
  if (!uuid.test(actionId)) return { ok: false, message: "Action invalide." };
  const { data: action, error } = await db().from("actions").select("id,agent_id,client_id,recommendation_id,action_type,parameters,status,payload_hash,approved_payload_hash").eq("id", actionId).maybeSingle();
  if (error) throw new Error("action read");
  if (!action || action.action_type !== "seo.github_pull_request" || action.status !== "approved") return { ok: false, message: "Seule une modification approuvée peut être exécutée." };
  if (!action.approved_payload_hash || action.approved_payload_hash !== action.payload_hash) return { ok: false, message: "Le contenu a changé depuis l’approbation : préparez et approuvez une nouvelle modification." };
  const parsed = githubChangeSchema.safeParse(action.parameters);
  if (!parsed.success) return { ok: false, message: "Paramètres de l’action invalides." };
  const { data: agent } = await db().from("agents").select("id,name,agent_type,enabled,status,autonomy_level,agent_scope").eq("id", action.agent_id).maybeSingle();
  if (!agent || agent.agent_type !== "seo") return { ok: false, message: "Agent SEO introuvable." };
  const decision = authorize({ agent: { type: "seo", enabled: agent.enabled, status: agent.status, autonomy: agent.autonomy_level }, capability: "modify_site", isProviderConfigured });
  if (decision.outcome === "deny") return { ok: false, message: decision.message };
  const denied = await clientContextDenied({ ...agent, agent_type: agent.agent_type ?? null }, action.client_id);
  if (denied) return { ok: false, message: denied };
  if (!githubWriteConfigured()) return { ok: false, message: "GITHUB_SEO_WRITE_TOKEN absent : la PR ne peut pas être créée. Voir docs/seo-keyword-opportunities.md." };
  const { data: opportunity } = await db().from("seo_keyword_opportunities").select("*").eq("id", parsed.data.opportunity_id).eq("client_id", action.client_id).maybeSingle();
  if (!opportunity) return { ok: false, message: "Opportunité liée introuvable." };

  const { data: started, error: startError } = await db().from("actions").update({ status: "executing" }).eq("id", action.id).eq("status", "approved").select("id").maybeSingle();
  if (startError) throw new Error("action update");
  if (!started) return { ok: false, message: "Action déjà en cours ou traitée." };
  await writeAudit(actor, { action: "action.execution_started", resource_type: "action", resource_id: action.id, metadata: { action_type: action.action_type, payload_hash: action.payload_hash } });
  try {
    const pr = await openSeoPullRequest(parsed.data);
    await db().from("actions").update({ status: "executed", executed_at: new Date().toISOString(), result: { pull_request_url: pr.pullRequestUrl, pull_request_number: pr.pullRequestNumber, branch: pr.branch, commit_sha: pr.commitSha }, error_message: null }).eq("id", action.id).eq("status", "executing");
    const row = opportunity as SeoOpportunityRow;
    await db().from("seo_opportunity_interventions").insert({
      opportunity_id: row.id, client_id: row.client_id, action_id: action.id, pull_request_url: pr.pullRequestUrl, keyword: row.keyword, target_url: row.target_url,
      baseline: row.metrics, baseline_start: row.period_start, baseline_end: row.period_end, created_by: actor.userId,
    });
    if (row.status === "approved") await transitionOpportunity({ ...storeDeps(actor), agentId: agent.id }, { id: row.id, to: "in_progress" });
    await writeAudit(actor, { action: "action.executed", resource_type: "action", resource_id: action.id, metadata: { action_type: action.action_type, pull_request: pr.pullRequestNumber, repository: parsed.data.repository } });
    return { ok: true, message: `PR créée en brouillon : ${pr.pullRequestUrl}. Relisez-la et fusionnez-la vous-même si elle convient.` };
  } catch (failure) {
    // Délai ou indisponibilité : la branche ou la PR ont pu être créées → résultat incertain, à vérifier sur GitHub.
    const uncertain = failure instanceof ProviderError && (failure.kind === "timeout" || failure.kind === "unavailable");
    const message = failure instanceof ProviderError ? (failure.code === "file_changed_since_preparation" ? "Le fichier a changé depuis la préparation : préparez une nouvelle modification." : failure.code === "edit_not_applicable" ? "Le texte à remplacer n’est plus présent tel quel dans le fichier." : failure.message) : "Exécution interrompue.";
    await db().from("actions").update({ status: uncertain ? "uncertain" : "failed", error_message: message.slice(0, 500) }).eq("id", action.id).eq("status", "executing");
    await writeAudit(actor, { action: uncertain ? "action.uncertain" : "action.failed", resource_type: "action", resource_id: action.id, metadata: { action_type: action.action_type, kind: failure instanceof ProviderError ? failure.kind : "internal" } });
    return { ok: false, message: uncertain ? `${message} Résultat incertain : vérifiez la branche ${parsed.data.branch} sur GitHub avant toute nouvelle tentative.` : message };
  }
}

// ——— Mesure ———

/** Intervention réalisée hors GitHub (ou PR déjà fusionnée) : situation de référence figée à partir du dernier relevé. */
export async function recordIntervention(actor: Actor & { kind: "admin" }, opportunityId: string, deployedAt: string | null): Promise<Outcome> {
  const detail = await getOpportunityDetail(opportunityId);
  if (!detail) return { ok: false, message: "Opportunité introuvable." };
  if (deployedAt && !validDeployDate(deployedAt)) return { ok: false, message: "Date de déploiement invalide." };
  const { row } = detail;
  if (!["approved", "in_progress", "done"].includes(row.status)) return { ok: false, message: "Approuvez l’opportunité avant d’enregistrer une intervention." };
  const { data, error } = await db().from("seo_opportunity_interventions").insert({
    opportunity_id: row.id, client_id: row.client_id, keyword: row.keyword, target_url: row.target_url,
    baseline: row.metrics, baseline_start: row.period_start, baseline_end: row.period_end, deployed_at: deployedAt, created_by: actor.userId,
  }).select("id").single();
  if (error || !data) throw new Error("intervention insert");
  await writeAudit(actor, { action: "seo_intervention.recorded", resource_type: "seo_intervention", resource_id: data.id, metadata: { opportunity_id: row.id, deployed_at: deployedAt } });
  if (deployedAt && (row.status === "approved" || row.status === "in_progress")) await changeOpportunityStatus(actor, row.id, "done", null);
  return { ok: true, message: deployedAt ? "Intervention enregistrée : les mesures à 7, 28 et 60 jours suivront les données consolidées." : "Intervention enregistrée ; indiquez la date de déploiement quand elle sera en production." };
}

export function validDeployDate(value: string, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return false;
  return value <= today.toISOString().slice(0, 10) && value >= "2020-01-01";
}

export async function recordDeployment(actor: Actor & { kind: "admin" }, interventionId: string, deployedAt: string): Promise<Outcome> {
  if (!uuid.test(interventionId) || !validDeployDate(deployedAt)) return { ok: false, message: "Date de déploiement invalide." };
  const { data, error } = await db().from("seo_opportunity_interventions").update({ deployed_at: deployedAt }).eq("id", interventionId).is("deployed_at", null).select("id,opportunity_id").maybeSingle();
  if (error) throw new Error("intervention update");
  if (!data) return { ok: false, message: "Date déjà enregistrée ou intervention introuvable." };
  await writeAudit(actor, { action: "seo_intervention.deployed", resource_type: "seo_intervention", resource_id: data.id, metadata: { deployed_at: deployedAt } });
  const { data: row } = await db().from("seo_keyword_opportunities").select("status").eq("id", data.opportunity_id).maybeSingle();
  if (row && (row.status === "approved" || row.status === "in_progress")) await changeOpportunityStatus(actor, data.opportunity_id, "done", null);
  return { ok: true, message: "Déploiement enregistré : l’opportunité est réalisée et ses résultats seront mesurés." };
}
