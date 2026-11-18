import "server-only";
// Bloc « Ce que l'agence a fait » de l'accueil : simples comptages sur les dernières 24 h (lecture seule).
// Un comptage illisible vaut null (jamais zéro) ; une table absente (module non installé) vaut undefined.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { ActivityCounts } from "./overview";

type CountResult = PromiseLike<{ count: number | null; error: { code?: string; message?: string } | null }>;
const missingTable = (e: { code?: string; message?: string }) => /42P01|PGRST205/.test(String(e.code)) || /could not find the table|does not exist/i.test(e.message ?? "");

async function count(query: CountResult, optional = false): Promise<number | null | undefined> {
  try {
    const r = await query;
    if (r.error) return optional && missingTable(r.error) ? undefined : null;
    return r.count ?? 0;
  } catch { return null; }
}

export async function loadActivity(now = new Date()): Promise<ActivityCounts> {
  const db = getSupabaseServerClient();
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const head = { count: "exact" as const, head: true };
  const [published, reportsBuilt, reportsAutoApproved, runsSucceeded, runsFailed, imagesGenerated, incidentsResolved] = await Promise.all([
    count(db.from("publication_deliveries").select("id", head).eq("status", "published").gte("published_at", since)),
    count(db.from("reports").select("id", head).gte("generated_at", since)),
    count(db.from("audit_logs").select("id", head).eq("action", "report.auto_approved").gte("created_at", since)),
    count(db.from("jobs").select("id", head).eq("status", "succeeded").gte("finished_at", since)),
    count(db.from("jobs").select("id", head).eq("status", "failed").gte("finished_at", since)),
    count(db.from("publication_generated_images" as never).select("id", head).gte("created_at", since) as unknown as CountResult, true),
    count(db.from("incidents").select("id", head).eq("status", "resolved").gte("resolved_at", since)),
  ]);
  return {
    published: published ?? null, reportsBuilt: reportsBuilt ?? null, reportsAutoApproved: reportsAutoApproved ?? null,
    runsSucceeded: runsSucceeded ?? null, runsFailed: runsFailed ?? null, imagesGenerated, incidentsResolved: incidentsResolved ?? null,
  };
}
