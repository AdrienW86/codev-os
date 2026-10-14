import { z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import { readOriginal } from "@/lib/whatsapp/library";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Prévisualisation interne d'un original Drive : administrateur uniquement, client et média vérifiés ensemble,
// jamais mis en cache ni proposé au téléchargement public.
export async function GET(_request: Request, ctx: RouteContext<"/api/media-library/[clientId]/[assetId]">) {
  await requireAdmin();
  const { clientId, assetId } = await ctx.params;
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!z.uuid().safeParse(clientId).success || !z.uuid().safeParse(assetId).success) return new Response("Introuvable", { status: 404, headers });
  try {
    const original = await readOriginal(clientId, assetId);
    if (!original) return new Response("Introuvable", { status: 404, headers });
    return new Response(Buffer.from(original.bytes), { headers: { ...headers, "Content-Type": original.mime, "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox" } });
  } catch {
    console.error("[media-library] Original indisponible.");
    return new Response("Original indisponible", { status: 503, headers });
  }
}
