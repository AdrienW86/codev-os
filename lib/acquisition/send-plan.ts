// Prospection e-mail : planification et garde-fous d'envoi (fonctions pures, aucun accès réseau ni base).
// Un domaine neuf qui envoie beaucoup d'un coup est classé indésirable : montée en charge progressive (préchauffage),
// envois en heures de bureau seulement, quelques messages par passage du planificateur (toutes les 15 min), arrêt
// automatique au premier signal de mauvaise réputation (plainte, taux de rebond).

/** Plafond absolu par jour et par espace, quel que soit le réglage (prospection à froid, pas de campagne de masse). */
export const HARD_DAILY_CAP = 50;
/** Au plus 3 messages par passage (toutes les 15 min) : envois espacés, jamais en rafale. */
export const MAX_PER_TICK = 3;

/** Préchauffage : 10/jour la 1re semaine, 20 la 2e, 35 la 3e, puis 50. Avant le premier envoi : 10. */
export function warmupCap(warmupStartedAt: string | null | undefined, now: Date): number {
  const start = warmupStartedAt ? Date.parse(warmupStartedAt) : NaN;
  if (!Number.isFinite(start)) return 10;
  const days = Math.floor((now.getTime() - start) / 86_400_000);
  return days < 7 ? 10 : days < 14 ? 20 : days < 21 ? 35 : HARD_DAILY_CAP;
}

/** Plafond du jour : le plus petit du réglage de l'espace, du préchauffage et du plafond absolu. */
export function dailyCap(workspaceLimit: number, warmupStartedAt: string | null | undefined, now: Date): number {
  const limit = Number.isSafeInteger(workspaceLimit) && workspaceLimit > 0 ? workspaceLimit : 0;
  return Math.min(limit, warmupCap(warmupStartedAt, now), HARD_DAILY_CAP);
}

type LocalTime = { year: number; month: number; day: number; weekday: number; minutes: number };

/** Date et heure locales (fuseau de l'espace, Europe/Paris par défaut). */
export function localTime(now: Date, timeZone = "Europe/Paris"): LocalTime {
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now); }
  catch { return localTime(now, "Europe/Paris"); }
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher), en date UTC. */
function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Jour férié en France métropolitaine (fixes + lundi de Pâques, Ascension, lundi de Pentecôte). */
export function isFrenchHoliday(year: number, month: number, day: number): boolean {
  const fixed = ["1-1", "5-1", "5-8", "7-14", "8-15", "11-1", "11-11", "12-25"];
  if (fixed.includes(`${month}-${day}`)) return true;
  const base = easter(year).getTime();
  const key = Date.UTC(year, month - 1, day);
  return [1, 39, 50].some((offset) => base + offset * 86_400_000 === key);
}

/** Créneaux d'envoi (heure locale) : du lundi au vendredi, 9 h – 11 h 30 et 14 h – 16 h 30, hors jours fériés. */
export const SEND_WINDOWS: readonly [number, number][] = [[9 * 60, 11 * 60 + 30], [14 * 60, 16 * 60 + 30]];

export function inSendWindow(now: Date, timeZone?: string): boolean {
  const t = localTime(now, timeZone);
  if (t.weekday < 1 || t.weekday > 5 || isFrenchHoliday(t.year, t.month, t.day)) return false;
  return SEND_WINDOWS.some(([from, to]) => t.minutes >= from && t.minutes < to);
}

/** Passages (toutes les 15 min) restant aujourd'hui dans les créneaux, passage courant compris. */
export function ticksLeftToday(now: Date, timeZone?: string): number {
  if (!inSendWindow(now, timeZone)) return 0;
  const { minutes } = localTime(now, timeZone);
  return SEND_WINDOWS.reduce((sum, [from, to]) => sum + Math.max(0, Math.ceil((to - Math.max(from, minutes)) / 15)), 0);
}

/** Nombre de messages à envoyer pendant ce passage : réparti sur les créneaux restants, 3 au plus. */
export function tickBudget(remainingToday: number, ticksLeft: number): number {
  if (remainingToday <= 0 || ticksLeft <= 0) return 0;
  return Math.min(MAX_PER_TICK, Math.ceil(remainingToday / ticksLeft));
}

/** Début du jour local (fuseau de l'espace), en ISO UTC : base du compte « envoyés aujourd'hui ». */
export function localDayStartIso(now: Date, timeZone?: string): string {
  const t = localTime(now, timeZone);
  // Décalage du fuseau à cet instant : différence entre l'heure locale lue et l'heure UTC.
  const localAsUtc = Date.UTC(t.year, t.month - 1, t.day, Math.floor(t.minutes / 60), t.minutes % 60);
  const offset = localAsUtc - Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(Date.UTC(t.year, t.month - 1, t.day) - offset).toISOString();
}

export type ReputationStats = { sent: number; hardBounces: number; complaints: number };
export type ReputationVerdict = { stop: false } | { stop: true; reason: "complaint" | "bounce_rate"; detail: string };

/**
 * Garde-fou de réputation sur les 7 derniers jours : une plainte, ou des rebonds définitifs au-delà de 3 % (dès 20
 * envois), ou 3 rebonds avant 20 envois → arrêt d'urgence automatique de l'espace (reprise manuelle seulement).
 */
export function reputationVerdict(stats: ReputationStats): ReputationVerdict {
  if (stats.complaints > 0) return { stop: true, reason: "complaint", detail: `${stats.complaints} plainte(s) pour indésirable sur 7 jours` };
  if (stats.sent >= 20 && stats.hardBounces / stats.sent > 0.03) return { stop: true, reason: "bounce_rate", detail: `${stats.hardBounces} rebond(s) définitif(s) sur ${stats.sent} envois (> 3 %)` };
  if (stats.sent < 20 && stats.hardBounces >= 3) return { stop: true, reason: "bounce_rate", detail: `${stats.hardBounces} rebonds définitifs sur ${stats.sent} envois` };
  return { stop: false };
}

/** Étapes de prospect qui interdisent tout nouvel envoi (réponse reçue, client, sans suite, exclu). */
export const NO_CONTACT_STAGES = new Set(["responded", "won", "lost", "excluded"]);

/** Ajoute n jours ouvrés (lundi-vendredi, hors fériés) à une date, à la même heure. */
export function addBusinessDays(from: Date, days: number): Date {
  const date = new Date(from.getTime());
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 5 && !isFrenchHoliday(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())) left--;
  }
  return date;
}
