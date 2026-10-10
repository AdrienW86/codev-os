import { z } from "zod";
import { isValidTimezone, localParts, nextRun } from "@/lib/scheduler/recurrence";
import { recipientSchema } from "@/lib/reports/recipient";
export const recurringConfigSchema = z.strictObject({
  accountId: z.string().regex(/^\d{10}$/).optional(), dataTimezone: z.string().max(64).refine(isValidTimezone).optional(), enabled: z.boolean(), frequency: z.enum(["weekly", "monthly"]), weekday: z.number().int().min(1).max(7), monthDay: z.number().int().min(1).max(31),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timezone: z.string().max(64).refine(isValidTimezone),
  recipient: recipientSchema, recipientConfirmed: z.literal(true), campaignIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(50).refine(v => new Set(v).size === v.length),
  types: z.array(z.string().regex(/^[A-Z_]{2,40}$/)).max(20), mode: z.enum(["ai", "deterministic"]),
  transport: z.enum(["prepare_only", "approved_auto"]), leadHours: z.number().int().min(0).max(72), lateMinutes: z.number().int().min(0).max(120),
});
export type RecurringConfig = z.infer<typeof recurringConfigSchema>;
export type OccurrenceWindow = { dueAt: string; prepareAt: string; start: string; end: string; timezone: string; cutoff: string };
export const DEFAULT_RECURRING_CONFIG: RecurringConfig = { enabled: false, frequency: "weekly", weekday: 5, monthDay: 1, time: "18:00", timezone: "Europe/Paris", recipient: "", recipientConfirmed: true, campaignIds: [], types: [], mode: "ai", transport: "prepare_only", leadHours: 6, lateMinutes: 5 };
const schedule = (c: RecurringConfig) => ({ time: c.time, weekdays: [c.weekday], monthDay: c.monthDay });
const dateInZone = (date: Date, zone: string) => { const p = localParts(date, zone); return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`; };
function previousDue(c: RecurringConfig, due: Date) {
  let value = nextRun(c.frequency, schedule(c), c.timezone, new Date(due.getTime() - 65 * 86400000));
  let previous: Date | null = null;
  for (let i = 0; value && value < due && i < 70; i++) { previous = value; value = nextRun(c.frequency, schedule(c), c.timezone, value); }
  if (!previous) throw new Error("recurrence boundary");
  return previous;
}
/** Cutoff is midnight BEFORE preparation: only closed Google Ads calendar days, never Friday partial. */
export function occurrenceWindow(c: RecurringConfig, dueAt: Date): OccurrenceWindow {
  const prepare = new Date(dueAt.getTime() - c.leadHours * 3600000);
  const previousPrepare = new Date(previousDue(c, dueAt).getTime() - c.leadHours * 3600000);
  const cutoff = dateInZone(prepare, c.dataTimezone ?? c.timezone);
  const end = new Date(`${cutoff}T00:00:00Z`); end.setUTCDate(end.getUTCDate() - 1);
  return { dueAt: dueAt.toISOString(), prepareAt: prepare.toISOString(), start: dateInZone(previousPrepare, c.dataTimezone ?? c.timezone), end: end.toISOString().slice(0,10), timezone: c.dataTimezone ?? c.timezone, cutoff: `${cutoff} 00:00 (${c.dataTimezone ?? c.timezone}), exclusive` };
}
export function nextOccurrence(c: RecurringConfig, after = new Date()): OccurrenceWindow {
  let due = nextRun(c.frequency, schedule(c), c.timezone, after);
  if (!due) throw new Error("recurrence next");
  // New configurations never backdate preparation; skip a cycle whose preparation has passed.
  while (new Date(due.getTime() - c.leadHours * 3600000) <= after) {
    due = nextRun(c.frequency, schedule(c), c.timezone, due)!;
  }
  return occurrenceWindow(c, due);
}
export function automaticSendDecision(c: RecurringConfig, dueAt: string, now: Date, report: { status: string; version: number; approved_version: number | null } | null) {
  if (!c.enabled) return "paused";
  if (c.transport !== "approved_auto") return "prepare_only";
  if (now < new Date(dueAt)) return "not_due";
  if (now.getTime() > new Date(dueAt).getTime() + c.lateMinutes * 60000) return "late";
  if (!report || report.status !== "approved" || report.approved_version !== report.version) return "approval_required";
  return "send";
}
/** Last fully closed account calendar day. */
export function localClosedDate(now: Date, timezone: string) {
  const date = new Date(`${dateInZone(now, timezone)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate()-1); return date.toISOString().slice(0,10);
}

/** Configuration changes and pause/resume continue after the last finalized account day. */
export function continueOccurrenceWindow(window: OccurrenceWindow, previousEnd?: string | null): OccurrenceWindow | null {
  if (!previousEnd) return window;
  if (previousEnd >= window.end) return null;
  const start = new Date(`${previousEnd}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 1);
  return { ...window, start: start.toISOString().slice(0, 10) };
}
