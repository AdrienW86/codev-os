// Diagnostic transversal PUR des sorties déjà enregistrées. Aucun fournisseur ni effet externe.
// Une ligne enregistrée prouve son état, jamais la cause d'une baisse ni un gain futur.
export const DIRECTOR_LIMIT = 200;
export type DirectorSource = "incidents" | "tasks" | "actions" | "recommendations" | "seo";
export type DirectorPriority = "critical" | "high" | "medium" | "low" | "unrated";
export type DirectorCoverage = { source: DirectorSource; status: "available" | "unavailable"; loaded: number; total: number | null; truncated: boolean };
export type DirectorEvidence = { statement: string; at: string; href: string };
export type DirectorDecision = {
  id: string; clientId: string; clientName: string; source: DirectorSource; title: string;
  priority: DirectorPriority; fact: string; hypothesis: string | null;
  impact: { level: "high" | "medium" | "unrated"; statement: string };
  confidence: { level: "supported" | "limited"; reason: string };
  evidence: DirectorEvidence[]; nextStep: string;
  validation: "human_review" | "existing_approval"; href: string;
};
export type DirectorBriefing = {
  generatedAt: string; today: string; scope: string; clientCount: number; clientTotal: number | null;
  coverage: DirectorCoverage[]; decisions: DirectorDecision[]; omitted: number; limitations: string[];
};
export type DirectorClient = { id: string; name: string };
export type DirectorIncident = { id: string; client_id: string; title: string; severity: string; source: string; status: string; updated_at: string; recommendation_id: string | null };
export type DirectorTask = { id: string; client_id: string; title: string; priority: string; status: string; due_date: string | null; updated_at: string };
export type DirectorAction = { id: string; client_id: string | null; title: string; status: string; created_at: string; recommendation_id: string | null };
export type DirectorRecommendation = { id: string; client_id: string; source: string; title: string; severity: string; reason: string | null; status: string; created_at: string };
export type DirectorSeo = { id: string; client_id: string | null; period_start: string; period_end: string; fetched_at: string; data: unknown };
export type DirectorInput = {
  today: string; now: string; clients: DirectorClient[]; clientTotal: number | null; scope: string;
  coverage: DirectorCoverage[]; incidents: DirectorIncident[]; tasks: DirectorTask[]; actions: DirectorAction[];
  recommendations: DirectorRecommendation[]; seo: DirectorSeo[];
  focus?: "all" | "seo" | "ads";
};

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const rank: Record<DirectorPriority, number> = { critical: 0, high: 1, medium: 2, low: 3, unrated: 4 };
const clean = (value: string, max = 300) => value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const priority = (value: string): DirectorPriority => Object.hasOwn(rank, value) ? value as DirectorPriority : "unrated";
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Recent here means evidence freshness, not that its business interpretation is proven. */
function confidence(at: string, now: string, reason: string, uncertain = false): DirectorDecision["confidence"] {
  const age = Date.parse(now) - Date.parse(at);
  if (!Number.isFinite(age) || age < -60_000 || age > 7 * 86_400_000) return { level: "limited", reason: "Preuve ancienne ou date invérifiable : revérifier l’état actuel avant de décider." };
  return { level: uncertain ? "limited" : "supported", reason };
}

/** Pure and deterministic. Foreign-client and malformed identifiers never become links or decisions. */
export function buildDirectorBriefing(input: DirectorInput): DirectorBriefing {
  const clients = new Map(input.clients.filter((client) => uuid.test(client.id)).map((client) => [client.id, clean(client.name, 120)]));
  const coverage = new Map(input.coverage.map((item) => [item.source, item]));
  const available = (source: DirectorSource) => coverage.get(source)?.status === "available";
  const recommendationClients = new Map((available("recommendations") ? input.recommendations : [])
    .filter((item) => uuid.test(item.id) && clients.has(item.client_id)).map((item) => [item.id, item.client_id]));
  const all: DirectorDecision[] = [];
  const add = (row: DirectorDecision) => { if (clients.has(row.clientId) && !all.some((item) => item.id === row.id)) all.push(row); };
  const matches = (source: string) => !input.focus || input.focus === "all" || source === input.focus;
  const name = (id: string) => clients.get(id) ?? "Client";
  const base = (id: string, clientId: string, source: DirectorSource, title: string, level: DirectorPriority) => ({
    id, clientId, clientName: name(clientId), source, title: clean(title), priority: level,
    impact: { level: level === "critical" || level === "high" ? "high" as const : "unrated" as const,
      statement: "Niveau qualitatif fondé sur la priorité enregistrée ; aucun gain de trafic, de revenu ou de budget chiffré." },
  });

  // Incidents and pending actions often refer to the same recommendation. Display that work once.
  const linked = new Set<string>();
  if (available("incidents")) for (const item of input.incidents) {
    if (!uuid.test(item.id) || !clients.has(item.client_id) || item.status === "resolved" || !matches(item.source)) continue;
    const verifiedRecommendation = item.recommendation_id && recommendationClients.get(item.recommendation_id) === item.client_id;
    const href = verifiedRecommendation ? `/recommendations/${item.recommendation_id}` : `/clients/${item.client_id}?tab=health`;
    if (verifiedRecommendation) linked.add(item.recommendation_id!);
    add({ ...base(`incident:${item.id}`, item.client_id, "incidents", item.title, priority(item.severity)),
      fact: `Incident ${item.status === "investigating" ? "en cours d’examen" : "ouvert"}, source ${clean(item.source, 40)}.`, hypothesis: null,
      confidence: confidence(item.updated_at, input.now, "État de l’incident enregistré ; cause et résolution à confirmer."),
      evidence: [{ statement: `Statut non résolu, gravité enregistrée : ${clean(item.severity, 20)}.`, at: item.updated_at, href }],
      nextStep: "Vérifier le constat et son état actuel, puis traiter l’incident dans le parcours existant.", validation: "human_review", href });
  }
  if (available("actions") && matches("operations")) for (const item of input.actions) {
    if (!uuid.test(item.id) || !item.client_id || !clients.has(item.client_id) || item.status !== "pending_approval") continue;
    if (item.recommendation_id && recommendationClients.get(item.recommendation_id) === item.client_id) linked.add(item.recommendation_id);
    const href = "/work?view=review";
    add({ ...base(`action:${item.id}`, item.client_id, "actions", item.title, "medium"),
      fact: "Action préparée, en attente de validation ; elle n’est pas exécutée.", hypothesis: null,
      confidence: confidence(item.created_at, input.now, "Statut de validation enregistré, efficacité de l’action non évaluée."),
      evidence: [{ statement: "Statut pending_approval ; la validation existante reste obligatoire.", at: item.created_at, href }],
      nextStep: "Relire le périmètre et les paramètres dans Travail, puis accepter ou refuser avec les boutons de validation.", validation: "existing_approval", href });
  }
  if (available("recommendations")) for (const item of input.recommendations) {
    if (!uuid.test(item.id) || !clients.has(item.client_id) || item.status !== "pending" || linked.has(item.id) || !matches(item.source)) continue;
    const href = `/recommendations/${item.id}`;
    add({ ...base(`recommendation:${item.id}`, item.client_id, "recommendations", item.title, priority(item.severity)),
      fact: "Recommandation en attente enregistrée par un agent ; aucune exécution déduite.",
      hypothesis: item.reason ? clean(item.reason, 600) : "Justification détaillée non disponible : examiner la recommandation avant de décider.",
      confidence: confidence(item.created_at, input.now, "Proposition enregistrée, justification et métriques à vérifier dans la source.", true),
      evidence: [{ statement: `Recommandation pending, priorité enregistrée : ${clean(item.severity, 20)}.`, at: item.created_at, href }],
      nextStep: "Examiner les preuves et l’action proposée dans la recommandation. Toute écriture suit sa validation habituelle.", validation: "human_review", href });
  }
  if (available("tasks") && matches("operations")) for (const item of input.tasks) {
    if (!uuid.test(item.id) || !clients.has(item.client_id) || item.status === "Terminé" || !item.due_date || !validDay(item.due_date) || item.due_date > input.today) continue;
    const overdue = item.due_date < input.today;
    const href = `/tasks/${item.id}/edit`;
    add({ ...base(`task:${item.id}`, item.client_id, "tasks", item.title, overdue && item.priority === "Haute" ? "high" : "medium"),
      fact: `Tâche ${overdue ? "en retard" : "à échéance aujourd’hui"} au ${item.due_date} (Europe/Paris).`, hypothesis: null,
      confidence: confidence(item.updated_at, input.now, "Échéance et statut de la tâche enregistrés."),
      evidence: [{ statement: `Échéance ${item.due_date}, statut ${clean(item.status, 40)}, priorité ${clean(item.priority, 20)}.`, at: item.updated_at, href }],
      nextStep: "Confirmer l’avancement réel, puis réaliser ou replanifier la tâche dans sa fiche.", validation: "human_review", href });
  }

  // Latest closed snapshot PER CLIENT, selected by period end before fetch date. Never treat a
  // recently re-fetched old month as this week's performance. No live provider request is made.
  const latest = new Map<string, DirectorSeo>();
  if (available("seo") && matches("seo")) for (const item of input.seo) {
    if (!uuid.test(item.id) || !item.client_id || !clients.has(item.client_id) || !validDay(item.period_start) || !validDay(item.period_end)
      || item.period_start > item.period_end || item.period_end >= input.today) continue;
    const previous = latest.get(item.client_id);
    if (!previous || item.period_end > previous.period_end || item.period_end === previous.period_end && item.fetched_at > previous.fetched_at) latest.set(item.client_id, item);
  }
  let comparableClients = 0;
  for (const [clientId, item] of latest) {
    const data = item.data;
    if (!record(data) || !number(data.clicks) || !number(data.previous_clicks) || data.previous_clicks === 0) continue;
    comparableClients++;
    if (data.clicks >= data.previous_clicks) continue;
    const drop = data.previous_clicks - data.clicks;
    const percent = Math.round(drop / data.previous_clicks * 100);
    const href = `/clients/${clientId}?tab=health`;
    const fresh = Date.parse(input.today) - Date.parse(item.period_end) <= 10 * 86_400_000;
    add({ ...base(`seo:${item.id}`, clientId, "seo", "Examiner la baisse des clics Search Console", percent >= 30 && data.previous_clicks >= 50 ? "high" : "medium"),
      fact: `Clics des pages de l’instantané : ${data.clicks} contre ${data.previous_clicks}, soit −${percent} % (${drop} clics).`,
      hypothesis: "La cause de la baisse n’est pas établie : vérifier requêtes, pages, saisonnalité et périmètre avant d’attribuer un problème SEO.",
      confidence: confidence(item.fetched_at, input.now, fresh ? "Comparaison des clics enregistrée ; périmètre des pages potentiellement partiel, causalité non établie." : "Période ancienne : cette baisse ne décrit pas nécessairement la semaine en cours.", true),
      impact: { level: percent >= 30 && data.previous_clicks >= 50 ? "high" : "medium", statement: `${drop} clics de moins sur le périmètre enregistré ; gain récupérable non estimé.` },
      evidence: [{ statement: `Période mesurée ${item.period_start} → ${item.period_end}. Comparaison : période précédente enregistrée, pas nécessairement une semaine.`, at: item.fetched_at, href }],
      nextStep: "Consulter l’analyse SEO et les opportunités existantes ; confirmer les périodes et le périmètre avant toute proposition de modification.", validation: "human_review", href });
  }
  all.sort((a, b) => rank[a.priority] - rank[b.priority]
    || (a.confidence.level === "supported" ? 0 : 1) - (b.confidence.level === "supported" ? 0 : 1)
    || a.clientName.localeCompare(b.clientName, "fr") || a.id.localeCompare(b.id));
  const limitations = [
    "Diagnostic déterministe des données enregistrées, sans relancer d’agent ni appeler une API externe. Aucune action, publication, campagne ou livraison exécutée.",
    "Les impacts sont qualitatifs, les justifications des agents sont des hypothèses à examiner ; aucun gain ni lien de causalité n’est garanti.",
    "Search Console : clics agrégés des pages présentes dans les instantanés, avec leurs dates. Une baisse de clics ne prouve pas une perte de visibilité cette semaine.",
    "Les instantanés SEO sont historiques : leur propriété Search Console et son association actuelle au client ne sont pas revalidées par ce diagnostic. Vérifier le branchement avant toute conclusion sur le compte actuel.",
  ];
  if (input.clientTotal === null) limitations.push("Nombre total de clients invérifiable : la couverture complète n’est pas établie.");
  else if (input.clientTotal > clients.size) limitations.push(`Couverture clients limitée : ${clients.size} sur ${input.clientTotal}. Consulter un client nommé pour compléter.`);
  for (const item of input.coverage) {
    if (item.status === "unavailable") limitations.push(`Source ${item.source} indisponible : aucune conclusion favorable ne peut en être tirée.`);
    else if (item.truncated) limitations.push(`Source ${item.source} partielle : ${item.loaded} éléments lus${item.total === null ? "" : ` sur ${item.total}`}. Des urgences peuvent être absentes du classement.`);
    else if (item.total === null) limitations.push(`Nombre total d’éléments de la source ${item.source} invérifiable : couverture complète non établie.`);
  }
  if (available("seo") && comparableClients < clients.size && matches("seo")) limitations.push(`Comparaison Search Console disponible pour ${comparableClients} client(s) sur ${clients.size} ; les autres ne sont pas considérés stables.`);
  if (all.some((item) => item.confidence.level === "limited")) limitations.push("Certaines preuves sont anciennes ou leur interprétation reste incertaine : consulter leur date et les sources avant validation.");
  return { generatedAt: input.now, today: input.today, scope: input.scope, clientCount: clients.size, clientTotal: input.clientTotal,
    coverage: input.coverage, decisions: all.slice(0, 20), omitted: Math.max(0, all.length - 20), limitations };
}

/** Short enough to speak: the structured evidence remains in the results panel. */
export function directorSummary(briefing: DirectorBriefing): string {
  const incomplete = briefing.coverage.some((source) => source.status === "unavailable" || source.truncated || source.total === null)
    || briefing.clientTotal === null || briefing.clientTotal > briefing.clientCount;
  if (!briefing.decisions.length) return `Diagnostic de ${briefing.clientCount} client(s) : aucune priorité établie dans les données consultées.${incomplete ? " Couverture incomplète, à vérifier dans le panneau." : " Les sources absentes ne permettent pas de conclure que tout est stable."}`;
  const first = briefing.decisions[0];
  return `${briefing.clientCount} client(s) examiné(s), ${briefing.decisions.length}${briefing.omitted ? " premières" : ""} priorité(s) à examiner.${incomplete ? " Couverture incomplète." : ""} En premier : ${first.clientName}, ${first.title}. Consultez les preuves et validez toute action dans son parcours habituel.`;
}
