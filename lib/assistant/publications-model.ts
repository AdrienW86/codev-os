// Publications dans l'assistant (phase 6) : règles PURES, testables sans base ni réseau.
// Semaine prochaine, créneaux en heure de Paris, liens de supervision, explication d'une photo écartée,
// phrases de confirmation. Aucun appel ici : les lectures et écritures passent par publications-tool.ts.
import { isPublicationCandidate, SENSITIVE_LABELS, VERDICT_LABELS, type SensitiveKind } from "@/lib/media-intelligence/model";

export const PUBLICATION_PLATFORMS = ["google_business_profile", "facebook", "instagram"] as const;
export type AssistantPlatform = (typeof PUBLICATION_PLATFORMS)[number];
export const PLATFORM_LABELS: Record<AssistantPlatform, string> = { google_business_profile: "Google Business Profile", facebook: "Facebook", instagram: "Instagram" };
export const platformLabel = (value: unknown) => (typeof value === "string" && value in PLATFORM_LABELS ? PLATFORM_LABELS[value as AssistantPlatform] : "Plateforme inconnue");

/**
 * Nombre maximal de préparations Agent v2 lancées par UNE confirmation de l'assistant (une préparation = une idée,
 * déclinée en un brouillon par plateforme du créneau). Borne le coût IA et la durée de la requête (maxDuration 120 s).
 */
export const MAX_ASSISTANT_PREPARATIONS = 4;
/** Nombre maximal d'éléments numérotés gardés dans le contexte (« la 2 », « la photo 3 »). */
export const MAX_CONTEXT_ITEMS = 10;

const DAY = 86_400_000;
export function addDaysIso(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
/** Lundi → dimanche de la semaine suivant `today` (AAAA-MM-JJ, dates locales). */
export function nextWeekRange(today: string): { start: string; end: string } {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDaysIso(today, 7 - weekday);
  return { start, end: addDaysIso(start, 6) };
}

const dayFormat = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
/** « lundi 19 octobre » à partir d'une date locale AAAA-MM-JJ. */
export const formatDay = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));
export const formatRange = (range: { start: string; end: string }) => `du ${formatDay(range.start)} au ${formatDay(range.end)}`;

const parisFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** Date et heure de Paris (AAAA-MM-JJ, HH:MM) d'un instant ISO. */
export function parisParts(iso: string): { date: string; time: string } {
  const parts = Object.fromEntries(parisFormat.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
/** « vendredi 16 octobre à 18:00 » (heure de Paris). */
export function formatSlot(iso: string | null | undefined) {
  if (!iso) return "sans créneau";
  const { date, time } = parisParts(iso);
  return `${formatDay(date)} à ${time}`;
}
/** Créneau libre de reprogrammation correspondant exactement au jour et à l'heure demandés (heure de Paris). */
export function matchSlot<T extends { id: string; scheduledFor: string }>(targets: readonly T[], date: string, time: string): T | undefined {
  return targets.find((target) => { const parts = parisParts(target.scheduledFor); return parts.date === date && parts.time === time; });
}

// --- Liens ------------------------------------------------------------------------------------
/** Vue « À valider » du hub de supervision (#45) ; le paramètre client filtre la file quand il est connu. */
export const supervisionReviewHref = (clientId?: string | null) => `/publications/supervision?view=review${clientId ? `&client=${encodeURIComponent(clientId)}` : ""}`;
/** File de validation complète existante. */
export const REVIEW_QUEUE_HREF = "/publications/review";
/** Reconnexion des comptes : onglet Publications de la fiche client (même lien que la supervision). */
export const reconnectHref = (clientId: string) => `/clients/${encodeURIComponent(clientId)}?tab=publications`;
/** Photothèque du client. */
export const libraryHref = (clientId: string) => `/clients/${encodeURIComponent(clientId)}?tab=media`;
export const publicationHref = (publicationId: string) => `/publications/${encodeURIComponent(publicationId)}`;
export const projectCalendarHref = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/calendar`;

// --- Explication d'une photo écartée ------------------------------------------------------------
export type PhotoDecisionRow = {
  id: string; libraryStatus: string; mediaKind: string; statusChangedAt: string | null; statusChangedByHuman: boolean;
  receivedAt: string | null; purged: boolean; width: number | null; height: number | null;
  assessment: {
    verdict: "relevant" | "to_review" | "off_topic"; confidential: boolean; sensitive: string[]; description: string;
    quality: "good" | "acceptable" | "poor"; qualityIssues: string[]; manualVerdict: "relevant" | "off_topic" | null; reviewedAt: string | null;
  } | null;
};

const QUALITY_LABELS: Record<string, string> = { blurry: "floue", dark: "trop sombre", low_resolution: "résolution insuffisante", watermark: "filigrane", screenshot: "capture d’écran", text_heavy: "essentiellement du texte", cropped: "mal cadrée" };
const STATUS_LABELS: Record<string, string> = { received: "Reçue", to_review: "À examiner", validated: "Validée", used: "Utilisée", archived: "Archivée", quarantined: "En quarantaine", rejected: "Rejetée" };
const shortDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "date inconnue");
const BLOCKING_ISSUES = ["blurry", "screenshot", "text_heavy"];
const MIN_SIDE = 600;

export const photoStatusLabel = (status: string) => STATUS_LABELS[status] ?? status;
/** Description affichable : jamais celle d'une photo confidentielle (ni légende, ni nom de fichier, ni identifiant Drive). */
export const safeDescription = (row: PhotoDecisionRow) => (!row.assessment ? "Non classée" : row.assessment.confidential ? "Contenu confidentiel (description masquée)" : row.assessment.description.slice(0, 160));

/**
 * Raisons, dans l'ordre d'autorité (décision humaine d'abord, puis classement IA, puis règles de qualité et de format),
 * pour lesquelles une photo n'est pas proposée à l'agent. Tableau vide : la photo est utilisable.
 */
export function photoExclusionReasons(row: PhotoDecisionRow): string[] {
  const reasons: string[] = [];
  const a = row.assessment;
  if (row.purged) reasons.push("Fichier supprimé après rejet (purge des photos rejetées).");
  if (row.libraryStatus === "rejected") reasons.push(`Rejetée par un administrateur le ${shortDate(row.statusChangedAt)} (décision humaine).`);
  if (row.libraryStatus === "archived") reasons.push(`Archivée${row.statusChangedByHuman ? " par un administrateur" : ""} le ${shortDate(row.statusChangedAt)}.`);
  if (row.libraryStatus === "quarantined") reasons.push(`Mise en quarantaine le ${shortDate(row.statusChangedAt)}${row.statusChangedByHuman ? " par un administrateur" : " par le classement automatique"} : elle n’est jamais proposée tant qu’elle n’est pas revue.`);
  if (a?.manualVerdict === "off_topic") reasons.push(`Jugée hors sujet par un administrateur${a.reviewedAt ? ` le ${shortDate(a.reviewedAt)}` : ""}.`);
  if (a?.confidential) {
    const kinds = a.sensitive.filter((kind) => kind in SENSITIVE_LABELS).map((kind) => SENSITIVE_LABELS[kind as SensitiveKind].toLowerCase());
    reasons.push(`Contenu confidentiel détecté par le classement IA${kinds.length ? ` (${kinds.join(", ")})` : ""}.`);
  }
  if (a && !a.manualVerdict && a.verdict === "off_topic") reasons.push("Jugée hors sujet par le classement IA (sans rapport avec l’activité du client).");
  if (a && !a.manualVerdict && a.verdict === "to_review") reasons.push("Classée « à examiner » par l’IA : une validation humaine est nécessaire.");
  if (a && !a.confidential && a.sensitive.some((kind) => kind === "face" || kind === "minor") && row.libraryStatus !== "validated" && row.libraryStatus !== "used")
    reasons.push(`${a.sensitive.includes("minor") ? "Mineur" : "Visage"} détecté : une validation humaine est nécessaire.`);
  if (a && (a.quality === "poor" || a.qualityIssues.some((issue) => BLOCKING_ISSUES.includes(issue)))) {
    const issues = a.qualityIssues.map((issue) => QUALITY_LABELS[issue]).filter(Boolean);
    reasons.push(`Qualité insuffisante${issues.length ? ` : ${issues.join(", ")}` : " (jugée médiocre)"}.`);
  }
  if (row.width && row.height && (Math.min(row.width, row.height) < MIN_SIDE || Math.max(row.width, row.height) / Math.min(row.width, row.height) > 3))
    reasons.push(`Format inadapté (${row.width}×${row.height} px ; ${MIN_SIDE} px minimum sur le petit côté, rapport 3:1 au plus).`);
  if (!a && !["validated", "used", "rejected", "archived", "quarantined"].includes(row.libraryStatus)) reasons.push("Pas encore classée : ni validation humaine, ni classement IA.");
  // Filet : la règle de sélection de l'agent (isPublicationCandidate) refuse la photo sans raison listée ci-dessus.
  const candidate = isPublicationCandidate({ libraryStatus: row.libraryStatus, mediaKind: row.mediaKind, purged: row.purged,
    assessment: a ? { verdict: a.verdict, confidential: a.confidential, sensitive: a.sensitive, manual_verdict: a.manualVerdict } : null });
  if (!candidate && !reasons.length) reasons.push(row.mediaKind !== "image" ? "Ce n’est pas une photo (vidéo)." : "Non retenue par les règles de sélection de l’agent.");
  return reasons;
}

/** Résumé du classement IA (lisible, sans donnée confidentielle). */
export function classificationSummary(row: PhotoDecisionRow) {
  const a = row.assessment;
  if (!a) return "Aucun classement IA.";
  return `${VERDICT_LABELS[a.verdict]} ; qualité ${a.quality === "good" ? "bonne" : a.quality === "acceptable" ? "acceptable" : "médiocre"}${a.manualVerdict ? ` ; décision humaine : ${VERDICT_LABELS[a.manualVerdict].toLowerCase()}` : ""}.`;
}

// --- Phrases de confirmation ---------------------------------------------------------------------
/** Phrase présentée avant toute préparation : brouillons uniquement, appel IA réel explicitement autorisé par la confirmation. */
export function describePrepare(input: Record<string, unknown>) {
  const client = String(input.client ?? "ce client");
  const project = typeof input.project === "string" ? ` (projet ${input.project})` : "";
  const scope = input.period === "next_week" && typeof input.start === "string" && typeof input.end === "string"
    ? `pour la semaine prochaine (${formatRange({ start: input.start, end: input.end })})${typeof input.slots === "number" ? `, ${input.slots} créneau${input.slots > 1 ? "x" : ""} libre${input.slots > 1 ? "s" : ""}` : ""}`
    : `: ${Number(input.count ?? 1)} publication${Number(input.count ?? 1) > 1 ? "s" : ""} sur les prochains créneaux libres`;
  const runs = input.period === "next_week" ? MAX_ASSISTANT_PREPARATIONS : Math.min(Number(input.count ?? 1), MAX_ASSISTANT_PREPARATIONS);
  return `Préparer avec l’Agent Publications v2 les publications de ${client}${project} ${scope}. `
    + `Brouillons uniquement : rien n’est soumis, approuvé, programmé ni publié. Confirmer autorise l’appel IA réel (${runs} préparation${runs > 1 ? "s" : ""} au plus).`;
}

export function describeReschedule(input: Record<string, unknown>) {
  const subject = typeof input.subject === "string" ? `« ${input.subject} »` : "cette publication";
  const where = [typeof input.platform === "string" ? platformLabel(input.platform) : null, typeof input.client_name === "string" ? input.client_name : null].filter(Boolean).join(", ");
  const from = typeof input.from === "string" ? ` du ${formatSlot(input.from)}` : "";
  const to = typeof input.date === "string" && typeof input.time === "string" ? `${formatDay(input.date)} à ${input.time}` : "le créneau choisi";
  return `Reprogrammer ${subject}${where ? ` (${where})` : ""}${from} au ${to} (heure de Paris). `
    + "Une nouvelle publication est créée sur ce créneau et l’ancienne est archivée ; l’approbation est remise à zéro : nouvelle validation humaine nécessaire avant toute diffusion.";
}
