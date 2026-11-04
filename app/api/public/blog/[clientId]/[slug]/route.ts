import { publishedArticle } from "@/lib/blog-agent/service";

// API publique en lecture seule : un article publié (HTML sûr déjà rendu + Markdown d'origine).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ clientId: string; slug: string }> }) {
  const { clientId, slug } = await params;
  try {
    const article = await publishedArticle(clientId, slug);
    if (!article) return Response.json({ error: "not_found" }, { status: 404, headers: { ...headers, "Cache-Control": "public, s-maxage=60" } });
    return Response.json({ article }, { headers: { ...headers, "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { ...headers, "Cache-Control": "no-store" } });
  }
}
export function OPTIONS() { return new Response(null, { status: 204, headers }); }
