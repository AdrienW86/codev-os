// Agenda (pur) : occurrences des éléments récurrents dans le fuseau de chaque élément (heure d'été
// comprise), exécutions prévues des automatisations, validation des saisies.
import { z } from "zod";
import { isValidTimezone, localParts, nextRun, zonedToUtc, type Frequency, type Schedule } from "@/lib/scheduler/recurrence";

export type AgendaRecurrence = "none" | "daily" | "weekly" | "monthly";
export type AgendaLike = { id: string; starts_at: string; timezone: string; recurrence: AgendaRecurrence; recurrence_until: string | null; status: string; duration_minutes: number };
export type Occurrence<T> = { item: T; startsAt: Date; endsAt: Date };

const MAX_OCCURRENCES = 400;

function scheduleOf(item: AgendaLike): { frequency: Frequency; schedule: Schedule } {
  const local = localParts(new Date(item.starts_at), item.timezone);
  const time = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
  if (item.recurrence === "weekly") return { frequency: "weekly", schedule: { time, weekdays: [local.weekday] } };
  if (item.recurrence === "monthly") return { frequency: "monthly", schedule: { time, monthDay: local.day } };
  return { frequency: "daily", schedule: { time } };
}

/** Occurrences d'éléments (annulés exclus) qui commencent dans [from, to[. */
export function expandOccurrences<T extends AgendaLike>(items: readonly T[], from: Date, to: Date): Occurrence<T>[] {
  const result: Occurrence<T>[] = [];
  for (const item of items) {
    if (item.status === "cancelled") continue;
    const first = new Date(item.starts_at);
    if (Number.isNaN(first.getTime()) || !isValidTimezone(item.timezone)) continue;
    const push = (start: Date) => result.push({ item, startsAt: start, endsAt: new Date(start.getTime() + item.duration_minutes * 60_000) });
    if (item.recurrence === "none") { if (first >= from && first < to) push(first); continue; }
    const until = item.recurrence_until ? zonedToUtc(...(item.recurrence_until.split("-").map(Number) as [number, number, number]), 23, 59, item.timezone) : null;
    const { frequency, schedule } = scheduleOf(item);
    let current: Date | null = first;
    for (let count = 0; current && count < MAX_OCCURRENCES && current < to; count++) {
      if (until && current > until) break;
      if (current >= from) push(current);
      current = nextRun(frequency, schedule, item.timezone, current);
    }
  }
  return result.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export type AutomationLike = { id: string; name: string; status: string; frequency: Frequency; schedule: unknown; timezone: string; next_run_at: string | null };

/** Exécutions prévues des automatisations actives dans [from, to[ (affichage seulement). */
export function automationRuns<T extends AutomationLike>(automations: readonly T[], from: Date, to: Date): { automation: T; at: Date }[] {
  const runs: { automation: T; at: Date }[] = [];
  for (const automation of automations) {
    if (automation.status !== "active" || !automation.next_run_at || !isValidTimezone(automation.timezone)) continue;
    let at: Date | null = new Date(automation.next_run_at);
    for (let count = 0; at && at < to && count < 100; count++) {
      if (at >= from) runs.push({ automation, at });
      at = automation.frequency === "once" ? null : nextRun(automation.frequency, automation.schedule as Schedule, automation.timezone, at);
    }
  }
  return runs.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Lundi (AAAA-MM-JJ) de la semaine contenant `day`. */
export function mondayOf(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Jour local (AAAA-MM-JJ) d'un instant dans un fuseau. */
export function localDay(instant: Date, timezone = "Europe/Paris") {
  const p = localParts(instant, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export const agendaInputSchema = z.object({
  kind: z.enum(["event", "meeting", "work_block", "check"]),
  title: z.string().trim().min(1, "Titre requis.").max(200),
  notes: z.string().trim().max(4000).optional().transform((value) => value || null),
  clientId: z.uuid().nullable(),
  startsLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Date et heure requises."),
  durationMinutes: z.coerce.number().int().min(5).max(1440).default(60),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
  recurrenceUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  timezone: z.string().refine(isValidTimezone).default("Europe/Paris"),
}).strict();

export function validateAgendaInput(input: unknown): { ok: true; value: { kind: "event" | "meeting" | "work_block" | "check"; title: string; notes: string | null; clientId: string | null; startsAt: string; durationMinutes: number; recurrence: AgendaRecurrence; recurrenceUntil: string | null; priority: "low" | "normal" | "high"; timezone: string } } | { ok: false; message: string } {
  const parsed = agendaInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Saisie invalide." };
  const { startsLocal, timezone, recurrence, recurrenceUntil } = parsed.data;
  const [date, time] = startsLocal.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const startsAt = zonedToUtc(year, month, day, hour, minute, timezone);
  if (Number.isNaN(startsAt.getTime()) || localDay(startsAt, timezone) !== date) return { ok: false, message: "Date invalide." };
  if (recurrence !== "none" && recurrenceUntil && recurrenceUntil < date) return { ok: false, message: "La fin de récurrence précède le début." };
  return { ok: true, value: { ...parsed.data, startsAt: startsAt.toISOString(), recurrenceUntil: recurrence === "none" ? null : recurrenceUntil } };
}

/** Prochaine occurrence de chaque élément prévu (fenêtre : hier → +14 jours). */
export function upcomingOccurrences<T extends AgendaLike>(items: readonly T[], limit = 10, now = new Date()): Occurrence<T>[] {
  const seen = new Set<string>();
  return expandOccurrences(items.filter((item) => item.status === "planned"), new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 14 * 86_400_000))
    .filter((occurrence) => !seen.has(occurrence.item.id) && Boolean(seen.add(occurrence.item.id))).slice(0, limit);
}
