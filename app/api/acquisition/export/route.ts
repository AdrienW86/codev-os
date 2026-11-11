import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { MULTISOURCE_PROSPECT_COLUMNS, PRESCRIBER_PROSPECT_COLUMNS, withoutExpiredPlacesData } from "@/lib/acquisition/data";
import { csvFilename, prospectsToCsv } from "@/lib/acquisition/csv";
import type { AcquisitionProspect } from "@/lib/acquisition/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "private, no-store, max-age=0" };
/** Plafond par fichier : reste sous la limite de taille de réponse de la plateforme (~4,5 Mo). */
const EXPORT_MAX_ROWS = 10_000;
const CATEGORIES = new Set(["prescriber", "zone_company"]);

/** Export privé des prospects d'un espace client (prescripteurs et/ou entreprises de la zone), réservé à l'administrateur. */
export async function GET(request: Request) {
  await requireAdmin();
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get("workspace") ?? "";
  const category = params.get("category") ?? "";
  const withEmail = params.get("with_email") === "1";
  if (!uuid.test(workspaceId) || (category && !CATEGORIES.has(category))) return new Response("Paramètres invalides.", { status: 400, headers: noStore });
  const db = getSupabaseServerClient() as unknown as SupabaseClient;
  const { data: workspace } = await db.from("acquisition_workspaces").select("id,label").eq("id", workspaceId).maybeSingle();
  if (!workspace) return new Response("Espace introuvable.", { status: 404, headers: noStore });

  const read = async (columns: string) => {
    const rows: AcquisitionProspect[] = [];
    for (let from = 0; from < EXPORT_MAX_ROWS; from += 1000) {
      let q = db.from("acquisition_prospects").select(columns).eq("workspace_id", workspaceId).neq("stage", "excluded")
        .in("category", category ? [category] : [...CATEGORIES]);
      if (withEmail) q = q.not("contact_email", "is", null);
      const { data, error } = await q.order("score", { ascending: false, nullsFirst: false }).order("id").range(from, Math.min(from + 999, EXPORT_MAX_ROWS - 1));
      if (error) return null;
      rows.push(...((data ?? []) as unknown as AcquisitionProspect[]));
      if (!data || data.length < 1000) break;
    }
    return rows;
  };
  const rows = (await read(MULTISOURCE_PROSPECT_COLUMNS)) ?? (withEmail ? null : await read(PRESCRIBER_PROSPECT_COLUMNS));
  if (!rows) return new Response("Données indisponibles.", { status: 503, headers: noStore });
  const csv = prospectsToCsv(rows.map((p) => withoutExpiredPlacesData(p)));
  return new Response(csv, { status: 200, headers: { ...noStore,
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${csvFilename(workspace.label)}"`,
  } });
}
