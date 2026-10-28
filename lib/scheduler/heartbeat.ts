import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

// Battement du planificateur (/api/internal/scheduler/tick) : une ligne par nom dans public.scheduler_heartbeats,
// réécrite à chaque passage (service_role uniquement). Lot 7 l'affiche ; lot 8 y ajoute son étape de purge.
// Contrat des étapes : nom stable → { status, ms, counts? }. Jamais de texte, d'identifiant ni de contenu : seuls des
// compteurs entiers. Un échec d'écriture n'interrompt jamais le passage.
export const SCHEDULER_HEARTBEAT = "scheduler_tick";
// Noms stables (ordre d'exécution du tick). Ne pas renommer : la supervision les lit.
export const schedulerSteps = ["whatsapp_exports", "automations", "publication_auto_approval", "publication_delivery_prepare", "publication_delivery_send", "push", "search_console", "whatsapp", "media_intelligence", "publication_preparation"] as const;
export type SchedulerStepName = (typeof schedulerSteps)[number];
export type SchedulerStepStatus = "ok" | "failed" | "skipped" | "disabled";
export type SchedulerStep = { status: SchedulerStepStatus; ms: number; counts?: Record<string, number> };
export type SchedulerHeartbeat = { name: string; startedAt: string; finishedAt: string | null; ok: boolean; steps: Record<string, SchedulerStep>; lastSuccessAt: string | null; lastFailureAt: string | null };

type Returning = PromiseLike<{ data: unknown; error: unknown }>;
type Filter = { eq(column: string, value: string): Filter; is(column: string, value: null): Filter; not(column: string, operator: "is", value: null): Filter; lt(column: string, value: string): Filter; select(columns: string): Returning };
type HeartbeatDb = { from(table: "scheduler_heartbeats"): {
  upsert(row: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates?: boolean }): PromiseLike<{ error: unknown }> & { select(columns: string): Returning };
  update(row: Record<string, unknown>): Filter;
  select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } };
} };
const productionDb = () => getSupabaseServerClient() as unknown as HeartbeatDb;
const statuses = new Set<SchedulerStepStatus>(["ok", "failed", "skipped", "disabled"]);
const KEY = /^[a-z][a-z0-9_]{0,39}$/;

// Compteurs entiers d'un résumé d'étape (profondeur 2 au plus, 12 clés) ; tout le reste est ignoré.
export function stepCounts(summary: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  const visit = (value: unknown, prefix: string, depth: number) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) return;
    for (const [key, item] of Object.entries(value)) {
      const name = prefix ? `${prefix}_${key}` : key;
      if (Object.keys(counts).length >= 12) return;
      if (typeof item === "number" && Number.isInteger(item) && item >= 0 && KEY.test(name)) counts[name] = Math.min(item, 1_000_000);
      else if (typeof item === "boolean" && KEY.test(name)) counts[name] = item ? 1 : 0;
      else visit(item, name, depth + 1);
    }
  };
  visit(summary, "", 1);
  return counts;
}
function sanitize(steps: Record<string, SchedulerStep>): Record<string, SchedulerStep> {
  const out: Record<string, SchedulerStep> = {};
  for (const [name, step] of Object.entries(steps).slice(0, 20)) {
    if (!KEY.test(name) || !statuses.has(step?.status)) continue;
    const ms = Number.isFinite(step.ms) ? Math.max(0, Math.min(Math.round(step.ms), 3_600_000)) : 0;
    out[name] = step.counts ? { status: step.status, ms, counts: stepCounts(step.counts) } : { status: step.status, ms };
  }
  return out;
}

/** Bail d'un passage : au-delà de maxDuration (300 s, coupure par la plateforme) plus une marge, un passage jamais
 * terminé est considéré interrompu et le passage suivant reprend la main. */
export const SCHEDULER_LEASE_MS = 330_000;
const hasRow = (data: unknown) => Array.isArray(data) && data.length > 0;

/**
 * Verrou du planificateur porté par la ligne de battement (aucune table ni migration supplémentaire) : un seul passage
 * à la fois. Compare-and-set atomique côté base : la ligne est prise si le passage précédent est terminé
 * (finished_at renseigné) ou interrompu (commencé depuis plus de leaseMs). Le gagnant écrit started_at = son début,
 * finished_at = null : c'est aussi le battement « passage en cours » lu par le diagnostic.
 * Retourne "claimed", "busy" (un autre passage est en cours) ou "unavailable" (base illisible : on ne lance rien).
 */
export async function claimSchedulerRun(startedAt: Date, options: { name?: string; leaseMs?: number } = {}, db: HeartbeatDb = productionDb()): Promise<"claimed" | "busy" | "unavailable"> {
  const name = options.name ?? SCHEDULER_HEARTBEAT;
  if (!KEY.test(name)) return "unavailable";
  const started = startedAt.toISOString();
  const row = { name, started_at: started, finished_at: null, updated_at: started };
  try {
    // Toute première exécution : insertion si la ligne n'existe pas encore (ON CONFLICT DO NOTHING).
    const first = await db.from("scheduler_heartbeats").upsert(row, { onConflict: "name", ignoreDuplicates: true }).select("name");
    if (first.error) throw new Error("heartbeat");
    if (hasRow(first.data)) return "claimed";
    const table = () => db.from("scheduler_heartbeats");
    const done = await table().update(row).eq("name", name).not("finished_at", "is", null).select("name");
    if (done.error) throw new Error("heartbeat");
    if (hasRow(done.data)) return "claimed";
    const stale = new Date(startedAt.getTime() - (options.leaseMs ?? SCHEDULER_LEASE_MS)).toISOString();
    const resumed = await table().update(row).eq("name", name).is("finished_at", null).lt("started_at", stale).select("name");
    if (resumed.error) throw new Error("heartbeat");
    if (hasRow(resumed.data)) { console.error("[scheduler] Passage précédent interrompu : reprise."); return "claimed"; }
    return "busy";
  } catch { console.error("[scheduler] Verrou du planificateur indisponible."); return "unavailable"; }
}

/**
 * Fin d'un passage verrouillé : écrite seulement si la ligne porte encore son started_at (fencing). Un passage
 * interrompu puis dépassé par une reprise ne peut ni libérer le verrou du suivant ni écraser son battement.
 */
export async function finishSchedulerRun(input: { name?: string; startedAt: Date; finishedAt: Date; steps: Record<string, SchedulerStep> }, db: HeartbeatDb = productionDb()): Promise<boolean> {
  const name = input.name ?? SCHEDULER_HEARTBEAT;
  if (!KEY.test(name)) return false;
  const now = input.finishedAt.toISOString();
  const steps = sanitize(input.steps);
  const ok = !Object.values(steps).some((step) => step.status === "failed");
  try {
    const { data, error } = await db.from("scheduler_heartbeats")
      .update({ finished_at: now, updated_at: now, ok, steps: steps as unknown as Json, [ok ? "last_success_at" : "last_failure_at"]: now })
      .eq("name", name).eq("started_at", input.startedAt.toISOString()).is("finished_at", null).select("name");
    if (error) throw new Error("heartbeat");
    if (!hasRow(data)) { console.error("[scheduler] Battement non enregistré : passage repris par un autre."); return false; }
    return true;
  } catch { console.error("[scheduler] Battement non enregistré."); return false; }
}

/** Début (finishedAt absent : passage en cours) ou fin d'un passage. Retourne false si rien n'a été écrit. */
export async function recordSchedulerHeartbeat(input: { name?: string; startedAt: Date; finishedAt?: Date | null; steps?: Record<string, SchedulerStep> }, db: HeartbeatDb = productionDb()): Promise<boolean> {
  const name = input.name ?? SCHEDULER_HEARTBEAT;
  if (!KEY.test(name)) return false;
  const now = (input.finishedAt ?? new Date()).toISOString();
  const row: Record<string, unknown> = { name, started_at: input.startedAt.toISOString(), finished_at: input.finishedAt ? input.finishedAt.toISOString() : null, updated_at: now };
  if (input.finishedAt) {
    const steps = sanitize(input.steps ?? {});
    const ok = !Object.values(steps).some((step) => step.status === "failed");
    // Colonnes absentes de l'upsert inchangées : le dernier succès survit à un échec, et inversement.
    Object.assign(row, { ok, steps: steps as unknown as Json, [ok ? "last_success_at" : "last_failure_at"]: now });
  }
  try {
    const { error } = await db.from("scheduler_heartbeats").upsert(row, { onConflict: "name" });
    if (error) throw new Error("heartbeat");
    return true;
  } catch { console.error("[scheduler] Battement non enregistré."); return false; }
}

export async function getSchedulerHeartbeat(name: string = SCHEDULER_HEARTBEAT, db: HeartbeatDb = productionDb()): Promise<SchedulerHeartbeat | null> {
  if (!KEY.test(name)) return null;
  const { data, error } = await db.from("scheduler_heartbeats").select("name,started_at,finished_at,ok,steps,last_success_at,last_failure_at").eq("name", name).maybeSingle();
  if (error) throw new Error("Battement du planificateur indisponible.");
  const r = data as { name: string; started_at: string; finished_at: string | null; ok: boolean; steps: unknown; last_success_at: string | null; last_failure_at: string | null } | null;
  if (!r) return null;
  const steps = r.steps && typeof r.steps === "object" && !Array.isArray(r.steps) ? sanitize(r.steps as Record<string, SchedulerStep>) : {};
  return { name: r.name, startedAt: r.started_at, finishedAt: r.finished_at, ok: r.ok === true, steps, lastSuccessAt: r.last_success_at, lastFailureAt: r.last_failure_at };
}
