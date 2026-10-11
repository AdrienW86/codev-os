// Automatisations : validation des saisies et modèles recommandés (fonctions pures, testables).
import { z } from "zod";
import { runTypes, type RunType } from "@/lib/agents/registry";
import { isValidTimezone, nextRun, scheduleSchema, zonedToUtc, type Frequency, type Schedule } from "@/lib/scheduler/recurrence";

export const DEFAULT_TIMEZONE = "Europe/Paris";

/** Paramètres acceptés par type d'exécution : rien d'autre n'est transmis au handler. */
export const runConfigSchemas: Record<RunType, z.ZodType<Record<string, unknown>>> = {
  "ads.report.prepare": z.object({ occurrenceId: z.uuid() }).strict(),
  "ads.report.send": z.object({ occurrenceId: z.uuid() }).strict(),

  "report.generate": z.object({ kind: z.enum(["weekly", "monthly"]).default("weekly") }).strict(),
  "monitoring.check_sites": z.object({}).strict(),
  "seo.analyze": z.object({}).strict(),
  "ads.monitor": z.object({}).strict(),
  "news.fetch": z.object({}).strict(),
};

const runTypeIds = Object.keys(runTypes) as [RunType, ...RunType[]];

export const automationInputSchema = z.object({
  name: z.string().trim().min(2, "Nom trop court.").max(120, "Nom trop long."),
  runType: z.enum(runTypeIds, "Type d’exécution inconnu."),
  clientId: z.uuid().nullable(),
  frequency: z.enum(["once", "daily", "weekly", "monthly"]),
  timezone: z.string().default(DEFAULT_TIMEZONE),
  schedule: z.record(z.string(), z.unknown()),
  config: z.record(z.string(), z.unknown()).default({}),
}).strict();

export type AutomationInput = z.input<typeof automationInputSchema>;
export type ValidAutomation = { name: string; runType: RunType; clientId: string | null; frequency: Frequency; timezone: string; schedule: Schedule; config: Record<string, unknown>; nextRunAt: string };

export function validateAutomation(input: unknown, now = new Date()): { ok: true; value: ValidAutomation } | { ok: false; message: string } {
  const parsed = automationInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Saisie invalide." };
  const { runType, clientId, frequency, timezone } = parsed.data;
  if (runTypes[runType].scope === "client" && !clientId) return { ok: false, message: "Ce type d’exécution nécessite un client." };
  const raw = { ...parsed.data.schedule };
  if ("runAtLocal" in raw) {
    const match = typeof raw.runAtLocal === "string" ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw.runAtLocal) : null;
    if (!match || !isValidTimezone(timezone)) return { ok: false, message: "Date d’exécution invalide." };
    const [, y, mo, d, h, mi] = match.map(Number);
    delete raw.runAtLocal;
    raw.runAt = zonedToUtc(y, mo, d, h, mi, timezone).toISOString();
  }
  const schedule = scheduleSchema.safeParse({ frequency, timezone, schedule: raw });
  if (!schedule.success) return { ok: false, message: schedule.error.issues[0]?.message ?? "Planification invalide." };
  const config = runConfigSchemas[runType].safeParse(parsed.data.config);
  if (!config.success) return { ok: false, message: "Paramètres d’exécution invalides." };
  const next = nextRun(frequency, schedule.data.schedule, timezone, now);
  if (!next) return { ok: false, message: "La date d’exécution est déjà passée." };
  return { ok: true, value: { name: parsed.data.name, runType, clientId, frequency, timezone, schedule: schedule.data.schedule, config: config.data, nextRunAt: next.toISOString() } };
}

/** Formulaire HTML → saisie structurée (jours cochés, heure, date unique). */
export function automationFromForm(form: { get(name: string): unknown; getAll(name: string): unknown[] }) {
  const text = (name: string) => { const value = form.get(name); return typeof value === "string" ? value.trim() : ""; };
  const frequency = text("frequency");
  const schedule: Record<string, unknown> = {};
  if (frequency === "once") {
    const local = text("run_at");
    // Saisie locale « AAAA-MM-JJTHH:MM » interprétée dans le fuseau : conversion faite côté serveur.
    if (local) schedule.runAtLocal = local;
  } else {
    if (text("time")) schedule.time = text("time");
    if (frequency === "weekly") schedule.weekdays = form.getAll("weekdays").map((value) => Number(value)).filter((value) => Number.isInteger(value));
    if (frequency === "monthly") schedule.monthDay = Number(text("month_day"));
  }
  const kind = text("kind");
  return {
    name: text("name"), runType: text("run_type"), clientId: text("client_id") || null, frequency,
    timezone: text("timezone") || DEFAULT_TIMEZONE, schedule, config: kind ? { kind } : {},
  };
}

export type AutomationPreset = { id: string; name: string; runType: RunType; frequency: Frequency; schedule: Schedule; config: Record<string, unknown>; why: string };

/** Automatisations recommandées : créées en un clic, modifiables, jamais actives sans action de l'administrateur. */
export const automationPresets: AutomationPreset[] = [
  { id: "weekly-reports", name: "Rapports hebdomadaires", runType: "report.generate", frequency: "weekly", schedule: { time: "08:00", weekdays: [1] }, config: { kind: "weekly" }, why: "Chaque lundi, un rapport à relire pour chaque client suivi." },
  { id: "monthly-reports", name: "Rapports mensuels", runType: "report.generate", frequency: "monthly", schedule: { time: "08:00", monthDay: 1 }, config: { kind: "monthly" }, why: "Le 1er du mois, le bilan du mois écoulé." },
  { id: "site-checks", name: "Contrôle des sites", runType: "monitoring.check_sites", frequency: "daily", schedule: { time: "07:00" }, config: {}, why: "Chaque matin : disponibilité et temps de réponse des sites suivis." },
  { id: "tech-watch", name: "Veille tech & IA", runType: "news.fetch", frequency: "daily", schedule: { time: "06:30" }, config: {}, why: "Les actualités utiles, triées, avant de commencer la journée." },
];
