// Périodes Google Ads (pur, testable) : préréglages proches de l'interface Google Ads, calculés dans
// le FUSEAU DU COMPTE. Les périodes glissantes excluent aujourd'hui ; « aujourd'hui », « cette semaine »
// et « ce mois-ci » l'incluent et sont signalées comme potentiellement incomplètes.
import type { AdsPeriod } from "./types";

export const PERIOD_PRESETS = ["today", "yesterday", "last_7", "last_14", "last_30", "last_90", "this_week", "last_week", "this_month", "last_month", "day", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export type PeriodSelection = { preset: PeriodPreset; date?: string; start?: string; end?: string };

/** Bornes explicites : 366 jours au plus par requête, données sur 3 ans au plus (rétention Google Ads). */
export const MAX_PERIOD_DAYS = 366;
export const MAX_HISTORY_DAYS = 1_095;

export const presetLabels: Record<PeriodPreset, string> = {
  today: "Aujourd’hui", yesterday: "Hier", last_7: "7 derniers jours", last_14: "14 derniers jours", last_30: "30 derniers jours", last_90: "90 derniers jours",
  this_week: "Cette semaine", last_week: "Semaine précédente", this_month: "Ce mois-ci", last_month: "Mois précédent", day: "Journée précise", custom: "Période personnalisée",
};

export type ResolvedPeriod = AdsPeriod & { preset: PeriodPreset; includesToday: boolean; today: string; timezone: string };

const iso = /^\d{4}-\d{2}-\d{2}$/;
const toUtc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const fromUtc = (time: number) => new Date(time).toISOString().slice(0, 10);
const addDays = (day: string, days: number) => fromUtc(toUtc(day) + days * 86_400_000);
const spanDays = (start: string, end: string) => Math.round((toUtc(end) - toUtc(start)) / 86_400_000) + 1;

export function isValidDay(value: unknown): value is string {
  return typeof value === "string" && iso.test(value) && fromUtc(toUtc(value)) === value;
}

/** Date du jour dans le fuseau IANA du compte Google Ads. */
export function todayIn(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export class PeriodError extends Error {}

/** Résout une sélection en dates exactes ; lève PeriodError avec un message lisible si elle est invalide. */
export function resolvePeriod(selection: PeriodSelection, timezone: string, now = new Date()): ResolvedPeriod {
  const today = todayIn(timezone, now);
  const weekday = (new Date(toUtc(today)).getUTCDay() + 6) % 7; // 0 = lundi
  const monthStart = `${today.slice(0, 8)}01`;
  let start: string, end: string;
  switch (selection.preset) {
    case "today": start = end = today; break;
    case "yesterday": start = end = addDays(today, -1); break;
    case "last_7": case "last_14": case "last_30": case "last_90": {
      const days = Number(selection.preset.slice(5));
      start = addDays(today, -days); end = addDays(today, -1); break;
    }
    case "this_week": start = addDays(today, -weekday); end = today; break;
    case "last_week": start = addDays(today, -weekday - 7); end = addDays(today, -weekday - 1); break;
    case "this_month": start = monthStart; end = today; break;
    case "last_month": end = addDays(monthStart, -1); start = `${end.slice(0, 8)}01`; break;
    case "day":
      if (!isValidDay(selection.date)) throw new PeriodError("Choisissez une date valide.");
      start = end = selection.date; break;
    case "custom":
      if (!isValidDay(selection.start) || !isValidDay(selection.end)) throw new PeriodError("Choisissez une date de début et une date de fin valides.");
      start = selection.start; end = selection.end; break;
    default: throw new PeriodError("Période inconnue.");
  }
  if (end < start) throw new PeriodError("La date de fin précède la date de début.");
  if (end > today) throw new PeriodError(`Les données s’arrêtent aujourd’hui (${today}, fuseau du compte).`);
  if (start < addDays(today, -MAX_HISTORY_DAYS)) throw new PeriodError("Période trop ancienne : 3 ans d’historique au plus.");
  const days = spanDays(start, end);
  if (days > MAX_PERIOD_DAYS) throw new PeriodError(`Période trop longue : ${MAX_PERIOD_DAYS} jours au plus.`);
  return { preset: selection.preset, start, end, days, includesToday: end === today, today, timezone };
}

/** Période précédente de même durée, juste avant le début. */
export function previousPeriod(period: AdsPeriod): AdsPeriod {
  const end = addDays(period.start, -1);
  return { start: addDays(end, -(period.days - 1)), end, days: period.days };
}

// Les dates sont déjà exprimées dans le fuseau du compte : on les formate telles quelles (UTC = pas de décalage).
const dayFormatter = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** « du 9 sept. 2026 au 8 oct. 2026 » ou « le 8 oct. 2026 ». */
export function describeDates(period: AdsPeriod) {
  const format = (day: string) => dayFormatter.format(new Date(`${day}T00:00:00Z`));
  return period.start === period.end ? `le ${format(period.start)}` : `du ${format(period.start)} au ${format(period.end)}`;
}
