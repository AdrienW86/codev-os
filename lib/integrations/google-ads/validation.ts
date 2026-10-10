import type { AdsPeriod } from "./types";
import { MAX_PERIOD_DAYS } from "./periods";

export function normalizeCustomerId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/.test(trimmed)) return null;
  return trimmed.replaceAll("-", "");
}

export function readFormText(data: FormData, key: string): string | null {
  const entries = data.getAll(key);
  return entries.length === 1 && typeof entries[0] === "string" ? entries[0].trim() : null;
}

export function getAdsPeriod(timezone: string, days = 30, now = new Date()): AdsPeriod {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("Période invalide.");
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const today = Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day")));
  const date = (offset: number) => new Date(today - offset * 86400000).toISOString().slice(0, 10);
  return { start: date(days), end: date(1), days };
}

export function validatePeriod(period: AdsPeriod) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.start) || !/^\d{4}-\d{2}-\d{2}$/.test(period.end)) throw new Error("Période invalide.");
  const start = Date.parse(period.start), end = Date.parse(period.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || (end - start) / 86400000 + 1 !== period.days || !Number.isInteger(period.days) || period.days < 1 || period.days > MAX_PERIOD_DAYS) throw new Error("Période invalide.");
}
