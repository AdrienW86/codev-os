import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { writeAudit } from "@/lib/core/audit";
import { completeSearchConsoleOAuth, oauthReturnPath } from "@/lib/integrations/search-console/connection";

// Callback OAuth Google Search Console : derrière le proxy Clerk (administrateur uniquement) et requireAdmin.
// État validé et consommé avant tout échange de code. Toujours une redirection 303 vers un chemin INTERNE fixe, sans
// cache ni référent, pour que le code présent dans l'URL ne soit transmis nulle part.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { userId } = await requireAdmin();
  const result = await completeSearchConsoleOAuth(userId, request.nextUrl.searchParams);
  await writeAudit({ kind: "admin", userId }, {
    action: result.outcome === "success" || result.outcome === "partial" ? "connection.search_console.connected" : "connection.search_console.failed",
    resource_type: "client_connection", resource_id: result.connectionId, metadata: { provider: "search-console", outcome: result.outcome, properties: result.properties },
  }).catch(() => undefined);
  const response = NextResponse.redirect(new URL(oauthReturnPath(result.outcome), request.nextUrl.origin), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
