import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { writeAudit } from "@/lib/core/audit";
import { completeGa4OAuth } from "@/lib/integrations/ga4/connection";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const { userId } = await requireAdmin();
  const result = await completeGa4OAuth(userId, request.nextUrl.searchParams);
  await writeAudit({ kind: "admin", userId }, {
    action: result.outcome === "success" || result.outcome === "partial" ? "connection.google_analytics.connected" : "connection.google_analytics.failed",
    resource_type: "client_connection", resource_id: result.connectionId,
    metadata: { provider: "google-analytics", outcome: result.outcome, properties: result.properties },
  }).catch(() => undefined);
  // Jamais de redirection externe avec le code ou l'état OAuth.
  const response = NextResponse.redirect(new URL(`/settings?tab=connections&ga4=${result.outcome}`, request.nextUrl.origin), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
