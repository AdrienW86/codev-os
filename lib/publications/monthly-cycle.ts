// Cycle mensuel des publications (règle de l'utilisateur, 2026-11-20). Fonctions pures, dates de Paris « AAAA-MM-JJ ».
//
// - Le 1er de chaque mois, les agents préparent le lot du mois : les publications du 16 de ce mois au 15 du mois suivant
//   (Google Business Profile, Facebook, Instagram et les autres canaux configurés).
// - Le soir du 1er, UNE notification invite à valider le lot avant le premier lundi qui suit le 1er.
// - Sans action, les publications partent quand même (validation automatique avant leur créneau) ; une image générée
//   par l'IA encore en attente après la date limite est validée automatiquement avec le lot (choix de l'utilisateur).
// Le reste du mois, le planificateur ne fait que rattraper : créneaux non préparés ou refusés, jusqu'au 15 suivant.

export const BATCH_START_DAY = 16, BATCH_END_DAY = 15;
/** Heure de Paris à partir de laquelle l'avis mensuel part le 1er (les agents ont eu la journée pour préparer). */
export const MONTHLY_NOTICE_HOUR = 20;
/** Plus long horizon possible : le 1er, jusqu'au 15 du mois suivant (≤ 46 jours). */
export const MAX_PREPARATION_HORIZON_DAYS = 46;
/** Une image IA encore en attente est validée automatiquement au plus tard ce nombre de jours avant son créneau. */
export const IMAGE_LAST_CALL_DAYS = 2;

const pad = (n: number) => String(n).padStart(2, "0");
const parse = (date: string) => { const [y, m, d] = date.slice(0, 10).split("-").map(Number); return { y, m, d }; };
const iso = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86400000);

export type MonthlyBatch = { key: string; preparedOn: string; from: string; to: string; deadline: string };

/** Lot préparé le 1er du mois « AAAA-MM » : du 16 de ce mois au 15 du suivant, à valider avant le premier lundi après le 1er. */
export function batchOfMonth(key: string): MonthlyBatch {
  const [y, m] = key.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = dimanche, 1 = lundi
  const toMonday = ((1 - first + 7) % 7) || 7; // premier lundi strictement après le 1er (2 au 8)
  return { key: `${y}-${pad(m)}`, preparedOn: iso(y, m, 1), from: iso(y, m, BATCH_START_DAY), to: iso(y, m + 1, BATCH_END_DAY), deadline: iso(y, m, 1 + toMonday) };
}

/** Lot auquel appartient une publication prévue ce jour-là (du 16 au 15 suivant). */
export function batchForDate(date: string): MonthlyBatch {
  const { y, m, d } = parse(date);
  return d >= BATCH_START_DAY ? batchOfMonth(`${y}-${pad(m)}`) : batchOfMonth(iso(y, m - 1, 1).slice(0, 7));
}

/** Lot préparé ce mois-ci (celui que l'avis du 1er annonce). */
export const currentBatch = (today: string) => batchOfMonth(today.slice(0, 7));

/**
 * Horizon de préparation (en jours depuis aujourd'hui) : jusqu'au 15 du mois suivant. Le 1er, l'horizon s'allonge
 * d'un mois d'un coup (le lot du mois) ; les autres jours il ne fait que rattraper les créneaux restés vides.
 */
export function preparationHorizonDays(today: string) {
  return Math.min(Math.max(daysBetween(today, currentBatch(today).to), 1), MAX_PREPARATION_HORIZON_DAYS);
}

/** L'avis mensuel peut partir : le lot de ce mois, à partir du 1er à MONTHLY_NOTICE_HOUR h, jusqu'à la date limite. */
export function monthlyNoticeDue(today: string, parisHour: number) {
  const batch = currentBatch(today);
  if (today > batch.deadline) return null;
  if (today === batch.preparedOn && parisHour < MONTHLY_NOTICE_HOUR) return null;
  return batch;
}

/** Une image IA en attente pour une publication prévue ce jour-là est-elle validée automatiquement aujourd'hui ? */
export function imageAutoValidationDue(targetDate: string, today: string) {
  return today > batchForDate(targetDate).deadline || daysBetween(today, targetDate) <= IMAGE_LAST_CALL_DAYS;
}

/** Heure (0-23) à Paris. */
export function parisHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(now));
}

const LONG = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
export const longDate = (date: string) => LONG.format(new Date(`${date}T12:00:00Z`));
export const shortDate = (date: string) => SHORT.format(new Date(`${date}T12:00:00Z`));
export const monthlyNoticeKey = (batch: MonthlyBatch) => `monthly-review:${batch.key}`;
