import { timingSafeEqual } from "node:crypto";
import { processImageBatch } from "@/lib/whatsapp/service";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return new Response("Refusé", { status: 401 });
  try { return Response.json(await processImageBatch({ kind: "system", worker: "whatsapp-import" }), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ status: "unavailable" }, { status: 503 }); }
}

// Les crons Vercel utilisent GET ; même authentification et même traitement que POST.
export const GET = POST;
