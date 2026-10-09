// Récurrences des automatisations, calculées dans le fuseau IANA de chaque automatisation.
// Les dates sont stockées en UTC (timestamptz) ; l'heure murale locale est respectée,
// y compris lors des changements d'heure :
//  - heure inexistante (passage à l'heure d'été) → décalée après le saut ;
//  - heure ambiguë (passage à l'heure d'hiver) → première occurrence.
import { z } from "zod";

export type Frequency = "once" | "daily" | "weekly" | "monthly";
/** weekdays : 1 = lundi … 7 = dimanche. monthDay : 1–31 (ramené au dernier jour du mois). */
export type Schedule = { time?: string; weekdays?: number[]; monthDay?: number; runAt?: string };

export function isValidTimezone(timezone: string) {
  if (typeof timezone !== "string" || timezone.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); return true; } catch { return false; }
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const scheduleSchema = z.object({
  frequency: z.enum(["once", "daily", "weekly", "monthly"]),
  timezone: z.string().refine(isValidTimezone, "Fuseau horaire inconnu."),
  schedule: z.object({
    time: time.optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    monthDay: z.number().int().min(1).max(31).optional(),
    runAt: z.iso.datetime({ offset: true }).optional(),
  }).strict(),
}).superRefine((value, context) => {
  const { frequency, schedule } = value;
  if (frequency === "once" && !schedule.runAt) context.addIssue({ code: "custom", message: "Date d’exécution requise.", path: ["schedule", "runAt"] });
  if (frequency !== "once" && !schedule.time) context.addIssue({ code: "custom", message: "Heure requise.", path: ["schedule", "time"] });
  if (frequency === "weekly" && !schedule.weekdays?.length) context.addIssue({ code: "custom", message: "Jour(s) de la semaine requis.", path: ["schedule", "weekdays"] });
  if (frequency === "monthly" && !schedule.monthDay) context.addIssue({ code: "custom", message: "Jour du mois requis.", path: ["schedule", "monthDay"] });
});

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string) {
  let value = formatters.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
    formatters.set(timezone, value);
  }
  return value;
}
const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Composantes locales d'un instant dans un fuseau. */
export function localParts(instant: Date, timezone: string): Parts {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(instant).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: weekdays[parts.weekday] };
}

/** Décalage (ms) du fuseau à un instant donné. */
function offsetAt(instant: number, timezone: string) {
  const p = localParts(new Date(instant), timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(instant / 60000) * 60000;
}

/** Instant UTC correspondant à une heure murale locale (règles DST ci-dessus). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Deux décalages candidats autour de l'instant : avant et après une éventuelle transition.
  const candidates = [...new Set([offsetAt(wall - 12 * 3600_000, timezone), offsetAt(wall + 12 * 3600_000, timezone)])]
    .map((offset) => wall - offset)
    .filter((instant) => { const p = localParts(new Date(instant), timezone); return p.hour === hour && p.minute === minute && p.day === day; })
    .sort((a, b) => a - b);
  if (candidates.length) return new Date(candidates[0]);
  // Heure inexistante (saut de printemps) : appliquer le décalage d'avant le saut, ce qui la place après.
  return new Date(wall - offsetAt(wall - 12 * 3600_000, timezone));
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Prochaine exécution strictement après `after`, ou `null` (exécution unique passée).
 * Recherche bornée à 400 jours.
 */
export function nextRun(frequency: Frequency, schedule: Schedule, timezone: string, after: Date): Date | null {
  if (frequency === "once") {
    const at = schedule.runAt ? new Date(schedule.runAt) : null;
    return at && !Number.isNaN(at.getTime()) && at.getTime() > after.getTime() ? at : null;
  }
  const [hour, minute] = (schedule.time ?? "08:00").split(":").map(Number);
  const start = localParts(after, timezone);
  for (let offset = 0; offset <= 400; offset++) {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1, day = date.getUTCDate();
    const weekday = ((date.getUTCDay() + 6) % 7) + 1;
    if (frequency === "weekly" && !(schedule.weekdays ?? []).includes(weekday)) continue;
    if (frequency === "monthly" && day !== Math.min(schedule.monthDay ?? 1, daysInMonth(year, month))) continue;
    const candidate = zonedToUtc(year, month, day, hour, minute, timezone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return null;
}

const dayNames = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
/** « Tous les lundis à 08:00 (Europe/Paris) ». */
export function describeSchedule(frequency: Frequency, schedule: Schedule, timezone: string) {
  const zone = timezone === "Europe/Paris" ? "" : ` (${timezone})`;
  if (frequency === "once") return `Une fois${schedule.runAt ? ` le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: timezone }).format(new Date(schedule.runAt))}` : ""}${zone}`;
  const at = `à ${schedule.time ?? "08:00"}${zone}`;
  if (frequency === "daily") return `Tous les jours ${at}`;
  if (frequency === "weekly") {
    const days = [...(schedule.weekdays ?? [])].sort().map((day) => dayNames[day]);
    return `${days.length === 1 ? `Tous les ${days[0]}s` : `Chaque ${days.join(", ")}`} ${at}`;
  }
  return `Le ${schedule.monthDay ?? 1} de chaque mois ${at}`;
}
