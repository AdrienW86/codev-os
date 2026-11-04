import { publishedArticles } from "@/lib/blog-agent/service";

// API publique en lecture seule (sites des clients) : articles publiés d'un client, sans corps. Aucune session,
// aucune donnée non publiée ; mise en cache courte côté CDN. CORS ouvert en lecture (GET seulement).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "X-Content-Type-Options": "nosniff" };
const cache = "public, s-maxage=300, stale-while-revalidate=3600";

export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  try {
    const articles = await publishedArticles(clientId, Number.isFinite(limit) ? limit : 50);
    if (!articles) return Response.json({ error: "not_found" }, { status: 404, headers: { ...headers, "Cache-Control": "no-store" } });
    return Response.json({ articles }, { headers: { ...headers, "Cache-Control": cache } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { ...headers, "Cache-Control": "no-store" } });
  }
}
export function OPTIONS() { return new Response(null, { status: 204, headers }); }
