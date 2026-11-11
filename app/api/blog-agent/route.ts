import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { generateBlogArticle } from "@/lib/blog-agent/service";

// Agent Blog : rédaction immédiate d'un article pour un client (administrateur, même origine). L'article est programmé
// 24 h plus tard et annoncé par une notification, comme ceux du planificateur ; rien n'est publié tout de suite.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const when = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ ok: false, message: "Requête refusée." }, { status: 403, headers });
  const { userId } = await requireAdmin();
  let clientId: unknown;
  try { clientId = ((await request.json()) as { client_id?: unknown }).client_id; } catch { clientId = null; }
  if (typeof clientId !== "string" || !UUID.test(clientId)) return NextResponse.json({ ok: false, message: "Client invalide." }, { status: 400, headers });
  const result = await generateBlogArticle(clientId, { trigger: "manual", actorId: userId });
  return NextResponse.json(result.ok ? { ...result, message: `Article « ${result.title} » rédigé (note SEO ${result.seoScore}/100${result.targetQuery ? `, recherche visée « ${result.targetQuery} »` : ""}) : publication prévue ${when.format(new Date(result.publishAt))}.` } : result, { status: result.ok ? 200 : 422, headers });
}
