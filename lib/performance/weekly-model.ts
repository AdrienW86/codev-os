// Audit Lighthouse hebdomadaire de l'Agent Monitoring : règles pures (testables), sans lecture ni écriture.
// Quatre catégories notées sur 100 : performance, accessibilité, bonnes pratiques, SEO. Une alerte n'est levée que sur
// un score réellement mesuré : score faible (< 50) ou baisse nette par rapport aux audits précédents du même site.

export type Strategy = "mobile" | "desktop";
export type CategoryId = "performance" | "accessibility" | "bestPractices" | "seo";
export type Scores = Record<CategoryId, number | null>;

export const CATEGORIES: readonly { id: CategoryId; label: string }[] = [
  { id: "performance", label: "Performance" },
  { id: "accessibility", label: "Accessibilité" },
  { id: "bestPractices", label: "Bonnes pratiques" },
  { id: "seo", label: "SEO" },
];
export const STRATEGIES: readonly Strategy[] = ["mobile", "desktop"];
export const strategyLabel: Record<Strategy, string> = { mobile: "mobile", desktop: "ordinateur" };

/** Score sous lequel une catégorie est jugée faible. */
export const LOW_SCORE = 50;
/** Baisse (en points) par rapport à la référence qui déclenche une alerte : au-delà du bruit habituel de Lighthouse. */
export const DROP_POINTS = 10;
/** Nombre d'audits précédents qui forment la référence (médiane). */
export const BASELINE_AUDITS = 4;
export const BASELINE_DAYS = 35;
/** Cadence : un site est audité de nouveau 6,5 jours après son dernier audit (la fenêtre de nuit cale la semaine). */
export const AUDIT_INTERVAL_MS = 6.5 * 86_400_000;
/** Après un échec, pas de nouvel essai avant 6 heures. */
export const RETRY_AFTER_MS = 6 * 3_600_000;
/** Fenêtre de nuit (heure de Paris) : les audits ne ralentissent pas les passages chargés de la journée. */
export const WINDOW_START_HOUR = 1;
export const WINDOW_END_HOUR = 6;

const score = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // Le moteur renvoie des notes sur 100 ; une note sur 1 (format brut Lighthouse) est convertie.
  const scaled = value > 0 && value <= 1 && !Number.isInteger(value) ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
};

/** Notes d'un audit enregistré (colonne scores) ; une catégorie illisible vaut null, jamais 0. */
export function readScores(value: unknown): Scores {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { performance: score(raw.performance), accessibility: score(raw.accessibility), bestPractices: score(raw.bestPractices ?? raw["best-practices"]), seo: score(raw.seo) };
}

export function parisHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(now));
}

export function inAuditWindow(now: Date): boolean {
  const hour = parisHour(now);
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/** Le site doit-il être audité maintenant ? */
export function auditDue(input: { lastAuditAt: string | null; lastFailureAt: string | null }, now: Date): boolean {
  const at = (value: string | null) => (value ? Date.parse(value) : Number.NaN);
  const failure = at(input.lastFailureAt);
  if (Number.isFinite(failure) && now.getTime() - failure < RETRY_AFTER_MS) return false;
  const last = at(input.lastAuditAt);
  return !Number.isFinite(last) || now.getTime() - last >= AUDIT_INTERVAL_MS;
}

/** Ordre de passage : jamais audité d'abord, puis le plus ancien audit. */
export function auditOrder<T extends { lastAuditAt: string | null }>(items: readonly T[]): T[] {
  const time = (item: T) => (item.lastAuditAt ? Date.parse(item.lastAuditAt) : -Infinity);
  return [...items].sort((a, b) => time(a) - time(b));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export type FindingKind = "low" | "drop";
export type Finding = { category: CategoryId; label: string; kind: FindingKind; score: number; baseline: number | null; severity: "high" | "medium" };

/**
 * Alertes d'un audit : catégorie faible (< 50, « high » sous 30) ou en baisse d'au moins 10 points par rapport à la
 * médiane des audits précédents (du plus récent au plus ancien, au plus BASELINE_AUDITS). Sans historique, pas de baisse.
 */
export function evaluateAudit(current: Scores, previous: readonly Scores[]): Finding[] {
  const findings: Finding[] = [];
  const history = previous.slice(0, BASELINE_AUDITS);
  for (const { id, label } of CATEGORIES) {
    const value = current[id];
    if (value === null) continue;
    const baseline = median(history.map((item) => item[id]).filter((item): item is number => item !== null));
    if (value < LOW_SCORE) findings.push({ category: id, label, kind: "low", score: value, baseline, severity: value < 30 ? "high" : "medium" });
    if (baseline !== null && baseline - value >= DROP_POINTS) findings.push({ category: id, label, kind: "drop", score: value, baseline, severity: "medium" });
  }
  return findings;
}

export const findingFingerprint = (clientId: string, strategy: Strategy, category: CategoryId, kind: FindingKind) => `lighthouse:${clientId}:${strategy}:${category}:${kind}`;

/** Toutes les empreintes possibles d'un site (pour résoudre celles qui ne s'appliquent plus). */
export function allFingerprints(clientId: string, strategy: Strategy): string[] {
  return CATEGORIES.flatMap(({ id }) => (["low", "drop"] as const).map((kind) => findingFingerprint(clientId, strategy, id, kind)));
}

export function findingTitle(host: string, strategy: Strategy, finding: Finding): string {
  const support = strategyLabel[strategy];
  return finding.kind === "low"
    ? `${host} : ${finding.label} ${support} faible (${finding.score}/100)`
    : `${host} : ${finding.label} ${support} en baisse (${finding.baseline} → ${finding.score}/100)`;
}

/** Principales pistes d'amélioration remontées par Lighthouse (titres uniquement), par gain estimé décroissant. */
export function topOpportunities(value: unknown, limit = 3): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { title: string; savingsMs?: unknown } => Boolean(item) && typeof item === "object" && typeof (item as { title?: unknown }).title === "string")
    .sort((a, b) => (typeof b.savingsMs === "number" ? b.savingsMs : 0) - (typeof a.savingsMs === "number" ? a.savingsMs : 0))
    .slice(0, limit).map((item) => item.title.slice(0, 160));
}
