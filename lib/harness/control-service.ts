import "server-only";
// Chef d'orchestre : contrôle quotidien (une fois par jour, à partir de 7 h, heure de Paris) de chaque client servi.
// Chaque écart ouvre un incident interne (source « system ») ; un écart disparu est résolu automatiquement.
// Aucune action externe, aucune publication, aucune réactivation : le contrôle constate et alerte, l'administrateur décide.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSchedulerHeartbeat, recordSchedulerHeartbeat } from "@/lib/scheduler/heartbeat";
import { openIncident } from "@/lib/agents/outputs";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import { loadClientSnapshot } from "./client-plan-service";
import { controlDue, controlFindings, controlFingerprint, controlPrefix } from "./control";

export const HARNESS_CONTROL = "harness_control";
const MAX_CLIENTS = 100;
const actor: Actor = { kind: "system", worker: "harness-control" };

export async function runHarnessControl(now = new Date(), options: { force?: boolean } = {}) {
  const last = await getSchedulerHeartbeat(HARNESS_CONTROL).catch(() => null);
  if (!options.force && !controlDue(now, last?.startedAt ?? null)) return { due: 0 };
  // Le jour est réservé avant le travail : un échec n'entraîne pas de nouvelles tentatives toutes les 15 minutes.
  await recordSchedulerHeartbeat({ name: HARNESS_CONTROL, startedAt: now });
  const db = getSupabaseServerClient();
  const { data: services, error } = await db.from("client_services").select("client_id").eq("lifecycle", "active").limit(1000);
  if (error) throw new Error("client services read");
  const clientIds = [...new Set((services ?? []).map((row) => row.client_id as string).filter(Boolean))].slice(0, MAX_CLIENTS);
  let opened = 0, resolved = 0, findings = 0, failed = 0;
  for (const clientId of clientIds) {
    try {
      const snapshot = await loadClientSnapshot(clientId, now);
      const current = controlFindings(snapshot.facts, snapshot.plan, now);
      findings += current.length;
      const keep = new Set(current.map((finding) => controlFingerprint(clientId, finding.code)));
      for (const finding of current) {
        const result = await openIncident(actor, { clientId, source: "system", severity: finding.severity, title: finding.title, fingerprint: controlFingerprint(clientId, finding.code), details: { harness: true, code: finding.code } });
        if (result.created) opened++;
      }
      const { data: open, error: openError } = await db.from("incidents").select("id,fingerprint").eq("client_id", clientId).eq("source", "system").neq("status", "resolved").like("fingerprint", `${controlPrefix(clientId)}%`).limit(200);
      if (openError) throw new Error("incidents read");
      const stale = (open ?? []).filter((row) => !keep.has(row.fingerprint as string)).map((row) => row.id as string);
      if (stale.length) {
        const { data: done, error: updateError } = await db.from("incidents").update({ status: "resolved", resolved_at: now.toISOString() }).in("id", stale).neq("status", "resolved").select("id");
        if (updateError) throw new Error("incidents update");
        for (const row of done ?? []) await writeAudit(actor, { action: "incident.resolved", resource_type: "incident", resource_id: row.id, metadata: { automatic: true, harness: true } });
        resolved += (done ?? []).length;
      }
    } catch {
      failed++;
    }
  }
  const finishedAt = new Date();
  await recordSchedulerHeartbeat({ name: HARNESS_CONTROL, startedAt: now, finishedAt, steps: { control: { status: failed ? "failed" : "ok", ms: finishedAt.getTime() - now.getTime(), counts: { clients: clientIds.length, findings, opened, resolved, failed } } } });
  return { due: 1, clients: clientIds.length, findings, opened, resolved, failed };
}
