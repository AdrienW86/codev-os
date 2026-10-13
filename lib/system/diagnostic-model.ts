// Diagnostic de production (lot 9) : classement pur et testable de chaque mécanisme dans exactement un état.
// Règle : jamais « opérationnel » sans preuve (un passage ou un traitement réussi récent, daté). Des variables
// présentes sans passage réussi récent restent « configuré ». « inconnu » est réservé aux données illisibles.
// Aucune valeur de variable ni texte fournisseur : uniquement des états, des compteurs et des dates.

export type DiagnosticStatus = "configured" | "operational" | "disabled" | "error" | "unknown";
export const DIAGNOSTIC_STATUS_LABELS: Record<DiagnosticStatus, string> = {
  configured: "configuré", operational: "opérationnel", disabled: "désactivé", error: "en erreur", unknown: "inconnu",
};
/** Un élément classé : un libellé, un état, une preuve lisible et, si elle existe, la date qui la porte. */
export type DiagnosticItem = { id: string; label: string; status: DiagnosticStatus; evidence: string; at: string | null };

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** Fraîcheur d'un passage : le cron peut n'être que quotidien (plan Hobby), d'où 36 h. */
export const FRESH_RUN_MS = 36 * HOUR;
/** Fenêtre de preuve des traitements moins fréquents (agents, IA, réception WhatsApp). */
export const FRESH_ACTIVITY_MS = 7 * DAY;
/** Un passage commencé et jamais terminé au-delà de cette durée est considéré interrompu (maxDuration 300 s). */
export const INTERRUPTED_RUN_MS = 15 * 60_000;
/** Retard toléré d'une file avant « en erreur » (même cadence que le planificateur). */
export const QUEUE_DELAY_MS = FRESH_RUN_MS;

const time = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? Date.parse(iso) : null);
export const isFresh = (iso: string | null | undefined, now: Date, windowMs: number) => { const t = time(iso); return t !== null && now.getTime() - t <= windowMs; };
/** La plus récente de plusieurs dates (null si aucune). */
export function latest(...values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of values) if (time(v) !== null && (best === null || time(v)! > time(best)!)) best = v!;
  return best;
}
/** Durée lisible (« 3 h », « 2 j »), jamais plus précise qu'utile. */
export function ageLabel(iso: string | null, now: Date): string {
  const t = time(iso);
  if (t === null) return "durée inconnue";
  const ms = Math.max(0, now.getTime() - t);
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 2 * DAY) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / DAY)} j`;
}
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

// --- Mécanisme générique ---
// Ordre : non configuré ou coupé → désactivé ; problème ouvert ou dernier échec plus récent que le dernier succès →
// en erreur ; succès récent → opérationnel ; sinon configuré.
export type MechanismInput = {
  id: string; label: string;
  /** Variables présentes (null : sans objet). */
  configured: boolean | null;
  /** Interrupteur (null : sans objet). */
  enabled?: boolean | null;
  disabledReason?: string;
  lastSuccessAt?: string | null; lastFailureAt?: string | null;
  /** Problèmes ouverts (connexions expirées, diffusions bloquées…) : au moins un → en erreur. */
  openIssues?: number; issueLabel?: string;
  successLabel?: string; failureLabel?: string;
  /** Preuve affichée quand aucun succès récent n'existe. */
  idleLabel?: string;
  freshMs?: number; now: Date;
};
export function classifyMechanism(input: MechanismInput): DiagnosticItem {
  const base = { id: input.id, label: input.label };
  const fresh = input.freshMs ?? FRESH_ACTIVITY_MS;
  if (input.configured === false) return { ...base, status: "disabled", evidence: input.disabledReason ?? "Variables absentes : non configuré.", at: null };
  if (input.enabled === false) return { ...base, status: "disabled", evidence: input.disabledReason ?? "Désactivé par son interrupteur.", at: null };
  const success = time(input.lastSuccessAt), failure = time(input.lastFailureAt);
  if ((input.openIssues ?? 0) > 0) return { ...base, status: "error", evidence: input.issueLabel ?? plural(input.openIssues!, "problème ouvert", "problèmes ouverts"), at: input.lastFailureAt ?? null };
  if (failure !== null && (success === null || failure > success)) return { ...base, status: "error", evidence: input.failureLabel ?? "Dernier traitement en échec", at: input.lastFailureAt! };
  if (success !== null && isFresh(input.lastSuccessAt, input.now, fresh)) return { ...base, status: "operational", evidence: input.successLabel ?? "Dernier traitement réussi", at: input.lastSuccessAt! };
  if (success !== null) return { ...base, status: "configured", evidence: `${input.successLabel ?? "Dernier traitement réussi"} il y a ${ageLabel(input.lastSuccessAt!, input.now)} : trop ancien pour le prouver`, at: input.lastSuccessAt! };
  return { ...base, status: "configured", evidence: input.idleLabel ?? "Configuré, aucun traitement réussi enregistré", at: null };
}

// --- Planificateur ---
export type StepStatus = "ok" | "failed" | "skipped" | "disabled";
export type HeartbeatInput = { startedAt: string | null; finishedAt: string | null; ok: boolean | null; lastSuccessAt: string | null; lastFailureAt: string | null; steps: { name: string; status: StepStatus; ms: number }[] };
/** Passages réels du planificateur (scheduler_heartbeats) : seule preuve de fonctionnement. */
export function classifyScheduler(configured: boolean, heartbeat: HeartbeatInput | null | "unavailable", now: Date): DiagnosticItem {
  const base = { id: "scheduler", label: "Planificateur (cron)" };
  if (!configured) return { ...base, status: "disabled", evidence: "CRON_SECRET absent : aucun passage n’est autorisé.", at: null };
  if (heartbeat === "unavailable") return { ...base, status: "unknown", evidence: "Battement illisible.", at: null };
  if (!heartbeat) return { ...base, status: "configured", evidence: "Configuré, aucun passage enregistré.", at: null };
  // Passage en cours : interrompu s'il dure au-delà de maxDuration, sinon on juge le dernier passage terminé.
  if (!heartbeat.finishedAt && heartbeat.startedAt && !isFresh(heartbeat.startedAt, now, INTERRUPTED_RUN_MS))
    return { ...base, status: "error", evidence: "Dernier passage commencé et jamais terminé", at: heartbeat.startedAt };
  const lastEnd = latest(heartbeat.lastSuccessAt, heartbeat.lastFailureAt);
  if (heartbeat.lastFailureAt && lastEnd === heartbeat.lastFailureAt && heartbeat.lastFailureAt !== heartbeat.lastSuccessAt) {
    const failed = heartbeat.steps.filter((s) => s.status === "failed").map((s) => stepLabel(s.name));
    return { ...base, status: "error", evidence: `Dernier passage en échec${failed.length ? ` : ${failed.join(", ")}` : ""}`, at: heartbeat.lastFailureAt };
  }
  if (!lastEnd) return { ...base, status: "configured", evidence: "Passage en cours, aucun passage terminé enregistré.", at: heartbeat.startedAt };
  if (!isFresh(lastEnd, now, FRESH_RUN_MS)) return { ...base, status: "error", evidence: `Aucun passage depuis ${ageLabel(lastEnd, now)}`, at: lastEnd };
  return { ...base, status: "operational", evidence: "Dernier passage réussi", at: lastEnd };
}
export const STEP_LABELS: Record<string, string> = {
  whatsapp_exports: "Purge des exports WhatsApp", automations: "Automatisations (jobs)", publication_delivery_prepare: "Préparation des diffusions",
  publication_delivery_send: "Envoi des publications dues", push: "Notifications push", search_console: "Synchro Search Console",
  whatsapp: "Import WhatsApp → Drive", media_intelligence: "Classement de la photothèque", publication_preparation: "Préparation automatique des publications",
};
export const stepLabel = (name: string) => STEP_LABELS[name] ?? name;
/** Une étape du dernier passage. « skipped » (faute de temps) n'est pas une preuve : « configuré ». */
export function classifyStep(name: string, heartbeat: HeartbeatInput | null | "unavailable", now: Date): DiagnosticItem {
  const base = { id: `step:${name}`, label: stepLabel(name) };
  if (heartbeat === "unavailable") return { ...base, status: "unknown", evidence: "Battement illisible.", at: null };
  if (!heartbeat) return { ...base, status: "unknown", evidence: "Aucun passage du planificateur enregistré.", at: null };
  const step = heartbeat.steps.find((s) => s.name === name);
  const at = heartbeat.finishedAt ?? heartbeat.startedAt;
  if (!step) return { ...base, status: "unknown", evidence: "Absente du dernier passage.", at };
  if (step.status === "failed") return { ...base, status: "error", evidence: "En échec au dernier passage", at };
  if (step.status === "disabled") return { ...base, status: "disabled", evidence: "Désactivée au dernier passage (interrupteur)", at };
  if (step.status === "skipped") return { ...base, status: "configured", evidence: "Sautée faute de temps au dernier passage", at };
  if (!isFresh(at, now, FRESH_RUN_MS)) return { ...base, status: "configured", evidence: `Réussie il y a ${ageLabel(at, now)} : trop ancien pour le prouver`, at };
  return { ...base, status: "operational", evidence: `Réussie au dernier passage (${step.ms} ms)`, at };
}

// --- Interrupteurs de sécurité ---
// Un interrupteur coupé → « désactivé » ; ouvert, il n'est qu'une autorisation → « configuré » (la preuve de
// fonctionnement relève des mécanismes qu'il autorise).
export function classifySwitch(id: string, label: string, enabled: boolean | null, on: string, off: string): DiagnosticItem {
  if (enabled === null) return { id, label, status: "unknown", evidence: "Réglages illisibles : tout est considéré comme arrêté.", at: null };
  return { id, label, status: enabled ? "configured" : "disabled", evidence: enabled ? on : off, at: null };
}
/** PUBLICATIONS_SCHEDULED_DELIVERY : activé uniquement par la valeur exacte « enabled » ; jamais la valeur lue. */
export function classifyScheduledDelivery(flag: "absent" | "other" | "enabled", sendStep: DiagnosticItem): DiagnosticItem {
  const base = { id: "flag:publications-scheduled-delivery", label: "Diffusion automatique à l’heure prévue (PUBLICATIONS_SCHEDULED_DELIVERY)" };
  if (flag === "absent") return { ...base, status: "disabled", evidence: "Variable absente : envoi manuel uniquement.", at: null };
  if (flag === "other") return { ...base, status: "disabled", evidence: "Variable présente mais différente de « enabled » : envoi manuel uniquement.", at: null };
  if (sendStep.status === "operational") return { ...base, status: "operational", evidence: "Activée ; étape d’envoi réussie au dernier passage", at: sendStep.at };
  if (sendStep.status === "error") return { ...base, status: "error", evidence: "Activée ; étape d’envoi en échec au dernier passage", at: sendStep.at };
  return { ...base, status: "configured", evidence: "Activée ; aucun passage réussi récent de l’étape d’envoi", at: sendStep.at };
}

// --- Files et retards ---
/** Retard d'une file : le plus ancien élément en attente au-delà du seuil → en erreur ; aucun retard → opérationnel. */
export function classifyQueue(input: { id: string; label: string; oldestAt: string | null; pending: number; capped?: boolean; now: Date; thresholdMs?: number; disabled?: string | null }): DiagnosticItem {
  const base = { id: input.id, label: input.label };
  const n = `${input.pending}${input.capped ? "+" : ""}`;
  if (!input.pending || !input.oldestAt) return { ...base, status: "operational", evidence: "Aucun élément en attente", at: null };
  const late = !isFresh(input.oldestAt, input.now, input.thresholdMs ?? QUEUE_DELAY_MS);
  if (late && input.disabled) return { ...base, status: "disabled", evidence: `${n} en attente · ${input.disabled}`, at: input.oldestAt };
  if (late) return { ...base, status: "error", evidence: `${n} en attente · le plus ancien depuis ${ageLabel(input.oldestAt, input.now)}`, at: input.oldestAt };
  return { ...base, status: "operational", evidence: `${n} en attente · le plus ancien depuis ${ageLabel(input.oldestAt, input.now)} (dans les délais)`, at: input.oldestAt };
}

/** Synthèse d'un ensemble : nombre d'éléments par état (affichée en tête de page). */
export function statusCounts(items: readonly DiagnosticItem[]): Record<DiagnosticStatus, number> {
  const counts: Record<DiagnosticStatus, number> = { operational: 0, configured: 0, disabled: 0, error: 0, unknown: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}
