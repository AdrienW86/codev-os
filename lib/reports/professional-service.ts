import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-admin";
import { writeAudit } from "@/lib/core/audit";
import type { Actor } from "@/lib/core/actor";
import type { Json } from "@/lib/supabase/database.types";
import { buildProfessionalReport, professionalReportSchema, type ProfessionalReportRequest } from "./professional";
import { gatherProfessionalSources } from "./professional-sources";
import { requireReportVersionStorage } from "./version-storage";

type Outcome = { ok: true; id: string; version: number; reused?: boolean } | { ok: false; message: string };
const db = () => getSupabaseServerClient();
const readColumns = "id,client_id,kind,scope,status,version";

/** Readiness is separate from credential presence and never probes a provider. */
export async function professionalReportingStatus() {
  const { data, error } = await db().rpc("codev_professional_reporting_ready", {});
  return !error && data === true;
}

function sameScope(a: unknown, b: ProfessionalReportRequest) {
  const parsed = professionalReportSchema.safeParse(a);
  return parsed.success && parsed.data.clientId === b.clientId && parsed.data.requestId === b.requestId
    && parsed.data.family === b.family && parsed.data.start === b.start && parsed.data.end === b.end
    && [...parsed.data.sources].sort().join(",") === [...b.sources].sort().join(",");
}

function content(built: ReturnType<typeof buildProfessionalReport>) {
  return {
    title: built.title, summary: built.client.summary,
    internal_content: built.internal as unknown as Json, client_content: built.client as unknown as Json,
    generated_at: new Date().toISOString(),
  };
}

/** A request identifier is consumed once; retries return the existing document, never regenerate it. */
export async function generateProfessionalReport(actor: Actor & { kind: "admin" }, raw: unknown): Promise<Outcome> {
  await requireAdmin();
  const parsed = professionalReportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Vérifiez le client, la famille, les sources et les dates (366 jours maximum)." };
  const input = parsed.data;
  if (!await professionalReportingStatus()) return { ok: false, message: "Le reporting personnalisé nécessite la migration 20261110000000. Les rapports existants restent accessibles." };
  await requireReportVersionStorage();
  const { data: existing, error: readError } = await db().from("reports").select(readColumns).eq("id", input.requestId).maybeSingle();
  if (readError) throw new Error("report read");
  if (existing) {
    if (existing.kind !== "custom" || !sameScope(existing.scope, input)) return { ok: false, message: "Cette demande a déjà été utilisée avec un autre périmètre. Recommencez une nouvelle préparation." };
    return { ok: true, id: existing.id, version: existing.version, reused: true };
  }
  const gathered = await gatherProfessionalSources(input);
  const built = buildProfessionalReport(input, gathered.clientName, gathered.sources);
  const { data: created, error } = await db().from("reports").insert({
    id: input.requestId, client_id: input.clientId, kind: "custom", period_start: input.start, period_end: input.end,
    scope: input as unknown as Json, status: "ready_for_review", version: 1, ...content(built),
  }).select("id,version").single();
  if (error?.code === "23505") {
    // A competing request may have completed while the read-only sources were collected.
    const { data: winner, error: winnerError } = await db().from("reports").select(readColumns).eq("id", input.requestId).maybeSingle();
    if (!winnerError && winner?.kind === "custom" && sameScope(winner.scope, input)) return { ok: true, id: winner.id, version: winner.version, reused: true };
  }
  if (error || !created) throw new Error("report insert");
  await writeAudit(actor, { action: "report.generated", resource_type: "report", resource_id: created.id, metadata: { client_id: input.clientId, kind: "custom", family: input.family, sources: input.sources, period_start: input.start, period_end: input.end } });
  return { ok: true, id: created.id, version: created.version };
}

/** Refresh uses the stored scope only. Optimistic version checks preserve approval and send guards. */
export async function regenerateProfessionalReport(actor: Actor & { kind: "admin" }, id: string, expectedVersion: number): Promise<Outcome> {
  await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1) return { ok: false, message: "Rapport invalide." };
  await requireReportVersionStorage();
  const { data: report, error } = await db().from("reports").select(readColumns).eq("id", id).maybeSingle();
  if (error) throw new Error("report read");
  const parsed = professionalReportSchema.safeParse(report?.scope);
  if (!report || report.kind !== "custom" || !parsed.success || report.version !== expectedVersion || ["sent", "archived"].includes(report.status)) return { ok: false, message: "Ce rapport a changé ou ne peut plus être actualisé. Rechargez la version actuelle." };
  const gathered = await gatherProfessionalSources(parsed.data);
  const built = buildProfessionalReport(parsed.data, gathered.clientName, gathered.sources);
  const version = report.version + 1;
  const { data: updated, error: updateError } = await db().from("reports").update({
    ...content(built), version, status: "ready_for_review", approved_at: null, approved_by: null, approved_version: null,
  }).eq("id", id).eq("version", expectedVersion).in("status", ["draft", "ready_for_review", "approved"]).select("id");
  if (updateError?.code === "55000") return { ok: false, message: "L’envoi est en cours ou incertain : l’actualisation reste bloquée." };
  if (updateError) throw new Error("report update");
  if (!updated?.length) return { ok: false, message: "Le rapport a changé pendant l’actualisation. Rechargez-le." };
  await writeAudit(actor, { action: "report.regenerated", resource_type: "report", resource_id: id, metadata: { version } });
  return { ok: true, id, version };
}
