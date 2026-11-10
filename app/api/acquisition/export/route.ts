import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PRESCRIBER_PROSPECT_COLUMNS, withoutExpiredPlacesData } from "@/lib/acquisition/data";
import { csvFilename, prospectsToCsv } from "@/lib/acquisition/csv";
import type { AcquisitionProspect } from "@/lib/acquisition/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

/** Export privé des prescripteurs d'un espace client, réservé à l'administrateur. */
export async function GET(request: Request) {
  await requireAdmin();
  const workspaceId = new URL(request.url).searchParams.get("workspace") ?? "";
  if (!uuid.test(workspaceId)) return new Response("Espace invalide.", { status: 400, headers: noStore });
  const db = getSupabaseServerClient() as unknown as SupabaseClient;
  const { data: workspace } = await db.from("acquisition_workspaces").select("id,label").eq("id", workspaceId).maybeSingle();
  if (!workspace) return new Response("Espace introuvable.", { status: 404, headers: noStore });
  const { data, error } = await db.from("acquisition_prospects").select(PRESCRIBER_PROSPECT_COLUMNS)
    .eq("workspace_id", workspaceId).eq("category", "prescriber").neq("stage", "excluded")
    .order("score", { ascending: false, nullsFirst: false }).limit(2000);
  if (error) return new Response("Données indisponibles.", { status: 503, headers: noStore });
  const csv = prospectsToCsv(((data ?? []) as unknown as AcquisitionProspect[]).map((p) => withoutExpiredPlacesData(p)));
  return new Response(csv, { status: 200, headers: { ...noStore,
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${csvFilename(workspace.label)}"`,
  } });
}
